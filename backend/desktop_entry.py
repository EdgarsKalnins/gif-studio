"""Standalone desktop entrypoint for PyInstaller-bundled GIF Studio backend."""

from __future__ import annotations

import argparse
import multiprocessing
import os
from pathlib import Path

import uvicorn

from app.main import create_app


def main() -> None:
    multiprocessing.freeze_support()
    parser = argparse.ArgumentParser(description="GIF Studio Local Engine")
    parser.add_argument("--host", default=os.environ.get("GIF_STUDIO_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("GIF_STUDIO_BACKEND_PORT", "8001")))
    parser.add_argument("--storage", default=os.environ.get("GIF_MAKER_STORAGE", ""))
    args = parser.parse_args()

    storage_dir = Path(args.storage) if args.storage else None
    app = create_app(storage_dir=storage_dir)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
