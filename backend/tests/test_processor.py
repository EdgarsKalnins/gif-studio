from __future__ import annotations

import io
import subprocess
from pathlib import Path

import pillow_heif
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.models import BorderConfig, CropConfig, FilterConfig, MotionConfig, TextOverlayConfig
from app.processor import (
    apply_border_and_corners,
    apply_filters,
    apply_frame_transform,
    apply_loop_mode,
    apply_text_overlay,
    synthesize_motion_frames,
)


def _make_jpeg_bytes(color: tuple[int, int, int], size: tuple[int, int] = (320, 240)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _make_heic_bytes(color: tuple[int, int, int], size: tuple[int, int] = (240, 320)) -> bytes:
    img = Image.new("RGB", size, color)
    heif_file = pillow_heif.from_pillow(img)
    buf = io.BytesIO()
    heif_file.save(buf, quality=85)
    return buf.getvalue()


def _make_mov_bytes(tmp_path: Path) -> bytes:
    out = tmp_path / "sample.mov"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1.0:size=320x240:rate=10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        check=True,
    )
    return out.read_bytes()


def test_loop_modes():
    imgs = [(Image.new("RGB", (64, 64), (i * 50, 10, 10)), 100) for i in range(4)]

    fwd, l_fwd, once_fwd = apply_loop_mode(imgs, "forward", 0, 10)
    assert len(fwd) == 4 and l_fwd == 0 and once_fwd is False

    fwd_one, l_fwd_one, once_fwd_one = apply_loop_mode(imgs, "forward", 1, 10)
    assert len(fwd_one) == 4 and l_fwd_one == 1 and once_fwd_one is False

    rev, l_rev, once_rev = apply_loop_mode(imgs, "reverse", 0, 10)
    assert len(rev) == 4 and rev[0][0].getpixel((0, 0)) == imgs[-1][0].getpixel((0, 0))
    assert l_rev == 0 and once_rev is False

    boom, _, _ = apply_loop_mode(imgs, "boomerang", 0, 10)
    assert len(boom) == 6  # 0,1,2,3,2,1

    once, l_once, once_flag = apply_loop_mode(imgs, "once", 0, 10)
    assert len(once) == 4 and l_once == 1 and once_flag is True

    xfade, _, _ = apply_loop_mode(imgs, "crossfade_loop", 0, 10)
    assert len(xfade) > 4


def test_motion_filters_and_text():
    base = Image.new("RGB", (300, 300), (120, 80, 200))
    frames = synthesize_motion_frames(
        base,
        240,
        240,
        "blur_pad",
        (10, 10, 10),
        MotionConfig(type="ken_burns", intensity=0.7, frames=8),
        800,
    )
    assert len(frames) == 8
    assert frames[0][0].size == (240, 240)

    filtered = apply_filters(
        frames[0][0],
        FilterConfig(preset="cyberpunk", film_grain=0.3, vignette=0.4, glitch=0.2),
        frame_index=1,
    )
    assert filtered.size == (240, 240)

    with_text = apply_text_overlay(
        filtered,
        TextOverlayConfig(text="HELLO GIF", position="bottom", bg_pill=True),
    )
    assert with_text.size == (240, 240)


def test_frame_transform_rotate_flip_crop():
    # 8x4 image: top-left = Red, top-right = Green, bottom-left = Blue, bottom-right = White
    img = Image.new("RGB", (8, 4))
    for y in range(2):
        for x in range(4):
            img.putpixel((x, y), (255, 0, 0))
            img.putpixel((x + 4, y), (0, 255, 0))
            img.putpixel((x, y + 2), (0, 0, 255))
            img.putpixel((x + 4, y + 2), (255, 255, 255))

    # 90° CW -> 4x8 image; original top-left (Red) moves to top-right (x=2..3, y=0..3)
    rot90 = apply_frame_transform(img, rotate=90)
    assert rot90.size == (4, 8)
    assert rot90.getpixel((3, 0))[:3] == (255, 0, 0)
    assert rot90.getpixel((0, 0))[:3] == (0, 0, 255)

    # Rotate 90° CW then crop top-right quadrant (x=0.5, y=0.0, w=0.5, h=0.5) -> Red pixels
    cropped = apply_frame_transform(
        img,
        rotate=90,
        crop=CropConfig(x=0.5, y=0.0, w=0.5, h=0.5),
    )
    assert cropped.size == (2, 4)
    assert cropped.getpixel((0, 0))[:3] == (255, 0, 0)

    # Flip H swaps left and right
    fh = apply_frame_transform(img, flip_h=True)
    assert fh.getpixel((0, 0))[:3] == (0, 255, 0)
    assert fh.getpixel((7, 0))[:3] == (255, 0, 0)


