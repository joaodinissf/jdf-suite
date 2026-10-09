import AppKit

// A menu-bar-only app (LSUIElement in Info.plist; .accessory here for `swift run` builds).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
