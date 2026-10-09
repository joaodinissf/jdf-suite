import Testing
@testable import STTCore

@Suite struct HotkeyMachineTests {
    @Test func holdToTalkStartsAtOnceAndStopsOnRelease() {
        var m = HotkeyMachine()
        #expect(m.handle(.down(10)) == .start)
        #expect(m.state == .pressed(since: 10))
        #expect(m.handle(.up(10.5)) == .stopAndInsert)
        #expect(m.state == .idle)
    }

    @Test func holdExactlyAtThresholdCountsAsHold() {
        var m = HotkeyMachine()
        _ = m.handle(.down(0))
        #expect(m.handle(.up(0.30)) == .stopAndInsert)
    }

    @Test func tapGoesHandsFreeAndTheNextPressStops() {
        var m = HotkeyMachine()
        #expect(m.handle(.down(0)) == .start)
        #expect(m.handle(.up(0.1)) == nil)
        #expect(m.state == .handsFree(tapAt: 0.1))
        #expect(m.handle(.down(5)) == .stopAndInsert)
        #expect(m.handle(.up(5.1)) == nil)
        #expect(m.state == .idle)
    }

    @Test func doubleTapLocksAndOnlyAPressEndsIt() {
        var m = HotkeyMachine(stopOnSilence: true)
        _ = m.handle(.down(0))
        _ = m.handle(.up(0.1))
        #expect(m.handle(.down(0.3)) == nil)
        #expect(m.state == .locked)
        #expect(m.handle(.up(0.35)) == nil)
        #expect(m.handle(.silence) == nil, "locked ignores silence")
        #expect(m.state == .locked)
        #expect(m.handle(.down(9)) == .stopAndInsert)
        #expect(m.state == .idle)
    }

    @Test func secondTapJustOutsideTheWindowStops() {
        var m = HotkeyMachine()
        _ = m.handle(.down(0))
        _ = m.handle(.up(0.1))
        #expect(m.handle(.down(0.46)) == .stopAndInsert)
    }

    @Test(arguments: ["pressed", "handsFree", "locked"])
    func escapeCancelsInEveryRecordingState(_ name: String) {
        var m = HotkeyMachine()
        _ = m.handle(.down(0))
        if name != "pressed" { _ = m.handle(.up(0.1)) }
        if name == "locked" { _ = m.handle(.down(0.2)) }
        #expect(m.isRecording)
        #expect(m.handle(.escape) == .cancel)
        #expect(m.state == .idle)
    }

    @Test func escapeWhileIdleDoesNothing() {
        var m = HotkeyMachine()
        #expect(m.handle(.escape) == nil)
        #expect(m.handle(.up(1)) == nil)
        #expect(m.handle(.silence) == nil)
    }

    @Test func silenceStopsHandsFreeOnlyWhenEnabled() {
        var off = HotkeyMachine(stopOnSilence: false)
        _ = off.handle(.down(0)); _ = off.handle(.up(0.1))
        #expect(off.handle(.silence) == nil)
        #expect(off.state == .handsFree(tapAt: 0.1))

        var on = HotkeyMachine(stopOnSilence: true)
        _ = on.handle(.down(0)); _ = on.handle(.up(0.1))
        #expect(on.handle(.silence) == .stopAndInsert)
        #expect(on.state == .idle)
    }

    @Test func silenceWhileHoldingDoesNotStop() {
        var m = HotkeyMachine(stopOnSilence: true)
        _ = m.handle(.down(0))
        #expect(m.handle(.silence) == nil)
        #expect(m.state == .pressed(since: 0))
    }

    @Test func keyRepeatWhileHoldingIsIgnored() {
        var m = HotkeyMachine()
        _ = m.handle(.down(0))
        #expect(m.handle(.down(0.05)) == nil)
        #expect(m.state == .pressed(since: 0))
    }

    @Test func thresholdsAreInjectable() {
        var m = HotkeyMachine(holdThreshold: 1.0, doubleTapWindow: 0.1)
        _ = m.handle(.down(0))
        #expect(m.handle(.up(0.5)) == nil, "0.5 s is a tap with a 1 s threshold")
        #expect(m.handle(.down(0.7)) == .stopAndInsert, "0.2 s later is outside a 0.1 s window")
    }
}