def test_border_styles_and_rounded_corners():
    base = Image.new("RGB", (240, 240), (80, 140, 220))
    polaroid = apply_border_and_corners(
        base,
        BorderConfig(style="polaroid", thickness=16, color="#FFFFFF", corner_radius=24),
        transparent_bg=False,
    )
    assert polaroid.size == (240, 240)
    assert polaroid.mode == "RGBA"
    # Corner pixel should be masked transparent by rounded corners
    assert polaroid.getpixel((0, 0))[3] == 0

    film = apply_border_and_corners(
        base,
        BorderConfig(style="film", thickness=14, corner_radius=0),
        transparent_bg=False,
    )
    assert film.size == (240, 240)
    assert film.mode == "RGB"


def test_gif_import_and_transparent_sticker_export(tmp_path: Path):
    app = create_app(storage_dir=tmp_path / "storage")
    client = TestClient(app)

    # Create a 2-frame animated GIF with distinct delays
    f1 = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
    for y in range(30, 90):
        for x in range(30, 90):
            f1.putpixel((x, y), (255, 80, 80, 255))
    f2 = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
    for y in range(20, 100):
        for x in range(20, 100):
            f2.putpixel((x, y), (80, 200, 255, 255))
    gif_buf = io.BytesIO()
    f1.save(gif_buf, format="GIF", save_all=True, append_images=[f2], duration=[180, 260], loop=0)

    up = client.post(
        "/api/upload",
        files=[("files", ("sticker.gif", gif_buf.getvalue(), "image/gif"))],
    )
    assert up.status_code == 200, up.text
    items = up.json()
    assert len(items) == 2
    assert items[0]["frame_duration_ms"] == 180
    assert items[1]["frame_duration_ms"] == 260

    # Re-export with transparent_bg=True and rounded corners
    exp = client.post(
        "/api/export",
        json={
            "frames": [
                {"media_id": items[0]["id"], "duration_ms": 180},
                {"media_id": items[1]["id"], "duration_ms": 260},
            ],
            "aspect_ratio": "1:1",
            "fit_mode": "fit",
            "border": {"style": "none", "thickness": 16, "color": "#FFFFFF", "corner_radius": 20},
            "export": {"format": "gif", "resolution": "480p", "fps": 12, "transparent_bg": True},
        },
    )
    assert exp.status_code == 200, exp.text
    dl = client.get(exp.json()["download_url"])
    assert dl.status_code == 200
    with Image.open(io.BytesIO(dl.content)) as out_gif:
        assert "transparency" in out_gif.info


