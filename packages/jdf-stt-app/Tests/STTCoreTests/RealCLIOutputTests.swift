import Foundation
import Testing
@testable import STTCore

/// The Transcript mirror decodes what the real CLI printed. The two fixtures are real output of
/// `jdf-stt --mic --format json` (say speech as the input) and `jdf-stt silence.wav --format json`,
/// with whisper-cli and large-v3-turbo; only the model path was shortened.
struct RealCLIOutputTests {
    static func fixture(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/\(name)")
        return try Data(contentsOf: url)
    }

    @Test func decodesARealDictation() throws {
        let t = try JSONDecoder().decode(Transcript.self, from: Self.fixture("real-cli-dictation.json"))
        #expect(t.text == "Hoje está um dia muito bonito, vamos ao parque.")
        #expect(t.language == "pt")
        #expect(t.engine == "whisper-cpp")
        #expect(t.segments.count == 1 && t.segments[0].end > t.segments[0].start)
    }

    @Test func decodesRealNoSpeech() throws {
        let t = try JSONDecoder().decode(Transcript.self, from: Self.fixture("real-cli-no-speech.json"))
        #expect(t.text.isEmpty && t.segments.isEmpty)
    }
}
