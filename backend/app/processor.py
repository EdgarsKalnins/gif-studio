from __future__ import annotations

import base64
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps, ImageSequence
from pillow_heif import register_heif_opener

from .models import (
    AspectRatioPreset,
    BorderConfig,
    CropConfig,
    ExportConfig,
    ExportResponse,
    FilterConfig,
    FitMode,
    FrameConfig,
    LoopMode,
    MotionConfig,
    ProjectRenderRequest,
    TextBadgeLayer,
    TextOverlayConfig,
    TransitionType,
    UploadedMediaItem,
    VideoExtractResponse,
)

register_heif_opener()

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".apng",
    ".webp",
    ".avif",
    ".gif",
    ".heic",
    ".heif",
    ".hif",
    ".bmp",
    ".tiff",
    ".tif",
}
VECTOR_OR_ANIM_EXTENSIONS = {".svg", ".json"}
VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi", ".ogv"}
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_VIDEO_DURATION_SEC = 60.0


def _parse_hex_color(hex_str: str, fallback: tuple[int, int, int] = (9, 9, 11)) -> tuple[int, int, int]:
    cleaned = hex_str.strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(c * 2 for c in cleaned)
    if len(cleaned) != 6:
        return fallback
    try:
        return (int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16))
    except ValueError:
        return fallback


def _ffmpeg_bin() -> str:
    env_bin = os.environ.get("GIF_MAKER_FFMPEG", "").strip()
    if env_bin and Path(env_bin).exists():
        return env_bin
    return shutil.which("ffmpeg") or "ffmpeg"


def _ffprobe_bin() -> str:
    env_bin = os.environ.get("GIF_MAKER_FFPROBE", "").strip()
    if env_bin and Path(env_bin).exists():
        return env_bin
    return shutil.which("ffprobe") or "ffprobe"


def _samples_dir() -> Path:
    env_dir = os.environ.get("GIF_STUDIO_SAMPLES_DIR", "").strip()
    if env_dir and Path(env_dir).exists():
        return Path(env_dir)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "samples"
        if bundled.exists():
            return bundled
    return Path(__file__).resolve().parent.parent / "samples"


