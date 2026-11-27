"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  ArrowsInSimple,
  ArrowsOutSimple,
  BookOpenText,
  CloudArrowUp,
  LoopModeGlyph,
  Pause,
  Play,
  Scales,
  SkipBack,
  SkipForward,
  Sparkle,
} from "@/components/StudioIcons";
import { resolveMediaUrl } from "@/lib/api";
import type {
  AspectRatioPreset,
  BorderConfig,
  CropAspectLock,
  CropConfig,
  FilterConfig,
  FitMode,
  FrameItem,
  LivePlaybackSnapshot,
  LoopMode,
  MotionConfig,
  RotateDegrees,
  TextBadgeLayer,
  TextOverlayConfig,
} from "@/types/studio";

interface CanvasPreviewProps {
  frames: FrameItem[];
  aspectRatio: AspectRatioPreset;
  fitMode: FitMode;
  bgColor: string;
  loopMode: LoopMode;
  speedMultiplier?: number;
  endHoldMs?: number;
  crossfadeLoopMs?: number;
  globalMotion: MotionConfig;
  globalFilters: FilterConfig;
  globalText: TextOverlayConfig;
  border: BorderConfig;
  transparentBg: boolean;
  selectedFrameUid: string | null;
  onSelectFrame: (uid: string) => void;
  onTriggerUpload: () => void;
  onLoadSamples: () => void;
  onLoadMotionSamples?: () => void;
  onLoadVideoSample?: () => void;
  isLoadingSamples: boolean;
  onChangeAspectRatio: (ratio: AspectRatioPreset) => void;
  onChangeFitMode: (mode: FitMode) => void;
  mobileStageCompact?: boolean;
  onToggleMobileStageCompact?: () => void;
  isEditingCrop?: boolean;
  cropAspectLock?: CropAspectLock;
  onUpdateCrop?: (crop: CropConfig) => void;
  onCommitCrop?: () => void;
  isEditingMotion?: boolean;
  motionAnchor?: { x: number; y: number };
  onUpdateMotionAnchor?: (anchor: { x: number; y: number }) => void;
  isEditingText?: boolean;
  activeTextOverlay?: TextOverlayConfig;
  onUpdateTextPosition?: (
    layerIdx: number,
    pos: { x_pct: number; y_pct: number }
  ) => void;
  showSafeGuides?: boolean;
  seekToMsRequest?: {
    ms?: number;
    frameUid?: string;
    frameRatio?: number;
    play?: boolean;
    nonce: number;
  } | null;
  onEmitPlayback?: (snap: LivePlaybackSnapshot) => void;
  onActivePlayingChange?: (frameUid: string | null, isPlaying: boolean) => void;
  onOpenGuide?: (section: "guide" | "license") => void;
}

interface PlaybackSegment {
  frame: FrameItem;
  prevFrame: FrameItem | null;
  startMs: number;
  endMs: number;
  reverseMotion: boolean;
  skipTransitionIn?: boolean;
  isCrossfadeLoopTail?: boolean;
  nextFrameForTail?: FrameItem;
}

function easeInOut(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
}

function solveCubicBezier(
  x: number,
  bezier: [number, number, number, number] = [0.42, 0, 0.58, 1]
): number {
  const x1 = Math.max(0, Math.min(1, bezier[0]));
  const y1 = bezier[1];
  const x2 = Math.max(0, Math.min(1, bezier[2]));
  const y2 = bezier[3];
  const t = Math.max(0, Math.min(1, x));
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const sampleX = (u: number) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
  };
  const sampleY = (u: number) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
  };

  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 14; i++) {
    u = (lo + hi) * 0.5;
    const sx = sampleX(u);
    if (Math.abs(sx - t) < 1e-4) break;
    if (sx < t) lo = u;
    else hi = u;
  }
  return sampleY(u);
}

function applyMotionEasing(
  t: number,
  easing: MotionConfig["easing"] = "ease_in_out",
  bezier?: [number, number, number, number]
): number {
  const c = Math.max(0, Math.min(1, t));
  if (easing === "linear") return c;
  if (easing === "ease_out") return 1 - Math.pow(1 - c, 3);
  if (easing === "elastic") {
    if (c === 0 || c === 1) return c;
    return 1 - Math.pow(2, -8 * c) * Math.cos(c * Math.PI * 2.5) * (1 - c);
  }
  if (easing === "custom_bezier" && bezier) {
    return solveCubicBezier(c, bezier);
  }
  return easeInOut(c);
}

function getTransformedDimensions(frame: FrameItem, includeCrop = true): { w: number; h: number } {
  const baseW = frame.media.width || 1;
  const baseH = frame.media.height || 1;
  const rotatedSwap = frame.rotate === 90 || frame.rotate === 270;
  const ow = rotatedSwap ? baseH : baseW;
  const oh = rotatedSwap ? baseW : baseH;
  if (includeCrop && frame.crop) {
    return {
      w: Math.max(2, Math.round(ow * frame.crop.w)),
      h: Math.max(2, Math.round(oh * frame.crop.h)),
    };
  }
  return { w: ow, h: oh };
}

function getCanvasDimensions(
  aspectRatio: AspectRatioPreset,
  firstFrame?: FrameItem
): { w: number; h: number } {
  const maxDim = 540;
  const ratioMap: Record<string, [number, number]> = {
    "1:1": [1, 1],
    "9:16": [9, 16],
    "16:9": [16, 9],
    "4:5": [4, 5],
    "4:3": [4, 3],
  };

  let rw = 1;
  let rh = 1;
  if (aspectRatio === "original" && firstFrame) {
    const dims = getTransformedDimensions(firstFrame, true);
    rw = dims.w;
    rh = dims.h;
  } else if (ratioMap[aspectRatio]) {
    [rw, rh] = ratioMap[aspectRatio];
  }

  if (rw >= rh) {
    return { w: maxDim, h: Math.round(maxDim * (rh / rw)) };
  }
  return { w: Math.round(maxDim * (rw / rh)), h: maxDim };
}

function computeFilterString(f: FilterConfig): string {
  const parts: string[] = [];
  let b = f.brightness;
  let c = f.contrast;
  let s = f.saturation;
  let sepia = 0;
  let hue = 0;

  if (f.preset === "bw") s = 0;
  else if (f.preset === "noir") {
    s = 0;
    c *= 1.55;
    b *= 0.92;
  } else if (f.preset === "sepia") sepia = 0.85;
  else if (f.preset === "duotone") {
    sepia = 0.65;
    c *= 1.3;
    s *= 1.35;
  } else if (f.preset === "sunset") {
    sepia = 0.35;
    s *= 1.35;
    b *= 1.04;
    hue = -8;
  } else if (f.preset === "pastel") {
    s *= 0.75;
    b *= 1.12;
    c *= 0.86;
  } else if (f.preset === "vintage") {
    sepia = 0.35;
    c *= 0.92;
    b *= 1.05;
  } else if (f.preset === "vivid") {
    s *= 1.45;
    c *= 1.15;
  } else if (f.preset === "cool") {
    hue = -12;
    s *= 1.1;
  } else if (f.preset === "warm") {
    sepia = 0.2;
    s *= 1.15;
  } else if (f.preset === "cyberpunk") {
    c *= 1.25;
    s *= 1.45;
    hue = 15;
  }

  const temp = f.temperature ?? 0;
  if (Math.abs(temp) > 0.02) {
    if (temp > 0) sepia = Math.min(1, sepia + temp * 0.25);
    else hue -= temp * 14;
  }
  const sharp = f.sharpen ?? 0;
  if (sharp > 0.02) {
    c *= 1 + sharp * 0.14;
  }
  hue += f.hue_shift ?? 0;

  if (Math.abs(b - 1) > 0.01) parts.push(`brightness(${b.toFixed(2)})`);
  if (Math.abs(c - 1) > 0.01) parts.push(`contrast(${c.toFixed(2)})`);
  if (Math.abs(s - 1) > 0.01) parts.push(`saturate(${s.toFixed(2)})`);
  if (sepia > 0) parts.push(`sepia(${sepia.toFixed(2)})`);
  if (hue !== 0) parts.push(`hue-rotate(${Math.round(hue)}deg)`);
  if (f.blur > 0.05) parts.push(`blur(${(f.blur * 0.7).toFixed(1)}px)`);

  return parts.length ? parts.join(" ") : "none";
}

