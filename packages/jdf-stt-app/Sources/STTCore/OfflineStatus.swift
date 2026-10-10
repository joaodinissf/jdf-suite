import Foundation

/// The menu-bar indicator: `.offline` means a dictation cannot touch the network.
public enum OfflineStatus: Equatable, Sendable {
    case offline
    case attention(String)

    /// - Parameters:
    ///   - cliFound: jdf-stt itself was found (the `uvx --offline` fallback
    ///     may not have it cached, so it does not count).
    ///   - model: registry name (`small`) or a path to a ggml file.
    ///   - modelsDir: where registry models live (`~/.cache/jdf-stt/models`).
    ///   - llmURL: the rewrite-mode server, when a mode is set.
    ///
    /// The Silero VAD model is required too: the CLI downloads it by itself on the first
    /// dictation that listens for silence, so without it that dictation would go online.
    public static func evaluate(
        cliFound: Bool,
        model: String,
        modelsDir: String,
        llmURL: String?,
        fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
    ) -> OfflineStatus {
        guard cliFound else {
            return .attention("jdf-stt not found: install it, or set its path in Settings")
        }
        let path = modelPath(model, modelsDir: modelsDir)
        guard fileExists(path) else {
            return .attention("Model \(model) is not downloaded: run jdf-stt models download \(model)")
        }
        guard fileExists(modelPath(vadModel, modelsDir: modelsDir)) else {
            return .attention("The silence model is not downloaded: run jdf-stt models download \(vadModel)")
        }
        if let llmURL, !isLoopback(llmURL) {
            return .attention("The LLM URL is not on this Mac: \(llmURL)")
        }
        return .offline
    }

    /// The CLI's default VAD model (`ggml-silero-v6.2.0.bin`).
    public static let vadModel = "silero-v6.2.0"

    /// `small` -> `<modelsDir>/ggml-small.bin`; anything with a slash or `.bin` is a path.
    public static func modelPath(_ model: String, modelsDir: String) -> String {
        if model.contains("/") || model.hasSuffix(".bin") {
            return (model as NSString).expandingTildeInPath
        }
        return (modelsDir as NSString).appendingPathComponent("ggml-\(model).bin")
    }

    public static func isLoopback(_ url: String) -> Bool {
        guard let host = URLComponents(string: url)?.host?.lowercased() else { return false }
        return ["127.0.0.1", "::1", "[::1]", "localhost"].contains(host)
    }
}
