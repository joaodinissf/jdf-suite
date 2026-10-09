import Foundation
import Testing
@testable import STTCore

@Suite struct HistoryStoreTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("stt-history-\(UUID().uuidString)")

    @Test func startsEmptyWithoutAFile() {
        #expect(HistoryStore(directory: dir).entries.isEmpty)
    }

    @Test func appendPersistsAcrossInstances() throws {
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = HistoryStore(directory: dir)
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        try store.append(HistoryEntry(date: date, text: "first", language: "en", duration: 1.5))
        try store.append(HistoryEntry(text: "second", language: nil, duration: nil))

        let reloaded = HistoryStore(directory: dir)
        #expect(reloaded.entries.map(\.text) == ["first", "second"])
        #expect(reloaded.entries[0] == store.entries[0])
        #expect(reloaded.entries[0].date == date)
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("history.json").path))
    }

    @Test func recentIsNewestFirst() throws {
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = HistoryStore(directory: dir)
        for text in ["a", "b", "c"] { try store.append(HistoryEntry(text: text, language: nil, duration: nil)) }
        #expect(store.recent(2).map(\.text) == ["c", "b"])
        #expect(store.recent(10).map(\.text) == ["c", "b", "a"])
    }

    @Test func aDamagedFileIsSetAsideNotLost() throws {
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: dir.appendingPathComponent("history.json"))
        let store = HistoryStore(directory: dir)
        #expect(store.entries.isEmpty)
        let bad = try String(contentsOf: dir.appendingPathComponent("history.json.bad"), encoding: .utf8)
        #expect(bad == "not json")
    }
}
