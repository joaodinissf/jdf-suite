import AppIntents
import Foundation
import STTCore

/// Shortcuts: "Transcribe Audio File" -> text. Runs `jdf-stt FILE --format json` on this Mac.
/// COMPILED; discovery by Shortcuts and running it are BLIND (SwiftPM does not extract the
/// App Intents metadata that Xcode's build normally does).
struct TranscribeFileIntent: AppIntent {
    static let title: LocalizedStringResource = "Transcribe Audio File"
    static let description = IntentDescription("Turns speech in an audio or video file into text, on this Mac.")

    @Parameter(title: "File", supportedContentTypes: [.audio, .movie])
    var file: IntentFile

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let (url, temporary) = try localURL(for: file)
        defer { if temporary { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) } }
        let transcript = try await Settings().client.transcribeFile(url)
        return .result(value: transcript.text)
    }
}

/// Shortcuts: "Dictate" -> text. Records from the microphone until a pause, then transcribes.
/// COMPILED; BLIND when run.
struct DictateIntent: AppIntent {
    static let title: LocalizedStringResource = "Dictate"
    static let description = IntentDescription("Records until you pause, then returns what you said. Nothing leaves this Mac.")

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let session = try Settings().client.startDictation(untilSilence: true)
        let transcript = try await withTaskCancellationHandler {
            try await session.result()
        } onCancel: {
            session.cancel()
        }
        return .result(value: transcript.text)
    }
}

struct STTShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DictateIntent(),
            phrases: ["Dictate with \(.applicationName)"],
            shortTitle: "Dictate",
            systemImageName: "mic"
        )
        AppShortcut(
            intent: TranscribeFileIntent(),
            phrases: ["Transcribe a file with \(.applicationName)"],
            shortTitle: "Transcribe File",
            systemImageName: "waveform"
        )
    }
}

/// The file on disk: its own URL when Shortcuts passes one, else a temporary copy of its data.
private func localURL(for file: IntentFile) throws -> (URL, temporary: Bool) {
    if let url = file.fileURL { return (url, false) }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("jdf-stt-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent(file.filename.isEmpty ? "audio" : file.filename)
    try file.data.write(to: url)
    return (url, true)
}
