// keywatch — listen-only global key tap:
//  - prints "voice-chord" when Cmd+Shift is pressed together and released
//    without any other key (any real key while holding cancels)
//  - prints "quick-chord" on Fn+Space (the quick-ask panel hotkey — the Fn
//    modifier is invisible to Electron's globalShortcut)
// Never consumes or blocks events. Requires Input Monitoring permission.

import CoreGraphics
import Foundation

var chordArmed = false

let callback: CGEventTapCallBack = { _, type, event, _ in
    let flags = event.flags
    let cmdShift = flags.contains(.maskCommand) && flags.contains(.maskShift)
    let otherMods = flags.contains(.maskControl) || flags.contains(.maskAlternate)

    switch type {
    case .flagsChanged:
        if cmdShift && !otherMods {
            chordArmed = true
        } else if chordArmed && !flags.contains(.maskCommand) && !flags.contains(.maskShift) {
            chordArmed = false
            print("voice-chord")
            fflush(stdout)
        } else if otherMods {
            chordArmed = false
        }
    case .keyDown:
        chordArmed = false // any real key while holding = a normal shortcut
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if keyCode == 49 && flags.contains(.maskSecondaryFn) { // Fn+Space
            print("quick-chord")
            fflush(stdout)
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
