import Foundation
import Testing
@testable import STTCore

/// Runs the real CLIClient against Tests/fixtures/fake-jdf-stt (a shell script).
@Suite(.timeLimit(.minutes(1))) struct CLIClientTests {
    static let fake = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures/fake-jdf-stt").path

    let log = FileManager.default.temporaryDirectory.appendingPathComponent("fake-jdf-stt-\(UUID().uuidString).log")

    func client(_ env: [String: String] = [:], options: [String] = ["-m", "small"]) -> CLIClient {
        var environment = ProcessInfo.processInfo.environment
        environment["FAKE_JDF_STT_LOG"] = log.path
        environment.merge(env) { $1 }
        return CLIClient(command: CLICommand(executable: Self.fake), options: options, environment: environment)
    }

    func calls() throws -> [String] {
        try String(contentsOf: log, encoding: .utf8).split(separator: "\n").map(String.init)
    }

    /// Waits until the fake has started (its log line exists), so a stop is not a race.
    func waitForStart() async throws {
        for _ in 0..<200 where (try? calls())?.isEmpty ?? true { try await Task.sleep(for: .milliseconds(10)) }
    }

    @Test func stopReturnsTheTranscript() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client(["FAKE_JDF_STT_TEXT": "hello world"]).startDictation(untilSilence: false)
        try await waitForStart()
        session.stop()
        let transcript = try await session.result()
        #expect(transcript.text == "hello world")
        #expect(transcript.language == "en")
        #expect(transcript.segments == [.init(start: 0, end: 1.5, text: "hello world")])
        #expect(try calls() == ["--mic --format json -m small", "stop: newline"])
    }

    @Test func untilSilenceIsPassedAndEndsOnItsOwn() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client().startDictation(untilSilence: true)
        let transcript = try await session.result()
        #expect(transcript.text == "hello from the fake")
        #expect(try calls() == ["--mic --format json --until-silence -m small", "stop: silence"])
    }

    /// A hold release with Stop on Silence on: the newline must still stop an until-silence call.
    @Test func stopEndsAnUntilSilenceCall() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client(["FAKE_JDF_STT_TEXT": "held", "FAKE_JDF_STT_SILENCE_AFTER": "30"]).startDictation(untilSilence: true)
        try await waitForStart()
        session.stop()
        #expect(try await session.result().text == "held")
        #expect(try calls() == ["--mic --format json --until-silence -m small", "stop: newline"])
    }

    @Test func cancelThrowsCancelled() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client().startDictation(untilSilence: false)
        try await waitForStart()
        session.cancel()
        await #expect(throws: CLIError.cancelled) { try await session.result() }
    }

    @Test func aFailureCarriesStderr() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client(["FAKE_JDF_STT_EXIT": "1"]).startDictation(untilSilence: false)
        await #expect(throws: CLIError.failed(status: 1, message: "fake failure")) { try await session.result() }
    }

    @Test func noSpeechIsAnEmptyTranscript() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client(["FAKE_JDF_STT_EMPTY": "1"]).startDictation(untilSilence: true)
        #expect(try await session.result() == .empty)
    }

    @Test func stopAfterExitDoesNotCrash() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let session = try client().startDictation(untilSilence: true)
        _ = try await session.result()
        session.stop()  // the pipe is closed: must not raise SIGPIPE
        session.cancel()
    }

    @Test func transcribeFilePassesThePath() async throws {
        defer { try? FileManager.default.removeItem(at: log) }
        let transcript = try await client(options: []).transcribeFile(URL(fileURLWithPath: "/tmp/a b.wav"))
        #expect(transcript.text == "hello from the fake")
        #expect(try calls() == ["/tmp/a b.wav --format json"])
    }

    @Test func childPathReachesHomebrew() {
        let c = CLIClient(command: CLICommand(executable: "/x"), environment: ["PATH": "/usr/bin:/bin"])
        let dirs = c.environment["PATH"]!.split(separator: ":")
        #expect(dirs.prefix(2) == ["/usr/bin", "/bin"])
        #expect(dirs.contains("/opt/homebrew/bin"))
    }

    @Test func resolveOrder() {
        let dirs = ["/a", "/b"]
        #expect(CLICommand.resolve(settingsPath: "/custom/jdf-stt", searchDirectories: dirs) { $0 == "/custom/jdf-stt" }
            == CLICommand(executable: "/custom/jdf-stt"))
        #expect(CLICommand.resolve(settingsPath: nil, searchDirectories: dirs) { $0 == "/b/jdf-stt" || $0 == "/a/uvx" }
            == CLICommand(executable: "/b/jdf-stt"))
        #expect(CLICommand.resolve(settingsPath: "", searchDirectories: dirs) { $0 == "/a/uvx" }
            == CLICommand(executable: "/a/uvx", prefix: ["--offline", "jdf-stt"], found: false))
        #expect(CLICommand.resolve(settingsPath: nil, searchDirectories: dirs) { _ in false }
            == CLICommand(executable: "/usr/bin/env", prefix: ["uvx", "--offline", "jdf-stt"], found: false))
    }
}
