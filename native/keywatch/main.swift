// keywatch — listen-only global key tap that prints "double-space" when the
// spacebar is pressed twice within 350 ms (with no other key in between).
// Never consumes or blocks events. Requires Input Monitoring permission.

import CoreGraphics
import Foundation

var lastSpace: Double = 0

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .keyDown {
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == 49 { // space
            let now = Date().timeIntervalSince1970
            if now - lastSpace < 0.35 {
                print("double-space")
                fflush(stdout)
                lastSpace = 0
            } else {
                lastSpace = now
            }
        } else {
            lastSpace = 0
        }
    }
    return Unmanaged.passUnretained(event)
}

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
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
