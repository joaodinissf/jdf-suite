#!/bin/bash
# Builds the menu-bar app in release mode and assembles build/jdf-stt.app, signed ad hoc
# (codesign -s -). No Xcode project, no DerivedData: everything stays in this package.
#
# Usage: scripts/make-app.sh        (from packages/jdf-stt-app)
#
# Ad-hoc signatures change on every build, so macOS may ask for the microphone,
# Accessibility and Input Monitoring permissions again after a rebuild.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release --product STTApp
bin="$(swift build -c release --show-bin-path)/STTApp"

app=build/jdf-stt.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp Resources/Info.plist "$app/Contents/Info.plist"
cp "$bin" "$app/Contents/MacOS/STTApp"

codesign --force --sign - --identifier eu.joaof.jdf-stt "$app"
codesign --verify --verbose "$app"
echo "Built $app"
