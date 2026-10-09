import AppKit
import STTCore

/// Wires the key, the jdf-stt CLI, insertion and history together.
/// COMPILED (swift build); running it is BLIND.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = Settings()
    private let history = HistoryStore()
    private var dictation: DictationController!
    private var lastError: String?
    private var offlineStatus = OfflineStatus.attention("Checking jdf-stt...")
    private var tap: HotkeyTap?
    private var statusItem: StatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        dictation = DictationController(
            machine: HotkeyMachine(stopOnSilence: settings.stopOnSilence),
            start: { [unowned self] in
                if !Permissions.microphone { Permissions.requestMicrophone { _ in } }
                let session = try settings.client.startDictation(untilSilence: settings.stopOnSilence)
                lastError = nil
                return session
            },
            deliver: { [unowned self] transcript in
                try? history.append(HistoryEntry(text: transcript.text, language: transcript.language, duration: transcript.duration))
                TextInserter.insert(transcript.text)
            },
            report: { [unowned self] error in lastError = error.localizedDescription }
        )
        dictation.onFinish = { [unowned self] in
            refreshOfflineStatus()  // the first dictation may have fetched the silence model
            statusItem?.refresh()
        }
        statusItem = StatusItem(actions: .init(
            model: { [unowned self] in
                .init(
                    phase: dictation.transcribing ? .transcribing : (dictation.session != nil ? .recording : .idle),
                    status: offlineStatus,
                    history: history.recent(10),
                    stopOnSilence: settings.stopOnSilence,
                    lastError: lastError
                )
            },
            toggleDictation: { [unowned self] in perform(.menu) },
            toggleStopOnSilence: { [unowned self] in
                settings.stopOnSilence.toggle()
                dictation.machine.stopOnSilence = settings.stopOnSilence
            },
            requestPermissions: { [unowned self] in requestPermissions() },
            menuOpened: { [unowned self] in refreshOfflineStatus() }
        ))
        startTap()
        refreshOfflineStatus()
    }

    /// Asks `jdf-stt status` in the background, so the indicator checks what the CLI would
    /// really use (config.toml included); the menu shows the last answer meanwhile.
    private func refreshOfflineStatus() {
        let client = settings.client
        Task.detached { [weak self] in
            let status = OfflineStatus.evaluate(cliFound: client.command.found, status: Result { try client.status() })
            await self?.show(status)
        }
    }

    private func show(_ status: OfflineStatus) {
        offlineStatus = status
        statusItem?.refresh()
    }

    private func startTap() {
        let tap = HotkeyTap(keyCode: settings.hotkeyKeyCode) { [unowned self] event, time in
            switch event {
            case .down: perform(.down(time))
            case .up: perform(.up(time))
            case .escape: perform(.escape)
            }
        }
        if tap.start() {
            self.tap = tap
        } else {
            lastError = "The dictation key needs Input Monitoring"
        }
    }

    private func requestPermissions() {
        if !Permissions.microphone { Permissions.requestMicrophone { _ in } }
        if !Permissions.accessibility { Permissions.requestAccessibility() }
        if !Permissions.inputMonitoring { Permissions.requestInputMonitoring() }
        if tap == nil { startTap() }
    }

    private func perform(_ event: HotkeyMachine.Event) {
        dictation.handle(event)
        statusItem?.refresh()
    }
}
