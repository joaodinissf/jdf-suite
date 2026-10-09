import Foundation

/// What `jdf-stt status` prints: the settings a dictation would really use (the app's options,
/// then config.toml, then the CLI's defaults), and whether their models are on disk.
public struct CLIStatus: Decodable, Equatable, Sendable {
    public var model: String
    public var modelDownloaded: Bool
    /// nil when the CLI would not use voice-activity detection.
    public var vadModel: String?
    public var vadModelDownloaded: Bool
    public var mode: String?
    /// The rewrite-mode server, only when a mode is set.
    public var llmURL: String?

    public init(model: String, modelDownloaded: Bool, vadModel: String?, vadModelDownloaded: Bool, mode: String? = nil, llmURL: String? = nil) {
        self.model = model
        self.modelDownloaded = modelDownloaded
        self.vadModel = vadModel
        self.vadModelDownloaded = vadModelDownloaded
        self.mode = mode
        self.llmURL = llmURL
    }

    enum CodingKeys: String, CodingKey {
        case model, mode
        case modelDownloaded = "model_downloaded"
        case vadModel = "vad_model"
        case vadModelDownloaded = "vad_model_downloaded"
        case llmURL = "llm_url"
    }
}

/// The menu-bar indicator: `.offline` means a dictation cannot touch the network.
public enum OfflineStatus: Equatable, Sendable {
    case offline
    case attention(String)

    /// - Parameters:
    ///   - cliFound: jdf-stt itself was found (the `uvx --offline` fallback
    ///     may not have it cached, so it does not count).
    ///   - status: what `jdf-stt status` said, or why it failed.
    ///
    /// The Silero VAD model is required too: the CLI downloads it by itself on the first
    /// dictation that uses it, so without it that dictation would go online.
    public static func evaluate(cliFound: Bool, status: Result<CLIStatus, Error>) -> OfflineStatus {
        guard cliFound else {
            return .attention("jdf-stt not found: install it, or set its path in Settings")
        }
        let s: CLIStatus
        switch status {
        case .success(let value): s = value
        case .failure(let error): return .attention(error.localizedDescription)
        }
        guard s.modelDownloaded else {
            return .attention("Model \(s.model) is not downloaded: run jdf-stt models download \(s.model)")
        }
        if let vad = s.vadModel, !s.vadModelDownloaded {
            return .attention("The silence model is not downloaded: run jdf-stt models download \(vad)")
        }
        if let llmURL = s.llmURL, !isLoopback(llmURL) {
            return .attention("The LLM URL is not on this Mac: \(llmURL)")
        }
        return .offline
    }

    public static func isLoopback(_ url: String) -> Bool {
        guard let host = URLComponents(string: url)?.host?.lowercased() else { return false }
        return ["127.0.0.1", "::1", "[::1]", "localhost"].contains(host)
    }
}
