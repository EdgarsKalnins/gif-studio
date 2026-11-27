export type AspectRatioPreset = "original" | "1:1" | "9:16" | "16:9" | "4:5" | "4:3";
export type FitMode = "fill" | "fit" | "blur_pad";
export type LoopMode = "forward" | "boomerang" | "reverse" | "once" | "crossfade_loop";

export type MotionType =
  | "none"
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down"
  | "ken_burns"
  | "bounce"
  | "shake"
  | "pulse"
  | "tilt_sway"
  | "float_orbit";

export type MotionEasing =
  | "ease_in_out"
  | "linear"
  | "ease_out"
  | "elastic"
  | "custom_bezier";

export type BgMatteMode =
  | "none"
  | "chroma_green"
  | "chroma_blue"
  | "edge_flood"
  | "custom";

export type TransitionType =
  | "none"
  | "crossfade"
  | "slide_left"
  | "slide_right"
  | "slide_up"
  | "zoom_in";

export type FilterPreset =
  | "none"
  | "bw"
  | "sepia"
  | "vintage"
  | "vivid"
  | "cool"
  | "warm"
  | "cyberpunk"
  | "duotone"
  | "noir"
  | "sunset"
  | "pastel";

export type ExportFormat =
  | "gif"
  | "webp"
  | "avif"
  | "apng"
  | "mp4"
  | "webm"
  | "mov_alpha"
  | "spritesheet"
  | "dotlottie"
  | "lottie"
  | "svg"
  | "bundle_zip";
export type VideoCodec = "auto" | "av1";
export type SpriteLayout = "strip" | "grid";
export type ResolutionPreset =
  | "480p"
  | "720p"
  | "1080p"
  | "original"
  | "retina_2x"
  | "custom";
export type QualityPreset = "high" | "balanced" | "compact";
export type DitherMode = "floyd_steinberg" | "bayer" | "none";
export type TextFontFamily = "sans" | "serif" | "mono" | "display";
export type TextAlign = "left" | "center" | "right";
export type TextEntrance = "none" | "fade_in" | "slide_up" | "typewriter" | "bounce";
export type StudioExperienceMode = "beginner" | "expert";

export interface LivePlaybackSnapshot {
  activeFrameUid: string | null;
  activeFrameIndex: number;
  frameProgress: number;
  timelineProgress: number;
  playheadMs: number;
  totalDurationMs: number;
  isPlaying: boolean;
}

export interface PlaybackProgressChannel {
  readonly latest: LivePlaybackSnapshot;
  subscribe: (fn: (snap: LivePlaybackSnapshot) => void) => () => void;
}

export interface UploadedMediaItem {
  id: string;
  filename: string;
  media_type: "image" | "video";
  mime_type: string;
  width: number;
  height: number;
  preview_url: string;
  video_url?: string | null;
  duration_sec?: number | null;
  source_fps?: number | null;
  frame_duration_ms?: number | null;
}

export type BorderStyle = "none" | "clean" | "polaroid" | "film";

export interface BorderConfig {
  style: BorderStyle;
  thickness: number;
  color: string;
  corner_radius: number;
  inner_padding?: number;
  shadow?: boolean;
}

export const DEFAULT_BORDER: BorderConfig = {
  style: "none",
  thickness: 16,
  color: "#FFFFFF",
  corner_radius: 0,
  inner_padding: 0,
  shadow: false,
};

export interface MotionConfig {
  type: MotionType;
  intensity: number;
  frames: number;
  easing?: MotionEasing;
  bezier?: [number, number, number, number];
  anchor_x?: number;
  anchor_y?: number;
}

export interface FilterConfig {
  preset: FilterPreset;
  brightness: number;
  contrast: number;
  saturation: number;
  film_grain: number;
  vignette: number;
  glitch: number;
  blur: number;
  sharpen?: number;
  temperature?: number;
  chromatic?: number;
  pixelate?: number;
  hue_shift?: number;
  bloom?: number;
  split_tone?: number;
  bg_matte?: BgMatteMode;
  matte_color?: string;
  matte_tolerance?: number;
  matte_feather?: number;
}

