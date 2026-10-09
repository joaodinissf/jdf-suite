import Foundation

/// Runs the HotkeyMachine against jdf-stt sessions: starts, stops and cancels them, and hands
/// each finished transcript to `deliver` (history and insertion in the app).
///
/// A transcript that is ready while the press that stopped the recording is still down is kept
/// back until that key is released, so a chord on that press (Option+2) still cancels it.
@MainActor
public final class DictationController {
    public var machine: HotkeyMachine
    public private(set) var session: DictationSession?
    /// Stopped, waiting for the CLI's transcript.
    public private(set) var transcribing = false
    /// The running `finish`, so tests can wait for it.
    public private(set) var finishing: Task<Void, Never>?
    private var pending: Transcript?

    private let startSession: @MainActor () throws -> DictationSession
    private let deliver: @MainActor (Transcript) -> Void
    private let report: @MainActor (Error) -> Void
    /// Called once a recording is over, whatever its outcome.
    public var onFinish: @MainActor () -> Void = {}

    public init(
        machine: HotkeyMachine = HotkeyMachine(),
        start: @escaping @MainActor () throws -> DictationSession,
        deliver: @escaping @MainActor (Transcript) -> Void,
        report: @escaping @MainActor (Error) -> Void
    ) {
        self.machine = machine
        startSession = start
        self.deliver = deliver
        self.report = report
    }

    public func handle(_ event: HotkeyMachine.Event) {
        switch machine.handle(event) {
        case .start:
            guard session == nil else { machine.reset(); return }
            do {
                let session = try startSession()
                self.session = session
                finishing = Task { await finish(session) }
            } catch {
                machine.reset()
                report(error)
            }
        case .stopAndInsert:
            if let session {
                transcribing = true
                session.stop()
            }
        case .cancel:
            pending = nil
            session?.cancel()
        case nil:
            break
        }
        releasePending()
    }

    /// Runs once per recording: after a stop, a cancel, or the CLI ending on silence.
    private func finish(_ session: DictationSession) async {
        var result: Result<Transcript, Error>
        do { result = .success(try await session.result()) } catch { result = .failure(error) }
        // A cancel can land after the CLI exited but before this runs.
        if session.isCancelled { result = .failure(CLIError.cancelled) }
        self.session = nil
        transcribing = false
        if machine.isRecording && machine.state != .stopKeyDown {
            // The CLI stopped by itself on a pause (--until-silence), whatever the gesture:
            // a hold or a lock ends too, and the next press starts a new recording.
            _ = machine.handle(.silence)
            machine.reset()
        }
        switch result {
        case .success(let transcript) where !transcript.text.isEmpty:
            pending = transcript
            releasePending()
        case .success, .failure(CLIError.cancelled):
            break  // no speech, or cancelled
        case .failure(let error):
            report(error)
        }
        onFinish()
    }

    /// Delivers the held transcript once the stopping key is no longer down.
    private func releasePending() {
        guard machine.state != .stopKeyDown, let transcript = pending else { return }
        pending = nil
        deliver(transcript)
    }
}
