#!/usr/bin/env bash
# Regenerates the Classic 2004 golden data from the (seeded) original Java code.
# Needs a JDK (e.g. Homebrew openjdk). Outputs: tests/fixtures/classic/frame-*.binz,
# public/classic/inputs.binz (Java-decoded images, used by Classic mode at runtime).
set -euo pipefail
cd "$(dirname "$0")"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
ROOT=../..
BUILD=build
rm -rf "$BUILD" && mkdir -p "$BUILD/blueearth/images"
cp "$ROOT"/public/classic/{world,worldtopo,LightMapOcean}.jpg "$BUILD/blueearth/images/"
"$JAVA_HOME/bin/javac" -nowarn -d "$BUILD" src/blueearth/*.java
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$BUILD" blueearth.GoldenHarness \
  "$ROOT/tests/fixtures/classic/mouse-script.txt" "$BUILD/out" 600 \
  1 2 64 255 256 300 320 345 400 470 480 600
mv "$BUILD"/out/frame-*.binz "$ROOT/tests/fixtures/classic/"
mv "$BUILD/out/inputs.binz" "$ROOT/public/classic/inputs.binz"
rm -rf "$BUILD"
ls -la "$ROOT/tests/fixtures/classic" "$ROOT/public/classic/inputs.binz"
