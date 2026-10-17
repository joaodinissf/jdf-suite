import AppIntents
import Foundation
import STTCore

/// Shortcuts: "Transcribe Audio File" -> text. Runs `jdf-stt FILE --format json` on this Mac.
/// COMPILED; BLIND: not discoverable in Shortcuts from a SwiftPM build (SwiftPM does not
/// extract the App Intents metadata that Xcode's build does), so never run. Making the actions
/// discoverable is a tracked follow-up.
struct TranscribeFileIntent: AppIntent {
    static let title: LocalizedStringResource = "Transcribe Audio File"
    static let description = IntentDescription("Turns speech in an audio or video file into text, on this Mac.")

    @Parameter(title: "File", supportedContentTypes: [.audio, .movie])
    var file: IntentFile

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        // Shortcuts passes a URL for a file on disk, else only its data: copy that to a temporary
        // file whose directory is the only thing removed afterwards.
        if let url = file.fileURL {
            return .result(value: try await Settings().client.transcribeFile(url).text)
        }
        let copy = try TemporaryFile(data: file.data, filename: file.filename)
        defer { copy.remove() }
        return .result(value: try await Settings().client.transcribeFile(copy.url).text)
    }
}

/// Shortcuts: "Dictate" -> text. Records from the microphone until a pause, then transcribes.
/// COMPILED; BLIND: not discoverable from a SwiftPM build, never run (see above).
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
