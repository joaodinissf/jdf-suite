import Foundation

/// The parts of a pasteboard ClipboardGuard needs; NSPasteboard in the app, a fake in tests.
public protocol PasteboardStore: AnyObject {
    /// Changes every time anyone writes to the pasteboard.
    var changeCount: Int { get }
    /// Every item, as type identifier -> data.
    func snapshot() -> [[String: Data]]
    func restore(_ items: [[String: Data]])
    func setString(_ string: String)
}

/// Paste-and-restore, the fallback when Accessibility insertion fails: put the text on the
/// pasteboard, paste, then put the user's own items back, unless someone (the user, or the
/// target app) wrote to the pasteboard in the meantime.
public enum ClipboardGuard {
    public struct Saved {
        public let items: [[String: Data]]
        /// The change count right after our write.
        public let ourChangeCount: Int
    }

    /// Saves what is on the pasteboard and replaces it with `text`.
    public static func put(_ text: String, on pasteboard: PasteboardStore) -> Saved {
        let items = pasteboard.snapshot()
        pasteboard.setString(text)
        return Saved(items: items, ourChangeCount: pasteboard.changeCount)
    }

    /// Puts the saved items back. Returns false (and changes nothing) if the pasteboard
    /// changed since our write.
    @discardableResult
    public static func restore(_ saved: Saved, on pasteboard: PasteboardStore) -> Bool {
        guard pasteboard.changeCount == saved.ourChangeCount else { return false }
        pasteboard.restore(saved.items)
        return true
    }
}
