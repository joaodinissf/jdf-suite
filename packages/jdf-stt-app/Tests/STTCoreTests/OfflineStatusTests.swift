import Testing
@testable import STTCore

@Suite struct OfflineStatusTests {
    let dir = "/models"

    @Test func offlineWhenCLIAndModelsArePresent() {
        let status = OfflineStatus.evaluate(cliFound: true, model: "small", modelsDir: dir, llmURL: nil) {
            ["/models/ggml-small.bin", "/models/ggml-silero-v6.2.0.bin"].contains($0)
        }
        #expect(status == .offline)
    }

    @Test func attentionWhenTheSilenceModelIsMissing() {
        let status = OfflineStatus.evaluate(cliFound: true, model: "small", modelsDir: dir, llmURL: nil) { $0 == "/models/ggml-small.bin" }
        #expect(status == .attention("The silence model is not downloaded: run jdf-stt models download silero-v6.2.0"))
    }

    @Test func attentionWithoutTheCLI() {
        let status = OfflineStatus.evaluate(cliFound: false, model: "small", modelsDir: dir, llmURL: nil) { _ in true }
        guard case .attention(let reason) = status else { Issue.record("expected attention"); return }
        #expect(reason.contains("jdf-stt not found"))
    }

    @Test func attentionWhenTheModelIsMissing() {
        let status = OfflineStatus.evaluate(cliFound: true, model: "small", modelsDir: dir, llmURL: nil) { _ in false }
        #expect(status == .attention("Model small is not downloaded: run jdf-stt models download small"))
    }

    @Test func aModelPathIsCheckedAsIs() {
        #expect(OfflineStatus.modelPath("/x/ggml-large-v3-turbo.bin", modelsDir: dir) == "/x/ggml-large-v3-turbo.bin")
        #expect(OfflineStatus.modelPath("tiny.en", modelsDir: dir) == "/models/ggml-tiny.en.bin")
    }

    @Test(arguments: ["http://127.0.0.1:8080", "http://localhost:11434", "http://[::1]:8080"])
    func loopbackLLMStaysOffline(_ url: String) {
        let status = OfflineStatus.evaluate(cliFound: true, model: "small", modelsDir: dir, llmURL: url) { _ in true }
        #expect(status == .offline)
    }

    @Test(arguments: ["https://api.example.com/v1", "http://192.168.1.5:8080", "not a url"])
    func aRemoteLLMNeedsAttention(_ url: String) {
        let status = OfflineStatus.evaluate(cliFound: true, model: "small", modelsDir: dir, llmURL: url) { _ in true }
        #expect(status == .attention("The LLM URL is not on this Mac: \(url)"))
    }
}