def test_api_upload_heic_jpeg_video_and_export(tmp_path: Path):
    app = create_app(storage_dir=tmp_path / "storage")
    client = TestClient(app)

    assert client.get("/api/health").json() == {"status": "ok"}

    demo_res = client.post("/api/demo-samples")
    assert demo_res.status_code == 200
    assert len(demo_res.json()) == 4

    jpeg_bytes = _make_jpeg_bytes((220, 40, 60))
    heic_bytes = _make_heic_bytes((40, 180, 220))
    res = client.post(
        "/api/upload",
        files=[
            ("files", ("photo1.jpg", jpeg_bytes, "image/jpeg")),
            ("files", ("iphone_shot.heic", heic_bytes, "image/heic")),
        ],
    )
    assert res.status_code == 200, res.text
    uploaded = res.json()
    assert len(uploaded) == 2
    assert uploaded[0]["media_type"] == "image"
    assert uploaded[1]["media_type"] == "image"
    assert uploaded[1]["width"] == 240 and uploaded[1]["height"] == 320

    # Verify preview endpoint serves valid image
    prev = client.get(uploaded[1]["preview_url"])
    assert prev.status_code == 200 and len(prev.content) > 100

    # Export multi-image GIF with motion, transition, filters, and boomerang loop
    export_req = {
        "frames": [
            {
                "media_id": uploaded[0]["id"],
                "duration_ms": 400,
                "motion": {"type": "zoom_in", "intensity": 0.6, "frames": 6},
                "transition_in": "none",
            },
            {
                "media_id": uploaded[1]["id"],
                "duration_ms": 400,
                "transition_in": "crossfade",
                "transition_ms": 200,
            },
        ],
        "aspect_ratio": "1:1",
        "fit_mode": "blur_pad",
        "loop_mode": "boomerang",
        "global_filters": {"preset": "vintage", "vignette": 0.3},
        "global_text": {"text": "STUDIO", "position": "bottom", "bg_pill": True},
        "export": {"format": "gif", "resolution": "480p", "fps": 12, "quality": "high"},
    }
    exp_res = client.post("/api/export", json=export_req)
    assert exp_res.status_code == 200, exp_res.text
    exp_data = exp_res.json()
    assert exp_data["format"] == "gif"
    assert exp_data["width"] == 480 and exp_data["height"] == 480
    assert exp_data["size_bytes"] > 500

    dl = client.get(exp_data["download_url"])
    assert dl.status_code == 200
    assert dl.content[:6] in (b"GIF87a", b"GIF89a")

    # Video upload + extraction + WebP export
    mov_bytes = _make_mov_bytes(tmp_path)
    vid_res = client.post(
        "/api/upload",
        files=[("files", ("live.mov", mov_bytes, "video/quicktime"))],
    )
    assert vid_res.status_code == 200, vid_res.text
    vid_item = vid_res.json()[0]
    assert vid_item["media_type"] == "video"

    ext_res = client.post(
        "/api/extract-video",
        json={"media_id": vid_item["id"], "start_sec": 0.0, "end_sec": 0.8, "fps": 5, "max_frames": 10},
    )
    assert ext_res.status_code == 200, ext_res.text
    ext_frames = ext_res.json()["frames"]
    assert len(ext_frames) >= 2

    webp_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": f["id"], "duration_ms": 150} for f in ext_frames[:3]],
            "aspect_ratio": "original",
            "fit_mode": "fill",
            "loop_mode": "forward",
            "export": {"format": "webp", "resolution": "480p", "fps": 10},
        },
    )
    assert webp_res.status_code == 200, webp_res.text
    assert webp_res.json()["format"] == "webp"
    assert webp_res.json()["size_bytes"] > 100

    mp4_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": f["id"], "duration_ms": 150} for f in ext_frames[:3]],
            "aspect_ratio": "original",
            "fit_mode": "fill",
            "loop_mode": "forward",
            "export": {"format": "mp4", "resolution": "480p", "fps": 10},
        },
    )
    assert mp4_res.status_code == 200, mp4_res.text
    assert mp4_res.json()["format"] == "mp4"
    assert mp4_res.json()["size_bytes"] > 100

    # Custom width + 4:3 aspect ratio + delete media cleanup
    custom_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": uploaded[0]["id"], "duration_ms": 300}],
            "aspect_ratio": "4:3",
            "fit_mode": "fit",
            "loop_mode": "once",
            "global_text": {
                "text": "A very long caption that should wrap cleanly inside the GIF canvas",
                "stroke_width": 4,
                "stroke_color": "#111111",
            },
            "export": {"format": "gif", "resolution": "custom", "custom_width": 360, "fps": 12},
        },
    )
    assert custom_res.status_code == 200, custom_res.text
    assert custom_res.json()["width"] == 360

    list_res = client.get("/api/media")
    assert list_res.status_code == 200
    assert any(item["id"] == uploaded[0]["id"] for item in list_res.json())

    del_res = client.delete(f"/api/media/{uploaded[0]['id']}")
    assert del_res.status_code == 200
    assert client.get(uploaded[0]["preview_url"]).status_code == 404
    after_del = client.get("/api/media").json()
    assert not any(item["id"] == uploaded[0]["id"] for item in after_del)


