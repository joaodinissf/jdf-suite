import Foundation
import Testing
@testable import STTCore

struct TemporaryFileTests {
    func makeBase() throws -> URL {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("tmpfile-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false)
        return base
    }

    @Test(arguments: ["../../escape.wav", "/etc/escape.wav", "sub/escape.wav"])
    func aFilenameWithAPathStaysInsideItsOwnDirectory(_ filename: String) throws {
        let base = try makeBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let file = try TemporaryFile(data: Data("x".utf8), filename: filename, in: base)
        #expect(file.url.deletingLastPathComponent().standardizedFileURL == file.directory.standardizedFileURL)
        #expect(file.url.lastPathComponent == "escape.wav")
        #expect(file.directory.deletingLastPathComponent().standardizedFileURL == base.standardizedFileURL)
        #expect(FileManager.default.fileExists(atPath: file.url.path))
    }

    @Test(arguments: ["", ".", "..", "a/.."])
    func aNameThatIsNoFileBecomesAudio(_ filename: String) throws {
        let base = try makeBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let file = try TemporaryFile(data: Data("x".utf8), filename: filename, in: base)
        #expect(file.url.lastPathComponent == "audio")
        #expect(file.url.deletingLastPathComponent().standardizedFileURL == file.directory.standardizedFileURL)
    }

    @Test func removeDeletesOnlyItsOwnDirectory() throws {
        let base = try makeBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let neighbour = base.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: neighbour)
        let file = try TemporaryFile(data: Data("x".utf8), filename: "../keep.txt", in: base)
        file.remove()
        #expect(!FileManager.default.fileExists(atPath: file.directory.path))
        #expect(FileManager.default.fileExists(atPath: neighbour.path))
        #expect(FileManager.default.fileExists(atPath: base.path))
    }

    @Test func aFailedWriteLeavesNoDirectoryBehind() throws {
        let base = try makeBase()
        defer { try? FileManager.default.removeItem(at: base) }
        // 300 bytes is over the 255-byte filename limit, so the write fails after mkdir.
        #expect(throws: (any Error).self) {
            try TemporaryFile(data: Data("x".utf8), filename: String(repeating: "a", count: 300), in: base)
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: base.path).isEmpty)
    }

    @Test func eachCopyGetsADirectoryOfItsOwn() throws {
        let base = try makeBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let a = try TemporaryFile(data: Data("a".utf8), filename: "same.wav", in: base)
        let b = try TemporaryFile(data: Data("b".utf8), filename: "same.wav", in: base)
        #expect(a.directory != b.directory)
        a.remove()
        #expect(FileManager.default.fileExists(atPath: b.url.path))
    }
}
