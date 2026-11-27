"""Generate PNG, ICO, and ICNS app icons for GIF Studio desktop builds."""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw


def render_base_icon(size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(size * 0.0625)
    radius = int(size * 0.22)
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=(20, 20, 22, 255),
        outline=(255, 255, 255, 40),
        width=max(2, int(size * 0.022)),
    )

    frame_x0 = int(size * 0.235)
    frame_y0 = int(size * 0.265)
    frame_x1 = int(size * 0.765)
    frame_y1 = int(size * 0.735)
    draw.rounded_rectangle(
        [frame_x0, frame_y0, frame_x1, frame_y1],
        radius=int(size * 0.078),
        outline=(244, 244, 246, 255),
        width=max(4, int(size * 0.04)),
    )

    # Play triangle centered slightly right for optical balance
    tri = [
        (int(size * 0.43), int(size * 0.40)),
        (int(size * 0.60), int(size * 0.50)),
        (int(size * 0.43), int(size * 0.60)),
    ]
    draw.polygon(tri, fill=(244, 244, 246, 255))

    # Signature warm amber recording indicator dot
    dot_cx = int(size * 0.68)
    dot_cy = int(size * 0.345)
    dot_r = int(size * 0.042)
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=(217, 119, 6, 255),
    )
    return img


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "desktop" / "build"
    out_dir.mkdir(parents=True, exist_ok=True)

    base = render_base_icon(1024)
    png_512 = base.resize((512, 512), Image.Resampling.LANCZOS)
    png_512.save(out_dir / "icon.png", format="PNG")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(out_dir / "icon.ico", format="ICO", sizes=ico_sizes)

    base.save(out_dir / "icon.icns", format="ICNS")
    print(f"Generated icons in {out_dir}")


if __name__ == "__main__":
    main()
