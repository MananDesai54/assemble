// keywatch — listen-only global key tap:
//  - "voice-chord": Cmd+Shift pressed together and released with no other key
//  - "quick-chord": Fn+Space (quick-ask panel — Fn is invisible to Electron)
//  - "fn-down"/"fn-up": Fn held alone = push-to-talk; any key while holding
//    prints "fn-cancel" (so fn+arrow etc never sends audio)
// Never consumes or blocks events. Requires Input Monitoring permission.

import CoreGraphics
import Foundation

var chordArmed = false
var fnHeld = false
var fnCancelled = false

func emit(_ s: String) {
    print(s)
    fflush(stdout)
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    let flags = event.flags
    let cmdShift = flags.contains(.maskCommand) && flags.contains(.maskShift)
    let otherMods = flags.contains(.maskControl) || flags.contains(.maskAlternate)
    let fn = flags.contains(.maskSecondaryFn)

    switch type {
    case .flagsChanged:
        if cmdShift && !otherMods {
            chordArmed = true
        } else if chordArmed && !flags.contains(.maskCommand) && !flags.contains(.maskShift) {
            chordArmed = false
            emit("voice-chord")
        } else if otherMods {
            chordArmed = false
        }
        if fn && !fnHeld {
            fnHeld = true
            fnCancelled = false
            emit("fn-down")
        } else if !fn && fnHeld {
            fnHeld = false
            emit(fnCancelled ? "fn-abort" : "fn-up")
        }
    case .keyDown:
        chordArmed = false // any real key while holding = a normal shortcut
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if fnHeld {
            fnCancelled = true
            emit("fn-cancel")
        }
        if keyCode == 49 && flags.contains(.maskSecondaryFn) { // Fn+Space
            emit("quick-chord")
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let mask = CGEventMask((1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue))
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    FileHandle.standardError.write(
        "keywatch: cannot create event tap — grant Input Monitoring in System Settings\n".data(using: .utf8)!)
    exit(1)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("keywatch: armed")
fflush(stdout)
CFRunLoopRun()
