from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


AspectRatioPreset = Literal["original", "1:1", "9:16", "16:9", "4:5", "4:3"]
FitMode = Literal["fill", "fit", "blur_pad"]
LoopMode = Literal["forward", "boomerang", "reverse", "once", "crossfade_loop"]
MotionType = Literal[
    "none",
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "ken_burns",
    "bounce",
    "shake",
    "pulse",
    "tilt_sway",
    "float_orbit",
]
MotionEasing = Literal["ease_in_out", "linear", "ease_out", "elastic", "custom_bezier"]
BgMatteMode = Literal["none", "chroma_green", "chroma_blue", "edge_flood", "custom"]
TransitionType = Literal[
    "none",
    "crossfade",
    "slide_left",
    "slide_right",
    "slide_up",
    "zoom_in",
]
FilterPreset = Literal[
    "none",
    "bw",
    "sepia",
    "vintage",
    "vivid",
    "cool",
    "warm",
    "cyberpunk",
    "duotone",
    "noir",
    "sunset",
    "pastel",
]
ExportFormat = Literal[
    "gif",
    "webp",
    "avif",
    "apng",
    "mp4",
    "webm",
    "mov_alpha",
    "spritesheet",
    "dotlottie",
    "lottie",
    "svg",
    "bundle_zip",
]
VideoCodec = Literal["auto", "av1"]
SpriteLayout = Literal["strip", "grid"]
ResolutionPreset = Literal["480p", "720p", "1080p", "original", "retina_2x", "custom"]
QualityPreset = Literal["high", "balanced", "compact"]
DitherMode = Literal["floyd_steinberg", "bayer", "none"]
TextFontFamily = Literal["sans", "serif", "mono", "display"]
TextAlign = Literal["left", "center", "right"]
TextEntrance = Literal["none", "fade_in", "slide_up", "typewriter", "bounce"]


class UploadedMediaItem(BaseModel):
    id: str
    filename: str
    media_type: Literal["image", "video"]
    mime_type: str
    width: int
    height: int
    preview_url: str
    video_url: Optional[str] = None
    duration_sec: Optional[float] = None
    source_fps: Optional[float] = None
    frame_duration_ms: Optional[int] = None


class VideoExtractRequest(BaseModel):
    media_id: str
    start_sec: float = Field(default=0.0, ge=0.0)
    end_sec: Optional[float] = Field(default=None, ge=0.0)
    fps: float = Field(default=10.0, ge=1.0, le=30.0)
    max_frames: int = Field(default=90, ge=1, le=200)
    speed: float = Field(default=1.0, ge=0.25, le=4.0)


class VideoExtractResponse(BaseModel):
    frames: list[UploadedMediaItem]
    default_frame_duration_ms: int
    source_duration_sec: Optional[float] = None


class CropConfig(BaseModel):
    x: float = Field(default=0.0, ge=0.0, le=1.0)
    y: float = Field(default=0.0, ge=0.0, le=1.0)
    w: float = Field(default=1.0, gt=0.0, le=1.0)
    h: float = Field(default=1.0, gt=0.0, le=1.0)


class MotionConfig(BaseModel):
    type: MotionType = "none"
    intensity: float = Field(default=0.5, ge=0.0, le=1.0)
    frames: int = Field(default=12, ge=2, le=48)
    easing: MotionEasing = "ease_in_out"
    bezier: list[float] = Field(default_factory=lambda: [0.42, 0.0, 0.58, 1.0], min_length=4, max_length=4)
    anchor_x: float = Field(default=0.5, ge=0.0, le=1.0)
    anchor_y: float = Field(default=0.5, ge=0.0, le=1.0)


class FilterConfig(BaseModel):
    preset: FilterPreset = "none"
    brightness: float = Field(default=1.0, ge=0.3, le=2.0)
    contrast: float = Field(default=1.0, ge=0.3, le=2.0)
    saturation: float = Field(default=1.0, ge=0.0, le=2.5)
    film_grain: float = Field(default=0.0, ge=0.0, le=1.0)
    vignette: float = Field(default=0.0, ge=0.0, le=1.0)
    glitch: float = Field(default=0.0, ge=0.0, le=1.0)
    blur: float = Field(default=0.0, ge=0.0, le=10.0)
    sharpen: float = Field(default=0.0, ge=0.0, le=1.0)
    temperature: float = Field(default=0.0, ge=-1.0, le=1.0)
    chromatic: float = Field(default=0.0, ge=0.0, le=1.0)
    pixelate: int = Field(default=0, ge=0, le=16)
    hue_shift: float = Field(default=0.0, ge=-180.0, le=180.0)
    bloom: float = Field(default=0.0, ge=0.0, le=1.0)
    split_tone: float = Field(default=0.0, ge=-1.0, le=1.0)
    bg_matte: BgMatteMode = "none"
    matte_color: str = "#00FF00"
    matte_tolerance: float = Field(default=0.22, ge=0.02, le=0.75)
    matte_feather: float = Field(default=0.08, ge=0.0, le=0.35)