function buildOrientedSource(
  img: HTMLImageElement,
  rotate: RotateDegrees,
  flipH: boolean,
  flipV: boolean,
  straighten: number,
  cache: Map<string, HTMLCanvasElement>,
  cacheKey: string
): HTMLCanvasElement | HTMLImageElement {
  if (rotate === 0 && !flipH && !flipV && Math.abs(straighten) <= 0.05) {
    return img;
  }
  const sKey = straighten.toFixed(1);
  const fullKey = `${cacheKey}_${rotate}_${flipH ? 1 : 0}_${flipV ? 1 : 0}_${sKey}`;
  const cached = cache.get(fullKey);
  if (cached) return cached;

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const swap = rotate === 90 || rotate === 270;
  const ow = swap ? ih : iw;
  const oh = swap ? iw : ih;

  const off = document.createElement("canvas");
  off.width = ow;
  off.height = oh;
  const octx = off.getContext("2d");
  if (octx) {
    octx.translate(ow / 2, oh / 2);
    if (Math.abs(straighten) > 0.05) {
      const rad = Math.abs((straighten * Math.PI) / 180);
      const cover = Math.max(1, Math.abs(Math.cos(rad)) + (ow / Math.max(1, oh)) * Math.abs(Math.sin(rad)));
      octx.scale(cover, cover);
      octx.rotate((straighten * Math.PI) / 180);
    }
    octx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    octx.rotate((rotate * Math.PI) / 180);
    octx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  }
  cache.set(fullKey, off);
  return off;
}

function drawFittedImage(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  crop: CropConfig | null,
  w: number,
  h: number,
  fitMode: FitMode,
  bgColor: string,
  motion: MotionConfig,
  t: number,
  transparentBg = false
) {
  const fullW = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const fullH = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (!fullW || !fullH) return;

  const sx = crop ? Math.min(fullW - 2, Math.max(0, crop.x * fullW)) : 0;
  const sy = crop ? Math.min(fullH - 2, Math.max(0, crop.y * fullH)) : 0;
  const sw = crop ? Math.max(2, Math.min(fullW - sx, crop.w * fullW)) : fullW;
  const sh = crop ? Math.max(2, Math.min(fullH - sy, crop.h * fullH)) : fullH;

  const eased = applyMotionEasing(t, motion.easing ?? "ease_in_out", motion.bezier);
  let zoom = 1;
  let dxFrac = 0;
  let dyFrac = 0;
  let tiltRad = 0;
  const intensity = motion.intensity;
  const anchorX = motion.anchor_x ?? 0.5;
  const anchorY = motion.anchor_y ?? 0.5;

  switch (motion.type) {
    case "zoom_in":
      zoom = 1 + 0.45 * intensity * eased;
      break;
    case "zoom_out":
      zoom = 1 + 0.45 * intensity * (1 - eased);
      break;
    case "pan_left":
      zoom = 1 + 0.3 * intensity;
      dxFrac = (0.5 - eased) * 0.22 * intensity;
      break;
    case "pan_right":
      zoom = 1 + 0.3 * intensity;
      dxFrac = (eased - 0.5) * 0.22 * intensity;
      break;
    case "pan_up":
      zoom = 1 + 0.3 * intensity;
      dyFrac = (0.5 - eased) * 0.22 * intensity;
      break;
    case "pan_down":
      zoom = 1 + 0.3 * intensity;
      dyFrac = (eased - 0.5) * 0.22 * intensity;
      break;
    case "ken_burns":
      zoom = 1 + 0.4 * intensity * eased;
      dxFrac = (eased - 0.5) * 0.16 * intensity;
      dyFrac = (0.5 - eased) * 0.12 * intensity;
      break;
    case "bounce":
      zoom = 1 + 0.14 * intensity * Math.abs(Math.sin(Math.PI * t * 2));
      dyFrac = -0.1 * intensity * Math.abs(Math.sin(Math.PI * t * 2));
      break;
    case "shake":
      zoom = 1 + 0.18 * intensity;
      dxFrac = 0.05 * intensity * Math.sin(2 * Math.PI * t * 4 + 0.3);
      dyFrac = 0.05 * intensity * Math.cos(2 * Math.PI * t * 5 + 1.1);
      break;
    case "pulse":
      zoom = 1 + 0.28 * intensity * Math.sin(Math.PI * t);
      break;
    case "tilt_sway":
      zoom = 1 + 0.2 * intensity;
      tiltRad = ((4.5 * intensity * Math.sin(2 * Math.PI * t)) * Math.PI) / 180;
      break;
    case "float_orbit":
      zoom = 1 + 0.2 * intensity;
      dxFrac = 0.06 * intensity * Math.sin(2 * Math.PI * t);
      dyFrac = 0.04 * intensity * Math.cos(2 * Math.PI * t * 2);
      break;
    default:
      break;
  }

  ctx.save();
  const focusShiftX = (0.5 - anchorX) * (zoom - 1) * w * 0.55;
  const focusShiftY = (0.5 - anchorY) * (zoom - 1) * h * 0.55;
  ctx.translate(w / 2 + dxFrac * w + focusShiftX, h / 2 + dyFrac * h + focusShiftY);
  if (tiltRad !== 0) ctx.rotate(tiltRad);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2, -h / 2);

  if (fitMode === "fill") {
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(source, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    if (fitMode === "blur_pad" && !transparentBg) {
      ctx.save();
      const bgScale = Math.max(w / sw, h / sh);
      const bw = sw * bgScale;
      const bh = sh * bgScale;
      ctx.filter = "blur(18px) brightness(0.65)";
      ctx.drawImage(source, sx, sy, sw, sh, (w - bw) / 2, (h - bh) / 2, bw, bh);
      ctx.restore();
    } else if (!transparentBg) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    const fgScale = Math.min(w / sw, h / sh);
    const fw = sw * fgScale;
    const fh = sh * fgScale;
    ctx.drawImage(source, sx, sy, sw, sh, (w - fw) / 2, (h - fh) / 2, fw, fh);
  }

  ctx.restore();
}

