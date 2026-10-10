import Foundation

public struct HistoryEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var date: Date
    public var text: String
    public var language: String?
    public var duration: Double?

    public init(id: UUID = UUID(), date: Date = Date(), text: String, language: String?, duration: Double?) {
        self.id = id
        self.date = date
        self.text = text
        self.language = language
        self.duration = duration
    }
}

/// Every dictation result, kept in one JSON file (`history.json`) so nothing is ever lost,
/// even when insertion fails.
public final class HistoryStore {
    public let fileURL: URL
    public private(set) var entries: [HistoryEntry] = []

    /// `~/Library/Application Support/jdf-stt`
    public static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("jdf-stt", isDirectory: true)
    }

    /// Loads `history.json` from `directory`; a missing file is an empty history. A damaged
    /// file is set aside as `history.json.bad` rather than overwritten.
    public init(directory: URL = HistoryStore.defaultDirectory) {
        fileURL = directory.appendingPathComponent("history.json")
        guard let data = try? Data(contentsOf: fileURL) else { return }
        if let decoded = try? Self.decoder.decode([HistoryEntry].self, from: data) {
            entries = decoded
        } else {
            let bad = fileURL.appendingPathExtension("bad")
            try? FileManager.default.removeItem(at: bad)
            try? FileManager.default.moveItem(at: fileURL, to: bad)
        }
    }

    public func append(_ entry: HistoryEntry) throws {
        entries.append(entry)
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.encoder.encode(entries).write(to: fileURL, options: .atomic)
    }

    /// The newest `count` entries, newest first.
    public func recent(_ count: Int) -> [HistoryEntry] {
        Array(entries.suffix(count).reversed())
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
