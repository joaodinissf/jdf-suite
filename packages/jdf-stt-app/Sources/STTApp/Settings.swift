import Foundation
import STTCore

/// User settings, kept in UserDefaults (domain eu.joaof.jdf-stt).
struct Settings {
    private let defaults = UserDefaults.standard

    /// Path to jdf-stt; empty means search PATH, then fall back to `uvx --offline jdf-stt`.
    var cliPath: String? { defaults.string(forKey: "cliPath") }
    /// Registry name or a ggml file path, passed as `-m`; unset leaves it to the CLI (config.toml,
    /// else `small`).
    var model: String? { defaults.string(forKey: "model").flatMap { $0.isEmpty ? nil : $0 } }
    /// A local-LLM rewrite mode (`clean`, `email`...), passed as `--mode`.
    var mode: String? { defaults.string(forKey: "mode").flatMap { $0.isEmpty ? nil : $0 } }
    var llmURL: String? { defaults.string(forKey: "llmURL").flatMap { $0.isEmpty ? nil : $0 } }
    /// Virtual key code of the dictation key; default Right Option (61).
    var hotkeyKeyCode: Int64 {
        defaults.object(forKey: "hotkeyKeyCode") as? Int64 ?? 61
    }
    var stopOnSilence: Bool {
        get { defaults.bool(forKey: "stopOnSilence") }
        nonmutating set { defaults.set(newValue, forKey: "stopOnSilence") }
    }

    var command: CLICommand {
        CLICommand.resolve(
            settingsPath: cliPath,
            searchDirectories: CLICommand.searchDirectories(path: ProcessInfo.processInfo.environment["PATH"])
        )
    }

    var client: CLIClient {
        var options: [String] = []
        if let model { options += ["-m", model] }
        if let mode {
            options += ["--mode", mode]
            if let llmURL { options += ["--llm-url", llmURL] }
        }
        return CLIClient(command: command, options: options)
    }
}