function applyPreviewBorderAndCorners(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  border: BorderConfig,
  scratchRef: React.MutableRefObject<HTMLCanvasElement | null>,
  transparentBg = false
) {
  const scale = w / 720;
  const innerPad = Math.max(0, Math.round((border.inner_padding ?? 0) * scale));
  if ((border.style !== "none" && border.thickness > 0) || innerPad > 0) {
    const t = border.style !== "none" ? Math.max(0, Math.round(border.thickness * scale)) : 0;
    let left = t + innerPad;
    let top = t + innerPad;
    let right = t + innerPad;
    let bottom = t + innerPad;
    let frameBg = border.color || "#FFFFFF";

    if (border.style === "polaroid") {
      bottom = Math.max(t + 6, Math.round(t * 2.6)) + innerPad;
    } else if (border.style === "film") {
      top = Math.max(12, Math.round(t * 1.45)) + innerPad;
      bottom = top;
      left = innerPad;
      right = innerPad;
      frameBg = "#101014";
    }

    const innerW = Math.max(8, w - left - right);
    const innerH = Math.max(8, h - top - bottom);

    if (!scratchRef.current) {
      scratchRef.current = document.createElement("canvas");
    }
    const scratch = scratchRef.current;
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d");
    if (sctx) {
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(canvas, 0, 0);

      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = frameBg;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(scratch, 0, 0, w, h, left, top, innerW, innerH);

      if (border.style === "polaroid") {
        ctx.strokeStyle = "rgba(0,0,0,0.09)";
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, innerW - 1, innerH - 1);
      } else if (border.style === "film") {
        const holeH = Math.max(6, Math.round(top * 0.56));
        const holeW = Math.max(4, Math.round(top * 0.45));
        const pitch = Math.max(holeW * 2, Math.round(w / 11));
        const holeYTop = Math.round((top - holeH) / 2);
        const holeYBot = h - top + holeYTop;
        if (transparentBg) {
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "#000000";
        } else {
          ctx.fillStyle = "rgba(235, 235, 240, 0.82)";
        }
        for (let hx = Math.round(pitch * 0.33); hx < w - holeW; hx += pitch) {
          ctx.beginPath();
          ctx.roundRect(hx, holeYTop, holeW, holeH, 2);
          ctx.roundRect(hx, holeYBot, holeW, holeH, 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  if (border.corner_radius > 0) {
    const r = Math.min(
      Math.round(border.corner_radius * scale),
      Math.floor(Math.min(w, h) / 2)
    );
    if (r > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      ctx.fill();
      ctx.restore();
    }
  }

  if (border.shadow && (transparentBg || border.corner_radius > 0)) {
    const pad = Math.max(6, Math.round(14 * scale));
    if (!scratchRef.current) {
      scratchRef.current = document.createElement("canvas");
    }
    const scratch = scratchRef.current;
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d");
    if (sctx) {
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.shadowColor = "rgba(0, 0, 0, 0.48)";
      ctx.shadowBlur = pad;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(pad * 0.25);
      ctx.drawImage(scratch, 0, 0, w, h, pad, pad, Math.max(8, w - pad * 2), Math.max(8, h - pad * 2));
      ctx.restore();
    }
  }
}

type DragHandle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function resolveTargetRatio(
  lock: CropAspectLock,
  canvasW: number,
  canvasH: number
): number | null {
  if (lock === "free") return null;
  if (lock === "canvas") return canvasW / canvasH;
  const map: Record<string, number> = {
    "1:1": 1,
    "4:5": 4 / 5,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
  };
  return map[lock] ?? null;
}

export function CanvasPreview({
  frames,
  aspectRatio,
  fitMode,
  bgColor,
  loopMode,
  speedMultiplier = 1,
  endHoldMs = 0,
  crossfadeLoopMs = 350,
  globalMotion,
  globalFilters,
  globalText,
  border,
  transparentBg,
  selectedFrameUid,
  onSelectFrame,
  onTriggerUpload,
  onLoadSamples,
  onLoadMotionSamples,
  onLoadVideoSample,
  isLoadingSamples,
  onChangeAspectRatio,
  onChangeFitMode,
  mobileStageCompact = false,
  onToggleMobileStageCompact,
  isEditingCrop = false,
  cropAspectLock = "free",
  onUpdateCrop,
  onCommitCrop,
  isEditingMotion = false,
  motionAnchor,
  onUpdateMotionAnchor,
  isEditingText = false,
  activeTextOverlay,
  onUpdateTextPosition,
  showSafeGuides = false,
  seekToMsRequest,
  onEmitPlayback,
  onActivePlayingChange,
  onOpenGuide,
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const cropAreaRef = useRef<HTMLDivElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const orientedCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const [isPlaying, setIsPlaying] = useState(true);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [loadedTick, setLoadedTick] = useState(0);
  const lastSeekNonceRef = useRef<number | null>(null);
  const lastReportedActiveRef = useRef<{ uid: string | null; isPlaying: boolean }>({
    uid: null,
    isPlaying: true,
  });

  const selectedFrame = useMemo(
    () => frames.find((f) => f.uid === selectedFrameUid) ?? frames[0] ?? null,
    [frames, selectedFrameUid]
  );

  // Preload frame images & prune stale cache entries
  useEffect(() => {
    let active = true;
    const activeUrls = new Set(frames.map((f) => resolveMediaUrl(f.media.preview_url)));
    for (const cachedUrl of imageCacheRef.current.keys()) {
      if (!activeUrls.has(cachedUrl)) {
        imageCacheRef.current.delete(cachedUrl);
      }
    }
    for (const key of orientedCacheRef.current.keys()) {
      const baseUrl = key.split("_")[0];
      if (!activeUrls.has(baseUrl)) {
        orientedCacheRef.current.delete(key);
      }
    }
    for (const url of activeUrls) {
      if (!imageCacheRef.current.has(url)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (active) setLoadedTick((n) => n + 1);
        };
        img.src = url;
        imageCacheRef.current.set(url, img);
      }
    }
    return () => {
      active = false;
    };
  }, [frames]);

  // Build playback segments honoring loopMode (aligned with backend apply_loop_mode)
  const { segments, totalDurationMs } = useMemo(() => {
    if (frames.length === 0) {
      return { segments: [] as PlaybackSegment[], totalDurationMs: 0 };
    }

    let ordered: { frame: FrameItem; reverseMotion: boolean; skipTransitionIn?: boolean }[] = [];
    if (loopMode === "reverse") {
      ordered = [...frames]
        .reverse()
        .map((frame) => ({ frame, reverseMotion: true, skipTransitionIn: true }));
    } else if (loopMode === "boomerang") {
      const fwd = frames.map((frame) => ({ frame, reverseMotion: false }));
      if (frames.length === 1) {
        const singleMotion = (frames[0].motion ?? globalMotion).type;
        ordered =
          singleMotion !== "none"
            ? [...fwd, { frame: frames[0], reverseMotion: true, skipTransitionIn: true }]
            : fwd;
      } else if (frames.length === 2) {
        const hasMotionOrTrans =
          (frames[0].motion ?? globalMotion).type !== "none" ||
          (frames[1].motion ?? globalMotion).type !== "none" ||
          frames[1].transition_in !== "none";
        ordered = hasMotionOrTrans
          ? [...fwd, { frame: frames[1], reverseMotion: true, skipTransitionIn: true }]
          : fwd;
      } else {
        const rev = frames
          .slice(1, -1)
          .reverse()
          .map((frame) => ({ frame, reverseMotion: true, skipTransitionIn: true }));
        ordered = [...fwd, ...rev];
      }
    } else {
      ordered = frames.map((frame) => ({ frame, reverseMotion: false }));
    }

    const speed = Math.max(0.25, Math.min(3, speedMultiplier));
    const built: PlaybackSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < ordered.length; i++) {
      const curr = ordered[i];
      const prev = i > 0 ? ordered[i - 1].frame : null;
      const baseDur = Math.max(40, Math.round(curr.frame.duration_ms / speed));
      const holdExtra = i === ordered.length - 1 ? Math.max(0, endHoldMs) : 0;
      const dur = baseDur + holdExtra;
      built.push({
        frame: curr.frame,
        prevFrame: prev,
        startMs: cursor,
        endMs: cursor + dur,
        reverseMotion: curr.reverseMotion,
        skipTransitionIn: curr.skipTransitionIn,
        isCrossfadeLoopTail:
          loopMode === "crossfade_loop" &&
          i === ordered.length - 1 &&
          ordered.length >= 2,
        nextFrameForTail: ordered[0].frame,
      });
      cursor += dur;
    }

    return { segments: built, totalDurationMs: cursor };
  }, [frames, loopMode, globalMotion, speedMultiplier, endHoldMs]);

  useEffect(() => {
    if (!seekToMsRequest || seekToMsRequest.nonce === lastSeekNonceRef.current) return;
    lastSeekNonceRef.current = seekToMsRequest.nonce;
    let targetMs = seekToMsRequest.ms ?? 0;
    if (seekToMsRequest.frameUid) {
      const seg = segments.find((s) => s.frame.uid === seekToMsRequest.frameUid);
      if (seg) {
        const span = Math.max(1, seg.endMs - seg.startMs);
        const ratio = Math.max(0, Math.min(0.999, seekToMsRequest.frameRatio ?? 0));
        const adjustedRatio = seg.reverseMotion ? 1 - ratio : ratio;
        targetMs = seg.startMs + adjustedRatio * span;
      }
    }
    const clamped = Math.max(0, Math.min(Math.max(0, totalDurationMs - 1), targetMs));
    const raf = requestAnimationFrame(() => {
      setPlayheadMs(clamped);
      if (typeof seekToMsRequest.play === "boolean") {
        setIsPlaying(seekToMsRequest.play);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [seekToMsRequest, totalDurationMs, segments]);

  const effectivePlayheadMs = useMemo(() => {
    if (totalDurationMs <= 0) return 0;
    return Math.min(playheadMs, totalDurationMs - 1);
  }, [playheadMs, totalDurationMs]);

  const activeSegment = useMemo(() => {
    if (segments.length === 0) return null;
    return (
      segments.find(
        (s) => effectivePlayheadMs >= s.startMs && effectivePlayheadMs < s.endMs
      ) || segments[0]
    );
  }, [segments, effectivePlayheadMs]);

  const activeFrameIndex = useMemo(() => {
    if (!activeSegment) return -1;
    return frames.findIndex((f) => f.uid === activeSegment.frame.uid);
  }, [activeSegment, frames]);

  const linearFrameOffsets = useMemo(() => {
    const entries: { uid: string; start: number; dur: number }[] = [];
    let cursor = 0;
    for (const f of frames) {
      const dur = Math.max(1, f.duration_ms);
      entries.push({ uid: f.uid, start: cursor, dur });
      cursor += dur;
    }
    return { entries, total: Math.max(1, cursor) };
  }, [frames]);

  // Emit smooth live playhead snapshot without triggering parent React re-renders
  useEffect(() => {
    const activeUid = activeSegment?.frame.uid ?? null;
    let frameProgress = 0;
    let timelineProgress = 0;
    if (activeSegment && activeFrameIndex >= 0) {
      const segSpan = Math.max(1, activeSegment.endMs - activeSegment.startMs);
      const rawFrac = Math.max(
        0,
        Math.min(1, (effectivePlayheadMs - activeSegment.startMs) / segSpan)
      );
      frameProgress = activeSegment.reverseMotion ? 1 - rawFrac : rawFrac;
      const entry = linearFrameOffsets.entries[activeFrameIndex];
      if (entry) {
        timelineProgress = Math.max(
          0,
          Math.min(
            1,
            (entry.start + frameProgress * entry.dur) / linearFrameOffsets.total
          )
        );
      }
    }

    onEmitPlayback?.({
      activeFrameUid: activeUid,
      activeFrameIndex,
      frameProgress,
      timelineProgress,
      playheadMs: effectivePlayheadMs,
      totalDurationMs,
      isPlaying,
    });

    if (
      lastReportedActiveRef.current.uid !== activeUid ||
      lastReportedActiveRef.current.isPlaying !== isPlaying
    ) {
      lastReportedActiveRef.current = { uid: activeUid, isPlaying };
      onActivePlayingChange?.(activeUid, isPlaying);
    }
  }, [
    activeSegment,
    activeFrameIndex,
    effectivePlayheadMs,
    totalDurationMs,
    isPlaying,
    linearFrameOffsets,
    onEmitPlayback,
    onActivePlayingChange,
  ]);

  const togglePlay = useCallback(() => {
    if (!isPlaying && loopMode === "once" && effectivePlayheadMs >= totalDurationMs - 2) {
      setPlayheadMs(0);
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying, loopMode, effectivePlayheadMs, totalDurationMs]);

  // Keyboard playback shortcuts (Space = play/pause, Left/Right = step)
  useEffect(() => {
    if (frames.length === 0 || isEditingCrop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        if (tag === "BUTTON" && target !== playButtonRef.current) return;
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        setIsPlaying(false);
        const currIdx = Math.max(0, activeFrameIndex);
        const nextIdx = (currIdx - 1 + frames.length) % frames.length;
        const targetSeg = segments.find((s) => s.frame.uid === frames[nextIdx].uid);
        if (targetSeg) setPlayheadMs(targetSeg.startMs + 1);
        onSelectFrame(frames[nextIdx].uid);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setIsPlaying(false);
        const currIdx = Math.max(0, activeFrameIndex);
        const nextIdx = (currIdx + 1) % frames.length;
        const targetSeg = segments.find((s) => s.frame.uid === frames[nextIdx].uid);
        if (targetSeg) setPlayheadMs(targetSeg.startMs + 1);
        onSelectFrame(frames[nextIdx].uid);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frames, activeFrameIndex, segments, onSelectFrame, togglePlay, isEditingCrop]);

  // Animation loop (~30fps cap so heavy filters/blur keep UI controls snappy)
  useEffect(() => {
    if (!isPlaying || isEditingCrop || totalDurationMs <= 0) return;

    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = now - lastTs;
      if (dt >= 30) {
        lastTs = now;
        setPlayheadMs((prev) => {
          const clampedPrev = prev >= totalDurationMs ? 0 : prev;
          const next = clampedPrev + dt;
          if (next >= totalDurationMs) {
            if (loopMode === "once") {
              setIsPlaying(false);
              return totalDurationMs - 1;
            }
            return next % totalDurationMs;
          }
          return next;
        });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isEditingCrop, totalDurationMs, loopMode]);

  const { w: canvasW, h: canvasH } = useMemo(
    () => getCanvasDimensions(aspectRatio, frames[0]),
    [aspectRatio, frames]
  );

  // Compute oriented image placement inside canvas when editing crop
  const cropImgRect = useMemo(() => {
    if (!isEditingCrop || !selectedFrame) return null;
    const dims = getTransformedDimensions(selectedFrame, false);
    const scale = Math.min(canvasW / dims.w, canvasH / dims.h);
    const rw = dims.w * scale;
    const rh = dims.h * scale;
    return {
      x: (canvasW - rw) / 2,
      y: (canvasH - rh) / 2,
      w: rw,
      h: rh,
      orientedW: dims.w,
      orientedH: dims.h,
    };
  }, [isEditingCrop, selectedFrame, canvasW, canvasH]);

  // Draw current frame (or full uncropped oriented frame in Crop Edit mode)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    if (!transparentBg) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    if (isEditingCrop && selectedFrame && cropImgRect) {
      const url = resolveMediaUrl(selectedFrame.media.preview_url);
      const img = imageCacheRef.current.get(url);
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const source = buildOrientedSource(
        img,
        selectedFrame.rotate,
        selectedFrame.flip_h,
        selectedFrame.flip_v,
        selectedFrame.straighten ?? 0,
        orientedCacheRef.current,
        url
      );
      ctx.drawImage(source, cropImgRect.x, cropImgRect.y, cropImgRect.w, cropImgRect.h);
      return;
    }

    if (segments.length === 0) return;

    const seg =
      segments.find(
        (s) => effectivePlayheadMs >= s.startMs && effectivePlayheadMs < s.endMs
      ) || segments[segments.length - 1];

    const segDur = Math.max(1, seg.endMs - seg.startMs);
    let localT = (effectivePlayheadMs - seg.startMs) / segDur;
    if (seg.reverseMotion) localT = 1 - localT;

    const frame = seg.frame;
    const motion = frame.motion ?? globalMotion;
    const filters = frame.filters ?? globalFilters;
    const textCfg = frame.text_overlay ?? globalText;

    const currUrl = resolveMediaUrl(frame.media.preview_url);
    const currImg = imageCacheRef.current.get(currUrl);
    if (!currImg || !currImg.complete || currImg.naturalWidth === 0) return;
    const currSource = buildOrientedSource(
      currImg,
      frame.rotate,
      frame.flip_h,
      frame.flip_v,
      frame.straighten ?? 0,
      orientedCacheRef.current,
      currUrl
    );

    ctx.save();
    ctx.filter = computeFilterString(filters);

    const elapsedInSeg = effectivePlayheadMs - seg.startMs;
    const effTransMs = frame.transition_ms / Math.max(0.25, speedMultiplier);
    const transMs = Math.min(effTransMs, segDur * 0.75);
    if (
      !seg.skipTransitionIn &&
      seg.prevFrame &&
      frame.transition_in !== "none" &&
      elapsedInSeg < transMs
    ) {
      const prevUrl = resolveMediaUrl(seg.prevFrame.media.preview_url);
      const prevImg = imageCacheRef.current.get(prevUrl);
      const transT = easeInOut(elapsedInSeg / Math.max(1, transMs));

      if (prevImg && prevImg.complete && prevImg.naturalWidth > 0) {
        const prevSource = buildOrientedSource(
          prevImg,
          seg.prevFrame.rotate,
          seg.prevFrame.flip_h,
          seg.prevFrame.flip_v,
          seg.prevFrame.straighten ?? 0,
          orientedCacheRef.current,
          prevUrl
        );
        drawFittedImage(
          ctx,
          prevSource,
          seg.prevFrame.crop,
          canvasW,
          canvasH,
          fitMode,
          bgColor,
          seg.prevFrame.motion ?? globalMotion,
          1,
          transparentBg
        );

        ctx.save();
        if (frame.transition_in === "crossfade") {
          ctx.globalAlpha = transT;
        } else if (frame.transition_in === "slide_left") {
          ctx.translate(canvasW * (1 - transT), 0);
        } else if (frame.transition_in === "slide_right") {
          ctx.translate(-canvasW * (1 - transT), 0);
        } else if (frame.transition_in === "slide_up") {
          ctx.translate(0, canvasH * (1 - transT));
        } else if (frame.transition_in === "zoom_in") {
          const s = 0.65 + 0.35 * transT;
          ctx.globalAlpha = transT;
          ctx.translate(canvasW / 2, canvasH / 2);
          ctx.scale(s, s);
          ctx.translate(-canvasW / 2, -canvasH / 2);
        }
        drawFittedImage(
          ctx,
          currSource,
          frame.crop,
          canvasW,
          canvasH,
          fitMode,
          bgColor,
          motion,
          localT,
          transparentBg
        );
        ctx.restore();
      } else {
        drawFittedImage(
          ctx,
          currSource,
          frame.crop,
          canvasW,
          canvasH,
          fitMode,
          bgColor,
          motion,
          localT,
          transparentBg
        );
      }
    } else {
      drawFittedImage(
        ctx,
        currSource,
        frame.crop,
        canvasW,
        canvasH,
        fitMode,
        bgColor,
        motion,
        localT,
        transparentBg
      );
    }

    if (seg.isCrossfadeLoopTail && seg.nextFrameForTail) {
      const tailMs = Math.min(
        crossfadeLoopMs / Math.max(0.25, speedMultiplier),
        segDur * 0.5
      );
      const remaining = seg.endMs - effectivePlayheadMs;
      if (remaining < tailMs) {
        const nextUrl = resolveMediaUrl(seg.nextFrameForTail.media.preview_url);
        const nextImg = imageCacheRef.current.get(nextUrl);
        if (nextImg && nextImg.complete && nextImg.naturalWidth > 0) {
          const nextSource = buildOrientedSource(
            nextImg,
            seg.nextFrameForTail.rotate,
            seg.nextFrameForTail.flip_h,
            seg.nextFrameForTail.flip_v,
            seg.nextFrameForTail.straighten ?? 0,
            orientedCacheRef.current,
            nextUrl
          );
          ctx.save();
          ctx.globalAlpha = easeInOut(1 - remaining / Math.max(1, tailMs));
          drawFittedImage(
            ctx,
            nextSource,
            seg.nextFrameForTail.crop,
            canvasW,
            canvasH,
            fitMode,
            bgColor,
            seg.nextFrameForTail.motion ?? globalMotion,
            0,
            transparentBg
          );
          ctx.restore();
        }
      }
    }

    ctx.restore();

    const pixelate = filters.pixelate ?? 0;
    if (pixelate >= 2) {
      if (!scratchCanvasRef.current) {
        scratchCanvasRef.current = document.createElement("canvas");
      }
      const scratch = scratchCanvasRef.current;
      const pw = Math.max(8, Math.floor(canvasW / pixelate));
      const ph = Math.max(8, Math.floor(canvasH / pixelate));
      scratch.width = pw;
      scratch.height = ph;
      const sctx = scratch.getContext("2d");
      if (sctx) {
        sctx.imageSmoothingEnabled = false;
        sctx.clearRect(0, 0, pw, ph);
        sctx.drawImage(canvas, 0, 0, pw, ph);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(scratch, 0, 0, pw, ph, 0, 0, canvasW, canvasH);
        ctx.restore();
      }
    }

    const chromatic = filters.chromatic ?? 0;
    if (chromatic > 0.02) {
      const offset = Math.max(1, Math.round(canvasW * 0.012 * chromatic));
      if (!scratchCanvasRef.current) {
        scratchCanvasRef.current = document.createElement("canvas");
      }
      const scratch = scratchCanvasRef.current;
      scratch.width = canvasW;
      scratch.height = canvasH;
      const sctx = scratch.getContext("2d");
      if (sctx) {
        sctx.clearRect(0, 0, canvasW, canvasH);
        sctx.drawImage(canvas, 0, 0);
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.drawImage(scratch, offset, 0);
        ctx.drawImage(scratch, -offset, 0);
        ctx.restore();
      }
    }

    if (filters.glitch > 0.02) {
      const sliceY = ((Math.floor(effectivePlayheadMs / 80) * 73) % Math.max(20, canvasH - 30));
      const sliceH = Math.max(6, Math.round(14 * filters.glitch));
      const shiftX = (Math.floor(effectivePlayheadMs / 60) % 2 === 0 ? 1 : -1) * Math.round(14 * filters.glitch);
      try {
        const strip = ctx.getImageData(0, sliceY, canvasW, sliceH);
        ctx.putImageData(strip, shiftX, sliceY);
      } catch {
        // Ignore cross-origin taint
      }
    }

    if (filters.vignette > 0.01) {
      const grad = ctx.createRadialGradient(
        canvasW / 2,
        canvasH / 2,
        canvasW * 0.25,
        canvasW / 2,
        canvasH / 2,
        Math.max(canvasW, canvasH) * 0.72
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${(0.75 * filters.vignette).toFixed(2)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    const bloomAmt = filters.bloom ?? 0;
    if (bloomAmt > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.filter = `blur(${Math.round(8 + bloomAmt * 14)}px) brightness(1.3)`;
      ctx.globalAlpha = Math.min(0.65, bloomAmt * 0.6);
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
    }

    const splitTone = filters.split_tone ?? 0;
    if (Math.abs(splitTone) > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = Math.min(0.45, Math.abs(splitTone) * 0.42);
      const grad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
      if (splitTone > 0) {
        grad.addColorStop(0, "#fbbf24");
        grad.addColorStop(1, "#0f766e");
      } else {
        grad.addColorStop(0, "#38bdf8");
        grad.addColorStop(1, "#ea580c");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    const bgMatte = filters.bg_matte ?? "none";
    if (bgMatte !== "none") {
      try {
        const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
        const d = imgData.data;
        let kr = 0.08;
        let kg = 0.78;
        let kb = 0.18;
        if (bgMatte === "chroma_blue") {
          kr = 0.1;
          kg = 0.34;
          kb = 0.88;
        } else if (bgMatte === "edge_flood") {
          const corners = [
            0,
            (canvasW - 1) * 4,
            (canvasH - 1) * canvasW * 4,
            ((canvasH - 1) * canvasW + (canvasW - 1)) * 4,
          ];
          let sr = 0;
          let sg = 0;
          let sb = 0;
          for (const ci of corners) {
            sr += d[ci] / 255;
            sg += d[ci + 1] / 255;
            sb += d[ci + 2] / 255;
          }
          kr = sr / 4;
          kg = sg / 4;
          kb = sb / 4;
        } else if (bgMatte === "custom") {
          const hex = (filters.matte_color ?? "#00FF00").replace("#", "");
          if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            kr = parseInt(hex.slice(0, 2), 16) / 255;
            kg = parseInt(hex.slice(2, 4), 16) / 255;
            kb = parseInt(hex.slice(4, 6), 16) / 255;
          }
        }
        const tol = filters.matte_tolerance ?? 0.22;
        const feather = Math.max(0.005, filters.matte_feather ?? 0.08);
        for (let i = 0; i < d.length; i += 4) {
          const dr = d[i] / 255 - kr;
          const dg = d[i + 1] / 255 - kg;
          const db = d[i + 2] / 255 - kb;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          const aFactor = Math.max(0, Math.min(1, (dist - tol) / feather));
          d[i + 3] = Math.round(d[i + 3] * aFactor);
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Ignore cross-origin taint
      }
    }

    if (filters.film_grain > 0.02) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${(0.06 * filters.film_grain).toFixed(3)})`;
      const step = 12;
      const seed = Math.floor(effectivePlayheadMs / 70);
      for (let y = 0; y < canvasH; y += step) {
        for (let x = ((y + seed * 17) % step); x < canvasW; x += step * 2) {
          if (((x * 31 + y * 17 + seed) % 5) === 0) {
            ctx.fillRect(x, y, 2, 2);
          }
        }
      }
      ctx.restore();
    }

    const drawTextLayer = (layer: TextBadgeLayer) => {
      const rawTxt = layer.text.trim();
      if (!rawTxt) return;
      ctx.save();
      const segProgress = Math.max(0.08, Math.min(1, (effectivePlayheadMs - seg.startMs) / segDur));
      const entrance = layer.entrance ?? "none";
      let txt = rawTxt;
      let alphaScale = layer.opacity ?? 1;
      let slideYOffset = 0;
      let bounceScale = 1;

      if (entrance === "typewriter") {
        const visChars = Math.max(1, Math.ceil(rawTxt.length * segProgress));
        txt = rawTxt.slice(0, visChars);
      } else if (entrance === "fade_in") {
        alphaScale *= Math.min(1, segProgress * 1.45);
      } else if (entrance === "slide_up") {
        const ease = 1 - Math.pow(1 - Math.min(1, segProgress * 1.35), 3);
        alphaScale *= ease;
        slideYOffset = (1 - ease) * 18;
      } else if (entrance === "bounce") {
        const p = Math.min(1, segProgress * 1.5);
        bounceScale = p >= 0.9 ? 1 : 0.72 + 0.36 * Math.sin(p * Math.PI * 0.75);
        alphaScale *= Math.min(1, p * 2);
      }

      const scaledSize = Math.max(12, Math.round(layer.font_size * (canvasW / 720) * bounceScale));
      const fontStack =
        layer.font_family === "serif"
          ? `700 ${scaledSize}px Georgia, "Times New Roman", serif`
          : layer.font_family === "mono"
          ? `700 ${scaledSize}px ui-monospace, Menlo, monospace`
          : layer.font_family === "display"
          ? `900 ${scaledSize}px "Arial Black", Impact, sans-serif`
          : `700 ${scaledSize}px sans-serif`;
      ctx.font = fontStack;
      const align = layer.align ?? "center";
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.globalAlpha = Math.max(0, Math.min(1, alphaScale));
      const maxWrapW = canvasW * 0.86;
      const spacing = layer.letter_spacing ?? 0;
      const spacedTxt =
        spacing > 0
          ? txt
              .split("\n")
              .map((ln) => (ln.length <= 24 ? ln.split("").join(" ".repeat(Math.max(1, Math.min(2, Math.floor(spacing / 3))))) : ln))
              .join("\n")
          : txt;

      const lines: string[] = [];
      for (const paragraph of spacedTxt.split("\n")) {
        const words = paragraph.split(" ");
        let current = words[0] ?? "";
        for (let wi = 1; wi < words.length; wi++) {
          const candidate = `${current} ${words[wi]}`;
          if (ctx.measureText(candidate).width <= maxWrapW) {
            current = candidate;
          } else {
            lines.push(current);
            current = words[wi];
          }
        }
        lines.push(current);
      }
      const lineHeight = scaledSize * 1.2;
      const totalTextH = lines.length * lineHeight;
      const marginX = Math.max(16, canvasW * 0.07);
      const marginY = Math.max(14, canvasH * ((layer.margin_pct ?? 6) / 100));

      const hasXY = layer.x_pct !== null && layer.x_pct !== undefined && layer.y_pct !== null && layer.y_pct !== undefined;
      let baseY = canvasH - marginY - totalTextH / 2;
      if (hasXY) {
        baseY = (layer.y_pct ?? 0.5) * canvasH;
      } else if (layer.position === "top") {
        baseY = marginY + totalTextH / 2;
      } else if (layer.position === "center") {
        baseY = canvasH / 2;
      }
      baseY += slideYOffset;

      const anchorTextX = hasXY
        ? (layer.x_pct ?? 0.5) * canvasW
        : align === "left"
        ? marginX
        : align === "right"
        ? canvasW - marginX
        : canvasW / 2;
      const drawAlign = hasXY ? "center" : align;
      ctx.textAlign = drawAlign;
      const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));

      const rotDeg = layer.rotation ?? 0;
      if (Math.abs(rotDeg) > 0.25) {
        ctx.translate(anchorTextX, baseY);
        ctx.rotate((rotDeg * Math.PI) / 180);
        ctx.translate(-anchorTextX, -baseY);
      }

      if (layer.bg_pill) {
        const px = 16;
        const py = 8;
        const rx =
          drawAlign === "left"
            ? anchorTextX - px
            : drawAlign === "right"
            ? anchorTextX - maxLineW - px
            : anchorTextX - maxLineW / 2 - px;
        const ry = baseY - totalTextH / 2 - py;
        const rw = maxLineW + px * 2;
        const rh = totalTextH + py * 2;
        ctx.fillStyle = "rgba(10,10,14,0.75)";
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, layer.box_radius ?? 14);
        ctx.fill();
      }

      lines.forEach((line, idx) => {
        const ly = baseY - totalTextH / 2 + lineHeight * (idx + 0.5);
        if (layer.shadow ?? true) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(line, anchorTextX + 2, ly + 3);
        }
        if (layer.stroke_width > 0) {
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          ctx.lineWidth = layer.stroke_width * 2;
          ctx.strokeStyle = layer.stroke_color;
          ctx.strokeText(line, anchorTextX, ly);
        }
        ctx.fillStyle = layer.color;
        ctx.fillText(line, anchorTextX, ly);
      });
      ctx.restore();
    };

    drawTextLayer(textCfg);
    if (textCfg.extra_layers?.length) {
      for (const extra of textCfg.extra_layers.slice(0, 3)) {
        drawTextLayer(extra);
      }
    }

    if (filters.preset === "duotone") {
      ctx.save();
      ctx.globalCompositeOperation = "color";
      const dGrad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
      dGrad.addColorStop(0, "rgba(245, 158, 66, 0.72)");
      dGrad.addColorStop(1, "rgba(24, 30, 36, 0.82)");
      ctx.fillStyle = dGrad;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    if (border.style !== "none" || border.corner_radius > 0 || (border.inner_padding ?? 0) > 0 || Boolean(border.shadow)) {
      applyPreviewBorderAndCorners(
        canvas,
        ctx,
        canvasW,
        canvasH,
        border,
        scratchCanvasRef,
        transparentBg
      );
    }
  }, [
    segments,
    effectivePlayheadMs,
    canvasW,
    canvasH,
    fitMode,
    bgColor,
    globalMotion,
    globalFilters,
    globalText,
    border,
    transparentBg,
    loadedTick,
    isEditingCrop,
    selectedFrame,
    cropImgRect,
    speedMultiplier,
    crossfadeLoopMs,
  ]);

  const startCropDrag = (handle: DragHandle, e: React.PointerEvent) => {
    if (!isEditingCrop || !selectedFrame || !cropImgRect || !onUpdateCrop || !cropAreaRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const rect = cropAreaRef.current.getBoundingClientRect();
    const startCrop: CropConfig = selectedFrame.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const minSize = 0.08;
    const imgAspect = cropImgRect.orientedW / Math.max(1, cropImgRect.orientedH);
    const targetRatio = resolveTargetRatio(cropAspectLock, canvasW, canvasH);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / Math.max(1, rect.width);
      const dy = (ev.clientY - startClientY) / Math.max(1, rect.height);

      let { x, y, w, h } = startCrop;

      if (handle === "move") {
        x = Math.max(0, Math.min(1 - w, startCrop.x + dx));
        y = Math.max(0, Math.min(1 - h, startCrop.y + dy));
      } else {
        let left = startCrop.x;
        let top = startCrop.y;
        let right = startCrop.x + startCrop.w;
        let bottom = startCrop.y + startCrop.h;

        if (handle.includes("w")) left = Math.max(0, Math.min(right - minSize, startCrop.x + dx));
        if (handle.includes("e")) right = Math.min(1, Math.max(left + minSize, startCrop.x + startCrop.w + dx));
        if (handle.includes("n")) top = Math.max(0, Math.min(bottom - minSize, startCrop.y + dy));
        if (handle.includes("s")) bottom = Math.min(1, Math.max(top + minSize, startCrop.y + startCrop.h + dy));

        w = right - left;
        h = bottom - top;

        if (targetRatio) {
          // w_norm * imgAspect / h_norm === targetRatio => h_norm = w_norm * imgAspect / targetRatio
          const desiredH = (w * imgAspect) / targetRatio;
          if (handle === "n" || handle === "s") {
            const desiredW = (h * targetRatio) / imgAspect;
            w = Math.min(1 - left, Math.max(minSize, desiredW));
            h = (w * imgAspect) / targetRatio;
          } else {
            h = desiredH;
          }
          if (top + h > 1) {
            h = 1 - top;
            w = (h * targetRatio) / imgAspect;
          }
          if (left + w > 1) {
            w = 1 - left;
            h = (w * imgAspect) / targetRatio;
          }
        }
        x = left;
        y = top;
      }

      onUpdateCrop({
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        w: Number(Math.max(minSize, w).toFixed(4)),
        h: Number(Math.max(minSize, h).toFixed(4)),
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommitCrop?.();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startStagePointDrag = (
    onUpdate: (pos: { x: number; y: number }) => void,
    e: React.PointerEvent
  ) => {
    if (!stageBoxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = stageBoxRef.current.getBoundingClientRect();
    const emitFromClient = (cx: number, cy: number) => {
      const nx = Math.max(0.05, Math.min(0.95, (cx - box.left) / Math.max(1, box.width)));
      const ny = Math.max(0.05, Math.min(0.95, (cy - box.top) / Math.max(1, box.height)));
      onUpdate({ x: Number(nx.toFixed(3)), y: Number(ny.toFixed(3)) });
    };
    emitFromClient(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => emitFromClient(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const stepFrame = (delta: number) => {
    if (frames.length === 0) return;
    setIsPlaying(false);
    const currIdx = Math.max(0, activeFrameIndex);
    const nextIdx = (currIdx + delta + frames.length) % frames.length;
    const targetSeg = segments.find((s) => s.frame.uid === frames[nextIdx].uid);
    if (targetSeg) setPlayheadMs(targetSeg.startMs + 1);
    onSelectFrame(frames[nextIdx].uid);
  };

  if (frames.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-8 text-center">
        <div className="studio-panel-radius mb-4 flex h-13 w-13 items-center justify-center bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950">
          <Aperture className="h-6 w-6" />
        </div>
        <h2 className="studio-display-font text-base sm:text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Drop Photos, SVGs, Animated Loops, or MOVs
        </h2>
        <p className="mt-2 max-w-md text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          Import JPEGs, PNGs, HEICs, SVGs, Lottie JSON, or animated GIF / WebP /
          AVIF / APNG loops, then export ready-to-embed web animations.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onTriggerUpload}
            className="studio-accent-ring studio-control-radius flex items-center gap-2 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            <CloudArrowUp className="h-4 w-4" />
            Choose Photos / MOV
          </button>
          <button
            type="button"
            disabled={isLoadingSamples}
            onClick={onLoadSamples}
            className="studio-accent-ring studio-control-radius flex items-center gap-2 bg-[#e9e7e1] px-4 py-2.5 text-xs font-semibold text-zinc-900 ring-1 ring-black/[0.06] transition hover:bg-[#dfdcd4] disabled:opacity-60 dark:bg-zinc-800/90 dark:text-zinc-100 dark:ring-white/[0.06] dark:hover:bg-zinc-700"
          >
            <Sparkle className="studio-accent-text h-4 w-4" />
            {isLoadingSamples ? "Generating samples..." : "Try Sample Photos"}
          </button>
          {onLoadMotionSamples && (
            <button
              type="button"
              disabled={isLoadingSamples}
              onClick={onLoadMotionSamples}
              className="studio-accent-ring studio-control-radius flex items-center gap-2 bg-[#efede8] px-3.5 py-2.5 text-xs font-medium text-zinc-800 ring-1 ring-black/[0.06] transition hover:bg-[#e5e2db] disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-zinc-800"
            >
              <LoopModeGlyph mode="forward" className="studio-accent-text h-4 w-4" />
              15-Frame Motion Loop
            </button>
          )}
          {onLoadVideoSample && (
            <button
              type="button"
              disabled={isLoadingSamples}
              onClick={onLoadVideoSample}
              className="studio-accent-ring studio-control-radius flex items-center gap-2 bg-[#efede8] px-3.5 py-2.5 text-xs font-medium text-zinc-800 ring-1 ring-black/[0.06] transition hover:bg-[#e5e2db] disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-zinc-800"
            >
              <Play className="studio-accent-text h-4 w-4" />
              Try Sample Video
            </button>
          )}
        </div>

        {/* Inline Onboarding Blocks on Desktop Stage */}
        <div className="mt-6 hidden lg:grid w-full max-w-2xl grid-cols-2 gap-3 text-left">
          <div className="studio-panel-radius flex flex-col justify-between bg-[#fbfaf8] dark:bg-zinc-900/60 p-4 ring-1 ring-black/[0.07] dark:ring-white/[0.06]">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <BookOpenText className="studio-accent-text h-3.5 w-3.5" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                  How to Use GIF Studio
                </h3>
              </div>
              <ol className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <li className="flex gap-2">
                  <span className="studio-accent-text font-mono tabular-nums">
                    01
                  </span>
                  <span>Drop HEICs, JPEGs, animated GIFs, or Live Photo MOVs.</span>
                </li>
                <li className="flex gap-2">
                  <span className="studio-accent-text font-mono tabular-nums">
                    02
                  </span>
                  <span>Reorder timeline, set durations &amp; pick loop mode.</span>
                </li>
                <li className="flex gap-2">
                  <span className="studio-accent-text font-mono tabular-nums">
                    03
                  </span>
                  <span>Add Ken Burns motion, Polaroid/35mm borders &amp; crop.</span>
                </li>
                <li className="flex gap-2">
                  <span className="studio-accent-text font-mono tabular-nums">
                    04
                  </span>
                  <span>Export 2-pass GIF, transparent sticker, WebP, or MP4.</span>
                </li>
              </ol>
            </div>
            {onOpenGuide && (
              <button
                type="button"
                onClick={() => onOpenGuide("guide")}
                className="studio-accent-text mt-3 self-start text-xs font-medium hover:underline"
              >
                Full guide &amp; keyboard shortcuts →
              </button>
            )}
          </div>

          <div className="studio-panel-radius flex flex-col justify-between bg-[#fbfaf8] dark:bg-zinc-900/60 p-4 ring-1 ring-black/[0.07] dark:ring-white/[0.06]">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Scales className="h-3.5 w-3.5 studio-accent-text" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                    Open Source · MIT
                  </h3>
                </div>
                <span className="rounded-md bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-200">
                  100% Local
                </span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                Runs locally on your machine with zero cloud uploads. Open source
                under the MIT License.
              </p>
              <a
                href="https://github.com/EdgarsKalnins/gif-studio"
                target="_blank"
                rel="noopener noreferrer"
                className="studio-accent-text mt-2 inline-block text-xs font-medium hover:underline"
              >
                EdgarsKalnins/gif-studio ↗
              </a>
            </div>
            {onOpenGuide && (
              <button
                type="button"
                onClick={() => onOpenGuide("license")}
                className="mt-3 self-start text-xs font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white hover:underline"
              >
                View MIT License →
              </button>
            )}
          </div>
        </div>

        {/* Compact Quick Links on Smaller Viewports */}
        {onOpenGuide && (
          <div className="mt-4 flex lg:hidden flex-wrap items-center justify-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => onOpenGuide("guide")}
              className="studio-accent-text flex items-center gap-1.5 font-medium"
            >
              <BookOpenText className="h-3.5 w-3.5" />
              How to Use
            </button>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <button
              type="button"
              onClick={() => onOpenGuide("license")}
              className="flex items-center gap-1.5 font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
            >
              <Scales className="h-3.5 w-3.5" />
              MIT Open Source
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeCrop = selectedFrame?.crop ?? { x: 0, y: 0, w: 1, h: 1 };

  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-2 sm:gap-2.5 p-2.5 sm:p-4 overflow-hidden">
      {/* Frosted Floating Stage Toolbar (Aspect Ratio & Fit Mode) */}
      <div className="flex w-full max-w-full items-center justify-center">
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl bg-[#fbfaf8]/90 px-2 py-1 backdrop-blur-md shadow-[0_8px_24px_-6px_rgba(20,20,22,0.12),0_0_0_1px_rgba(20,20,22,0.08)] dark:bg-zinc-900/85 dark:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.09)]">
          <div className="flex shrink-0 items-center gap-0.5">
            {(["original", "1:1", "9:16", "16:9", "4:5", "4:3"] as AspectRatioPreset[]).map(
              (ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => onChangeAspectRatio(ratio)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                    aspectRatio === ratio
                      ? "bg-zinc-900 text-white shadow-xs dark:bg-white/[0.14] dark:text-white"
                      : "text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                  }`}
                >
                  {ratio === "original" ? "Orig" : ratio}
                </button>
              )
            )}
          </div>

          <div className="h-4 w-px shrink-0 bg-black/[0.1] dark:bg-white/[0.1]" />

          <div className="flex shrink-0 items-center gap-0.5">
            {(
              [
                { id: "fill", label: "Fill" },
                { id: "fit", label: "Fit" },
                { id: "blur_pad", label: "Blur Pad" },
              ] as { id: FitMode; label: string }[]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeFitMode(m.id)}
                className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                  fitMode === m.id
                    ? "bg-zinc-900 text-white shadow-xs dark:bg-white/[0.14] dark:text-white"
                    : "text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Stage */}
      <div className="studio-stage-surface relative flex flex-1 min-h-0 w-full items-center justify-center overflow-hidden rounded-2xl p-2.5 sm:p-4 ring-1 ring-black/[0.07] dark:ring-white/[0.06]">
        <div
          ref={stageBoxRef}
          className="relative flex max-h-full max-w-full items-center justify-center"
          style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
        >
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            onClick={() => {
              if (!isEditingCrop) togglePlay();
            }}
            title={
              isEditingCrop
                ? "Drag crop handles to reframe"
                : isPlaying
                ? "Click canvas to pause"
                : "Click canvas to play"
            }
            className={`h-full w-full rounded-lg shadow-[0_18px_45px_-12px_rgba(20,20,22,0.22),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.1)] ${
              transparentBg || border.corner_radius > 0 ? "studio-checkerboard" : ""
            } ${isEditingCrop ? "cursor-crosshair" : "cursor-pointer"}`}
          />

          {/* Interactive On-Canvas Crop Editor Overlay */}
          {isEditingCrop && cropImgRect && (
            <div
              ref={cropAreaRef}
              className="absolute select-none touch-none"
              style={{
                left: `${(cropImgRect.x / canvasW) * 100}%`,
                top: `${(cropImgRect.y / canvasH) * 100}%`,
                width: `${(cropImgRect.w / canvasW) * 100}%`,
                height: `${(cropImgRect.h / canvasH) * 100}%`,
              }}
            >
              {/* Darkened regions outside crop */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 bg-black/60"
                style={{ height: `${activeCrop.y * 100}%` }}
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60"
                style={{ height: `${Math.max(0, 1 - activeCrop.y - activeCrop.h) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute left-0 bg-black/60"
                style={{
                  top: `${activeCrop.y * 100}%`,
                  height: `${activeCrop.h * 100}%`,
                  width: `${activeCrop.x * 100}%`,
                }}
              />
              <div
                className="pointer-events-none absolute right-0 bg-black/60"
                style={{
                  top: `${activeCrop.y * 100}%`,
                  height: `${activeCrop.h * 100}%`,
                  width: `${Math.max(0, 1 - activeCrop.x - activeCrop.w) * 100}%`,
                }}
              />

              {/* Active Crop Box */}
              <div
                onPointerDown={(e) => startCropDrag("move", e)}
                className="absolute cursor-move border-2 border-[var(--studio-accent)] shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{
                  left: `${activeCrop.x * 100}%`,
                  top: `${activeCrop.y * 100}%`,
                  width: `${activeCrop.w * 100}%`,
                  height: `${activeCrop.h * 100}%`,
                }}
              >
                {/* Rule-of-thirds grid */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  <div className="border-r border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-r border-b border-white/25" />
                  <div className="border-b border-white/25" />
                  <div className="border-r border-white/25" />
                  <div className="border-r border-white/25" />
                  <div />
                </div>

                {/* 8 Drag Handles */}
                {(
                  [
                    { id: "nw", cls: "-top-1.5 -left-1.5 cursor-nwse-resize" },
                    { id: "n", cls: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
                    { id: "ne", cls: "-top-1.5 -right-1.5 cursor-nesw-resize" },
                    { id: "e", cls: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
                    { id: "se", cls: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
                    { id: "s", cls: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
                    { id: "sw", cls: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
                    { id: "w", cls: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
                  ] as { id: DragHandle; cls: string }[]
                ).map((h) => (
                  <div
                    key={h.id}
                    onPointerDown={(e) => startCropDrag(h.id, e)}
                    className={`absolute h-3 w-3 rounded-sm border border-zinc-950 bg-white shadow ${h.cls}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Safe-Zone Guides (Rule of Thirds + Center Crosshair) */}
          {showSafeGuides && !isEditingCrop && (
            <div className="pointer-events-none absolute inset-0 rounded-lg overflow-hidden">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                <div className="border-r border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-b border-white/25" />
                <div className="border-r border-white/25" />
                <div className="border-r border-white/25" />
                <div />
              </div>
              <div className="absolute left-1/2 top-1/2 h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--studio-accent)]/80" />
              <div className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-[var(--studio-accent)]/80" />
            </div>
          )}

          {/* Interactive Draggable Motion Focal Reticle */}
          {isEditingMotion && !isEditingCrop && motionAnchor && onUpdateMotionAnchor && (
            <div
              onPointerDown={(e) => startStagePointDrag(onUpdateMotionAnchor, e)}
              title="Drag to set Motion Focal Anchor"
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing touch-none"
              style={{
                left: `${motionAnchor.x * 100}%`,
                top: `${motionAnchor.y * 100}%`,
              }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[var(--studio-accent)]/85 shadow-lg ring-2 ring-black/40">
                <div className="h-2 w-2 rounded-full bg-white" />
              </div>
              <span className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white opacity-90">
                {Math.round(motionAnchor.x * 100)}% · {Math.round(motionAnchor.y * 100)}%
              </span>
            </div>
          )}

          {/* Interactive Draggable Text Positioning Handles */}
          {isEditingText && !isEditingCrop && activeTextOverlay && onUpdateTextPosition && (
            <>
              {[activeTextOverlay, ...(activeTextOverlay.extra_layers ?? [])].map(
                (lyr, lIdx) => {
                  if (!lyr.text.trim()) return null;
                  const layerKey = lIdx === 0 ? -1 : lIdx - 1;
                  const px =
                    lyr.x_pct ??
                    (lyr.align === "left" ? 0.16 : lyr.align === "right" ? 0.84 : 0.5);
                  const py =
                    lyr.y_pct ??
                    (lyr.position === "top" ? 0.14 : lyr.position === "center" ? 0.5 : 0.86);
                  return (
                    <div
                      key={`tx-handle-${layerKey}`}
                      onPointerDown={(e) =>
                        startStagePointDrag(
                          (pt) => onUpdateTextPosition(layerKey, { x_pct: pt.x, y_pct: pt.y }),
                          e
                        )
                      }
                      title={`Drag Text Layer ${lIdx + 1} anywhere on canvas`}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 border-white bg-zinc-950/90 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300 shadow-lg ring-2 ring-[var(--studio-accent)]"
                      style={{
                        left: `${px * 100}%`,
                        top: `${py * 100}%`,
                      }}
                    >
                      T{lIdx + 1}
                    </div>
                  );
                }
              )}
            </>
          )}
        </div>

        {!isPlaying && !isEditingCrop && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Resume playback"
            className="absolute flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900/90 text-white shadow-lg ring-1 ring-white/20 backdrop-blur transition hover:scale-105 dark:bg-zinc-100/95 dark:text-zinc-950"
          >
            <Play className="h-5 w-5 ml-0.5" />
          </button>
        )}

        {selectedFrameUid && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-2 rounded-full bg-[#fbfaf8]/90 px-2.5 py-1 text-[11px] font-medium text-zinc-800 ring-1 ring-black/[0.08] backdrop-blur-md dark:bg-zinc-900/85 dark:text-zinc-200 dark:ring-white/[0.08]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--studio-accent)]" />
            {isEditingCrop
              ? "Crop Mode (drag handles)"
              : `Frame ${activeFrameIndex + 1} / ${frames.length}`}
          </div>
        )}
        <div className="pointer-events-none absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-[#fbfaf8]/90 px-2.5 py-1 text-[11px] font-mono text-zinc-800 ring-1 ring-black/[0.08] backdrop-blur-md dark:bg-zinc-900/85 dark:text-zinc-200 dark:ring-white/[0.08]">
          <LoopModeGlyph mode={loopMode} className="studio-accent-text h-3.5 w-3.5" />
          {loopMode.replace("_", " ")}
        </div>
        {onToggleMobileStageCompact && (
          <button
            type="button"
            onClick={onToggleMobileStageCompact}
            aria-label={mobileStageCompact ? "Expand preview" : "Compact preview"}
            title={mobileStageCompact ? "Expand preview" : "Compact preview"}
            className="md:hidden absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg bg-[#fbfaf8]/90 text-zinc-800 ring-1 ring-black/[0.1] backdrop-blur-md hover:bg-white dark:bg-zinc-900/85 dark:text-zinc-200 dark:ring-white/[0.1] dark:hover:bg-zinc-800"
          >
            {mobileStageCompact ? (
              <ArrowsOutSimple className="h-3.5 w-3.5" />
            ) : (
              <ArrowsInSimple className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Frosted Floating Transport Pill */}
      <div className="studio-panel-radius flex w-full max-w-xl items-center gap-2 bg-[#fbfaf8]/90 px-3 py-1.5 backdrop-blur-md shadow-[0_8px_24px_-6px_rgba(20,20,22,0.14),0_0_0_1px_rgba(20,20,22,0.08)] dark:bg-zinc-900/85 dark:shadow-[0_14px_36px_-8px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.09)]">
        <button
          type="button"
          onClick={() => stepFrame(-1)}
          className="studio-accent-ring studio-pill-radius p-1.5 text-zinc-700 transition hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          title="Previous frame (Left Arrow)"
          aria-label="Previous frame"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          ref={playButtonRef}
          type="button"
          onClick={togglePlay}
          className="studio-accent-ring studio-pill-radius flex h-8 w-8 items-center justify-center bg-zinc-900 text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => stepFrame(1)}
          className="studio-accent-ring studio-pill-radius p-1.5 text-zinc-700 transition hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          title="Next frame (Right Arrow)"
          aria-label="Next frame"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(1, totalDurationMs - 1)}
          value={effectivePlayheadMs}
          onChange={(e) => {
            setIsPlaying(false);
            setPlayheadMs(Number(e.target.value));
          }}
          aria-label="Timeline scrubber"
          className="flex-1 cursor-pointer"
        />

        <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11px] sm:text-xs text-zinc-700 dark:text-zinc-300 tabular-nums">
          {(effectivePlayheadMs / 1000).toFixed(2)}s / {(totalDurationMs / 1000).toFixed(2)}s
        </span>
      </div>
    </div>
  );
}
