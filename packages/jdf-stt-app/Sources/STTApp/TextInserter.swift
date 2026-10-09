import AppKit
import ApplicationServices
import STTCore

/// Puts dictated text at the cursor. First choice: set the focused element's selected text
/// through Accessibility, which leaves the clipboard alone. Fallback: paste-and-restore with
/// ClipboardGuard. BLIND: not run.
@MainActor
enum TextInserter {
    enum Method { case accessibility, paste }

    @discardableResult
    static func insert(_ text: String) -> Method {
        if insertWithAccessibility(text) { return .accessibility }
        paste(text)
        return .paste
    }

    private static func insertWithAccessibility(_ text: String) -> Bool {
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused, CFGetTypeID(focused) == AXUIElementGetTypeID()
        else { return false }
        let element = focused as! AXUIElement
        return AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success
    }

    private static func paste(_ text: String) {
        let pasteboard = SystemPasteboard()
        let saved = ClipboardGuard.put(text, on: pasteboard)
        postCommandV()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            ClipboardGuard.restore(saved, on: pasteboard)
        }
    }

    private static func postCommandV() {
        let source = CGEventSource(stateID: .combinedSessionState)
        let vKey: CGKeyCode = 9
        for keyDown in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: keyDown)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
    }
}

/// NSPasteboard behind ClipboardGuard's protocol.
final class SystemPasteboard: PasteboardStore {
    private let pasteboard = NSPasteboard.general

    var changeCount: Int { pasteboard.changeCount }

    func snapshot() -> [[String: Data]] {
        (pasteboard.pasteboardItems ?? []).map { item in
            var types: [String: Data] = [:]
            for type in item.types { types[type.rawValue] = item.data(forType: type) }
            return types
        }
    }

    func restore(_ items: [[String: Data]]) {
        pasteboard.clearContents()
        let restored = items.map { types in
            let item = NSPasteboardItem()
            for (type, data) in types { item.setData(data, forType: NSPasteboard.PasteboardType(type)) }
            return item
        }
        if !restored.isEmpty { pasteboard.writeObjects(restored) }
    }

    func setString(_ string: String) {
        pasteboard.clearContents()
        pasteboard.setString(string, forType: .string)
    }
}
