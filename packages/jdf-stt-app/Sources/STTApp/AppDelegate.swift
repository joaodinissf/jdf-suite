import AppKit
import STTCore

/// Wires the key, the jdf-stt CLI, insertion and history together.
/// COMPILED (swift build); running it is BLIND.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = Settings()
    private let history = HistoryStore()
    private var machine = HotkeyMachine()
    private var session: DictationSession?
    private var transcribing = false
    private var lastError: String?
    private var tap: HotkeyTap?
    private var statusItem: StatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        machine.stopOnSilence = settings.stopOnSilence
        statusItem = StatusItem(actions: .init(
            model: { [unowned self] in
                .init(
                    phase: transcribing ? .transcribing : (session != nil ? .recording : .idle),
                    status: settings.offlineStatus,
                    history: history.recent(10),
                    stopOnSilence: settings.stopOnSilence,
                    lastError: lastError
                )
            },
            toggleDictation: { [unowned self] in
                // The menu acts like a tap on the key: start hands-free, or stop.
                let now = ProcessInfo.processInfo.systemUptime
                if machine.isRecording {
                    if case .pressed = machine.state { _ = machine.handle(.up(now)) }
                    perform(machine.handle(.down(now + 1)))
                } else {
                    perform(machine.handle(.down(now)))
                    _ = machine.handle(.up(now))
                }
            },
            toggleStopOnSilence: { [unowned self] in
                settings.stopOnSilence.toggle()
                machine.stopOnSilence = settings.stopOnSilence
            },
            requestPermissions: { [unowned self] in requestPermissions() }
        ))
        startTap()
    }

    private func startTap() {
        let tap = HotkeyTap(keyCode: settings.hotkeyKeyCode) { [unowned self] event, time in
            switch event {
            case .down: perform(machine.handle(.down(time)))
            case .up: perform(machine.handle(.up(time)))
            case .escape: perform(machine.handle(.escape))
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

    private func perform(_ action: HotkeyMachine.Action?) {
        switch action {
        case .start: start()
        case .stopAndInsert:
            if let session {
                transcribing = true
                session.stop()
            }
        case .cancel: session?.cancel()
        case nil: break
        }
        statusItem?.refresh()
    }

    private func start() {
        guard session == nil else { machine.reset(); return }
        if !Permissions.microphone {
            Permissions.requestMicrophone { _ in }
        }
        do {
            let session = try settings.client.startDictation(untilSilence: settings.stopOnSilence)
            self.session = session
            lastError = nil
            Task { await finish(session) }
        } catch {
            machine.reset()
            lastError = error.localizedDescription
        }
    }

    /// Runs once per recording: after a stop, a cancel, or the CLI ending on silence.
    private func finish(_ session: DictationSession) async {
        let result: Result<Transcript, Error>
        do { result = .success(try await session.result()) } catch { result = .failure(error) }
        self.session = nil
        transcribing = false
        if machine.isRecording {
            // The CLI stopped by itself on a pause (--until-silence), whatever the gesture:
            // a hold or a lock ends too, and the next press starts a new recording.
            _ = machine.handle(.silence)
            machine.reset()
        }
        switch result {
        case .success(let transcript) where !transcript.text.isEmpty:
            try? history.append(HistoryEntry(text: transcript.text, language: transcript.language, duration: transcript.duration))
            TextInserter.insert(transcript.text)
        case .success:
            break  // no speech
        case .failure(CLIError.cancelled):
            break
        case .failure(let error):
            lastError = error.localizedDescription
        }
        statusItem?.refresh()
    }
}
