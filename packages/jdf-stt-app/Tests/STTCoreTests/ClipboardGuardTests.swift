import Foundation
import Testing
@testable import STTCore

final class FakePasteboard: PasteboardStore {
    var changeCount = 0
    var items: [[String: Data]] = []

    func snapshot() -> [[String: Data]] { items }
    func restore(_ items: [[String: Data]]) { self.items = items; changeCount += 1 }
    func setString(_ string: String) { items = [["public.utf8-plain-text": Data(string.utf8)]]; changeCount += 1 }
    var string: String? { items.first?["public.utf8-plain-text"].map { String(decoding: $0, as: UTF8.self) } }
}

@Suite struct ClipboardGuardTests {
    @Test func putsTheTextThenRestoresTheUsersItems() {
        let pb = FakePasteboard()
        let original: [[String: Data]] = [["public.png": Data([1, 2, 3])], ["public.utf8-plain-text": Data("mine".utf8)]]
        pb.items = original
        let saved = ClipboardGuard.put("dictated", on: pb)
        #expect(pb.string == "dictated")
        #expect(ClipboardGuard.restore(saved, on: pb))
        #expect(pb.items == original)
    }

    @Test func doesNotRestoreOverANewerCopy() {
        let pb = FakePasteboard()
        pb.setString("mine")
        let saved = ClipboardGuard.put("dictated", on: pb)
        pb.setString("copied meanwhile")
        #expect(!ClipboardGuard.restore(saved, on: pb))
        #expect(pb.string == "copied meanwhile")
    }

    @Test func restoresAnEmptyPasteboard() {
        let pb = FakePasteboard()
        let saved = ClipboardGuard.put("dictated", on: pb)
        #expect(ClipboardGuard.restore(saved, on: pb))
        #expect(pb.items.isEmpty)
    }
}