def test_public_domain_demo_samples_packs(tmp_path: Path):
    app = create_app(storage_dir=tmp_path)
    client = TestClient(app)

    stock_res = client.post("/api/demo-samples")
    assert stock_res.status_code == 200, stock_res.text
    stock = stock_res.json()
    assert len(stock) == 4
    names = {item["filename"] for item in stock}
    assert "nasa_earthrise.jpg" in names
    assert "muybridge_horse_plate.jpg" in names

    motion_res = client.post("/api/demo-samples?pack=motion")
    assert motion_res.status_code == 200, motion_res.text
    motion_frames = motion_res.json()
    assert len(motion_frames) >= 10
    assert all(f["frame_duration_ms"] is not None for f in motion_frames)


def test_modern_web_dev_formats_export_and_import(tmp_path: Path):
    import io
    import json
    from PIL import Image

    app = create_app(storage_dir=tmp_path)
    client = TestClient(app)

    # 1. Import an SVG logo via rsvg-convert
    svg_bytes = (
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">'
        b'<circle cx="60" cy="60" r="45" fill="#d97706"/></svg>'
    )
    svg_up = client.post(
        "/api/upload",
        files=[("files", ("badge.svg", svg_bytes, "image/svg+xml"))],
    )
    assert svg_up.status_code == 200, svg_up.text
    svg_item = svg_up.json()[0]
    assert svg_item["mime_type"] == "image/png"

    # 2. Import multi-frame WebP and verify frame splitting
    w1 = Image.new("RGBA", (80, 80), (220, 60, 60, 255))
    w2 = Image.new("RGBA", (80, 80), (60, 180, 220, 255))
    webp_buf = io.BytesIO()
    w1.save(webp_buf, format="WEBP", save_all=True, append_images=[w2], duration=[90, 140], loop=0)
    webp_up = client.post(
        "/api/upload",
        files=[("files", ("loop.webp", webp_buf.getvalue(), "image/webp"))],
    )
    assert webp_up.status_code == 200, webp_up.text
    webp_frames = webp_up.json()
    assert len(webp_frames) == 2

    frames_payload = [
        {"media_id": svg_item["id"], "duration_ms": 120},
        {"media_id": webp_frames[0]["id"], "duration_ms": 140},
        {"media_id": webp_frames[1]["id"], "duration_ms": 140},
    ]

    # 3. Export AVIF
    avif_res = client.post(
        "/api/export",
        json={
            "frames": frames_payload[:2],
            "aspect_ratio": "1:1",
            "export": {"format": "avif", "resolution": "custom", "custom_width": 160, "transparent_bg": True},
        },
    )
    assert avif_res.status_code == 200, avif_res.text
    avif_meta = avif_res.json()
    assert avif_meta["format"] == "avif"
    avif_dl = client.get(avif_meta["preview_url"])
    assert avif_dl.status_code == 200
    assert avif_dl.headers["content-type"].startswith("image/avif")
    with Image.open(io.BytesIO(avif_dl.content)) as avif_im:
        assert getattr(avif_im, "n_frames", 1) == 2

    # 4. Export APNG
    apng_res = client.post(
        "/api/export",
        json={
            "frames": frames_payload[:2],
            "aspect_ratio": "1:1",
            "export": {"format": "apng", "resolution": "custom", "custom_width": 160, "transparent_bg": True},
        },
    )
    assert apng_res.status_code == 200, apng_res.text
    apng_dl = client.get(apng_res.json()["preview_url"])
    assert apng_dl.headers["content-type"].startswith("image/apng")
    with Image.open(io.BytesIO(apng_dl.content)) as apng_im:
        assert getattr(apng_im, "n_frames", 1) == 2

    # 5. Export WebM VP9 with alpha
    webm_res = client.post(
        "/api/export",
        json={
            "frames": frames_payload[:2],
            "aspect_ratio": "1:1",
            "export": {"format": "webm", "resolution": "custom", "custom_width": 160, "transparent_bg": True},
        },
    )
    assert webm_res.status_code == 200, webm_res.text
    webm_dl = client.get(webm_res.json()["preview_url"])
    assert webm_dl.headers["content-type"].startswith("video/webm")
    assert len(webm_dl.content) > 500

    # 6. Export Sprite Sheet Grid (3 frames -> 2x2 cols/rows)
    sprite_res = client.post(
        "/api/export",
        json={
            "frames": frames_payload,
            "aspect_ratio": "1:1",
            "export": {
                "format": "spritesheet",
                "sprite_layout": "grid",
                "resolution": "custom",
                "custom_width": 120,
                "transparent_bg": True,
            },
        },
    )
    assert sprite_res.status_code == 200, sprite_res.text
    sm = sprite_res.json()
    assert sm["sprite_cols"] == 2 and sm["sprite_rows"] == 2
    assert sm["width"] == 240 and sm["height"] == 240

    # 7. Export Lottie JSON & round-trip import it back
    lottie_res = client.post(
        "/api/export",
        json={
            "frames": frames_payload[:2],
            "aspect_ratio": "1:1",
            "export": {"format": "lottie", "resolution": "custom", "custom_width": 128, "transparent_bg": True},
        },
    )
    assert lottie_res.status_code == 200, lottie_res.text
    lottie_dl = client.get(lottie_res.json()["preview_url"])
    assert lottie_dl.headers["content-type"].startswith("application/json")
    lottie_doc = json.loads(lottie_dl.content)
    assert lottie_doc["v"] == "5.9.0" and len(lottie_doc["assets"]) == 2
    lottie_reup = client.post(
        "/api/upload",
        files=[("files", ("anim.json", lottie_dl.content, "application/json"))],
    )
    assert lottie_reup.status_code == 200, lottie_reup.text
    assert len(lottie_reup.json()) == 2

    # 8. Export Animated SVG
    svg_export = client.post(
        "/api/export",
        json={
            "frames": frames_payload[:2],
            "aspect_ratio": "1:1",
            "export": {"format": "svg", "resolution": "custom", "custom_width": 128, "transparent_bg": True},
        },
    )
    assert svg_export.status_code == 200, svg_export.text
    svg_dl = client.get(svg_export.json()["preview_url"])
    assert svg_dl.headers["content-type"].startswith("image/svg+xml")
    svg_text = svg_dl.content.decode("utf-8")
    assert "@keyframes" in svg_text and "steps(1,end)" in svg_text


