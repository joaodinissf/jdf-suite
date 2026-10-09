// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "jdf-stt-app",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "STTApp", targets: ["STTApp"]),
    ],
    targets: [
        // Everything that can be tested without permissions: the gesture state machine,
        // history, clipboard save-and-restore, the offline indicator and the jdf-stt driver.
        .target(name: "STTCore"),
        // The menu-bar app: event tap, Accessibility insertion, permissions, AppKit UI.
        .executableTarget(name: "STTApp", dependencies: ["STTCore"]),
        .testTarget(name: "STTCoreTests", dependencies: ["STTCore"]),
    ]
)
