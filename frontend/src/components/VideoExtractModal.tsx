"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadSimple,
  FilmStrip,
  LoopModeGlyph,
  Pause,
  Play,
  Scissors,
  Sparkle,
  SpinnerGap,
  X,
} from "@/components/StudioIcons";
import { extractVideoFrames, resolveMediaUrl } from "@/lib/api";
import type { FrameItem, UploadedMediaItem } from "@/types/studio";

export interface VideoExtractOptions {
  loopMode: "forward" | "boomerang";
}

interface VideoExtractModalProps {
  video: UploadedMediaItem;
  onClose: () => void;
  onExtracted: (frames: FrameItem[], options?: VideoExtractOptions) => void;
  onInstantExportGif?: (
    frames: FrameItem[],
    options?: VideoExtractOptions
  ) => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

export function VideoExtractModal({
  video,
  onClose,
  onExtracted,
  onInstantExportGif,
}: VideoExtractModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [measuredDuration, setMeasuredDuration] = useState<number>(
    Math.max(0.5, video.duration_sec || 3.0)
  );
  const maxDur = Math.max(0.5, measuredDuration);
  const isLivePhotoClip = maxDur <= 4.5;

  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(() =>
    isLivePhotoClip
      ? Number(maxDur.toFixed(2))
      : Number(Math.min(maxDur, 4.0).toFixed(2))
  );
  const [fps, setFps] = useState(isLivePhotoClip ? 12 : 10);
  const [maxFrames, setMaxFrames] = useState(isLivePhotoClip ? 60 : 40);
  const [speed, setSpeed] = useState<number>(1);
  const [loopMode, setLoopMode] = useState<"forward" | "boomerang">("forward");
  const [isPlaying, setIsPlaying] = useState(true);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [videoReady, setVideoReady] = useState(false);

  const [loadingMode, setLoadingMode] = useState<"timeline" | "instant" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const streamUrl = useMemo(
    () => resolveMediaUrl(video.video_url || `/api/media/${video.id}/video`),
    [video.id, video.video_url]
  );
  const posterUrl = useMemo(
    () => resolveMediaUrl(video.preview_url),
    [video.preview_url]
  );

  // Allow Escape key to dismiss modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && loadingMode === null) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loadingMode, onClose]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed, videoReady]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) {
      if (el.currentTime < startSec || el.currentTime >= endSec) {
        el.currentTime = startSec;
      }
      el.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      el.pause();
    }
  }, [isPlaying, startSec, endSec]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el) {
        if (el.currentTime >= endSec || el.currentTime < startSec - 0.05) {
          el.currentTime = startSec;
        }
        setPlayheadSec(el.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, startSec, endSec]);

  const clipSpan = Math.max(0.2, endSec - startSec);
  const estFrames = Math.min(maxFrames, Math.max(1, Math.round(clipSpan * fps)));
  const estGifSec =
    (clipSpan / speed) * (loopMode === "boomerang" && estFrames > 2 ? 1.85 : 1);

  const applyPreset = (preset: "auto" | "smooth" | "compact") => {
    if (preset === "auto") {
      setStartSec(0);
      setEndSec(Number(maxDur.toFixed(2)));
      setFps(12);
      setMaxFrames(60);
      setSpeed(1);
    } else if (preset === "smooth") {
      setFps(15);
      setMaxFrames(60);
    } else {
      setFps(8);
      setMaxFrames(32);
    }
  };

  const handleTrackScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const el = videoRef.current;
    if (!track || !el) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = Number((ratio * maxDur).toFixed(2));
    el.currentTime = target;
    setPlayheadSec(target);
  };

  const handleTogglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      if (el.currentTime < startSec || el.currentTime >= endSec) {
        el.currentTime = startSec;
      }
      el.playbackRate = speed;
      el.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleRunExtract = async (mode: "timeline" | "instant") => {
    setLoadingMode(mode);
    setError(null);
    try {
      const res = await extractVideoFrames({
        media_id: video.id,
        start_sec: startSec,
        end_sec: endSec,
        fps,
        max_frames: maxFrames,
        speed,
      });
      const frameItems: FrameItem[] = res.frames.map((f) => ({
        uid: `${f.id}_${Math.random().toString(36).slice(2, 9)}`,
        media: f,
        duration_ms: f.frame_duration_ms ?? res.default_frame_duration_ms,
        motion: null,
        filters: null,
        transition_in: "none",
        transition_ms: 250,
        text_overlay: null,
        crop: null,
        rotate: 0,
        straighten: 0,
        flip_h: false,
        flip_v: false,
      }));
      if (mode === "instant" && onInstantExportGif) {
        onInstantExportGif(frameItems, { loopMode });
      } else {
        onExtracted(frameItems, { loopMode });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to extract video frames"
      );
    } finally {
      setLoadingMode(null);
    }
  };

  const trimLeftPct = Math.max(0, Math.min(100, (startSec / maxDur) * 100));
  const trimWidthPct = Math.max(
    2,
    Math.min(100 - trimLeftPct, ((endSec - startSec) / maxDur) * 100)
  );
  const playheadPct = Math.max(0, Math.min(100, (playheadSec / maxDur) * 100));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-trimmer-title"
      onClick={() => {
        if (loadingMode === null) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="studio-panel-radius flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#fbfaf8] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.35),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_24px_60px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.08] dark:border-zinc-800 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--studio-accent-soft)] studio-accent-text">
              <FilmStrip className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3
                id="video-trimmer-title"
                className="studio-display-font truncate text-sm font-semibold tracking-tight"
              >
                Trim Video &amp; Make GIF
              </h3>
              <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                {video.filename} · {video.width}×{video.height} · {maxDur.toFixed(1)}s
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loadingMode !== null}
            onClick={onClose}
            aria-label="Close video trimmer"
            className="studio-accent-ring rounded-lg p-1.5 text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          {/* Live Video Stage + Scrub Bar */}
          <div className="studio-control-radius overflow-hidden border border-black/[0.08] dark:border-zinc-800 bg-zinc-950">
            <div className="relative flex h-44 sm:h-52 items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.06),_rgba(9,9,11,1))]">
              <video
                ref={videoRef}
                src={streamUrl}
                poster={posterUrl}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0.2) {
                    const rounded = Number(dur.toFixed(2));
                    setMeasuredDuration(rounded);
                    if (endSec > rounded || dur <= 4.5) {
                      setEndSec(
                        rounded <= 4.5
                          ? rounded
                          : Number(Math.min(rounded, 4.0).toFixed(2))
                      );
                    }
                  }
                  e.currentTarget.playbackRate = speed;
                  setVideoReady(true);
                }}
                onTimeUpdate={(e) => {
                  setPlayheadSec(e.currentTarget.currentTime);
                }}
                onClick={handleTogglePlay}
                className="max-h-full max-w-full cursor-pointer object-contain"
              />
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? "Pause clip preview" : "Play clip preview"}
                className="studio-accent-ring absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black"
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Play Range
                  </>
                )}
              </button>
              <div className="absolute bottom-2.5 right-2.5 rounded-full bg-black/75 px-2.5 py-1 font-mono text-[11px] tabular-nums text-zinc-200 ring-1 ring-white/10">
                {playheadSec.toFixed(2)}s / {maxDur.toFixed(2)}s
              </div>
            </div>

            {/* Interactive Trim Track Scrubber */}
            <div className="border-t border-zinc-800 bg-zinc-900/95 px-3 py-2.5">
              <div
                ref={trackRef}
                onClick={handleTrackScrub}
                title="Click anywhere to scrub video preview"
                className="relative h-5 w-full cursor-pointer overflow-hidden rounded-md bg-zinc-800"
              >
                <div
                  className="absolute inset-y-0 border-x-2 border-[var(--studio-accent)] bg-[var(--studio-accent-soft)]"
                  style={{
                    left: `${trimLeftPct}%`,
                    width: `${trimWidthPct}%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                  style={{ left: `${playheadPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Presets Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {isLivePhotoClip && (
                <button
                  type="button"
                  onClick={() => applyPreset("auto")}
                  className="studio-accent-ring inline-flex items-center gap-1 rounded-full bg-[var(--studio-accent-soft)] px-2.5 py-1 text-[11px] font-semibold studio-accent-text ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
                >
                  <Sparkle className="h-3 w-3" />
                  Auto Full Clip ({maxDur.toFixed(1)}s)
                </button>
              )}
              <button
                type="button"
                onClick={() => applyPreset("smooth")}
                className="studio-accent-ring rounded-full bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 ring-1 ring-black/[0.06] dark:ring-white/[0.08] hover:bg-[#e5e2da] dark:hover:bg-zinc-800"
              >
                Smooth 15fps
              </button>
              <button
                type="button"
                onClick={() => applyPreset("compact")}
                className="studio-accent-ring rounded-full bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 ring-1 ring-black/[0.06] dark:ring-white/[0.08] hover:bg-[#e5e2da] dark:hover:bg-zinc-800"
              >
                Compact 8fps
              </button>
            </div>
            <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              ~{estFrames} frames · ~{estGifSec.toFixed(1)}s GIF
            </div>
          </div>

          {/* Trim Range Sliders */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Start Time
                </span>
                <span className="font-mono studio-accent-text tabular-nums">
                  {startSec.toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, Number((maxDur - 0.2).toFixed(2)))}
                step={0.05}
                value={startSec}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setStartSec(next);
                  if (next >= endSec - 0.2) {
                    setEndSec(Math.min(maxDur, Number((next + 0.2).toFixed(2))));
                  }
                  if (videoRef.current) {
                    videoRef.current.currentTime = next;
                    setPlayheadSec(next);
                  }
                }}
                className="w-full"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  End Time
                </span>
                <span className="font-mono studio-accent-text tabular-nums">
                  {endSec.toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={Math.min(maxDur, 0.2)}
                max={Number(maxDur.toFixed(2))}
                step={0.05}
                value={endSec}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setEndSec(next);
                  if (next <= startSec + 0.2) {
                    setStartSec(Math.max(0, Number((next - 0.2).toFixed(2))));
                  }
                  if (videoRef.current) {
                    videoRef.current.currentTime = next;
                    setPlayheadSec(next);
                  }
                }}
                className="w-full"
              />
            </label>
          </div>

          {/* Speed & Loop + FPS & Max Frames */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Speed
                </span>
                <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                  {speed}×
                </span>
              </div>
              <div className="studio-control-radius grid grid-cols-4 gap-1 bg-[#efede8] p-1 dark:bg-zinc-900">
                {SPEED_OPTIONS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpeed(sp)}
                    className={`studio-accent-ring rounded-md py-1 text-xs font-medium transition ${
                      speed === sp
                        ? "studio-accent-bg shadow-sm font-semibold"
                        : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                    }`}
                  >
                    {sp}×
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Loop Style
                </span>
                <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  {loopMode === "boomerang" ? "Ping-pong" : "Standard"}
                </span>
              </div>
              <div className="studio-control-radius grid grid-cols-2 gap-1 bg-[#efede8] p-1 dark:bg-zinc-900">
                {(["forward", "boomerang"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLoopMode(mode)}
                    className={`studio-accent-ring inline-flex items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium capitalize transition ${
                      loopMode === mode
                        ? "studio-accent-bg shadow-sm font-semibold"
                        : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                    }`}
                  >
                    <LoopModeGlyph mode={mode} className="h-3.5 w-3.5" />
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Sample Rate (FPS)
                </span>
                <span className="font-mono studio-accent-text tabular-nums">
                  {fps} fps
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={24}
                step={1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  Max Frames
                </span>
                <span className="font-mono studio-accent-text tabular-nums">
                  {maxFrames}
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={maxFrames}
                onChange={(e) => setMaxFrames(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Sticky Footer with Dual CTAs */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black/[0.08] dark:border-zinc-800 bg-[#efede8]/70 dark:bg-zinc-900/70 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={loadingMode !== null}
            onClick={onClose}
            className="studio-accent-ring studio-control-radius px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loadingMode !== null}
              onClick={() => handleRunExtract("timeline")}
              className="studio-accent-ring studio-control-radius flex items-center gap-1.5 border border-black/[0.1] dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              {loadingMode === "timeline" ? (
                <>
                  <SpinnerGap className="h-3.5 w-3.5 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Scissors className="h-3.5 w-3.5" />
                  Add Frames to Timeline
                </>
              )}
            </button>

            {onInstantExportGif && (
              <button
                type="button"
                disabled={loadingMode !== null}
                onClick={() => handleRunExtract("instant")}
                className="studio-accent-ring studio-control-radius studio-accent-bg flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                {loadingMode === "instant" ? (
                  <>
                    <SpinnerGap className="h-3.5 w-3.5 animate-spin" />
                    Building GIF...
                  </>
                ) : (
                  <>
                    <DownloadSimple className="h-3.5 w-3.5" />
                    Instant Export GIF
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
