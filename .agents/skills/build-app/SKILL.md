---
name: build-app
description: >-
  Build standalone macOS (.dmg/.zip), Windows (.exe), and Linux (.AppImage/.deb) desktop apps
  for GIF Studio using Electron, PyInstaller, Next.js static export, and bundled static FFmpeg.
  Use whenever asked to build, package, smoke-test, or trigger cross-OS desktop builds.
---

# Build GIF Studio Standalone Desktop App

Use this workflow when asked to package **GIF Studio** into a standalone offline desktop application for **macOS**, **Windows**, or **Linux**.

## Architecture Built by This Command
- **Shell**: `desktop/` (Electron + `electron-builder`) with ad-hoc signing (`identity: null`) so no Apple Developer or Windows EV cert is required.
- **Engine**: PyInstaller `--onedir` build (`gif-studio-engine`) from `backend/desktop_entry.py`, binding a free local `127.0.0.1` port and writing user uploads/exports cleanly into Electron's `userData` directory.
- **Frontend**: Static Next.js export (`NEXT_PUBLIC_STATIC_EXPORT=1`) served on the same origin by FastAPI.
- **Zero-dependency Binaries**: Static `ffmpeg` + `ffprobe` binaries and `backend/samples/` copied into `desktop/staged/`.

## Commands

1. **Build native standalone installer for the current OS** (runs backend `pytest`, frontend `eslint`, PyInstaller freeze, Next static export, icon generation, FFmpeg staging, and `electron-builder`):
   ```bash
   node scripts/build-desktop.mjs --target current
   ```

2. **Fast local unpacked `.app` / folder verification** (skips `.dmg` compression for quicker smoke testing):
   ```bash
   node scripts/build-desktop.mjs --target current --dir
   ```

3. **Run headless smoke test against a built macOS `.app` or unpacked bundle**:
   ```bash
   desktop/dist/mac-arm64/GIF\ Studio.app/Contents/MacOS/GIF\ Studio --smoke-test
   ```
   *(Adjust `mac-arm64` -> `mac` on Intel Mac, or run the built `.exe` / AppImage with `--smoke-test`.)*

4. **Build macOS, Windows, and Linux standalone apps via GitHub Actions matrix** (`.github/workflows/build-desktop.yml`):
   ```bash
   node scripts/build-desktop.mjs --target all --ci
   ```
   Or target one remote OS specifically:
   ```bash
   node scripts/build-desktop.mjs --target win --ci
   node scripts/build-desktop.mjs --target linux --ci
   node scripts/build-desktop.mjs --target mac --ci
   ```
