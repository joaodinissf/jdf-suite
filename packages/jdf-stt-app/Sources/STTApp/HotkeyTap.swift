import CoreGraphics
import Foundation

/// A listen-only CGEventTap that turns the dictation key and Esc into HotkeyMachine events.
/// It needs Input Monitoring. Being listen-only, it never swallows keys. BLIND: not run.
@MainActor
final class HotkeyTap {
    enum KeyEvent { case down, up, escape }

    private let keyCode: Int64
    private let onEvent: @MainActor (KeyEvent, TimeInterval) -> Void
    private var tap: CFMachPort?
    private var keyIsDown = false

    init(keyCode: Int64, onEvent: @escaping @MainActor (KeyEvent, TimeInterval) -> Void) {
        self.keyCode = keyCode
        self.onEvent = onEvent
    }

    /// Returns false when the tap cannot be created (no Input Monitoring permission yet).
    func start() -> Bool {
        guard tap == nil else { return true }
        let mask: CGEventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
            | (1 << CGEventType.flagsChanged.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: hotkeyTapCallback, userInfo: me
        ) else { return false }
        tap = port
        let source = CFMachPortCreateRunLoopSource(nil, port, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        return true
    }

    /// The device-dependent flag bit of each modifier key (IOKit's NX_DEVICE*KEYMASK), so a
    /// flagsChanged event says whether that very key is down rather than toggling a guess.
    private static let modifierBits: [Int64: UInt64] = [
        59: 0x01, 56: 0x02, 60: 0x04, 55: 0x08, 54: 0x10, 58: 0x20, 61: 0x40, 62: 0x2000,
        63: CGEventFlags.maskSecondaryFn.rawValue,
    ]

    fileprivate func handle(type: CGEventType, code: Int64, isRepeat: Bool, flags: CGEventFlags) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if type == .keyDown && code == 53 {
            onEvent(.escape, now)
            return
        }
        guard code == keyCode else {
            // Another key while the dictation key is down is a chord (Option+2 types "@" on
            // some layouts), not dictation: throw the recording away.
            if type == .keyDown && keyIsDown { onEvent(.escape, now) }
            return
        }
        let down: Bool
        switch type {
        case .flagsChanged:
            // A modifier key (the default, Right Option): read its own flag bit, so a missed
            // event cannot swap press and release from then on.
            if let bit = Self.modifierBits[code] {
                down = flags.rawValue & bit != 0
            } else {
                down = !keyIsDown
            }
            if down == keyIsDown { return }
        case .keyDown:
            if isRepeat { return }
            down = true
        case .keyUp:
            down = false
        default:
            return
        }
        keyIsDown = down
        onEvent(down ? .down : .up, now)
    }
}

private func hotkeyTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let userInfo {
        let tap = Unmanaged<HotkeyTap>.fromOpaque(userInfo).takeUnretainedValue()
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        // The tap's run-loop source is on the main run loop.
        let flags = event.flags
        MainActor.assumeIsolated { tap.handle(type: type, code: code, isRepeat: isRepeat, flags: flags) }
    }
    return Unmanaged.passUnretained(event)
}