def test_pro_expert_options_across_all_tabs(tmp_path: Path):
    import io
    from PIL import Image

    app = create_app(storage_dir=tmp_path)
    client = TestClient(app)

    raw = _make_jpeg_bytes((190, 95, 45), (320, 320))
    up = client.post("/api/upload", files=[("files", ("hero.jpg", raw, "image/jpeg"))])
    assert up.status_code == 200
    mid = up.json()[0]["id"]

    # Exercise Loop Pro + Motion Pro + Crop/Border Pro + Effects Pro + Text Pro + Export Pro
    res = client.post(
        "/api/export",
        json={
            "frames": [
                {
                    "media_id": mid,
                    "duration_ms": 600,
                    "straighten": 3.5,
                    "rotate": 0,
                    "flip_h": False,
                    "flip_v": False,
                }
            ],
            "aspect_ratio": "1:1",
            "fit_mode": "fill",
            "loop_mode": "crossfade_loop",
            "speed_multiplier": 2.0,
            "end_hold_ms": 400,
            "crossfade_loop_ms": 200,
            "global_motion": {
                "type": "float_orbit",
                "intensity": 0.6,
                "frames": 8,
                "easing": "elastic",
                "anchor_x": 0.35,
                "anchor_y": 0.4,
            },
            "global_filters": {
                "preset": "duotone",
                "sharpen": 0.4,
                "temperature": 0.3,
                "chromatic": 0.25,
                "pixelate": 4,
            },
            "global_text": {
                "text": "PRO STUDIO",
                "position": "top",
                "font_family": "mono",
                "align": "left",
                "margin_pct": 10,
                "opacity": 0.9,
                "shadow": True,
                "entrance": "typewriter",
            },
            "border": {
                "style": "polaroid",
                "thickness": 14,
                "corner_radius": 18,
                "inner_padding": 8,
                "shadow": True,
            },
            "export": {
                "format": "webp",
                "resolution": "retina_2x",
                "transparent_bg": True,
                "custom_quality": 85,
                "lossless": False,
            },
        },
    )
    assert res.status_code == 200, res.text
    meta = res.json()
    assert meta["format"] == "webp"
    # retina_2x on 320x320 -> 640x640
    assert meta["width"] == 640 and meta["height"] == 640
    # 600ms / 2.0 speed + 400ms end_hold_ms ~= 700ms
    assert meta["total_duration_ms"] >= 650

    # Also check sprite_padding in Sprite Sheet Pro
    sp_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": mid, "duration_ms": 200}, {"media_id": mid, "duration_ms": 200}],
            "aspect_ratio": "1:1",
            "export": {
                "format": "spritesheet",
                "sprite_layout": "strip",
                "sprite_padding": 10,
                "resolution": "custom",
                "custom_width": 100,
                "transparent_bg": True,
            },
        },
    )
    assert sp_res.status_code == 200, sp_res.text
    sp = sp_res.json()
    assert sp["width"] == 210 and sp["height"] == 100  # 2 * 100 + 10px gap
    img_bytes = client.get(sp["preview_url"]).content
    with Image.open(io.BytesIO(img_bytes)) as atlas:
        assert atlas.size == (210, 100)