class TextBadgeLayer(BaseModel):
    text: str = ""
    position: Literal["top", "center", "bottom"] = "bottom"
    font_size: int = Field(default=32, ge=12, le=120)
    color: str = "#FFFFFF"
    stroke_color: str = "#000000"
    stroke_width: int = Field(default=3, ge=0, le=10)
    bg_pill: bool = False
    font_family: TextFontFamily = "sans"
    align: TextAlign = "center"
    margin_pct: int = Field(default=6, ge=2, le=24)
    opacity: float = Field(default=1.0, ge=0.2, le=1.0)
    shadow: bool = True
    entrance: TextEntrance = "none"
    x_pct: Optional[float] = Field(default=None, ge=0.04, le=0.96)
    y_pct: Optional[float] = Field(default=None, ge=0.04, le=0.96)
    letter_spacing: int = Field(default=0, ge=-2, le=12)
    rotation: float = Field(default=0.0, ge=-45.0, le=45.0)
    box_radius: int = Field(default=14, ge=0, le=32)


class TextOverlayConfig(TextBadgeLayer):
    extra_layers: list[TextBadgeLayer] = Field(default_factory=list, max_length=3)


class FrameConfig(BaseModel):
    media_id: str
    duration_ms: int = Field(default=500, ge=30, le=10000)
    motion: Optional[MotionConfig] = None
    filters: Optional[FilterConfig] = None
    transition_in: TransitionType = "none"
    transition_ms: int = Field(default=250, ge=50, le=1500)
    text_overlay: Optional[TextOverlayConfig] = None
    crop: Optional[CropConfig] = None
    rotate: Literal[0, 90, 180, 270] = 0
    straighten: float = Field(default=0.0, ge=-15.0, le=15.0)
    flip_h: bool = False
    flip_v: bool = False


BorderStyle = Literal["none", "clean", "polaroid", "film"]


class BorderConfig(BaseModel):
    style: BorderStyle = "none"
    thickness: int = Field(default=16, ge=0, le=64)
    color: str = "#FFFFFF"
    corner_radius: int = Field(default=0, ge=0, le=64)
    inner_padding: int = Field(default=0, ge=0, le=48)
    shadow: bool = False


class ExportConfig(BaseModel):
    format: ExportFormat = "gif"
    resolution: ResolutionPreset = "720p"
    custom_width: Optional[int] = Field(default=None, ge=64, le=2160)
    fps: int = Field(default=15, ge=1, le=30)
    quality: QualityPreset = "high"
    dither: DitherMode = "floyd_steinberg"
    max_colors: int = Field(default=256, ge=16, le=256)
    target_size_mb: Optional[float] = Field(default=None, gt=0.1, le=100.0)
    transparent_bg: bool = False
    sprite_layout: SpriteLayout = "strip"
    custom_quality: Optional[int] = Field(default=None, ge=1, le=100)
    lossless: bool = False
    video_crf: Optional[int] = Field(default=None, ge=10, le=44)
    video_codec: VideoCodec = "auto"
    sprite_padding: int = Field(default=0, ge=0, le=24)


class ProjectRenderRequest(BaseModel):
    frames: list[FrameConfig] = Field(..., min_length=1)
    aspect_ratio: AspectRatioPreset = "1:1"
    fit_mode: FitMode = "fill"
    bg_color: str = "#09090B"
    loop_mode: LoopMode = "forward"
    loop_count: int = Field(default=0, ge=0, le=100)
    speed_multiplier: float = Field(default=1.0, ge=0.25, le=3.0)
    end_hold_ms: int = Field(default=0, ge=0, le=2000)
    crossfade_loop_ms: int = Field(default=350, ge=100, le=1200)
    global_motion: MotionConfig = Field(default_factory=MotionConfig)
    global_filters: FilterConfig = Field(default_factory=FilterConfig)
    global_text: TextOverlayConfig = Field(default_factory=TextOverlayConfig)
    border: BorderConfig = Field(default_factory=BorderConfig)
    export: ExportConfig = Field(default_factory=ExportConfig)


class ExportResponse(BaseModel):
    export_id: str
    download_url: str
    preview_url: str
    filename: str
    format: ExportFormat
    size_bytes: int
    width: int
    height: int
    frame_count: int
    total_duration_ms: int
    sprite_cols: Optional[int] = None
    sprite_rows: Optional[int] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    avg_frame_ms: Optional[int] = None
    sprite_padding: Optional[int] = None
    bundle_files: Optional[list[str]] = None
