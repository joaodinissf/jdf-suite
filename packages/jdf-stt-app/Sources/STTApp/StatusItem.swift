import AppKit
import STTCore

/// The menu-bar icon and its menu. BLIND: never shown during development.
@MainActor
final class StatusItem: NSObject, NSMenuDelegate {
    enum Phase { case idle, recording, transcribing }

    struct Model {
        var phase: Phase
        var status: OfflineStatus
        var history: [HistoryEntry]
        var stopOnSilence: Bool
        var lastError: String?
    }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let actions: Actions

    struct Actions {
        var model: @MainActor () -> Model
        var toggleDictation: @MainActor () -> Void
        var toggleStopOnSilence: @MainActor () -> Void
        var requestPermissions: @MainActor () -> Void
    }

    init(actions: Actions) {
        self.actions = actions
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        refresh()
    }

    /// Updates the icon; the menu is rebuilt each time it opens.
    func refresh() {
        let model = actions.model()
        let symbol: String
        switch (model.phase, model.status) {
        case (.recording, _): symbol = "mic.fill"
        case (.transcribing, _): symbol = "ellipsis.circle"
        case (.idle, .offline): symbol = "mic"
        case (.idle, .attention): symbol = "exclamationmark.triangle"
        }
        item.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "jdf-stt")
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        let model = actions.model()
        menu.removeAllItems()

        switch model.status {
        case .offline: menu.addItem(disabled: "Offline: nothing leaves this Mac")
        case .attention(let reason): menu.addItem(disabled: reason)
        }
        if let error = model.lastError { menu.addItem(disabled: "Last error: \(error)") }
        menu.addItem(.separator())

        let title = switch model.phase {
        case .idle: "Start Dictation"
        case .recording: "Stop and Insert"
        case .transcribing: "Transcribing..."
        }
        menu.addItem(button(title, enabled: model.phase != .transcribing) { [actions] in actions.toggleDictation() })
        let silence = button("Stop on Silence (hands-free)") { [actions] in actions.toggleStopOnSilence() }
        silence.state = model.stopOnSilence ? .on : .off
        menu.addItem(silence)

        if !model.history.isEmpty {
            menu.addItem(.separator())
            menu.addItem(disabled: "Recent (click to copy)")
            for entry in model.history {
                let label = entry.text.count > 60 ? entry.text.prefix(57) + "..." : Substring(entry.text)
                menu.addItem(button(String(label)) {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(entry.text, forType: .string)
                })
            }
        }

        menu.addItem(.separator())
        let mic = Permissions.microphone, ax = Permissions.accessibility, keys = Permissions.inputMonitoring
        if !(mic && ax && keys) {
            let missing = [mic ? nil : "Microphone", ax ? nil : "Accessibility", keys ? nil : "Input Monitoring"]
                .compactMap { $0 }.joined(separator: ", ")
            menu.addItem(button("Grant Permissions (\(missing))...") { [actions] in actions.requestPermissions() })
        }
        menu.addItem(NSMenuItem(title: "Quit jdf-stt", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func button(_ title: String, enabled: Bool = true, _ action: @escaping @MainActor () -> Void) -> NSMenuItem {
        let item = ClosureMenuItem(title: title, action: action)
        item.isEnabled = enabled
        return item
    }
}

@MainActor
private final class ClosureMenuItem: NSMenuItem {
    private let run: @MainActor () -> Void

    init(title: String, action: @escaping @MainActor () -> Void) {
        run = action
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func fire() { run() }
}

private extension NSMenu {
    func addItem(disabled title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        addItem(item)
    }
}