def test_dotlottie_safari_hevc_alpha_and_av1_codecs(tmp_path: Path):
    import io
    import json
    import zipfile

    app = create_app(storage_dir=tmp_path)
    client = TestClient(app)

    raw1 = _make_jpeg_bytes((220, 90, 40), (160, 160))
    raw2 = _make_jpeg_bytes((40, 150, 210), (160, 160))
    up = client.post(
        "/api/upload",
        files=[
            ("files", ("a.jpg", raw1, "image/jpeg")),
            ("files", ("b.jpg", raw2, "image/jpeg")),
        ],
    )
    assert up.status_code == 200
    items = up.json()

    # 1. Export dotLottie (.lottie) + preview endpoint + round-trip import
    dl_res = client.post(
        "/api/export",
        json={
            "frames": [
                {"media_id": items[0]["id"], "duration_ms": 150},
                {"media_id": items[1]["id"], "duration_ms": 150},
            ],
            "aspect_ratio": "1:1",
            "export": {"format": "dotlottie", "resolution": "custom", "custom_width": 128, "transparent_bg": True},
        },
    )
    assert dl_res.status_code == 200, dl_res.text
    dl_meta = dl_res.json()
    assert dl_meta["filename"].endswith(".lottie")
    dl_bytes = client.get(dl_meta["preview_url"]).content
    with zipfile.ZipFile(io.BytesIO(dl_bytes), "r") as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "animations/animation.json" in names
        assert any(n.startswith("images/") for n in names)

    prev_json = client.get(f"/api/exports/{dl_meta['export_id']}/preview-frames")
    assert prev_json.status_code == 200
    assert prev_json.json()["assets"][0]["p"].startswith("data:image/")

    reup = client.post(
        "/api/upload",
        files=[("files", ("bundle.lottie", dl_bytes, "application/zip"))],
    )
    assert reup.status_code == 200, reup.text
    assert len(reup.json()) == 2

    # 2. Export Safari HEVC with Alpha (.mov hvc1)
    mov_res = client.post(
        "/api/export",
        json={
            "frames": [
                {"media_id": items[0]["id"], "duration_ms": 200},
                {"media_id": items[1]["id"], "duration_ms": 200},
            ],
            "aspect_ratio": "1:1",
            "export": {"format": "mov_alpha", "resolution": "custom", "custom_width": 160, "transparent_bg": True},
        },
    )
    assert mov_res.status_code == 200, mov_res.text
    assert mov_res.json()["filename"].endswith(".mov")
    mov_dl = client.get(mov_res.json()["preview_url"])
    assert mov_dl.headers["content-type"].startswith("video/quicktime")
    assert len(mov_dl.content) > 500

    # 3. Export AV1 MP4
    av1_res = client.post(
        "/api/export",
        json={
            "frames": [
                {"media_id": items[0]["id"], "duration_ms": 200},
                {"media_id": items[1]["id"], "duration_ms": 200},
            ],
            "aspect_ratio": "1:1",
            "export": {"format": "mp4", "video_codec": "av1", "resolution": "custom", "custom_width": 160},
        },
    )
    assert av1_res.status_code == 200, av1_res.text
    assert len(client.get(av1_res.json()["preview_url"]).content) > 400


