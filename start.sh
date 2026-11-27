#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${GIF_STUDIO_BACKEND_PORT:-8001}"
FRONTEND_PORT="${GIF_STUDIO_FRONTEND_PORT:-3000}"

# Fresh-clone bootstrap for Python backend venv
if [ ! -d "$ROOT_DIR/backend/.venv" ]; then
  echo "Bootstrapping Python backend environment in backend/.venv ..."
  python3 -m venv "$ROOT_DIR/backend/.venv"
  "$ROOT_DIR/backend/.venv/bin/python" -m pip install --upgrade pip
  "$ROOT_DIR/backend/.venv/bin/python" -m pip install -e "$ROOT_DIR/backend[dev]"
fi

# Fresh-clone bootstrap for Next.js frontend dependencies
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "Installing Next.js frontend dependencies in frontend/node_modules ..."
  (cd "$ROOT_DIR/frontend" && npm install)
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "Warning: ffmpeg / ffprobe not found in PATH. Install FFmpeg for video import & 2-pass GIF/WebM/MP4 exports."
fi

cleanup() {
  echo ""
  echo "Stopping GIF Studio servers..."
  kill ${BACKEND_PID:-} ${FRONTEND_PID:-} 2>/dev/null || true
  wait ${BACKEND_PID:-} ${FRONTEND_PID:-} 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Python FastAPI backend on http://127.0.0.1:${BACKEND_PORT} ..."
(
  cd "$ROOT_DIR/backend"
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload
) &
BACKEND_PID=$!

echo "Starting Next.js frontend on http://localhost:${FRONTEND_PORT} ..."
(
  cd "$ROOT_DIR/frontend"
  export NEXT_PUBLIC_API_URL="http://127.0.0.1:${BACKEND_PORT}"
  exec npm run dev -- --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "GIF Studio is running! Open http://localhost:${FRONTEND_PORT} in your browser."
wait
