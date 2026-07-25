// audiotap — capture system audio + microphone to a 16 kHz mono WAV.
// Usage: audiotap /path/to/out.wav   (stops + finalizes on SIGINT/SIGTERM)
// Requires: macOS 15+, Screen Recording + Microphone permissions.

import AVFoundation
import Foundation
import ScreenCaptureKit

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: audiotap <out.wav>\n".data(using: .utf8)!)
    exit(2)
}
let outPath = CommandLine.arguments[1]

let SAMPLE_RATE: Double = 16000
let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: SAMPLE_RATE,
                              channels: 1, interleaved: false)!

// ---------- WAV writer (16-bit PCM mono) ----------

final class WavWriter {
    private let handle: FileHandle
    private var dataBytes: UInt32 = 0

    init(path: String) throws {
        FileManager.default.createFile(atPath: path, contents: nil)
        guard let h = FileHandle(forWritingAtPath: path) else {
            throw NSError(domain: "audiotap", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "cannot open \(path)"])
        }
        handle = h
        handle.write(Self.header(dataBytes: 0))
    }

    static func header(dataBytes: UInt32) -> Data {
        var d = Data()
        func put(_ s: String) { d.append(s.data(using: .ascii)!) }
        func put32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func put16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        let rate = UInt32(SAMPLE_RATE)
        put("RIFF"); put32(36 + dataBytes); put("WAVE")
        put("fmt "); put32(16); put16(1); put16(1)          // PCM, mono
        put32(rate); put32(rate * 2); put16(2); put16(16)   // byte rate, block align, bits
        put("data"); put32(dataBytes)
        return d
    }

    func append(_ samples: [Float]) {
        var pcm = [Int16](repeating: 0, count: samples.count)
        for i in 0..<samples.count {
            pcm[i] = Int16(max(-1, min(1, samples[i])) * 32767)
        }
        let data = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
        handle.write(data)
        dataBytes += UInt32(data.count)
    }

    func finalize() {
        try? handle.seek(toOffset: 0)
        handle.write(Self.header(dataBytes: dataBytes))
        try? handle.close()
    }
}

// ---------- capture ----------

extension CMSampleBuffer {
    func toPCMBuffer() -> AVAudioPCMBuffer? {
        guard let fd = CMSampleBufferGetFormatDescription(self),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fd) else { return nil }
        var asbd = asbdPtr.pointee
        guard let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let n = AVAudioFrameCount(CMSampleBufferGetNumSamples(self))
        guard n > 0, let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: n) else { return nil }
        pcm.frameLength = n
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            self, at: 0, frameCount: Int32(n), into: pcm.mutableAudioBufferList)
        return status == noErr ? pcm : nil
    }
}

final class Tap: NSObject, SCStreamOutput, SCStreamDelegate {
    private var sys: [Float] = []
    private var mic: [Float] = []
    private let lock = NSLock()
    private var converters: [ObjectIdentifier: AVAudioConverter] = [:]
    private var converterFormats: [ObjectIdentifier: AVAudioFormat] = [:]
    private var sysConverter: AVAudioConverter?
    private var micConverter: AVAudioConverter?
    let writer: WavWriter

    init(writer: WavWriter) { self.writer = writer }

    private func toMono16k(_ pcm: AVAudioPCMBuffer, isMic: Bool) -> [Float] {
        let converter: AVAudioConverter
        if isMic {
            if micConverter == nil || micConverter!.inputFormat != pcm.format {
                micConverter = AVAudioConverter(from: pcm.format, to: outFormat)
            }
            guard let c = micConverter else { return [] }
            converter = c
        } else {
            if sysConverter == nil || sysConverter!.inputFormat != pcm.format {
                sysConverter = AVAudioConverter(from: pcm.format, to: outFormat)
            }
            guard let c = sysConverter else { return [] }
            converter = c
        }
        let ratio = SAMPLE_RATE / pcm.format.sampleRate
        let capacity = AVAudioFrameCount(Double(pcm.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return [] }
        var fed = false
        converter.convert(to: out, error: nil) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return pcm
        }
        guard let ch = out.floatChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio || type == .microphone, let pcm = sb.toPCMBuffer() else { return }
        let mono = toMono16k(pcm, isMic: type == .microphone)
        guard !mono.isEmpty else { return }
        lock.lock()
        if type == .microphone { mic.append(contentsOf: mono) } else { sys.append(contentsOf: mono) }
        lock.unlock()
    }

    // Mix whatever both queues have; if one side stalls > 1 s, pad it with silence.
    func drain(final: Bool = false) {
        lock.lock()
        var n = min(sys.count, mic.count)
        let staleThreshold = Int(SAMPLE_RATE) // 1 s
        if final || sys.count > mic.count + staleThreshold || mic.count > sys.count + staleThreshold {
            n = max(sys.count, mic.count)
        }
        guard n > 0 else { lock.unlock(); return }
        var mixed = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let a = i < sys.count ? sys[i] : 0
            let b = i < mic.count ? mic[i] : 0
            mixed[i] = (a + b) * 0.7
        }
        sys.removeFirst(min(n, sys.count))
        mic.removeFirst(min(n, mic.count))
        lock.unlock()
        writer.append(mixed)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write("stream stopped: \(error.localizedDescription)\n".data(using: .utf8)!)
        shutdown(code: 1)
    }
}

// ---------- lifecycle ----------

var globalStream: SCStream?
var globalTap: Tap?

func shutdown(code: Int32) {
    globalTap?.drain(final: true)
    globalTap?.writer.finalize()
    exit(code)
}

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let sigintSrc = DispatchSource.makeSignalSource(signal: SIGINT)
let sigtermSrc = DispatchSource.makeSignalSource(signal: SIGTERM)
for src in [sigintSrc, sigtermSrc] {
    src.setEventHandler {
        globalStream?.stopCapture { _ in shutdown(code: 0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { shutdown(code: 0) }
    }
    src.resume()
}

Task {
    do {
        let writer = try WavWriter(path: outPath)
        let tap = Tap(writer: writer)
        globalTap = tap

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            FileHandle.standardError.write("no display found\n".data(using: .utf8)!)
            shutdown(code: 1); return
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.captureMicrophone = true
        config.sampleRate = Int(SAMPLE_RATE)
        config.channelCount = 1
        // minimal video (SCK requires a video output config even for audio-only use)
        config.width = 2; config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: tap)
        globalStream = stream
        try stream.addStreamOutput(tap, type: .audio, sampleHandlerQueue: DispatchQueue(label: "sys-audio"))
        try stream.addStreamOutput(tap, type: .microphone, sampleHandlerQueue: DispatchQueue(label: "mic-audio"))
        try await stream.startCapture()
        print("recording → \(outPath)")

        // periodic mixer
        let timer = DispatchSource.makeTimerSource()
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { tap.drain() }
        timer.resume()
        _ = timer // keep alive
    } catch {
        FileHandle.standardError.write("audiotap failed: \(error.localizedDescription)\n".data(using: .utf8)!)
        shutdown(code: 1)
    }
}

RunLoop.main.run()
