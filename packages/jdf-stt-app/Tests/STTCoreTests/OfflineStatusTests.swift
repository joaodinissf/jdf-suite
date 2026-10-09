import Foundation
import Testing
@testable import STTCore

@Suite struct OfflineStatusTests {
    func ready(model: String = "small", llmURL: String? = nil) -> CLIStatus {
        CLIStatus(model: model, modelDownloaded: true, vadModel: "silero-v6.2.0", vadModelDownloaded: true, mode: llmURL == nil ? nil : "clean", llmURL: llmURL)
    }

    @Test func offlineWhenCLIAndModelsArePresent() {
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(ready())) == .offline)
    }

    @Test func attentionWhenTheSilenceModelIsMissing() {
        var s = ready()
        s.vadModelDownloaded = false
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(s))
            == .attention("The silence model is not downloaded: run jdf-stt models download silero-v6.2.0"))
    }

    @Test func noVADNeedsNoSilenceModel() {
        let s = CLIStatus(model: "small", modelDownloaded: true, vadModel: nil, vadModelDownloaded: false)
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(s)) == .offline)
    }

    @Test func attentionWithoutTheCLI() {
        guard case .attention(let reason) = OfflineStatus.evaluate(cliFound: false, status: .success(ready())) else {
            Issue.record("expected attention"); return
        }
        #expect(reason.contains("jdf-stt not found"))
    }

    /// The model config.toml chose, not a default of the app's.
    @Test func attentionNamesTheCLIsModel() {
        var s = ready(model: "base")
        s.modelDownloaded = false
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(s))
            == .attention("Model base is not downloaded: run jdf-stt models download base"))
    }

    @Test func aFailingStatusCallNeedsAttention() {
        let error = CLIError.failed(status: 1, message: "jdf-stt: model file not found: /x.bin")
        #expect(OfflineStatus.evaluate(cliFound: true, status: .failure(error)) == .attention(error.localizedDescription))
    }

    @Test(arguments: ["http://127.0.0.1:8080", "http://localhost:11434", "http://[::1]:8080"])
    func loopbackLLMStaysOffline(_ url: String) {
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(ready(llmURL: url))) == .offline)
    }

    @Test(arguments: ["https://api.example.com/v1", "http://192.168.1.5:8080", "not a url"])
    func aRemoteLLMNeedsAttention(_ url: String) {
        #expect(OfflineStatus.evaluate(cliFound: true, status: .success(ready(llmURL: url)))
            == .attention("The LLM URL is not on this Mac: \(url)"))
    }

    /// The exact shape `jdf-stt status` prints.
    @Test func decodesTheCLIsJSON() throws {
        let json = #"{"model": "base", "model_downloaded": true, "vad_model": null, "vad_model_downloaded": false, "mode": "clean", "llm_url": "http://127.0.0.1:8080"}"#
        #expect(try JSONDecoder().decode(CLIStatus.self, from: Data(json.utf8))
            == CLIStatus(model: "base", modelDownloaded: true, vadModel: nil, vadModelDownloaded: false, mode: "clean", llmURL: "http://127.0.0.1:8080"))
    }
}