def test_next_tier_expert_bezier_matte_multitext_and_bundle_zip(tmp_path: Path) -> None:
    import zipfile

    app = create_app(storage_dir=tmp_path)
    client = TestClient(app)

    # Create a green-screen background image with an orange subject center
    matte_img = Image.new("RGB", (120, 120), (15, 220, 45))
    for y in range(35, 85):
        for x in range(35, 85):
            matte_img.putpixel((x, y), (225, 110, 30))
    buf = io.BytesIO()
    matte_img.save(buf, format="PNG")

    up = client.post(
        "/api/upload",
        files=[("files", ("greenscreen.png", buf.getvalue(), "image/png"))],
    )
    assert up.status_code == 200, up.text
    media_id = up.json()[0]["id"]

    # 1. Custom bezier + hue_shift/bloom/split_tone + bg_matte + multi-layer draggable text -> APNG alpha
    apng_res = client.post(
        "/api/export",
        json={
            "frames": [
                {
                    "media_id": media_id,
                    "duration_ms": 240,
                    "motion": {
                        "type": "zoom_in",
                        "intensity": 0.5,
                        "frames": 6,
                        "easing": "custom_bezier",
                        "bezier": [0.22, 1.0, 0.36, 1.0],
                    },
                    "filters": {
                        "preset": "none",
                        "hue_shift": 25.0,
                        "bloom": 0.4,
                        "split_tone": 0.5,
                        "bg_matte": "chroma_green",
                        "matte_tolerance": 0.32,
                        "matte_feather": 0.08,
                    },
                    "text_overlay": {
                        "text": "PRO",
                        "x_pct": 0.35,
                        "y_pct": 0.28,
                        "font_size": 28,
                        "letter_spacing": 4,
                        "rotation": -8.0,
                        "box_radius": 20,
                        "bg_pill": True,
                        "entrance": "bounce",
                        "extra_layers": [
                            {
                                "text": "BADGE 2",
                                "x_pct": 0.65,
                                "y_pct": 0.72,
                                "font_size": 22,
                                "color": "#FDE68A",
                                "bg_pill": True,
                            }
                        ],
                    },
                }
            ],
            "aspect_ratio": "1:1",
            "export": {"format": "apng", "resolution": "custom", "custom_width": 120},
        },
    )
    assert apng_res.status_code == 200, apng_res.text
    apng_dl = client.get(apng_res.json()["preview_url"])
    assert apng_dl.status_code == 200
    with Image.open(io.BytesIO(apng_dl.content)) as im:
        rgba = im.convert("RGBA")
        # Corner green-screen pixel must be keyed out transparent
        assert rgba.getpixel((2, 2))[3] < 40

    # 2. Export Multi-Format Web Dev Bundle (.zip)
    bundle_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": media_id, "duration_ms": 180}],
            "aspect_ratio": "1:1",
            "global_filters": {"preset": "none", "bg_matte": "chroma_green"},
            "export": {
                "format": "bundle_zip",
                "resolution": "custom",
                "custom_width": 128,
                "transparent_bg": True,
            },
        },
    )
    assert bundle_res.status_code == 200, bundle_res.text
    bmeta = bundle_res.json()
    assert bmeta["format"] == "bundle_zip"
    assert bmeta["filename"].endswith(".zip")
    assert set(bmeta["bundle_files"] or []) == {
        "animation.webm",
        "animation.mov",
        "animation.webp",
        "animation.gif",
        "embed.html",
    }
    zip_dl = client.get(bmeta["preview_url"])
    assert zip_dl.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(zip_dl.content), "r") as zf:
        assert "embed.html" in zf.namelist()
        assert "animation.mov" in zf.namelist()
        assert "animation.webm" in zf.namelist()
        assert "animation.webp" in zf.namelist()
        assert "animation.gif" in zf.namelist()