def _load_font(size: int, family: str = "sans") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_map = {
        "serif": [
            "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
            "/System/Library/Fonts/NewYork.ttf",
            "C:/Windows/Fonts/georgiab.ttf",
            "C:/Windows/Fonts/timesbd.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        ],
        "mono": [
            "/System/Library/Fonts/Menlo.ttc",
            "/System/Library/Fonts/SFNSMono.ttf",
            "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
            "C:/Windows/Fonts/consolab.ttf",
            "C:/Windows/Fonts/courbd.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        ],
        "display": [
            "/System/Library/Fonts/Supplemental/Arial Black.ttf",
            "/System/Library/Fonts/Supplemental/Impact.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "C:/Windows/Fonts/ariblk.ttf",
            "C:/Windows/Fonts/impact.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
        "sans": [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNS.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
    }
    candidates = font_map.get(family, font_map["sans"]) + font_map["sans"]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def _ffprobe_video(path: Path) -> tuple[int, int, float, float, str]:
    cmd = [
        _ffprobe_bin(),
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration,codec_name:format=duration",
        "-of",
        "json",
        str(path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(res.stdout)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    width = int(stream.get("width") or 720)
    height = int(stream.get("height") or 720)
    dur_raw = stream.get("duration") or fmt.get("duration") or 3.0
    duration = float(dur_raw)
    codec_name = str(stream.get("codec_name") or "").lower()
    rate_str = stream.get("r_frame_rate") or "30/1"
    if "/" in rate_str:
        num, den = rate_str.split("/", 1)
        fps = float(num) / max(float(den), 1.0)
    else:
        fps = float(rate_str)
    return width, height, duration, round(fps, 2), codec_name


class MediaStore:
    """Manages uploaded media, converted previews, and exported artifacts on local disk."""

    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.uploads_dir = root_dir / "uploads"
        self.exports_dir = root_dir / "exports"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root_dir / "media_index.json"
        self._index: dict[str, dict] = self._load_index()

    def _load_index(self) -> dict[str, dict]:
        if self.index_path.exists():
            try:
                return json.loads(self.index_path.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def _save_index(self) -> None:
        self.index_path.write_text(json.dumps(self._index, indent=2), encoding="utf-8")

    def _rasterize_svg(self, raw_bytes: bytes) -> bytes:
        """Rasterize an SVG file cleanly into RGBA PNG bytes using rsvg-convert or ImageMagick."""
        with tempfile.TemporaryDirectory() as tmp:
            svg_path = Path(tmp) / "input.svg"
            png_path = Path(tmp) / "output.png"
            svg_path.write_bytes(raw_bytes)
            rsvg_bin = shutil.which("rsvg-convert")
            if rsvg_bin:
                cmd = [rsvg_bin, "-w", "1080", "--keep-aspect-ratio", "-o", str(png_path), str(svg_path)]
            else:
                magick_bin = shutil.which("magick")
                if not magick_bin:
                    raise ValueError("SVG import requires rsvg-convert or ImageMagick installed locally")
                cmd = [magick_bin, "-background", "none", str(svg_path), "-resize", "1080x1080>", str(png_path)]
            res = subprocess.run(cmd, capture_output=True)
            if res.returncode != 0 or not png_path.exists():
                raise ValueError("Invalid or unsupported SVG file")
            return png_path.read_bytes()

    def _split_multiframe_image(self, filename: str, raw_bytes: bytes) -> list[UploadedMediaItem]:
        """Split animated GIF, WebP, AVIF, or APNG into individual frame items."""
        buf = io.BytesIO(raw_bytes)
        with Image.open(buf) as seq_img:
            n_frames = getattr(seq_img, "n_frames", 1)
            if n_frames <= 1:
                return []
            items: list[UploadedMediaItem] = []
            stem = Path(filename).stem
            limit = min(n_frames, 120)
            for idx, frame in enumerate(ImageSequence.Iterator(seq_img), start=1):
                if idx > limit:
                    break
                dur_ms = max(40, int(frame.info.get("duration") or 100))
                rgba = frame.convert("RGBA")
                out_buf = io.BytesIO()
                rgba.save(out_buf, format="PNG")
                item = self.ingest_upload(
                    f"{stem}_f{idx:03d}.png",
                    out_buf.getvalue(),
                    frame_duration_ms=dur_ms,
                )
                items.append(item)
            return items

    def _ingest_lottie_json(
        self,
        filename: str,
        raw_bytes: bytes,
        archive_assets: Optional[dict[str, bytes]] = None,
    ) -> list[UploadedMediaItem]:
        """Import embedded raster frame sequences from Bodymovin / Lottie JSON (or dotLottie archive)."""
        try:
            data = json.loads(raw_bytes.decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"Invalid JSON file: {exc}") from exc

        if not isinstance(data, dict) or "layers" not in data or "assets" not in data:
            raise ValueError("Unsupported JSON: expected a Lottie/Bodymovin animation object")

        fr = float(data.get("fr") or 15.0)
        assets_by_id: dict[str, bytes] = {}
        for asset in data.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            aid = str(asset.get("id") or "")
            p_val = str(asset.get("p") or "")
            u_val = str(asset.get("u") or "")
            if aid and p_val.startswith("data:image/") and ";base64," in p_val:
                b64_payload = p_val.split(";base64,", 1)[1]
                try:
                    assets_by_id[aid] = base64.b64decode(b64_payload)
                except Exception:
                    continue
            elif aid and archive_assets and p_val:
                rel = (u_val + p_val).lstrip("/")
                if rel in archive_assets:
                    assets_by_id[aid] = archive_assets[rel]
                elif f"images/{p_val}" in archive_assets:
                    assets_by_id[aid] = archive_assets[f"images/{p_val}"]

        if not assets_by_id:
            raise ValueError(
                "This Lottie JSON contains vector shapes only without embedded raster image frames."
            )

        image_layers = [
            layer
            for layer in (data.get("layers") or [])
            if isinstance(layer, dict) and str(layer.get("refId") or "") in assets_by_id
        ]
        image_layers.sort(key=lambda lyr: (float(lyr.get("ip", 0)), int(lyr.get("ind", 0))))

        stem = Path(filename).stem
        items: list[UploadedMediaItem] = []
        if image_layers:
            for idx, lyr in enumerate(image_layers[:120], start=1):
                aid = str(lyr.get("refId"))
                raw_img = assets_by_id[aid]
                span_frames = max(1.0, float(lyr.get("op", 1)) - float(lyr.get("ip", 0)))
                dur_ms = max(40, int(round((span_frames / max(1.0, fr)) * 1000.0)))
                with Image.open(io.BytesIO(raw_img)) as im:
                    rgba = im.convert("RGBA")
                    out_buf = io.BytesIO()
                    rgba.save(out_buf, format="PNG")
                items.append(
                    self.ingest_upload(
                        f"{stem}_f{idx:03d}.png",
                        out_buf.getvalue(),
                        frame_duration_ms=dur_ms,
                    )
                )
        else:
            default_ms = max(40, int(round(1000.0 / max(1.0, fr))))
            for idx, raw_img in enumerate(list(assets_by_id.values())[:120], start=1):
                with Image.open(io.BytesIO(raw_img)) as im:
                    rgba = im.convert("RGBA")
                    out_buf = io.BytesIO()
                    rgba.save(out_buf, format="PNG")
                items.append(
                    self.ingest_upload(
                        f"{stem}_f{idx:03d}.png",
                        out_buf.getvalue(),
                        frame_duration_ms=default_ms,
                    )
                )
        return items

    def _ingest_dotlottie(self, filename: str, raw_bytes: bytes) -> list[UploadedMediaItem]:
        """Unpack a .lottie ZIP container and ingest its animation frames."""
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
                names = zf.namelist()
                anim_files = [n for n in names if n.startswith("animations/") and n.endswith(".json")]
                if not anim_files:
                    anim_files = [n for n in names if n.endswith(".json") and n != "manifest.json"]
                if not anim_files:
                    raise ValueError("Invalid .lottie archive: no animation JSON found")
                archive_assets = {
                    n.lstrip("/"): zf.read(n)
                    for n in names
                    if not n.endswith("/") and not n.endswith(".json")
                }
                anim_bytes = zf.read(anim_files[0])
                return self._ingest_lottie_json(filename, anim_bytes, archive_assets=archive_assets)
        except zipfile.BadZipFile as exc:
            raise ValueError("Invalid .lottie archive (corrupt ZIP)") from exc

    def ingest_upload_multi(self, filename: str, raw_bytes: bytes) -> list[UploadedMediaItem]:
        """Ingest images, SVGs, Lottie JSON/.lottie, videos, or split animated images into frames."""
        ext = Path(filename).suffix.lower()
        if ext == ".svg":
            png_bytes = self._rasterize_svg(raw_bytes)
            stem = Path(filename).stem or "vector"
            return [self.ingest_upload(f"{stem}.png", png_bytes)]
        if ext == ".lottie":
            return self._ingest_dotlottie(filename, raw_bytes)
        if ext == ".json":
            return self._ingest_lottie_json(filename, raw_bytes)
        if ext in {".gif", ".webp", ".avif", ".apng", ".png"}:
            items = self._split_multiframe_image(filename, raw_bytes)
            if items:
                return items
        return [self.ingest_upload(filename, raw_bytes)]

    def ingest_upload(
        self,
        filename: str,
        raw_bytes: bytes,
        frame_duration_ms: Optional[int] = None,
        *,
        is_derived: bool = False,
        parent_video_id: Optional[str] = None,
        save_index: bool = True,
    ) -> UploadedMediaItem:
        ext = Path(filename).suffix.lower()
        media_id = uuid.uuid4().hex[:12]

        if ext in VIDEO_EXTENSIONS:
            if len(raw_bytes) > MAX_VIDEO_BYTES:
                raise ValueError("Video exceeds 200 MB size limit for local GIF conversion.")
            orig_path = self.uploads_dir / f"{media_id}{ext}"
            orig_path.write_bytes(raw_bytes)
            try:
                width, height, duration, fps, codec_name = _ffprobe_video(orig_path)
            except Exception as exc:
                orig_path.unlink(missing_ok=True)
                raise ValueError(f"Could not read video stream from {filename}: {exc}") from exc
            if duration > MAX_VIDEO_DURATION_SEC:
                orig_path.unlink(missing_ok=True)
                raise ValueError(
                    f"Video is {duration:.1f}s long; clips up to {int(MAX_VIDEO_DURATION_SEC)}s are supported."
                )
            preview_path = self.uploads_dir / f"{media_id}_preview.jpg"
            subprocess.run(
                [
                    _ffmpeg_bin(),
                    "-y",
                    "-i",
                    str(orig_path),
                    "-vframes",
                    "1",
                    "-q:v",
                    "3",
                    str(preview_path),
                ],
                capture_output=True,
                check=True,
            )
            video_mime = {
                ".mov": "video/quicktime",
                ".webm": "video/webm",
                ".mkv": "video/x-matroska",
                ".avi": "video/x-msvideo",
                ".ogv": "video/ogg",
            }.get(ext, "video/mp4")
            meta = {
                "id": media_id,
                "filename": filename,
                "media_type": "video",
                "mime_type": video_mime,
                "codec_name": codec_name,
                "width": width,
                "height": height,
                "duration_sec": round(duration, 3),
                "source_fps": fps,
                "source_path": str(orig_path),
                "preview_path": str(preview_path),
            }
            self._index[media_id] = meta
            if save_index:
                self._save_index()
            return self._to_item(meta)

        if ext not in IMAGE_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext or 'unknown'}")

        temp_orig = self.uploads_dir / f"{media_id}_raw{ext}"
        temp_orig.write_bytes(raw_bytes)
        try:
            with Image.open(temp_orig) as img:
                oriented = ImageOps.exif_transpose(img)
                has_alpha = oriented.mode in ("RGBA", "LA") or (
                    oriented.mode == "P" and "transparency" in oriented.info
                )
                normalized = oriented.convert("RGBA" if has_alpha else "RGB")
                width, height = normalized.size

                canonical_path = self.uploads_dir / f"{media_id}.png"
                normalized.save(canonical_path, format="PNG")

                preview_img = normalized.copy()
                preview_img.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
                preview_path = self.uploads_dir / f"{media_id}_preview.png" if has_alpha else self.uploads_dir / f"{media_id}_preview.jpg"
                if has_alpha:
                    preview_img.save(preview_path, format="PNG")
                else:
                    preview_img.save(preview_path, format="JPEG", quality=90)
        finally:
            temp_orig.unlink(missing_ok=True)

        meta = {
            "id": media_id,
            "filename": filename,
            "media_type": "image",
            "mime_type": "image/png" if has_alpha else "image/jpeg",
            "width": width,
            "height": height,
            "duration_sec": None,
            "source_fps": None,
            "frame_duration_ms": frame_duration_ms,
            "is_derived": is_derived,
            "parent_video_id": parent_video_id,
            "source_path": str(canonical_path),
            "preview_path": str(preview_path),
        }
        self._index[media_id] = meta
        if save_index:
            self._save_index()
        return self._to_item(meta)

    def get_video_stream_path(self, media_id: str) -> Path:
        """Return native browser-playable video or generate a fast H.264 stream proxy."""
        meta = self.get_meta(media_id)
        if meta.get("media_type") != "video":
            raise ValueError("Media item is not a video")
        orig_path = Path(meta["source_path"])
        ext = orig_path.suffix.lower()
        codec = str(meta.get("codec_name") or "").lower()
        if ext in {".mp4", ".m4v", ".webm", ".ogv"} and codec in {"h264", "vp8", "vp9", "av1", "theora"}:
            return orig_path

        proxy_raw = meta.get("video_proxy_path")
        if proxy_raw and Path(proxy_raw).exists():
            return Path(proxy_raw)

        proxy_path = self.uploads_dir / f"{media_id}_proxy.mp4"
        subprocess.run(
            [
                _ffmpeg_bin(),
                "-y",
                "-i",
                str(orig_path),
                "-vf",
                "scale=w='min(720,iw)':h=-2:flags=lanczos",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "24",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-an",
                str(proxy_path),
            ],
            capture_output=True,
            check=True,
        )
        meta["video_proxy_path"] = str(proxy_path)
        self._save_index()
        return proxy_path

    def extract_video_frames(
        self,
        media_id: str,
        start_sec: float,
        end_sec: Optional[float],
        fps: float,
        max_frames: int,
        speed: float = 1.0,
    ) -> VideoExtractResponse:
        meta = self.get_meta(media_id)
        if meta["media_type"] != "video":
            raise ValueError("Media item is not a video")

        src = Path(meta["source_path"])
        duration = float(meta.get("duration_sec") or 3.0)
        actual_end = min(end_sec if end_sec is not None else duration, duration)
        if actual_end <= start_sec:
            actual_end = min(duration, start_sec + 0.5)

        safe_speed = max(0.25, min(4.0, float(speed)))
        default_ms = max(25, int(round((1000.0 / fps) / safe_speed)))

        with tempfile.TemporaryDirectory() as tmp:
            pattern = str(Path(tmp) / "frame_%04d.png")
            cmd = [
                _ffmpeg_bin(),
                "-y",
                "-ss",
                f"{start_sec:.3f}",
                "-to",
                f"{actual_end:.3f}",
                "-i",
                str(src),
                "-vf",
                f"fps={fps:.2f}",
                "-frames:v",
                str(max_frames),
                pattern,
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            extracted_files = sorted(Path(tmp).glob("frame_*.png"))
            if not extracted_files:
                raise RuntimeError("No frames could be extracted from video range")

            items: list[UploadedMediaItem] = []
            stem = Path(meta["filename"]).stem
            for idx, fpath in enumerate(extracted_files, start=1):
                item = self.ingest_upload(
                    f"{stem}_f{idx:03d}.png",
                    fpath.read_bytes(),
                    frame_duration_ms=default_ms,
                    is_derived=True,
                    parent_video_id=media_id,
                    save_index=False,
                )
                items.append(item)
            self._save_index()

        return VideoExtractResponse(
            frames=items,
            default_frame_duration_ms=default_ms,
            source_duration_sec=round(duration, 3),
        )

    def create_demo_samples(self, pack: str = "stock") -> list[UploadedMediaItem]:
        """Load curated Public Domain / CC0 photographs, motion loops, or a sample video clip."""
        samples_dir = _samples_dir()
        if pack == "video":
            vid_path = samples_dir / "sample_clip.mp4"
            if vid_path.exists():
                return [self.ingest_upload("muybridge_sample.mp4", vid_path.read_bytes())]
        if pack == "motion":
            gif_path = samples_dir / "muybridge_gallop.gif"
            if gif_path.exists():
                return self.ingest_upload_multi("muybridge_gallop.gif", gif_path.read_bytes())

        stock_files = [
            "nasa_earthrise.jpg",
            "nasa_mars_sunset.jpg",
            "vintage_camera.jpg",
            "muybridge_horse_plate.jpg",
        ]
        loaded: list[UploadedMediaItem] = []
        for fname in stock_files:
            fpath = samples_dir / fname
            if fpath.exists():
                loaded.append(self.ingest_upload(fname, fpath.read_bytes()))
        if loaded:
            return loaded

        # Fallback if bundled samples directory is absent
        specs = [
            ("sample_sunset.jpg", (255, 94, 98), (255, 195, 113), "01 · GOLDEN HOUR"),
            ("sample_neon.jpg", (217, 119, 6), (180, 83, 9), "02 · FILM AMBER"),
            ("sample_ocean.jpg", (14, 165, 233), (15, 118, 110), "03 · OCEAN DRIFT"),
        ]
        items: list[UploadedMediaItem] = []
        w, h = 720, 720
        for idx, (fname, c1, c2, label) in enumerate(specs):
            yy, xx = np.mgrid[0:h, 0:w]
            t = (xx * 0.65 + yy * 0.35) / float(w)
            t = np.clip(t, 0.0, 1.0)
            arr = np.zeros((h, w, 3), dtype=np.float32)
            for ch in range(3):
                arr[:, :, ch] = c1[ch] * (1.0 - t) + c2[ch] * t

            cx = w * (0.42 + idx * 0.08)
            cy = h * (0.46 + (idx % 2) * 0.06)
            dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            ring = (dist > 110) & (dist < 142)
            disc = dist <= 82
            arr[ring] = np.clip(arr[ring] * 0.35 + 255 * 0.65, 0, 255)
            arr[disc] = np.clip(arr[disc] * 0.55 + 255 * 0.45, 0, 255)

            img = Image.fromarray(arr.astype(np.uint8), mode="RGB")
            draw = ImageDraw.Draw(img)
            font = _load_font(28)
            draw.text((48, h - 82), label, font=font, fill=(255, 255, 255))

            import io

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=92)
            items.append(self.ingest_upload(fname, buf.getvalue()))
        return items

    def get_meta(self, media_id: str) -> dict:
        if media_id not in self._index:
            raise KeyError(f"Unknown media_id: {media_id}")
        return self._index[media_id]

    def get_preview_path(self, media_id: str) -> Path:
        meta = self.get_meta(media_id)
        return Path(meta["preview_path"])

    def get_source_path(self, media_id: str) -> Path:
        meta = self.get_meta(media_id)
        return Path(meta["source_path"])

    def register_export(self, export_id: str, path: Path) -> None:
        self._index[f"export:{export_id}"] = {"path": str(path)}
        self._save_index()

    def get_export_path(self, export_id: str) -> Path:
        key = f"export:{export_id}"
        if key not in self._index:
            raise KeyError(f"Unknown export_id: {export_id}")
        return Path(self._index[key]["path"])

    def list_media(self) -> list[UploadedMediaItem]:
        """Return non-derived persisted media items whose files still exist on disk."""
        items: list[UploadedMediaItem] = []
        dirty = False
        for key, meta in list(self._index.items()):
            if key.startswith("export:"):
                continue
            src = Path(meta.get("source_path", ""))
            prev = Path(meta.get("preview_path", ""))
            if not src.exists() or not prev.exists():
                del self._index[key]
                dirty = True
                continue
            if meta.get("is_derived"):
                continue
            items.append(self._to_item(meta))
        if dirty:
            self._save_index()
        return items

    def delete_media(self, media_id: str) -> None:
        meta = self._index.pop(media_id, None)
        if meta is None:
            raise KeyError(f"Unknown media_id: {media_id}")
        for key in ("source_path", "preview_path", "video_proxy_path"):
            p_str = meta.get(key)
            if p_str:
                Path(p_str).unlink(missing_ok=True)
        # Clean up any child frames extracted from this video
        for cid, cmeta in list(self._index.items()):
            if not cid.startswith("export:") and cmeta.get("parent_video_id") == media_id:
                for pkey in ("source_path", "preview_path"):
                    cp = cmeta.get(pkey)
                    if cp:
                        Path(cp).unlink(missing_ok=True)
                del self._index[cid]
        self._save_index()

    @staticmethod
    def _to_item(meta: dict) -> UploadedMediaItem:
        is_video = meta["media_type"] == "video"
        return UploadedMediaItem(
            id=meta["id"],
            filename=meta["filename"],
            media_type=meta["media_type"],
            mime_type=meta["mime_type"],
            width=meta["width"],
            height=meta["height"],
            preview_url=f"/api/media/{meta['id']}/preview",
            video_url=f"/api/media/{meta['id']}/video" if is_video else None,
            duration_sec=meta.get("duration_sec"),
            source_fps=meta.get("source_fps"),
            frame_duration_ms=meta.get("frame_duration_ms"),
        )


def compute_canvas_size(
    aspect_ratio: AspectRatioPreset,
    resolution: str,
    custom_width: Optional[int],
    first_image_size: tuple[int, int],
) -> tuple[int, int]:
    res_map = {"480p": 480, "720p": 720, "1080p": 1080}
    orig_w, orig_h = first_image_size

    if resolution == "custom" and custom_width:
        base = custom_width
    elif resolution == "retina_2x":
        base = min(max(orig_w, orig_h) * 2, 2160)
    elif resolution == "original":
        base = min(max(orig_w, orig_h), 1280)
    else:
        base = res_map.get(resolution, 720)

    ratios: dict[str, tuple[int, int]] = {
        "1:1": (1, 1),
        "9:16": (9, 16),
        "16:9": (16, 9),
        "4:5": (4, 5),
        "4:3": (4, 3),
    }
    if aspect_ratio == "original":
        rw, rh = orig_w, orig_h
    else:
        rw, rh = ratios[aspect_ratio]

    if rw >= rh:
        w = base
        h = int(round(base * (rh / rw)))
    else:
        h = base
        w = int(round(base * (rw / rh)))

    # Ensure even dimensions >= 16 for MP4/GIF encoder compatibility
    w = max(16, w + (w % 2))
    h = max(16, h + (h % 2))
    return w, h


def _compose_on_canvas(
    img: Image.Image,
    target_w: int,
    target_h: int,
    fit_mode: FitMode,
    bg_rgb: tuple[int, int, int],
    transparent_bg: bool = False,
) -> Image.Image:
    src = img.convert("RGBA")
    sw, sh = src.size

    if fit_mode == "fill":
        scale = max(target_w / sw, target_h / sh)
        nw, nh = max(1, int(round(sw * scale))), max(1, int(round(sh * scale)))
        resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
        left = (nw - target_w) // 2
        top = (nh - target_h) // 2
        cropped = resized.crop((left, top, left + target_w, top + target_h))
        if transparent_bg:
            bg = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
            return Image.alpha_composite(bg, cropped)
        bg = Image.new("RGBA", (target_w, target_h), (*bg_rgb, 255))
        return Image.alpha_composite(bg, cropped).convert("RGB")

    # fit or blur_pad
    if fit_mode == "blur_pad" and not transparent_bg:
        bg_scale = max(target_w / sw, target_h / sh)
        bw, bh = max(1, int(round(sw * bg_scale))), max(1, int(round(sh * bg_scale)))
        bg_img = src.resize((bw, bh), Image.Resampling.BILINEAR)
        bleft = (bw - target_w) // 2
        btop = (bh - target_h) // 2
        canvas = bg_img.crop((bleft, btop, bleft + target_w, btop + target_h)).convert("RGB")
        canvas = canvas.filter(ImageFilter.GaussianBlur(radius=max(12, target_w // 28)))
        canvas = ImageEnhance.Brightness(canvas).enhance(0.65).convert("RGBA")
    else:
        bg_rgba = (0, 0, 0, 0) if transparent_bg else (*bg_rgb, 255)
        canvas = Image.new("RGBA", (target_w, target_h), bg_rgba)

    fg_scale = min(target_w / sw, target_h / sh)
    fw, fh = max(1, int(round(sw * fg_scale))), max(1, int(round(sh * fg_scale)))
    fg = src.resize((fw, fh), Image.Resampling.LANCZOS)
    ox = (target_w - fw) // 2
    oy = (target_h - fh) // 2
    canvas.paste(fg, (ox, oy), fg)
    return canvas if transparent_bg else canvas.convert("RGB")


def _ease_in_out(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * t)


def _cubic_bezier(x: float, bezier: list[float] | tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = bezier
    x1 = max(0.0, min(1.0, float(x1)))
    x2 = max(0.0, min(1.0, float(x2)))
    y1 = float(y1)
    y2 = float(y2)
    t = max(0.0, min(1.0, x))
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0

    def sample_x(u: float) -> float:
        inv = 1.0 - u
        return 3.0 * inv * inv * u * x1 + 3.0 * inv * u * u * x2 + u * u * u

    def sample_y(u: float) -> float:
        inv = 1.0 - u
        return 3.0 * inv * inv * u * y1 + 3.0 * inv * u * u * y2 + u * u * u

    lo, hi = 0.0, 1.0
    u = t
    for _ in range(14):
        u = (lo + hi) * 0.5
        sx = sample_x(u)
        if abs(sx - t) < 1e-4:
            break
        if sx < t:
            lo = u
        else:
            hi = u
    return sample_y(u)


def _apply_easing(
    t: float,
    easing: str = "ease_in_out",
    bezier: Optional[list[float]] = None,
) -> float:
    t = max(0.0, min(1.0, t))
    if easing == "linear":
        return t
    if easing == "ease_out":
        return 1.0 - (1.0 - t) ** 3
    if easing == "elastic":
        if t in (0.0, 1.0):
            return t
        return 1.0 - (2.0 ** (-8.0 * t)) * math.cos(t * math.pi * 2.5) * (1.0 - t)
    if easing == "custom_bezier" and bezier and len(bezier) == 4:
        return _cubic_bezier(t, bezier)
    return _ease_in_out(t)


def synthesize_motion_frames(
    base_img: Image.Image,
    target_w: int,
    target_h: int,
    fit_mode: FitMode,
    bg_rgb: tuple[int, int, int],
    motion: MotionConfig,
    total_duration_ms: int,
    transparent_bg: bool = False,
) -> list[tuple[Image.Image, int]]:
    if motion.type == "none":
        composed = _compose_on_canvas(base_img, target_w, target_h, fit_mode, bg_rgb, transparent_bg=transparent_bg)
        return [(composed, total_duration_ms)]

    # Render slightly oversized canvas for smooth subpixel crop/pan/tilt transforms without clipping
    oversample = 1.65
    work_w = int(round(target_w * oversample))
    work_h = int(round(target_h * oversample))
    work_canvas = _compose_on_canvas(base_img, work_w, work_h, fit_mode, bg_rgb, transparent_bg=transparent_bg)

    n = max(2, motion.frames)
    per_frame_ms = max(25, int(round(total_duration_ms / n)))
    intensity = motion.intensity
    anchor_x = getattr(motion, "anchor_x", 0.5)
    anchor_y = getattr(motion, "anchor_y", 0.5)
    easing = getattr(motion, "easing", "ease_in_out")
    bezier = getattr(motion, "bezier", None)
    results: list[tuple[Image.Image, int]] = []

    for i in range(n):
        t = i / max(1, n - 1)
        eased = _apply_easing(t, easing, bezier)
        zoom = 1.0
        dx_frac = 0.0
        dy_frac = 0.0
        tilt_deg = 0.0

        mtype = motion.type
        if mtype == "zoom_in":
            zoom = 1.0 + 0.45 * intensity * eased
        elif mtype == "zoom_out":
            zoom = 1.0 + 0.45 * intensity * (1.0 - eased)
        elif mtype == "pan_left":
            zoom = 1.0 + 0.30 * intensity
            dx_frac = (0.5 - eased) * 0.22 * intensity
        elif mtype == "pan_right":
            zoom = 1.0 + 0.30 * intensity
            dx_frac = (eased - 0.5) * 0.22 * intensity
        elif mtype == "pan_up":
            zoom = 1.0 + 0.30 * intensity
            dy_frac = (0.5 - eased) * 0.22 * intensity
        elif mtype == "pan_down":
            zoom = 1.0 + 0.30 * intensity
            dy_frac = (eased - 0.5) * 0.22 * intensity
        elif mtype == "ken_burns":
            zoom = 1.0 + 0.40 * intensity * eased
            dx_frac = (eased - 0.5) * 0.16 * intensity
            dy_frac = (0.5 - eased) * 0.12 * intensity
        elif mtype == "bounce":
            zoom = 1.0 + 0.14 * intensity * abs(math.sin(math.pi * t * 2))
            dy_frac = -0.10 * intensity * abs(math.sin(math.pi * t * 2))
        elif mtype == "shake":
            zoom = 1.0 + 0.18 * intensity
            dx_frac = 0.05 * intensity * math.sin(2 * math.pi * t * 4 + 0.3)
            dy_frac = 0.05 * intensity * math.cos(2 * math.pi * t * 5 + 1.1)
        elif mtype == "pulse":
            zoom = 1.0 + 0.28 * intensity * math.sin(math.pi * t)
        elif mtype == "tilt_sway":
            zoom = 1.0 + 0.20 * intensity
            tilt_deg = 4.5 * intensity * math.sin(2 * math.pi * t)
        elif mtype == "float_orbit":
            zoom = 1.0 + 0.20 * intensity
            dx_frac = 0.06 * intensity * math.sin(2 * math.pi * t)
            dy_frac = 0.04 * intensity * math.cos(2 * math.pi * t * 2)

        crop_w = work_w / max(0.5, zoom)
        crop_h = work_h / max(0.5, zoom)
        # Shift center toward focal anchor when zoomed/animating
        target_cx = (anchor_x * work_w) + dx_frac * work_w
        target_cy = (anchor_y * work_h) + dy_frac * work_h
        blend = min(1.0, max(0.0, (zoom - 1.0) * 1.4 + 0.25))
        cx = (work_w / 2.0) * (1.0 - blend) + target_cx * blend + dx_frac * work_w * (1.0 - blend)
        cy = (work_h / 2.0) * (1.0 - blend) + target_cy * blend + dy_frac * work_h * (1.0 - blend)

        x0 = max(0.0, min(work_w - crop_w, cx - crop_w / 2.0))
        y0 = max(0.0, min(work_h - crop_h, cy - crop_h / 2.0))
        src_view = work_canvas
        if abs(tilt_deg) > 0.05:
            src_view = work_canvas.rotate(tilt_deg, resample=Image.Resampling.BICUBIC, expand=False)
        cropped = src_view.crop((int(round(x0)), int(round(y0)), int(round(x0 + crop_w)), int(round(y0 + crop_h))))
        frame = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
        results.append((frame, per_frame_ms))

    return results


def apply_filters(img: Image.Image, cfg: FilterConfig, frame_index: int = 0) -> Image.Image:
    alpha = img.getchannel("A") if img.mode == "RGBA" else None
    out = img.convert("RGB")

    # Apply Background Knockout Matte on raw ungraded plate first so color grading never breaks the key
    bg_matte = getattr(cfg, "bg_matte", "none")
    if bg_matte != "none":
        rgb_arr = np.asarray(out, dtype=np.float32) / 255.0
        mh, mw, _ = rgb_arr.shape
        if bg_matte == "chroma_green":
            key_rgb = np.array([0.08, 0.78, 0.18], dtype=np.float32)
        elif bg_matte == "chroma_blue":
            key_rgb = np.array([0.10, 0.34, 0.88], dtype=np.float32)
        elif bg_matte == "edge_flood":
            corners = np.array(
                [
                    rgb_arr[0, 0],
                    rgb_arr[0, max(0, mw - 1)],
                    rgb_arr[max(0, mh - 1), 0],
                    rgb_arr[max(0, mh - 1), max(0, mw - 1)],
                ],
                dtype=np.float32,
            )
            key_rgb = corners.mean(axis=0)
        else:
            mc = _parse_hex_color(getattr(cfg, "matte_color", "#00FF00"), (0, 255, 0))
            key_rgb = np.array([mc[0] / 255.0, mc[1] / 255.0, mc[2] / 255.0], dtype=np.float32)

        dist = np.linalg.norm(rgb_arr - key_rgb[None, None, :], axis=-1)
        tol = float(getattr(cfg, "matte_tolerance", 0.22))
        feather = max(0.005, float(getattr(cfg, "matte_feather", 0.08)))
        matte_alpha = np.clip((dist - tol) / feather, 0.0, 1.0)
        if alpha is not None:
            existing_a = np.asarray(alpha, dtype=np.float32) / 255.0
            matte_alpha = matte_alpha * existing_a
        alpha = Image.fromarray((matte_alpha * 255.0).clip(0, 255).astype(np.uint8), mode="L")

    # Apply named preset first
    preset = cfg.preset
    if preset == "bw":
        out = ImageOps.grayscale(out).convert("RGB")
    elif preset == "noir":
        gray = ImageOps.grayscale(out)
        out = ImageEnhance.Contrast(gray.convert("RGB")).enhance(1.55)
        out = ImageEnhance.Brightness(out).enhance(0.92)
    elif preset == "sepia":
        arr = np.asarray(out, dtype=np.float32)
        r = arr[:, :, 0] * 0.393 + arr[:, :, 1] * 0.769 + arr[:, :, 2] * 0.189
        g = arr[:, :, 0] * 0.349 + arr[:, :, 1] * 0.686 + arr[:, :, 2] * 0.168
        b = arr[:, :, 0] * 0.272 + arr[:, :, 1] * 0.534 + arr[:, :, 2] * 0.131
        sep = np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)
        out = Image.fromarray(sep)
    elif preset == "duotone":
        lum = np.asarray(ImageOps.grayscale(out), dtype=np.float32) / 255.0
        lo = np.array([24.0, 30.0, 36.0], dtype=np.float32)
        hi = np.array([245.0, 158.0, 66.0], dtype=np.float32)
        duo = lo[None, None, :] * (1.0 - lum[:, :, None]) + hi[None, None, :] * lum[:, :, None]
        out = Image.fromarray(duo.clip(0, 255).astype(np.uint8))
    elif preset == "sunset":
        arr = np.asarray(out, dtype=np.float32)
        arr[:, :, 0] = arr[:, :, 0] * 1.18 + 16
        arr[:, :, 1] = arr[:, :, 1] * 0.96 + 6
        arr[:, :, 2] = arr[:, :, 2] * 0.84 + 14
        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    elif preset == "pastel":
        out = ImageEnhance.Color(out).enhance(0.75)
        out = ImageEnhance.Brightness(out).enhance(1.12)
        out = ImageEnhance.Contrast(out).enhance(0.86)
    elif preset == "vintage":
        arr = np.asarray(out, dtype=np.float32)
        arr[:, :, 0] = arr[:, :, 0] * 1.08 + 14
        arr[:, :, 1] = arr[:, :, 1] * 1.01 + 10
        arr[:, :, 2] = arr[:, :, 2] * 0.86 + 18
        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
        out = ImageEnhance.Contrast(out).enhance(0.92)
    elif preset == "vivid":
        out = ImageEnhance.Color(out).enhance(1.45)
        out = ImageEnhance.Contrast(out).enhance(1.15)
    elif preset == "cool":
        arr = np.asarray(out, dtype=np.float32)
        arr[:, :, 0] *= 0.90
        arr[:, :, 2] *= 1.16
        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    elif preset == "warm":
        arr = np.asarray(out, dtype=np.float32)
        arr[:, :, 0] *= 1.14
        arr[:, :, 1] *= 1.03
        arr[:, :, 2] *= 0.88
        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    elif preset == "cyberpunk":
        arr = np.asarray(out, dtype=np.float32)
        arr[:, :, 0] = arr[:, :, 0] * 1.15 + 12
        arr[:, :, 1] = arr[:, :, 1] * 0.88
        arr[:, :, 2] = arr[:, :, 2] * 1.25 + 18
        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
        out = ImageEnhance.Contrast(out).enhance(1.22)

    if abs(cfg.brightness - 1.0) > 0.01:
        out = ImageEnhance.Brightness(out).enhance(cfg.brightness)
    if abs(cfg.contrast - 1.0) > 0.01:
        out = ImageEnhance.Contrast(out).enhance(cfg.contrast)
    if abs(cfg.saturation - 1.0) > 0.01:
        out = ImageEnhance.Color(out).enhance(cfg.saturation)

    hue_shift = getattr(cfg, "hue_shift", 0.0)
    if abs(hue_shift) > 1.0:
        hsv = np.asarray(out.convert("HSV"), dtype=np.int16)
        delta_h = int(round((hue_shift / 360.0) * 255.0))
        hsv[:, :, 0] = (hsv[:, :, 0] + delta_h) % 256
        out = Image.fromarray(hsv.astype(np.uint8), mode="HSV").convert("RGB")

    if getattr(cfg, "sharpen", 0.0) > 0.02:
        pct = int(round(60 + cfg.sharpen * 180))
        out = out.filter(ImageFilter.UnsharpMask(radius=1.5, percent=pct, threshold=2))
    if cfg.blur > 0.05:
        out = out.filter(ImageFilter.GaussianBlur(radius=cfg.blur))

    bloom = getattr(cfg, "bloom", 0.0)
    if bloom > 0.02:
        arr_b = np.asarray(out, dtype=np.float32)
        lum_b = 0.299 * arr_b[:, :, 0] + 0.587 * arr_b[:, :, 1] + 0.114 * arr_b[:, :, 2]
        hi_mask = np.clip((lum_b - 165.0) / 90.0, 0.0, 1.0)[:, :, None]
        hi_img = Image.fromarray((arr_b * hi_mask).clip(0, 255).astype(np.uint8))
        glow_radius = max(3, int(round(max(out.size) * 0.018)))
        glow_arr = np.asarray(hi_img.filter(ImageFilter.GaussianBlur(radius=glow_radius)), dtype=np.float32)
        blended = arr_b + glow_arr * (bloom * 0.95)
        out = Image.fromarray(blended.clip(0, 255).astype(np.uint8))

    pixelate = getattr(cfg, "pixelate", 0)
    if pixelate and pixelate >= 2:
        pw, ph = out.size
        sw = max(8, pw // pixelate)
        sh = max(8, ph // pixelate)
        out = out.resize((sw, sh), Image.Resampling.NEAREST).resize((pw, ph), Image.Resampling.NEAREST)

    temp = getattr(cfg, "temperature", 0.0)
    chromatic = getattr(cfg, "chromatic", 0.0)
    split_tone = getattr(cfg, "split_tone", 0.0)
    if (
        cfg.vignette > 0.01
        or cfg.film_grain > 0.01
        or cfg.glitch > 0.01
        or abs(temp) > 0.02
        or chromatic > 0.02
        or abs(split_tone) > 0.02
    ):
        arr = np.asarray(out, dtype=np.float32)
        h, w, _ = arr.shape

        if abs(temp) > 0.02:
            arr[:, :, 0] *= 1.0 + max(-0.22, min(0.28, temp * 0.22))
            arr[:, :, 2] *= 1.0 - max(-0.28, min(0.22, temp * 0.22))

        if abs(split_tone) > 0.02:
            lum = (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]) / 255.0
            sh_w = np.clip(1.0 - lum * 1.4, 0.0, 1.0)
            hi_w = np.clip((lum - 0.35) * 1.5, 0.0, 1.0)
            st = split_tone * 36.0
            if split_tone > 0:
                # Warm amber highlights + cool slate shadows
                arr[:, :, 0] += hi_w * st
                arr[:, :, 1] += hi_w * (st * 0.45)
                arr[:, :, 2] += sh_w * st
                arr[:, :, 0] -= sh_w * (st * 0.35)
            else:
                amt = abs(st)
                # Cool cyan highlights + warm terracotta shadows
                arr[:, :, 2] += hi_w * amt
                arr[:, :, 1] += hi_w * (amt * 0.35)
                arr[:, :, 0] += sh_w * amt
                arr[:, :, 2] -= sh_w * (amt * 0.35)

        if chromatic > 0.02:
            c_shift = max(1, int(round(w * 0.016 * chromatic)))
            arr[:, :, 0] = np.roll(arr[:, :, 0], c_shift, axis=1)
            arr[:, :, 2] = np.roll(arr[:, :, 2], -c_shift, axis=1)

        if cfg.glitch > 0.01:
            shift = max(2, int(round(w * 0.025 * cfg.glitch)))
            direction = 1 if (frame_index % 2 == 0) else -1
            arr[:, :, 0] = np.roll(arr[:, :, 0], shift * direction, axis=1)
            arr[:, :, 2] = np.roll(arr[:, :, 2], -shift * direction, axis=1)
            rng = np.random.default_rng(seed=100 + frame_index)
            bands = max(2, int(6 * cfg.glitch))
            for _ in range(bands):
                y0 = int(rng.integers(0, max(1, h - 12)))
                bh = int(rng.integers(3, min(20, max(4, h - y0))))
                dx = int(rng.integers(-shift * 2, shift * 2 + 1))
                arr[y0 : y0 + bh] = np.roll(arr[y0 : y0 + bh], dx, axis=1)

        if cfg.vignette > 0.01:
            yy, xx = np.ogrid[:h, :w]
            nx = (xx - w / 2.0) / (w / 2.0)
            ny = (yy - h / 2.0) / (h / 2.0)
            dist = np.sqrt(nx * nx + ny * ny)
            mask = np.clip(1.0 - cfg.vignette * 0.65 * (dist ** 1.8), 0.15, 1.0)
            arr *= mask[:, :, None]

        if cfg.film_grain > 0.01:
            rng = np.random.default_rng(seed=42 + frame_index)
            noise = rng.normal(0.0, 28.0 * cfg.film_grain, size=(h, w, 1))
            arr = arr + noise

        out = Image.fromarray(arr.clip(0, 255).astype(np.uint8))

    if alpha is not None:
        rgba = out.convert("RGBA")
        rgba.putalpha(alpha)
        return rgba
    return out


def _wrap_text_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: float,
    stroke_width: int,
) -> str:
    wrapped: list[str] = []
    for paragraph in text.splitlines() or [""]:
        words = paragraph.split(" ")
        if not words:
            wrapped.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            bbox = draw.textbbox((0, 0), candidate, font=font, stroke_width=stroke_width)
            if (bbox[2] - bbox[0]) <= max_width:
                current = candidate
            else:
                wrapped.append(current)
                current = word
        wrapped.append(current)
    return "\n".join(wrapped)


def _draw_single_text_layer(
    base: Image.Image,
    overlay: TextBadgeLayer,
    progress_t: float = 1.0,
) -> Image.Image:
    raw_text = overlay.text.strip()
    if not raw_text:
        return base

    entrance = getattr(overlay, "entrance", "none")
    text = raw_text
    alpha_scale = getattr(overlay, "opacity", 1.0)
    slide_y_offset = 0.0
    bounce_scale = 1.0

    if entrance == "typewriter":
        vis_chars = max(1, int(math.ceil(len(raw_text) * max(0.08, progress_t))))
        text = raw_text[:vis_chars]
    elif entrance == "fade_in":
        alpha_scale *= min(1.0, progress_t * 1.45)
    elif entrance == "slide_up":
        ease = 1.0 - (1.0 - min(1.0, progress_t * 1.35)) ** 3
        alpha_scale *= ease
        slide_y_offset = (1.0 - ease) * 24.0
    elif entrance == "bounce":
        p = min(1.0, progress_t * 1.5)
        bounce_scale = 0.72 + 0.36 * math.sin(p * math.pi * 0.75)
        if p >= 0.9:
            bounce_scale = 1.0
        alpha_scale *= min(1.0, p * 2.0)

    w, h = base.size
    text_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_layer)
    scaled_size = max(12, int(round(overlay.font_size * (w / 720.0) * bounce_scale)))
    font = _load_font(scaled_size, getattr(overlay, "font_family", "sans"))
    align = getattr(overlay, "align", "center")
    wrapped_text = _wrap_text_lines(draw, text, font, w * 0.86, overlay.stroke_width)

    letter_spacing = getattr(overlay, "letter_spacing", 0)
    if letter_spacing > 0:
        # Subtle visual tracking via thin spaces when positive letter spacing is requested
        gap_str = " " * max(1, min(3, letter_spacing // 3))
        wrapped_text = "\n".join(
            gap_str.join(list(line)) if len(line) <= 24 else line
            for line in wrapped_text.splitlines()
        )

    bbox = draw.multiline_textbbox((0, 0), wrapped_text, font=font, stroke_width=overlay.stroke_width, align=align)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    margin_x = max(18, int(w * 0.07))
    margin_y = max(14, int(h * (getattr(overlay, "margin_pct", 6) / 100.0)))

    x_pct = getattr(overlay, "x_pct", None)
    y_pct = getattr(overlay, "y_pct", None)
    if x_pct is not None and y_pct is not None:
        cx = float(x_pct) * w
        cy = float(y_pct) * h + slide_y_offset
        tx = cx - tw / 2.0
        ty = cy - th / 2.0
    else:
        if align == "left":
            tx = float(margin_x)
        elif align == "right":
            tx = float(max(margin_x, w - tw - margin_x))
        else:
            tx = (w - tw) / 2.0

        if overlay.position == "top":
            ty = float(margin_y)
        elif overlay.position == "center":
            ty = (h - th) / 2.0
        else:
            ty = float(h - th - margin_y)
        ty += slide_y_offset
        cx = tx + tw / 2.0
        cy = ty + th / 2.0

    op_byte = max(0, min(255, int(round(255 * alpha_scale))))
    box_radius = max(0, min(32, int(getattr(overlay, "box_radius", 14))))
    if overlay.bg_pill:
        pad_x, pad_y = 18, 10
        pill_box = [tx - pad_x, ty - pad_y, tx + tw + pad_x, ty + th + pad_y]
        draw.rounded_rectangle(
            pill_box,
            radius=box_radius,
            fill=(10, 10, 14, int(round(185 * alpha_scale))),
        )

    fg_rgb = _parse_hex_color(overlay.color, (255, 255, 255))
    stroke_rgb = _parse_hex_color(overlay.stroke_color, (0, 0, 0))
    if getattr(overlay, "shadow", True):
        draw.multiline_text(
            (tx + 2, ty + 3),
            wrapped_text,
            font=font,
            fill=(0, 0, 0, int(round(140 * alpha_scale))),
            align=align,
        )
    draw.multiline_text(
        (tx, ty),
        wrapped_text,
        font=font,
        fill=(*fg_rgb, op_byte),
        stroke_width=overlay.stroke_width,
        stroke_fill=(*stroke_rgb, op_byte),
        align=align,
    )

    rot = float(getattr(overlay, "rotation", 0.0))
    if abs(rot) > 0.25:
        text_layer = text_layer.rotate(
            -rot,
            resample=Image.Resampling.BICUBIC,
            center=(cx, cy),
        )
    return Image.alpha_composite(base, text_layer)


def apply_text_overlay(
    img: Image.Image,
    overlay: TextOverlayConfig,
    progress_t: float = 1.0,
) -> Image.Image:
    extra_layers = getattr(overlay, "extra_layers", None) or []
    has_primary = bool(overlay.text.strip())
    has_extras = any(bool(l.text.strip()) for l in extra_layers)
    if not has_primary and not has_extras:
        return img

    keep_alpha = img.mode == "RGBA"
    base = img.convert("RGBA")
    if has_primary:
        base = _draw_single_text_layer(base, overlay, progress_t=progress_t)
    for layer in extra_layers[:3]:
        if layer.text.strip():
            base = _draw_single_text_layer(base, layer, progress_t=progress_t)
    return base if keep_alpha else base.convert("RGB")


def apply_border_and_corners(
    img: Image.Image,
    border: BorderConfig,
    transparent_bg: bool = False,
) -> Image.Image:
    w, h = img.size
    scale = w / 720.0
    out = img.convert("RGBA")
    inner_pad = max(0, int(round(getattr(border, "inner_padding", 0) * scale)))

    if (border.style != "none" and border.thickness > 0) or inner_pad > 0:
        t = max(0, int(round(border.thickness * scale))) if border.style != "none" else 0
        border_rgb = _parse_hex_color(border.color, (255, 255, 255))

        if border.style == "polaroid":
            bottom_t = int(round(t * 2.6)) + inner_pad
            side_t = t + inner_pad
            top_t = t + inner_pad
            inner_w = max(8, w - 2 * side_t)
            inner_h = max(8, h - top_t - bottom_t)
            inner = out.resize((inner_w, inner_h), Image.Resampling.LANCZOS)
            frame = Image.new("RGBA", (w, h), (*border_rgb, 255))
            frame.paste(inner, (side_t, top_t), inner)
            out = frame
        elif border.style == "film":
            rail = max(14, int(round(t * 1.45))) + inner_pad
            inner_w = max(8, w - 2 * inner_pad)
            inner_h = max(8, h - 2 * rail)
            inner = out.resize((inner_w, inner_h), Image.Resampling.LANCZOS)
            frame = Image.new("RGBA", (w, h), (16, 16, 20, 255))
            frame.paste(inner, (inner_pad, rail), inner)
            draw = ImageDraw.Draw(frame)
            hole_w = max(6, int(round(rail * 0.45)))
            hole_h = max(8, int(round(rail * 0.56)))
            step = max(hole_w * 2, int(round(w / 11)))
            hole_fill = (0, 0, 0, 0) if transparent_bg else (235, 235, 240, 210)
            for hx in range(step // 3, w - hole_w, step):
                y_top = (rail - hole_h) // 2
                y_bot = h - rail + (rail - hole_h) // 2
                draw.rounded_rectangle([hx, y_top, hx + hole_w, y_top + hole_h], radius=2, fill=hole_fill)
                draw.rounded_rectangle([hx, y_bot, hx + hole_w, y_bot + hole_h], radius=2, fill=hole_fill)
            out = frame
        else:  # clean or padding matte
            total_t = t + inner_pad
            inner_w = max(8, w - 2 * total_t)
            inner_h = max(8, h - 2 * total_t)
            inner = out.resize((inner_w, inner_h), Image.Resampling.LANCZOS)
            frame = Image.new("RGBA", (w, h), (*border_rgb, 255))
            frame.paste(inner, (total_t, total_t), inner)
            out = frame

    if border.corner_radius > 0:
        rad = max(2, int(round(border.corner_radius * scale)))
        mask = Image.new("L", (w, h), 0)
        mdraw = ImageDraw.Draw(mask)
        mdraw.rounded_rectangle([0, 0, w, h], radius=rad, fill=255)
        existing_alpha = out.getchannel("A")
        combined_alpha = Image.fromarray(
            np.minimum(np.asarray(existing_alpha), np.asarray(mask)).astype(np.uint8)
        )
        out.putalpha(combined_alpha)

    if getattr(border, "shadow", False) and (transparent_bg or border.corner_radius > 0):
        pad = max(6, int(round(14 * scale)))
        shadow_mask = out.getchannel("A").filter(ImageFilter.GaussianBlur(radius=pad // 2))
        shadow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        dark = Image.new("RGBA", (w, h), (0, 0, 0, 115))
        dark.putalpha(shadow_mask)
        resized_fg = out.resize((max(8, w - pad * 2), max(8, h - pad * 2)), Image.Resampling.LANCZOS)
        resized_shadow = dark.resize((max(8, w - pad * 2), max(8, h - pad * 2)), Image.Resampling.LANCZOS)
        shadow_layer.paste(resized_shadow, (pad, int(round(pad * 1.25))), resized_shadow)
        shadow_layer.paste(resized_fg, (pad, pad), resized_fg)
        out = shadow_layer

    return out if (transparent_bg or border.corner_radius > 0 or getattr(border, "shadow", False)) else out.convert("RGB")


def build_transition_frames(
    prev_img: Image.Image,
    next_img: Image.Image,
    transition: TransitionType,
    transition_ms: int,
    fps: int,
) -> list[tuple[Image.Image, int]]:
    if transition == "none":
        return []

    steps = max(2, min(18, int(round((transition_ms / 1000.0) * fps))))
    step_ms = max(25, int(round(transition_ms / steps)))
    w, h = next_img.size
    has_alpha = prev_img.mode == "RGBA" or next_img.mode == "RGBA"
    mode = "RGBA" if has_alpha else "RGB"
    p_base = prev_img.convert(mode)
    n_base = next_img.convert(mode)
    frames: list[tuple[Image.Image, int]] = []

    for i in range(1, steps):
        t = _ease_in_out(i / steps)
        if transition == "crossfade":
            blended = Image.blend(p_base, n_base, t)
        elif transition == "slide_left":
            offset = int(round(w * (1.0 - t)))
            blended = p_base.copy()
            blended.paste(n_base, (offset, 0))
        elif transition == "slide_right":
            offset = int(round(-w * (1.0 - t)))
            blended = p_base.copy()
            blended.paste(n_base, (offset, 0))
        elif transition == "slide_up":
            offset = int(round(h * (1.0 - t)))
            blended = p_base.copy()
            blended.paste(n_base, (0, offset))
        elif transition == "zoom_in":
            scale = 0.65 + 0.35 * t
            zw, zh = max(2, int(round(w * scale))), max(2, int(round(h * scale)))
            zoomed = n_base.resize((zw, zh), Image.Resampling.LANCZOS)
            layer = p_base.copy()
            layer.paste(zoomed, ((w - zw) // 2, (h - zh) // 2))
            blended = Image.blend(p_base, layer, t)
        else:
            blended = Image.blend(p_base, n_base, t)
        frames.append((blended, step_ms))
    return frames


def apply_loop_mode(
    frames: list[tuple[Image.Image, int]],
    loop_mode: LoopMode,
    loop_count: int,
    fps: int,
    crossfade_loop_ms: int = 350,
    end_hold_ms: int = 0,
) -> tuple[list[tuple[Image.Image, int]], int, bool]:
    if not frames:
        return frames, 0, False

    play_once = loop_mode == "once"
    effective_loop = 1 if play_once else loop_count
    if loop_mode == "reverse":
        out_frames = list(reversed(frames))
        if end_hold_ms > 0 and out_frames:
            img, d = out_frames[-1]
            out_frames[-1] = (img, d + end_hold_ms)
        return out_frames, effective_loop, False

    if loop_mode == "boomerang":
        if len(frames) <= 2:
            out_frames = list(frames)
        else:
            tail = list(reversed(frames[1:-1]))
            out_frames = list(frames) + tail
        if end_hold_ms > 0 and out_frames:
            img, d = out_frames[-1]
            out_frames[-1] = (img, d + end_hold_ms)
        return out_frames, effective_loop, False

    if loop_mode == "crossfade_loop" and len(frames) >= 2:
        xfade = build_transition_frames(
            frames[-1][0],
            frames[0][0],
            "crossfade",
            min(crossfade_loop_ms, max(100, frames[-1][1])),
            fps,
        )
        out_frames = list(frames) + xfade
        if end_hold_ms > 0 and out_frames:
            img, d = out_frames[-1]
            out_frames[-1] = (img, d + end_hold_ms)
        return out_frames, effective_loop, False

    out_frames = list(frames)
    if end_hold_ms > 0 and out_frames:
        img, d = out_frames[-1]
        out_frames[-1] = (img, d + end_hold_ms)
    return out_frames, effective_loop, play_once


def _encode_gif_ffmpeg(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    loop_count: int,
    max_colors: int,
    dither: str,
    play_once: bool = False,
    transparent: bool = False,
    scale_width: Optional[int] = None,
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        concat_file = Path(tmp) / "frames.txt"
        _build_concat_file(frame_paths, durations_ms, concat_file)

        palette_path = Path(tmp) / "palette.png"
        scale_filter = f"scale={scale_width}:-2:flags=lanczos," if scale_width else ""
        reserve_opt = ":reserve_transparent=1" if transparent else ""

        subprocess.run(
            [
                _ffmpeg_bin(),
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-vf",
                f"{scale_filter}palettegen=max_colors={max_colors}{reserve_opt}:stats_mode=diff",
                str(palette_path),
            ],
            capture_output=True,
            check=True,
        )

        dither_opt = (
            "bayer:bayer_scale=3"
            if dither == "bayer"
            else ("none" if dither == "none" else "floyd_steinberg")
        )
        paletteuse_opts = (
            f"paletteuse=dither={dither_opt}:alpha_threshold=128"
            if transparent
            else f"paletteuse=dither={dither_opt}:diff_mode=rectangle"
        )
        ffmpeg_loop = -1 if play_once else loop_count
        subprocess.run(
            [
                _ffmpeg_bin(),
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-i",
                str(palette_path),
                "-lavfi",
                f"{scale_filter}{paletteuse_opts}",
                "-loop",
                str(ffmpeg_loop),
                str(out_path),
            ],
            capture_output=True,
            check=True,
        )


def _encode_webp(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    loop_count: int,
    quality: str,
    custom_quality: Optional[int] = None,
    lossless: bool = False,
) -> None:
    q_val = custom_quality if custom_quality is not None else (90 if quality == "high" else (78 if quality == "balanced" else 60))
    imgs = [Image.open(p).convert("RGBA") for p in frame_paths]
    try:
        imgs[0].save(
            out_path,
            format="WEBP",
            save_all=True,
            append_images=imgs[1:],
            duration=durations_ms,
            loop=loop_count,
            quality=100 if lossless else q_val,
            lossless=lossless,
            method=4,
        )
    finally:
        for im in imgs:
            im.close()


def _encode_avif(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    loop_count: int,
    quality: str,
    transparent: bool,
    custom_quality: Optional[int] = None,
    lossless: bool = False,
) -> None:
    q_val = 100 if lossless else (custom_quality if custom_quality is not None else (82 if quality == "high" else (68 if quality == "balanced" else 52)))
    mode = "RGBA" if transparent else "RGB"
    imgs = [Image.open(p).convert(mode) for p in frame_paths]
    try:
        imgs[0].save(
            out_path,
            format="AVIF",
            save_all=True,
            append_images=imgs[1:],
            duration=durations_ms,
            loop=loop_count,
            quality=q_val,
            speed=6,
        )
    finally:
        for im in imgs:
            im.close()


def _encode_apng(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    loop_count: int,
) -> None:
    imgs = [Image.open(p).convert("RGBA") for p in frame_paths]
    try:
        imgs[0].save(
            out_path,
            format="PNG",
            save_all=True,
            append_images=imgs[1:],
            duration=durations_ms,
            loop=loop_count,
            default_image=False,
        )
    finally:
        for im in imgs:
            im.close()


def _build_concat_file(frame_paths: list[Path], durations_ms: list[int], concat_file: Path) -> None:
    lines: list[str] = []
    for fpath, dur in zip(frame_paths, durations_ms):
        escaped = fpath.as_posix().replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
        lines.append(f"duration {max(0.02, dur / 1000.0):.4f}")
    last_escaped = frame_paths[-1].as_posix().replace("'", "'\\''")
    lines.append(f"file '{last_escaped}'")
    concat_file.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _encode_mp4(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    quality: str,
    video_crf: Optional[int] = None,
    video_codec: str = "auto",
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        concat_file = Path(tmp) / "frames.txt"
        _build_concat_file(frame_paths, durations_ms, concat_file)

        use_av1 = video_codec == "av1"
        crf = (
            str(video_crf)
            if video_crf is not None
            else (
                ("28" if quality == "high" else ("34" if quality == "balanced" else "40"))
                if use_av1
                else ("18" if quality == "high" else ("23" if quality == "balanced" else "28"))
            )
        )
        cmd = [
            _ffmpeg_bin(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libsvtav1" if use_av1 else "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            crf,
        ]
        if use_av1:
            cmd.extend(["-preset", "8"])
        cmd.extend(["-movflags", "+faststart", "-fps_mode", "vfr", str(out_path)])
        subprocess.run(cmd, capture_output=True, check=True)


def _encode_webm(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    quality: str,
    transparent: bool,
    video_crf: Optional[int] = None,
    video_codec: str = "auto",
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        concat_file = Path(tmp) / "frames.txt"
        _build_concat_file(frame_paths, durations_ms, concat_file)

        use_av1 = video_codec == "av1"
        crf = str(video_crf) if video_crf is not None else ("24" if quality == "high" else ("32" if quality == "balanced" else "40"))
        cmd = [
            _ffmpeg_bin(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ]
        if use_av1:
            cmd.extend(["-c:v", "libsvtav1", "-crf", crf, "-preset", "8", "-pix_fmt", "yuv420p"])
        else:
            cmd.extend([
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                crf,
                "-deadline",
                "realtime",
                "-cpu-used",
                "4",
            ])
            if transparent:
                cmd.extend(["-pix_fmt", "yuva420p", "-auto-alt-ref", "0"])
            else:
                cmd.extend(["-pix_fmt", "yuv420p"])
        cmd.extend(["-fps_mode", "vfr", str(out_path)])
        subprocess.run(cmd, capture_output=True, check=True)


def _encode_mov_alpha(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    quality: str,
    transparent: bool,
) -> None:
    """Hardware-encode Apple/Safari HEVC with Alpha (.mov hvc1) via VideoToolbox."""
    with tempfile.TemporaryDirectory() as tmp:
        concat_file = Path(tmp) / "frames.txt"
        _build_concat_file(frame_paths, durations_ms, concat_file)

        alpha_q = "0.85" if quality == "high" else ("0.72" if quality == "balanced" else "0.55")
        cmd = [
            _ffmpeg_bin(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "hevc_videotoolbox",
            "-vtag",
            "hvc1",
        ]
        if transparent:
            cmd.extend(["-alpha_quality", alpha_q])
        else:
            cmd.extend(["-pix_fmt", "yuv420p"])
        cmd.extend(["-movflags", "+faststart", "-fps_mode", "vfr", str(out_path)])
        subprocess.run(cmd, capture_output=True, check=True)


def _encode_spritesheet(
    frame_paths: list[Path],
    out_path: Path,
    layout: str,
    padding: int = 0,
) -> tuple[int, int, int, int]:
    """Pack rendered frames into an RGBA sprite atlas and return (sheet_w, sheet_h, cols, rows)."""
    count = len(frame_paths)
    cols = count if layout == "strip" else max(1, math.ceil(math.sqrt(count)))
    rows = 1 if layout == "strip" else max(1, math.ceil(count / cols))

    with Image.open(frame_paths[0]) as first:
        fw, fh = first.size

    pad = max(0, padding)
    sheet_w = cols * fw + max(0, cols - 1) * pad
    sheet_h = rows * fh + max(0, rows - 1) * pad
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    for idx, fpath in enumerate(frame_paths):
        col = idx % cols
        row = idx // cols
        with Image.open(fpath) as im:
            sheet.paste(im.convert("RGBA"), (col * (fw + pad), row * (fh + pad)))
    sheet.save(out_path, format="PNG", optimize=True)
    return sheet.width, sheet.height, cols, rows


def _build_lottie_payload(
    frame_paths: list[Path],
    durations_ms: list[int],
    width: int,
    height: int,
    quality: str,
    transparent: bool,
    embed_inline: bool = True,
) -> tuple[dict, dict[str, bytes]]:
    """Build a Bodymovin v5.9.0 Lottie document and optional binary archive images."""
    avg_ms = max(20.0, sum(durations_ms) / max(1, len(durations_ms)))
    fr = round(1000.0 / avg_ms, 2)
    use_webp = quality != "high"
    img_fmt = "WEBP" if use_webp else "PNG"
    ext = "webp" if use_webp else "png"
    mime = "image/webp" if use_webp else "image/png"
    webp_q = 84 if quality == "balanced" else 68

    assets: list[dict] = []
    layers: list[dict] = []
    bin_assets: dict[str, bytes] = {}
    cursor_tick = 0.0
    for idx, (fpath, dur_ms) in enumerate(zip(frame_paths, durations_ms)):
        asset_id = f"frame_{idx}"
        with Image.open(fpath) as im:
            converted = im.convert("RGBA" if transparent else "RGB")
            buf = io.BytesIO()
            if use_webp:
                converted.save(buf, format=img_fmt, quality=webp_q, method=4)
            else:
                converted.save(buf, format=img_fmt)
        raw_bytes = buf.getvalue()
        if embed_inline:
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            assets.append(
                {
                    "id": asset_id,
                    "w": width,
                    "h": height,
                    "u": "",
                    "p": f"data:{mime};base64,{b64}",
                    "e": 1,
                }
            )
        else:
            fname = f"frame_{idx}.{ext}"
            bin_assets[f"images/{fname}"] = raw_bytes
            assets.append(
                {
                    "id": asset_id,
                    "w": width,
                    "h": height,
                    "u": "images/",
                    "p": fname,
                    "e": 0,
                }
            )
        span_ticks = max(1.0, round((dur_ms / 1000.0) * fr, 3))
        end_tick = round(cursor_tick + span_ticks, 3)
        layers.append(
            {
                "ddd": 0,
                "ind": idx + 1,
                "ty": 2,
                "nm": f"frame_{idx + 1}",
                "refId": asset_id,
                "sr": 1,
                "ks": {
                    "o": {"a": 0, "k": 100},
                    "r": {"a": 0, "k": 0},
                    "p": {"a": 0, "k": [width / 2.0, height / 2.0, 0]},
                    "a": {"a": 0, "k": [width / 2.0, height / 2.0, 0]},
                    "s": {"a": 0, "k": [100, 100, 100]},
                },
                "ao": 0,
                "ip": cursor_tick,
                "op": end_tick,
                "st": cursor_tick,
                "bm": 0,
            }
        )
        cursor_tick = end_tick

    lottie_doc = {
        "v": "5.9.0",
        "fr": fr,
        "ip": 0,
        "op": round(cursor_tick, 3),
        "w": width,
        "h": height,
        "nm": "gif_studio_export",
        "ddd": 0,
        "assets": assets,
        "layers": layers,
    }
    return lottie_doc, bin_assets


def _encode_lottie_json(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    width: int,
    height: int,
    quality: str,
    transparent: bool,
) -> None:
    lottie_doc, _ = _build_lottie_payload(
        frame_paths, durations_ms, width, height, quality, transparent, embed_inline=True
    )
    out_path.write_text(json.dumps(lottie_doc, separators=(",", ":")), encoding="utf-8")


def _encode_dotlottie(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    width: int,
    height: int,
    quality: str,
    transparent: bool,
    play_once: bool,
) -> None:
    """Package frames + animation JSON into a compact dotLottie (.lottie) ZIP archive."""
    lottie_doc, bin_assets = _build_lottie_payload(
        frame_paths, durations_ms, width, height, quality, transparent, embed_inline=False
    )
    manifest = {
        "version": "1.0",
        "generator": "GIF Studio",
        "animations": [
            {
                "id": "animation",
                "loop": not play_once,
                "speed": 1,
                "direction": 1,
                "autoplay": True,
            }
        ],
    }
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
        zf.writestr("animations/animation.json", json.dumps(lottie_doc, separators=(",", ":")))
        for archive_path, raw_bytes in bin_assets.items():
            zf.writestr(archive_path, raw_bytes)


def _encode_animated_svg(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    width: int,
    height: int,
    loop_count: int,
    play_once: bool,
    quality: str,
    transparent: bool,
) -> None:
    """Emit a self-contained animated SVG driven by zero-JS CSS steps() keyframes."""
    total_ms = max(1, sum(durations_ms))
    iter_css = "1" if play_once else ("infinite" if loop_count == 0 else str(loop_count))
    use_webp = quality != "high"
    mime = "image/webp" if use_webp else "image/png"
    webp_q = 82 if quality == "balanced" else 66

    style_lines: list[str] = [".gs-f{opacity:0;}"]
    image_tags: list[str] = []
    elapsed = 0

    for idx, (fpath, dur_ms) in enumerate(zip(frame_paths, durations_ms)):
        with Image.open(fpath) as im:
            converted = im.convert("RGBA" if transparent else "RGB")
            buf = io.BytesIO()
            if use_webp:
                converted.save(buf, format="WEBP", quality=webp_q, method=4)
            else:
                converted.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        image_tags.append(
            f'<image class="gs-f gs-f{idx}" width="{width}" height="{height}" href="data:{mime};base64,{b64}"/>'
        )
        if len(frame_paths) == 1:
            style_lines = [f".gs-f0{{opacity:1;}}"]
        else:
            start_pct = (elapsed / total_ms) * 100.0
            end_pct = ((elapsed + dur_ms) / total_ms) * 100.0
            if idx == 0:
                kf = f"0%{{opacity:1}}{end_pct:.4f}%{{opacity:0}}100%{{opacity:0}}"
            elif idx == len(frame_paths) - 1:
                kf = f"0%{{opacity:0}}{start_pct:.4f}%{{opacity:1}}100%{{opacity:1}}"
            else:
                kf = f"0%{{opacity:0}}{start_pct:.4f}%{{opacity:1}}{end_pct:.4f}%{{opacity:0}}100%{{opacity:0}}"
            style_lines.append(f"@keyframes gs{idx}{{{kf}}}")
            style_lines.append(
                f".gs-f{idx}{{animation:gs{idx} {total_ms}ms steps(1,end) {iter_css};}}"
            )
        elapsed += dur_ms

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">'
        f"<style>{''.join(style_lines)}</style>"
        f"{''.join(image_tags)}"
        "</svg>"
    )
    out_path.write_text(svg, encoding="utf-8")


def _encode_bundle_zip(
    frame_paths: list[Path],
    durations_ms: list[int],
    out_path: Path,
    tmp_dir: Path,
    effective_loop: int,
    play_once: bool,
    transparent: bool,
    width: int,
    height: int,
    req: ProjectRenderRequest,
) -> list[str]:
    """Build a production Web Dev bundle ZIP (WebM, Safari MOV/MP4, WebP, GIF, embed.html)."""
    bundled_entries: list[tuple[str, Path]] = []

    webm_p = tmp_dir / "animation.webm"
    _encode_webm(
        frame_paths,
        durations_ms,
        webm_p,
        req.export.quality,
        transparent=transparent,
        video_crf=getattr(req.export, "video_crf", None),
        video_codec=getattr(req.export, "video_codec", "auto"),
    )
    bundled_entries.append(("animation.webm", webm_p))

    if transparent:
        mov_p = tmp_dir / "animation.mov"
        _encode_mov_alpha(
            frame_paths,
            durations_ms,
            mov_p,
            req.export.quality,
            transparent=True,
        )
        bundled_entries.append(("animation.mov", mov_p))
        video_markup = (
            f'<video width="{width}" height="{height}" autoplay loop muted playsinline>\n'
            f'  <source src="./animation.mov" type=\'video/quicktime; codecs="hvc1"\' />\n'
            f'  <source src="./animation.webm" type="video/webm" />\n'
            f"</video>"
        )
    else:
        mp4_p = tmp_dir / "animation.mp4"
        _encode_mp4(
            frame_paths,
            durations_ms,
            mp4_p,
            req.export.quality,
            video_crf=getattr(req.export, "video_crf", None),
            video_codec=getattr(req.export, "video_codec", "auto"),
        )
        bundled_entries.append(("animation.mp4", mp4_p))
        video_markup = (
            f'<video width="{width}" height="{height}" autoplay loop muted playsinline>\n'
            f'  <source src="./animation.webm" type="video/webm" />\n'
            f'  <source src="./animation.mp4" type="video/mp4" />\n'
            f"</video>"
        )

    webp_p = tmp_dir / "animation.webp"
    _encode_webp(
        frame_paths,
        durations_ms,
        webp_p,
        effective_loop,
        req.export.quality,
        custom_quality=getattr(req.export, "custom_quality", None),
        lossless=getattr(req.export, "lossless", False),
    )
    bundled_entries.append(("animation.webp", webp_p))

    gif_p = tmp_dir / "animation.gif"
    _encode_gif_ffmpeg(
        frame_paths,
        durations_ms,
        gif_p,
        effective_loop,
        req.export.max_colors,
        req.export.dither,
        play_once=play_once,
        transparent=transparent,
    )
    bundled_entries.append(("animation.gif", gif_p))

    embed_html = tmp_dir / "embed.html"
    embed_html.write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>GIF Studio Web Animation Bundle</title>
  <style>
    .gs-asset {{
      display: block;
      width: 100%;
      max-width: {width}px;
      aspect-ratio: {width} / {height};
      height: auto;
    }}
  </style>
</head>
<body>
  <!-- Option A: Modern Video Loop (Smallest + Alpha) -->
  {video_markup}

  <!-- Option B: Picture Image Fallback (WebP -> GIF) -->
  <picture>
    <source srcset="./animation.webp" type="image/webp" />
    <img class="gs-asset" src="./animation.gif" width="{width}" height="{height}" alt="Animated asset" loading="lazy" />
  </picture>
</body>
</html>
""",
        encoding="utf-8",
    )
    bundled_entries.append(("embed.html", embed_html))

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for arc_name, src in bundled_entries:
            zf.write(src, arcname=arc_name)

    return [name for name, _ in bundled_entries]


def apply_frame_transform(
    img: Image.Image,
    rotate: int = 0,
    flip_h: bool = False,
    flip_v: bool = False,
    crop: Optional[CropConfig] = None,
    straighten: float = 0.0,
) -> Image.Image:
    """Apply clockwise rotation, horizontal/vertical flips, straighten tilt, then normalized crop."""
    out = img.convert("RGBA")
    if rotate == 90:
        out = out.transpose(Image.Transpose.ROTATE_270)
    elif rotate == 180:
        out = out.transpose(Image.Transpose.ROTATE_180)
    elif rotate == 270:
        out = out.transpose(Image.Transpose.ROTATE_90)

    if flip_h:
        out = ImageOps.mirror(out)
    if flip_v:
        out = ImageOps.flip(out)

    if abs(straighten) > 0.05:
        rad = abs(math.radians(straighten))
        iw, ih = out.size
        rotated = out.rotate(-straighten, resample=Image.Resampling.BICUBIC, expand=False)
        zoom_cover = max(1.0, (abs(math.cos(rad)) + (iw / max(1, ih)) * abs(math.sin(rad))))
        crop_w = max(2, int(round(iw / zoom_cover)))
        crop_h = max(2, int(round(ih / zoom_cover)))
        left = (iw - crop_w) // 2
        top = (ih - crop_h) // 2
        out = rotated.crop((left, top, left + crop_w, top + crop_h)).resize((iw, ih), Image.Resampling.LANCZOS)

    if crop:
        iw, ih = out.size
        cx = min(max(0, int(round(crop.x * iw))), max(0, iw - 2))
        cy = min(max(0, int(round(crop.y * ih))), max(0, ih - 2))
        cw = max(2, int(round(crop.w * iw)))
        ch = max(2, int(round(crop.h * ih)))
        out = out.crop((cx, cy, min(iw, cx + cw), min(ih, cy + ch)))
    return out


def render_project(store: MediaStore, req: ProjectRenderRequest) -> ExportResponse:
    first_frame = req.frames[0]
    first_path = store.get_source_path(first_frame.media_id)
    with Image.open(first_path) as first_img:
        transformed_first = apply_frame_transform(
            first_img,
            rotate=first_frame.rotate,
            flip_h=first_frame.flip_h,
            flip_v=first_frame.flip_v,
            crop=first_frame.crop,
            straighten=getattr(first_frame, "straighten", 0.0),
        )
        first_size = transformed_first.size

    target_w, target_h = compute_canvas_size(
        req.aspect_ratio,
        req.export.resolution,
        req.export.custom_width,
        first_size,
    )
    bg_rgb = _parse_hex_color(req.bg_color)
    use_av1 = getattr(req.export, "video_codec", "auto") == "av1"
    supports_alpha = req.export.format != "mp4" and not (req.export.format == "webm" and use_av1)
    has_bg_matte = (
        getattr(req.global_filters, "bg_matte", "none") != "none"
        or any(f.filters is not None and getattr(f.filters, "bg_matte", "none") != "none" for f in req.frames)
    )
    use_transparent = (
        req.export.transparent_bg
        or req.border.corner_radius > 0
        or getattr(req.border, "shadow", False)
        or has_bg_matte
    ) and supports_alpha
    speed = max(0.25, min(3.0, getattr(req, "speed_multiplier", 1.0)))

    timeline: list[tuple[Image.Image, int]] = []
    global_frame_idx = 0
    prev_last_img: Optional[Image.Image] = None

    for fcfg in req.frames:
        src_path = store.get_source_path(fcfg.media_id)
        with Image.open(src_path) as raw_img:
            img = apply_frame_transform(
                raw_img,
                rotate=fcfg.rotate,
                flip_h=fcfg.flip_h,
                flip_v=fcfg.flip_v,
                crop=fcfg.crop,
                straighten=getattr(fcfg, "straighten", 0.0),
            )

        motion = fcfg.motion if fcfg.motion is not None else req.global_motion
        filters = fcfg.filters if fcfg.filters is not None else req.global_filters
        text_cfg = fcfg.text_overlay if fcfg.text_overlay is not None else req.global_text
        eff_dur_ms = max(30, int(round(fcfg.duration_ms / speed)))
        eff_trans_ms = max(40, int(round(fcfg.transition_ms / speed)))

        # If animated text entrance is active on a static frame, synthesize subtle progress steps
        extra_layers = getattr(text_cfg, "extra_layers", None) or []
        has_animated_text = (
            (bool(text_cfg.text.strip()) and getattr(text_cfg, "entrance", "none") != "none")
            or any(bool(l.text.strip()) and getattr(l, "entrance", "none") != "none" for l in extra_layers)
        )
        if motion.type == "none" and has_animated_text:
            step_count = max(6, min(12, eff_dur_ms // 70))
            step_ms = max(30, int(round(eff_dur_ms / step_count)))
            composed = _compose_on_canvas(
                img,
                target_w,
                target_h,
                req.fit_mode,
                bg_rgb,
                transparent_bg=(req.export.transparent_bg or has_bg_matte) and supports_alpha,
            )
            subframes = [(composed, step_ms) for _ in range(step_count)]
        else:
            subframes = synthesize_motion_frames(
                img,
                target_w,
                target_h,
                req.fit_mode,
                bg_rgb,
                motion,
                eff_dur_ms,
                transparent_bg=(req.export.transparent_bg or has_bg_matte) and supports_alpha,
            )

        processed_subframes: list[tuple[Image.Image, int]] = []
        n_sub = max(1, len(subframes))
        for sf_idx, (sf_img, sf_ms) in enumerate(subframes):
            progress_t = 1.0 if n_sub == 1 else sf_idx / max(1, n_sub - 1)
            filtered = apply_filters(sf_img, filters, frame_index=global_frame_idx)
            with_text = apply_text_overlay(filtered, text_cfg, progress_t=progress_t)
            with_border = apply_border_and_corners(
                with_text,
                req.border,
                transparent_bg=use_transparent,
            )
            processed_subframes.append((with_border, sf_ms))
            global_frame_idx += 1

        if prev_last_img is not None and fcfg.transition_in != "none" and processed_subframes:
            trans_frames = build_transition_frames(
                prev_last_img,
                processed_subframes[0][0],
                fcfg.transition_in,
                eff_trans_ms,
                req.export.fps,
            )
            timeline.extend(trans_frames)

        timeline.extend(processed_subframes)
        if processed_subframes:
            prev_last_img = processed_subframes[-1][0]

    final_frames, effective_loop, play_once = apply_loop_mode(
        timeline,
        req.loop_mode,
        req.loop_count,
        req.export.fps,
        crossfade_loop_ms=max(80, int(round(getattr(req, "crossfade_loop_ms", 350) / speed))),
        end_hold_ms=max(0, getattr(req, "end_hold_ms", 0)),
    )

    export_id = uuid.uuid4().hex[:12]
    ext = req.export.format
    file_suffix = {
        "spritesheet": "png",
        "lottie": "json",
        "dotlottie": "lottie",
        "mov_alpha": "mov",
        "bundle_zip": "zip",
    }.get(ext, ext)
    out_filename = (
        f"gifstudio_{export_id}_sheet.png"
        if ext == "spritesheet"
        else f"gifstudio_{export_id}_bundle.zip"
        if ext == "bundle_zip"
        else f"gifstudio_{export_id}.{file_suffix}"
    )
    out_path = store.exports_dir / out_filename
    out_w, out_h = target_w, target_h
    sprite_cols: Optional[int] = None
    sprite_rows: Optional[int] = None
    bundle_files: Optional[list[str]] = None

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        frame_paths: list[Path] = []
        durations_ms: list[int] = []
        for idx, (frame_img, dur_ms) in enumerate(final_frames):
            fpath = tmp_dir / f"f_{idx:05d}.png"
            frame_img.save(fpath, format="PNG")
            frame_paths.append(fpath)
            durations_ms.append(dur_ms)

        if ext == "gif":
            max_colors = req.export.max_colors
            if req.export.quality == "balanced":
                max_colors = min(max_colors, 192)
            elif req.export.quality == "compact":
                max_colors = min(max_colors, 128)

            _encode_gif_ffmpeg(
                frame_paths,
                durations_ms,
                out_path,
                effective_loop,
                max_colors,
                req.export.dither,
                play_once=play_once,
                transparent=use_transparent,
            )

            # Auto-optimize if target_size_mb is set and output exceeds target
            if req.export.target_size_mb:
                target_bytes = int(req.export.target_size_mb * 1024 * 1024)
                for scale_factor, colors in [(0.8, min(max_colors, 160)), (0.65, min(max_colors, 112)), (0.5, 64)]:
                    if out_path.stat().st_size <= target_bytes:
                        break
                    sw = max(160, int(round(target_w * scale_factor)))
                    sw += sw % 2
                    _encode_gif_ffmpeg(
                        frame_paths,
                        durations_ms,
                        out_path,
                        effective_loop,
                        colors,
                        "bayer",
                        play_once=play_once,
                        transparent=use_transparent,
                        scale_width=sw,
                    )
        elif ext == "webp":
            _encode_webp(
                frame_paths,
                durations_ms,
                out_path,
                effective_loop,
                req.export.quality,
                custom_quality=getattr(req.export, "custom_quality", None),
                lossless=getattr(req.export, "lossless", False),
            )
        elif ext == "avif":
            _encode_avif(
                frame_paths,
                durations_ms,
                out_path,
                effective_loop,
                req.export.quality,
                transparent=use_transparent,
                custom_quality=getattr(req.export, "custom_quality", None),
                lossless=getattr(req.export, "lossless", False),
            )
        elif ext == "apng":
            _encode_apng(
                frame_paths,
                durations_ms,
                out_path,
                effective_loop,
            )
        elif ext == "webm":
            _encode_webm(
                frame_paths,
                durations_ms,
                out_path,
                req.export.quality,
                transparent=use_transparent,
                video_crf=getattr(req.export, "video_crf", None),
                video_codec=getattr(req.export, "video_codec", "auto"),
            )
        elif ext == "mov_alpha":
            _encode_mov_alpha(
                frame_paths,
                durations_ms,
                out_path,
                req.export.quality,
                transparent=use_transparent,
            )
        elif ext == "spritesheet":
            out_w, out_h, sprite_cols, sprite_rows = _encode_spritesheet(
                frame_paths,
                out_path,
                req.export.sprite_layout,
                padding=getattr(req.export, "sprite_padding", 0),
            )
        elif ext == "dotlottie":
            _encode_dotlottie(
                frame_paths,
                durations_ms,
                out_path,
                target_w,
                target_h,
                req.export.quality,
                transparent=use_transparent,
                play_once=play_once,
            )
        elif ext == "lottie":
            _encode_lottie_json(
                frame_paths,
                durations_ms,
                out_path,
                target_w,
                target_h,
                req.export.quality,
                transparent=use_transparent,
            )
        elif ext == "svg":
            _encode_animated_svg(
                frame_paths,
                durations_ms,
                out_path,
                target_w,
                target_h,
                req.loop_count,
                play_once=play_once,
                quality=req.export.quality,
                transparent=use_transparent,
            )
        elif ext == "bundle_zip":
            bundle_files = _encode_bundle_zip(
                frame_paths,
                durations_ms,
                out_path,
                tmp_dir,
                effective_loop,
                play_once,
                use_transparent,
                target_w,
                target_h,
                req,
            )
        else:
            _encode_mp4(
                frame_paths,
                durations_ms,
                out_path,
                req.export.quality,
                video_crf=getattr(req.export, "video_crf", None),
                video_codec=getattr(req.export, "video_codec", "auto"),
            )

    store.register_export(export_id, out_path)
    total_ms = sum(d for _, d in final_frames)
    avg_ms = max(20, int(round(total_ms / max(1, len(final_frames)))))
    return ExportResponse(
        export_id=export_id,
        download_url=f"/api/exports/{export_id}?download=1",
        preview_url=f"/api/exports/{export_id}",
        filename=out_filename,
        format=ext,
        size_bytes=out_path.stat().st_size,
        width=out_w,
        height=out_h,
        frame_count=len(final_frames),
        total_duration_ms=total_ms,
        sprite_cols=sprite_cols,
        sprite_rows=sprite_rows,
        frame_width=target_w,
        frame_height=target_h,
        avg_frame_ms=avg_ms,
        sprite_padding=req.export.sprite_padding if ext == "spritesheet" else None,
        bundle_files=bundle_files,
    )
