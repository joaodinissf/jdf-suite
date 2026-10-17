import Foundation

/// A copy of some file data in its own new temporary directory, for a Shortcuts file that
/// arrives as data without a URL. The given filename is untrusted: only its last component is
/// kept, and a name that is empty, "." or ".." becomes "audio", so the copy never lands outside
/// `directory`. `remove()` deletes exactly that directory and nothing else; if the write itself
/// fails, the initializer removes that directory before it rethrows.
public struct TemporaryFile: Sendable {
    public let directory: URL
    public let url: URL

    public init(data: Data, filename: String, in base: URL = FileManager.default.temporaryDirectory) throws {
        var name = (filename as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." || name.contains("/") { name = "audio" }
        directory = base.appendingPathComponent("jdf-stt-\(UUID().uuidString)", isDirectory: true)
        // No intermediate directories: this fails rather than reuse a directory that exists.
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        url = directory.appendingPathComponent(name, isDirectory: false)
        do {
            try data.write(to: url, options: .withoutOverwriting)
        } catch {
            // The caller never gets a value to remove(), so take the directory back here.
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    public func remove() {
        try? FileManager.default.removeItem(at: directory)
    }
}
