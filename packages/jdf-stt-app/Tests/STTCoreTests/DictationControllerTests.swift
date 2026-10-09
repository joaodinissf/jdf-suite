import Foundation
import Testing
@testable import STTCore

/// The controller driving the fake jdf-stt (Tests/fixtures/fake-jdf-stt) through key events.
@MainActor @Suite(.timeLimit(.minutes(1))) struct DictationControllerTests {
    final class Delivered { var texts: [String] = [] }

    func controller(_ env: [String: String] = [:], stopOnSilence: Bool = false) -> (DictationController, Delivered) {
        var environment = ProcessInfo.processInfo.environment
        environment.merge(env) { $1 }
        let client = CLIClient(command: CLICommand(executable: CLIClientTests.fake), environment: environment)
        let delivered = Delivered()
        let c = DictationController(
            machine: HotkeyMachine(stopOnSilence: stopOnSilence),
            start: { try client.startDictation(untilSilence: stopOnSilence) },
            deliver: { delivered.texts.append($0.text) },
            report: { Issue.record($0) }
        )
        return (c, delivered)
    }

    /// Tap for hands-free, then press again to stop; the stopping key stays down.
    func stopHandsFreeAndKeepTheKeyDown(_ c: DictationController) async throws {
        c.handle(.down(0)); c.handle(.up(0.1))
        c.handle(.down(5))
        #expect(c.machine.state == .stopKeyDown)
        await c.finishing?.value  // the transcript is ready while the key is still down
    }

    @Test func aTranscriptReadyBeforeTheReleaseIsInsertedOnRelease() async throws {
        let (c, delivered) = controller(["FAKE_JDF_STT_TEXT": "kept"])
        try await stopHandsFreeAndKeepTheKeyDown(c)
        #expect(delivered.texts.isEmpty, "held back while the stopping key is down")
        c.handle(.up(5.2))
        #expect(delivered.texts == ["kept"])
    }

    @Test func aChordAfterTheTranscriptIsReadyStillCancels() async throws {
        let (c, delivered) = controller()
        try await stopHandsFreeAndKeepTheKeyDown(c)
        c.handle(.escape)  // Option+2 on the stopping press
        c.handle(.up(5.2))
        #expect(delivered.texts.isEmpty)
        #expect(c.machine.state == .idle)
    }

    @Test func aHoldInsertsOnRelease() async throws {
        let (c, delivered) = controller(["FAKE_JDF_STT_TEXT": "held"])
        c.handle(.down(0)); c.handle(.up(1))
        await c.finishing?.value
        #expect(delivered.texts == ["held"])
    }

    /// The CLI ended on silence and exited; Esc comes before the app has read its transcript.
    @Test func aCancelAfterTheCLIExitedDiscardsTheTranscript() async throws {
        let (c, delivered) = controller(stopOnSilence: true)
        c.handle(.down(0)); c.handle(.up(0.1))
        let session = try #require(c.session)
        session.waitUntilExit()  // blocks the main actor, so finish cannot run in between
        c.handle(.escape)
        await c.finishing?.value
        #expect(delivered.texts.isEmpty)
        #expect(c.machine.state == .idle)
    }
}
