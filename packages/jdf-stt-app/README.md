# jdf-stt menu-bar app

A macOS 15+ menu-bar app for [jdf-stt](../jdf-stt): hold a key to talk, tap for hands-free,
double-tap to lock, Esc to cancel. The text is inserted at the cursor. All recording and
transcription is done by the `jdf-stt` CLI on this Mac; the app starts it, stops it and reads
its JSON. See the "Menu-bar app" section of the [jdf-stt README](../jdf-stt/README.md) for use.

## Layout

- `Sources/STTCore`: everything testable without permissions. `HotkeyMachine` (the one-key
  gestures), `HistoryStore`, `ClipboardGuard` (paste-and-restore), `OfflineStatus` (the icon, from `jdf-stt status`),
  `CLIClient` (runs `jdf-stt`; newline on stdin stops, SIGINT cancels, exit 130 is cancelled;
  `-o -` keeps the JSON on stdout whatever `config.toml` says),
  `Transcript` (the CLI's JSON contract), `DictationController` (machine plus sessions; holds a
  transcript back until the stopping key is released, so a chord on it still cancels).
- `Sources/STTApp`: the app. `HotkeyTap` (listen-only event tap, needs Input Monitoring),
  `TextInserter` (Accessibility, paste fallback), `Permissions`, `StatusItem` (menu),
  `AppDelegate` (wiring), `Settings` (UserDefaults).
- `Resources/Info.plist`: LSUIElement, NSMicrophoneUsageDescription, bundle id `eu.joaof.jdf-stt`.
- `scripts/make-app.sh`: release build, `build/jdf-stt.app`, ad-hoc signature.
- `Tests/fixtures/fake-jdf-stt`: a shell stand-in for the CLI used by `CLIClientTests` and `DictationControllerTests`.

## Development

```sh
swift build
swift test      # Swift Testing; never opens the microphone or asks for a permission
```

SwiftPM only, no third-party packages, no Xcode project. CI: `.github/workflows/jdf-stt-app-ci.yml`.
