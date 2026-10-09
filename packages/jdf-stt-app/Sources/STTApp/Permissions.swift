import ApplicationServices
import AVFoundation
import CoreGraphics

/// The three permissions the app needs. BLIND: none of this has been run.
enum Permissions {
    /// The microphone, for the jdf-stt child (ffmpeg inherits the app's permission).
    static var microphone: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    static func requestMicrophone(_ done: @escaping @Sendable (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: done)
    }

    /// Accessibility, to insert text at the cursor.
    static var accessibility: Bool { AXIsProcessTrusted() }

    static func requestAccessibility() {
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    /// Input Monitoring, for the global key (a listen-only event tap).
    static var inputMonitoring: Bool { CGPreflightListenEventAccess() }

    static func requestInputMonitoring() { _ = CGRequestListenEventAccess() }
}