export interface TextBadgeLayer {
  text: string;
  position: "top" | "center" | "bottom";
  font_size: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
  bg_pill: boolean;
  font_family?: TextFontFamily;
  align?: TextAlign;
  margin_pct?: number;
  opacity?: number;
  shadow?: boolean;
  entrance?: TextEntrance;
  x_pct?: number | null;
  y_pct?: number | null;
  letter_spacing?: number;
  rotation?: number;
  box_radius?: number;
}

export interface TextOverlayConfig extends TextBadgeLayer {
  extra_layers?: TextBadgeLayer[];
}

export type RotateDegrees = 0 | 90 | 180 | 270;
export type CropAspectLock = "free" | "canvas" | "1:1" | "4:5" | "16:9" | "9:16";

export interface CropConfig {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameItem {
  uid: string;
  media: UploadedMediaItem;
  duration_ms: number;
  motion: MotionConfig | null;
  filters: FilterConfig | null;
  transition_in: TransitionType;
  transition_ms: number;
  text_overlay: TextOverlayConfig | null;
  crop: CropConfig | null;
  rotate: RotateDegrees;
  straighten?: number;
  flip_h: boolean;
  flip_v: boolean;
}

export interface ExportConfig {
  format: ExportFormat;
  resolution: ResolutionPreset;
  custom_width?: number;
  fps: number;
  quality: QualityPreset;
  dither: DitherMode;
  max_colors: number;
  target_size_mb: number | null;
  transparent_bg: boolean;
  sprite_layout: SpriteLayout;
  custom_quality?: number | null;
  lossless?: boolean;
  video_crf?: number | null;
  video_codec?: VideoCodec;
  sprite_padding?: number;
}

export interface ExportResponse {
  export_id: string;
  download_url: string;
  preview_url: string;
  filename: string;
  format: ExportFormat;
  size_bytes: number;
  width: number;
  height: number;
  frame_count: number;
  total_duration_ms: number;
  sprite_cols?: number | null;
  sprite_rows?: number | null;
  frame_width?: number | null;
  frame_height?: number | null;
  avg_frame_ms?: number | null;
  sprite_padding?: number | null;
  bundle_files?: string[] | null;
}

export const DEFAULT_MOTION: MotionConfig = {
  type: "none",
  intensity: 0.55,
  frames: 12,
  easing: "ease_in_out",
  bezier: [0.42, 0, 0.58, 1],
  anchor_x: 0.5,
  anchor_y: 0.5,
};

export const DEFAULT_FILTERS: FilterConfig = {
  preset: "none",
  brightness: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  film_grain: 0.0,
  vignette: 0.0,
  glitch: 0.0,
  blur: 0.0,
  sharpen: 0.0,
  temperature: 0.0,
  chromatic: 0.0,
  pixelate: 0,
  hue_shift: 0,
  bloom: 0,
  split_tone: 0,
  bg_matte: "none",
  matte_color: "#00FF00",
  matte_tolerance: 0.22,
  matte_feather: 0.08,
};

export const DEFAULT_TEXT_LAYER: TextBadgeLayer = {
  text: "",
  position: "bottom",
  font_size: 32,
  color: "#FFFFFF",
  stroke_color: "#000000",
  stroke_width: 3,
  bg_pill: true,
  font_family: "sans",
  align: "center",
  margin_pct: 6,
  opacity: 1.0,
  shadow: true,
  entrance: "none",
  x_pct: null,
  y_pct: null,
  letter_spacing: 0,
  rotation: 0,
  box_radius: 14,
};

export const DEFAULT_TEXT: TextOverlayConfig = {
  ...DEFAULT_TEXT_LAYER,
  font_size: 36,
  extra_layers: [],
};

export const DEFAULT_EXPORT: ExportConfig = {
  format: "gif",
  resolution: "720p",
  custom_width: 640,
  fps: 15,
  quality: "high",
  dither: "floyd_steinberg",
  max_colors: 256,
  target_size_mb: null,
  transparent_bg: false,
  sprite_layout: "strip",
  custom_quality: null,
  lossless: false,
  video_crf: null,
  video_codec: "auto",
  sprite_padding: 0,
};

export const LOOP_MODES: { id: LoopMode; label: string; desc: string }[] = [
  { id: "forward", label: "Forward Loop", desc: "Classic 1 → N infinite loop" },
  { id: "boomerang", label: "Boomerang", desc: "Ping-pong forward & reverse" },
  { id: "reverse", label: "Reverse Loop", desc: "Play backwards N → 1" },
  { id: "crossfade_loop", label: "Seamless Fade", desc: "Crossfade tail back to start" },
  { id: "once", label: "Play Once", desc: "Single pass, stops on end" },
];

export const MOTION_OPTIONS: { id: MotionType; label: string; desc: string }[] = [
  { id: "none", label: "Static", desc: "No synthetic camera movement" },
  { id: "ken_burns", label: "Ken Burns", desc: "Smooth diagonal pan + zoom" },
  { id: "zoom_in", label: "Zoom In", desc: "Ease-in push toward center" },
  { id: "zoom_out", label: "Zoom Out", desc: "Pull back reveal" },
  { id: "pan_left", label: "Pan Left", desc: "Horizontal camera glide left" },
  { id: "pan_right", label: "Pan Right", desc: "Horizontal camera glide right" },
  { id: "pan_up", label: "Pan Up", desc: "Vertical tilt upward" },
  { id: "pan_down", label: "Pan Down", desc: "Vertical tilt downward" },
  { id: "bounce", label: "Bounce", desc: "Playful vertical pop" },
  { id: "shake", label: "Camera Shake", desc: "High-energy handheld wiggle" },
  { id: "pulse", label: "Pulse", desc: "Rhythmic beat zoom in & out" },
  { id: "tilt_sway", label: "Tilt Sway", desc: "Subtle Dutch roll oscillation" },
  { id: "float_orbit", label: "Float Orbit", desc: "Smooth figure-8 sticker hover" },
];

export const MOTION_EASING_OPTIONS: { id: MotionEasing; label: string }[] = [
  { id: "ease_in_out", label: "Ease In-Out" },
  { id: "linear", label: "Linear" },
  { id: "ease_out", label: "Ease Out" },
  { id: "elastic", label: "Elastic" },
  { id: "custom_bezier", label: "Cubic Bezier" },
];

export const FILTER_PRESETS: { id: FilterPreset; label: string; swatch: string; expertOnly?: boolean }[] = [
  { id: "none", label: "Original", swatch: "from-zinc-700 to-zinc-800" },
  { id: "vivid", label: "Vivid", swatch: "from-amber-400 to-rose-500" },
  { id: "vintage", label: "Vintage", swatch: "from-amber-700 to-stone-700" },
  { id: "bw", label: "B & W", swatch: "from-zinc-200 to-zinc-900" },
  { id: "sepia", label: "Sepia", swatch: "from-amber-300 to-amber-900" },
  { id: "warm", label: "Warm", swatch: "from-orange-400 to-red-600" },
  { id: "cool", label: "Cool", swatch: "from-sky-400 to-cyan-700" },
  { id: "cyberpunk", label: "Neon", swatch: "from-cyan-400 to-rose-600" },
  { id: "duotone", label: "Duotone", swatch: "from-amber-500 to-zinc-900", expertOnly: true },
  { id: "noir", label: "Noir", swatch: "from-zinc-100 to-black", expertOnly: true },
  { id: "sunset", label: "Sunset", swatch: "from-orange-400 to-amber-700", expertOnly: true },
  { id: "pastel", label: "Pastel", swatch: "from-teal-200 to-amber-200", expertOnly: true },
];

export const TRANSITION_OPTIONS: { id: TransitionType; label: string }[] = [
  { id: "none", label: "Cut (None)" },
  { id: "crossfade", label: "Crossfade" },
  { id: "slide_left", label: "Slide Left" },
  { id: "slide_right", label: "Slide Right" },
  { id: "slide_up", label: "Slide Up" },
  { id: "zoom_in", label: "Zoom Dissolve" },
];

export interface GifStudioDesktopBridge {
  platform?: string;
  arch?: string;
  isDesktopApp?: boolean;
  setCloseConfirmReady?: (ready: boolean) => void;
  onCloseRequest?: (callback: () => void) => () => void;
  ackCloseRequest?: () => void;
  respondCloseRequest?: (confirmed: boolean) => void;
}

declare global {
  interface Window {
    gifStudioDesktop?: GifStudioDesktopBridge;
  }
}
