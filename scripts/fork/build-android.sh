#!/usr/bin/env bash
# Android-only version of frontend's `npm run build:mobile`. Upstream's script runs `cap sync` for
# both platforms and fails on a Mac without Xcode once the Android half has already copied. The
# fork ships Android only. Pass --apk to go on to the Gradle release build (needs JDK 21).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

NODE22=/opt/homebrew/opt/node@22/bin
if [ -x "$NODE22/node" ]; then export PATH="$NODE22:$PATH"; fi

cd frontend
VITE_MOBILE=1 VITE_FORK=1 npx vite build
node ../scripts/catalogue/stage-media.mjs dist
npx cap sync android
node scripts/check-mobile-bundle.mjs

if [ "${1:-}" = "--apk" ]; then
  # JDK 21 lives in ~/Library/Java/JavaVirtualMachines (tar.gz install, no sudo); java_home finds it.
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  "$JAVA_HOME/bin/java" -version 2>&1 | head -1
  (cd android && ./gradlew assembleRelease)
  ls -la android/app/build/outputs/apk/release/
fi