def test_video_proxy_stream_derived_cleanup_speed_and_sample_clip(tmp_path: Path):
    app = create_app(tmp_path / "data")
    client = TestClient(app)

    # 1. Bundled Public Domain sample video clip (pack=video)
    sample_res = client.post("/api/demo-samples?pack=video")
    assert sample_res.status_code == 200, sample_res.text
    samples = sample_res.json()
    assert len(samples) == 1
    clip = samples[0]
    assert clip["media_type"] == "video"
    assert clip["filename"] == "muybridge_sample.mp4"
    assert clip["video_url"] == f"/api/media/{clip['id']}/video"
    assert (clip["duration_sec"] or 0) >= 2.5

    stream_res = client.get(clip["video_url"])
    assert stream_res.status_code == 200
    assert stream_res.headers["content-type"].startswith("video/mp4")
    assert len(stream_res.content) > 10_000

    # 2. Extract frames with 2.0x speed and confirm no Media Bin clutter
    ext_res = client.post(
        "/api/extract-video",
        json={
            "media_id": clip["id"],
            "start_sec": 0.2,
            "end_sec": 1.4,
            "fps": 6,
            "max_frames": 12,
            "speed": 2.0,
        },
    )
    assert ext_res.status_code == 200, ext_res.text
    ext_data = ext_res.json()
    frames = ext_data["frames"]
    assert len(frames) >= 4
    # At 6fps and 2.0x speed, frame duration should be ~83ms (1000/6/2)
    assert 60 <= ext_data["default_frame_duration_ms"] <= 105
    assert frames[0]["frame_duration_ms"] == ext_data["default_frame_duration_ms"]

    # Media bin list must only show the parent video, hiding derived extracted frames
    bin_res = client.get("/api/media")
    assert bin_res.status_code == 200
    bin_ids = {item["id"] for item in bin_res.json()}
    assert clip["id"] in bin_ids
    for f in frames:
        assert f["id"] not in bin_ids

    # Export using derived extracted frame IDs must succeed
    gif_res = client.post(
        "/api/export",
        json={
            "frames": [{"media_id": f["id"], "duration_ms": f["frame_duration_ms"]} for f in frames[:4]],
            "aspect_ratio": "original",
            "fit_mode": "fill",
            "loop_mode": "forward",
            "export": {"format": "gif", "resolution": "480p", "fps": 10},
        },
    )
    assert gif_res.status_code == 200, gif_res.text
    assert gif_res.json()["size_bytes"] > 500

    # Deleting parent video cleans up derived frames too
    del_res = client.delete(f"/api/media/{clip['id']}")
    assert del_res.status_code == 200
    assert client.get(frames[0]["preview_url"]).status_code == 404

    # 3. Upload MKV video -> auto H.264 stream proxy + cleanup
    mkv_path = tmp_path / "clip.mkv"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1.2:size=320x240:rate=10",
            "-c:v",
            "mpeg4",
            str(mkv_path),
        ],
        capture_output=True,
        check=True,
    )
    mkv_upload = client.post(
        "/api/upload",
        files=[("files", ("clip.mkv", mkv_path.read_bytes(), "video/x-matroska"))],
    )
    assert mkv_upload.status_code == 200, mkv_upload.text
    mkv_item = mkv_upload.json()[0]
    assert mkv_item["media_type"] == "video"
    proxy_res = client.get(mkv_item["video_url"])
    assert proxy_res.status_code == 200
    assert proxy_res.headers["content-type"].startswith("video/mp4")
    assert len(proxy_res.content) > 5_000
    assert (tmp_path / "data" / "uploads" / f"{mkv_item['id']}_proxy.mp4").exists()

    client.delete(f"/api/media/{mkv_item['id']}")
    assert not (tmp_path / "data" / "uploads" / f"{mkv_item['id']}_proxy.mp4").exists()

    # 4. Enforce 60s max clip duration guard
    long_path = tmp_path / "too_long.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=62:r=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(long_path),
        ],
        capture_output=True,
        check=True,
    )
    too_long_res = client.post(
        "/api/upload",
        files=[("files", ("too_long.mp4", long_path.read_bytes(), "video/mp4"))],
    )
    assert too_long_res.status_code == 400
    assert "60s" in too_long_res.json()["detail"]
