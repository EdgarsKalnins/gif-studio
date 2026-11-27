from __future__ import annotations

import os
import subprocess
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .models import (
    ExportResponse,
    ProjectRenderRequest,
    UploadedMediaItem,
    VideoExtractRequest,
    VideoExtractResponse,
)
from .processor import MediaStore, render_project

STORAGE_DIR = Path(os.environ.get("GIF_MAKER_STORAGE", Path(__file__).resolve().parent.parent / "storage"))


def create_app(storage_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="GIF Studio API", version="0.1.0")
    store = MediaStore(storage_dir or STORAGE_DIR)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/demo-samples", response_model=list[UploadedMediaItem])
    def create_demo_samples(pack: str = "stock") -> list[UploadedMediaItem]:
        return store.create_demo_samples(pack=pack)

    @app.get("/api/media", response_model=list[UploadedMediaItem])
    def list_media() -> list[UploadedMediaItem]:
        return store.list_media()

    @app.post("/api/upload", response_model=list[UploadedMediaItem])
    async def upload_media(files: list[UploadFile] = File(...)) -> list[UploadedMediaItem]:
        if not files:
            raise HTTPException(status_code=400, detail="No files uploaded")

        items: list[UploadedMediaItem] = []
        for f in files:
            raw = await f.read()
            if not raw:
                continue
            try:
                uploaded = store.ingest_upload_multi(f.filename or "upload.jpg", raw)
                items.extend(uploaded)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to process {f.filename}: {exc}") from exc

        if not items:
            raise HTTPException(status_code=400, detail="All uploaded files were empty")
        return items

    @app.post("/api/extract-video", response_model=VideoExtractResponse)
    def extract_video(req: VideoExtractRequest) -> VideoExtractResponse:
        try:
            return store.extract_video_frames(
                media_id=req.media_id,
                start_sec=req.start_sec,
                end_sec=req.end_sec,
                fps=req.fps,
                max_frames=req.max_frames,
                speed=req.speed,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Video extraction failed: {exc}") from exc

    @app.get("/api/media/{media_id}/preview")
    def get_media_preview(media_id: str) -> FileResponse:
        try:
            path = store.get_preview_path(media_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not path.exists():
            raise HTTPException(status_code=404, detail="Preview file missing")
        return FileResponse(path)

    @app.get("/api/media/{media_id}/video")
    def get_media_video(media_id: str) -> FileResponse:
        try:
            path = store.get_video_stream_path(media_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not path.exists():
            raise HTTPException(status_code=404, detail="Video stream missing")
        stream_mime = {
            ".webm": "video/webm",
            ".ogv": "video/ogg",
        }.get(path.suffix.lower(), "video/mp4")
        return FileResponse(path, media_type=stream_mime)

    @app.delete("/api/media/{media_id}")
    def delete_media(media_id: str) -> dict[str, str]:
        try:
            store.delete_media(media_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"deleted": media_id}

    @app.post("/api/export", response_model=ExportResponse)
    def export_project(req: ProjectRenderRequest) -> ExportResponse:
        try:
            return render_project(store, req)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            stderr_msg = (exc.stderr or b"").decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            tail = stderr_msg.strip().splitlines()[-1] if stderr_msg.strip() else str(exc)
            raise HTTPException(status_code=500, detail=f"FFmpeg render error: {tail}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Render failed: {exc}") from exc

    @app.get("/api/exports/{export_id}")
    def get_export(export_id: str, download: bool = Query(default=False)) -> FileResponse:
        try:
            path = store.get_export_path(export_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not path.exists():
            raise HTTPException(status_code=404, detail="Exported file missing")
        ext_mime = {
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".avif": "image/avif",
            ".apng": "image/apng",
            ".png": "image/png",
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".lottie": "application/zip",
            ".svg": "image/svg+xml",
            ".json": "application/json",
            ".zip": "application/zip",
        }.get(path.suffix.lower())
        headers = {}
        if download:
            headers["Content-Disposition"] = f'attachment; filename="{path.name}"'
        return FileResponse(path, media_type=ext_mime, headers=headers)

    @app.get("/api/exports/{export_id}/preview-frames")
    def get_export_preview_frames(export_id: str) -> dict:
        """Unpack frames from a .lottie archive for lightweight live preview in ExportModal."""
        import base64
        import zipfile
        import json as json_mod

        try:
            path = store.get_export_path(export_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not path.exists() or path.suffix.lower() != ".lottie":
            raise HTTPException(status_code=404, detail="Not a dotLottie archive")

        with zipfile.ZipFile(path, "r") as zf:
            names = zf.namelist()
            anim_files = [n for n in names if n.startswith("animations/") and n.endswith(".json")]
            if not anim_files:
                raise HTTPException(status_code=400, detail="Missing animation JSON inside .lottie")
            anim = json_mod.loads(zf.read(anim_files[0]).decode("utf-8"))
            for asset in anim.get("assets") or []:
                u = str(asset.get("u") or "")
                p_name = str(asset.get("p") or "")
                candidate = (u + p_name).lstrip("/")
                if not candidate.startswith("images/") and f"images/{p_name}" in names:
                    candidate = f"images/{p_name}"
                if candidate in names:
                    ext = Path(candidate).suffix.lower()
                    mime = "image/webp" if ext == ".webp" else "image/png"
                    b64 = base64.b64encode(zf.read(candidate)).decode("ascii")
                    asset["u"] = ""
                    asset["p"] = f"data:{mime};base64,{b64}"
                    asset["e"] = 1
            return anim

    static_dir_env = os.environ.get("GIF_STUDIO_STATIC_DIR", "").strip()
    if static_dir_env and Path(static_dir_env).is_dir():
        app.mount("/", StaticFiles(directory=static_dir_env, html=True), name="static-ui")

    return app


app = create_app()
