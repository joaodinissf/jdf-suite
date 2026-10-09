import Foundation

public enum CLIError: Error, Equatable, LocalizedError {
    /// Esc, a cancel, or the CLI's exit 130.
    case cancelled
    /// The CLI failed; `message` is the end of its stderr.
    case failed(status: Int32, message: String)
    /// Exit 0, but stdout was not the JSON contract.
    case badOutput(String)

    public var errorDescription: String? {
        switch self {
        case .cancelled: "Cancelled"
        case .failed(let status, let message): "jdf-stt failed (exit \(status)): \(message)"
        case .badOutput(let output): "jdf-stt printed something that is not a transcript: \(output.prefix(200))"
        }
    }
}

/// How to run jdf-stt: the executable, the arguments before ours, and whether jdf-stt itself
/// was found (false means the `uvx --offline jdf-stt` fallback).
public struct CLICommand: Equatable, Sendable {
    public var executable: String
    public var prefix: [String]
    public var found: Bool

    public init(executable: String, prefix: [String] = [], found: Bool = true) {
        self.executable = executable
        self.prefix = prefix
        self.found = found
    }

    /// Apps started from Finder get a bare PATH, so Homebrew and uv's tool directory are added.
    public static func searchDirectories(path: String?, home: String = NSHomeDirectory()) -> [String] {
        var dirs = (path ?? "").split(separator: ":").map(String.init)
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "/usr/bin", "/bin"] where !dirs.contains(extra) {
            dirs.append(extra)
        }
        return dirs
    }

    /// The path from Settings, else `jdf-stt` on the search path, else `uvx --offline jdf-stt`.
    /// `--offline` keeps the fallback off the network: it runs jdf-stt only when uv already has
    /// it cached, and otherwise fails with uv's message instead of downloading from PyPI.
    public static func resolve(
        settingsPath: String?,
        searchDirectories: [String],
        isExecutable: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }
    ) -> CLICommand {
        if let settingsPath, !settingsPath.isEmpty {
            let expanded = (settingsPath as NSString).expandingTildeInPath
            return CLICommand(executable: expanded, found: isExecutable(expanded))
        }
        func find(_ name: String) -> String? {
            searchDirectories.lazy.map { ($0 as NSString).appendingPathComponent(name) }.first(where: isExecutable)
        }
        if let cli = find("jdf-stt") { return CLICommand(executable: cli) }
        if let uvx = find("uvx") { return CLICommand(executable: uvx, prefix: ["--offline", "jdf-stt"], found: false) }
        return CLICommand(executable: "/usr/bin/env", prefix: ["uvx", "--offline", "jdf-stt"], found: false)
    }
}

/// Drives the jdf-stt CLI as a child process. The CLI does the recording (ffmpeg), the
/// transcription and the rewrite modes; the app only starts, stops and reads JSON.
public struct CLIClient: Sendable {
    public var command: CLICommand
    /// Options passed on every call, e.g. `["-m", "small"]`.
    public var options: [String]
    /// The child's environment; PATH must reach whisper-cli and ffmpeg.
    public var environment: [String: String]

    public init(command: CLICommand, options: [String] = [], environment: [String: String]? = nil) {
        self.command = command
        self.options = options
        var env = environment ?? ProcessInfo.processInfo.environment
        env["PATH"] = CLICommand.searchDirectories(path: env["PATH"]).joined(separator: ":")
        self.environment = env
    }

    /// Starts recording from the microphone. The child (ffmpeg) inherits the app's microphone
    /// permission.
    public func startDictation(untilSilence: Bool) throws -> DictationSession {
        var args = ["--mic", "--format", "json"]
        if untilSilence { args.append("--until-silence") }
        return try DictationSession(launch: process(args + options))
    }

    /// Transcribes an audio file and returns the transcript.
    public func transcribeFile(_ url: URL) async throws -> Transcript {
        let session = try DictationSession(launch: process([url.path, "--format", "json"] + options), stdinIsPipe: false)
        return try await session.result()
    }

    func process(_ args: [String]) -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: command.executable)
        p.arguments = command.prefix + args
        p.environment = environment
        return p
    }
}

/// One running jdf-stt call. `stop()` asks for the transcript, `cancel()` throws it away,
/// `result()` waits for either (or for the CLI stopping itself on silence).
public final class DictationSession: @unchecked Sendable {
    private let process: Process
    private let stdin: FileHandle?
    private let outcome: Task<Transcript, Error>

    init(launch process: Process, stdinIsPipe: Bool = true) throws {
        // A write to a CLI that already exited must fail, not kill the app.
        signal(SIGPIPE, SIG_IGN)
        let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
        process.standardInput = stdinIsPipe ? inPipe : FileHandle.nullDevice
        process.standardOutput = outPipe
        process.standardError = errPipe
        try process.run()
        self.process = process
        stdin = stdinIsPipe ? inPipe.fileHandleForWriting : nil
        outcome = Task.detached {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global().async {
                    continuation.resume(with: Result { try Self.collect(process, out: outPipe, err: errPipe) })
                }
            }
        }
    }

    /// The process identifier, for logs.
    public var pid: Int32 { process.processIdentifier }

    /// Stop recording and transcribe: the CLI's pipe protocol is a newline on stdin.
    public func stop() {
        try? stdin?.write(contentsOf: Data("\n".utf8))
    }

    /// Throw the recording away: SIGINT makes the CLI delete it and exit 130.
    public func cancel() {
        if process.isRunning { process.interrupt() }
    }

    public func result() async throws -> Transcript {
        try await outcome.value
    }

    private static func collect(_ process: Process, out: Pipe, err: Pipe) throws -> Transcript {
        final class Box: @unchecked Sendable { var data = Data() }
        let stderr = Box()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            stderr.data = err.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }
        let stdout = out.fileHandleForReading.readDataToEndOfFile()
        group.wait()
        process.waitUntilExit()

        let status = process.terminationStatus
        if status == 130 || (process.terminationReason == .uncaughtSignal && status == SIGINT) {
            throw CLIError.cancelled
        }
        guard status == 0 else {
            let message = String(decoding: stderr.data, as: UTF8.self)
                .split(separator: "\n").suffix(3).joined(separator: "\n")
            throw CLIError.failed(status: status, message: message)
        }
        if stdout.allSatisfy({ $0 == 0x20 || $0 == 0x0A || $0 == 0x0D || $0 == 0x09 }) {
            return .empty  // the CLI's "no speech"
        }
        do {
            return try JSONDecoder().decode(Transcript.self, from: stdout)
        } catch {
            throw CLIError.badOutput(String(decoding: stdout, as: UTF8.self))
        }
    }
}
