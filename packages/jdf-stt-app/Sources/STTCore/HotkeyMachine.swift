import Foundation

/// One key, three gestures: hold to talk, tap for hands-free, double-tap to lock.
///
/// The machine is pure: the app feeds it key events with their timestamps and acts on what it
/// returns. Recording starts on the first key-down (no waiting to learn the gesture), so the
/// gesture only decides how the recording ends.
public struct HotkeyMachine: Sendable {
    public enum State: Equatable, Sendable {
        case idle
        /// Key is down; recording since `since`.
        case pressed(since: TimeInterval)
        /// A short tap started a hands-free recording at `tapAt`.
        case handsFree(tapAt: TimeInterval)
        /// Tapped twice: records until the next key-down. (With Stop on Silence the CLI ends
        /// any recording on a pause; the app then resets the machine.)
        case locked
    }

    public enum Event: Equatable, Sendable {
        case down(TimeInterval)
        case up(TimeInterval)
        case escape
        /// The recording ended itself after a pause (the CLI's --until-silence).
        case silence
    }

    public enum Action: Equatable, Sendable {
        case start
        case stopAndInsert
        case cancel
    }

    /// A press at least this long is hold-to-talk; shorter is a tap.
    public var holdThreshold: TimeInterval
    /// A second key-down within this long of a tap locks the recording.
    public var doubleTapWindow: TimeInterval
    /// Whether `.silence` ends a hands-free recording.
    public var stopOnSilence: Bool
    public private(set) var state: State = .idle

    public init(holdThreshold: TimeInterval = 0.30, doubleTapWindow: TimeInterval = 0.35, stopOnSilence: Bool = false) {
        self.holdThreshold = holdThreshold
        self.doubleTapWindow = doubleTapWindow
        self.stopOnSilence = stopOnSilence
    }

    public var isRecording: Bool { state != .idle }

    /// Back to idle without an action, e.g. when the recording ended on its own.
    public mutating func reset() { state = .idle }

    public mutating func handle(_ event: Event) -> Action? {
        switch (state, event) {
        case (.idle, .down(let t)):
            state = .pressed(since: t)
            return .start
        case (.pressed(let since), .up(let t)):
            if t - since >= holdThreshold {
                state = .idle
                return .stopAndInsert
            }
            state = .handsFree(tapAt: t)
            return nil
        case (.handsFree(let tapAt), .down(let t)):
            if t - tapAt <= doubleTapWindow {
                state = .locked
                return nil
            }
            state = .idle
            return .stopAndInsert
        case (.locked, .down):
            state = .idle
            return .stopAndInsert
        case (.handsFree, .silence) where stopOnSilence:
            state = .idle
            return .stopAndInsert
        case (.pressed, .escape), (.handsFree, .escape), (.locked, .escape):
            state = .idle
            return .cancel
        default:
            // Key repeat, the release after a stopping press, Esc while idle, and so on.
            return nil
        }
    }
}
