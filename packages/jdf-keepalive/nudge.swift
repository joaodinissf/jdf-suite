import ApplicationServices
import CoreGraphics

// Posts one synthetic zero-distance mouse move at the current cursor position.
// macOS counts it as user input, resetting the HID idle timer.
// Requires Accessibility permission for the program that runs it.
// With --check, only reports whether that permission is granted.
guard AXIsProcessTrusted() else {
    print("error: not trusted for Accessibility; grant it to the program running this (see README)")
    exit(1)
}
if CommandLine.arguments.contains("--check") {
    exit(0)
}
let pos = CGEvent(source: nil)!.location
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pos, mouseButton: .left)!
    .post(tap: .cghidEventTap)
