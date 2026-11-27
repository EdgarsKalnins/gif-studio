"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsInSimple,
  ArrowsOutSimple,
  Check,
  CheckSquare,
  ClipboardText,
  CloudArrowUp,
  Copy,
  FlipHorizontal,
  MagnifyingGlass,
  Plus,
  Repeat,
  SlidersHorizontal,
  SpinnerGap,
  Stack,
  Swap,
  Trash,
  X,
} from "@/components/StudioIcons";
import { resolveMediaUrl } from "@/lib/api";
import type {
  CropConfig,
  FilterConfig,
  FrameItem,
  LivePlaybackSnapshot,
  MotionConfig,
  PlaybackProgressChannel,
  RotateDegrees,
  TextOverlayConfig,
  TransitionType,
  UploadedMediaItem,
} from "@/types/studio";

export interface CopiedFrameLook {
  duration_ms: number;
  motion: MotionConfig | null;
  filters: FilterConfig | null;
  text_overlay: TextOverlayConfig | null;
  crop: CropConfig | null;
  rotate: RotateDegrees;
  straighten?: number;
  flip_h: boolean;
  flip_v: boolean;
  transition_in: TransitionType;
  transition_ms: number;
}

type FrameDensity = "s" | "m" | "l";

interface TimelinePanelProps {
  frames: FrameItem[];
  mediaBin: UploadedMediaItem[];
  selectedFrameUid: string | null;
  activeSelectedUids: string[];
  globalMotion: MotionConfig;
  totalTimelineMs: number;
  copiedLook: CopiedFrameLook | null;
  timelineExpanded: boolean;
  isReplacingUpload?: boolean;
  playingFrameUid?: string | null;
  isPreviewPlaying?: boolean;
  playbackChannel?: PlaybackProgressChannel;
  onSeekToFrame?: (frameUid: string, frameRatio: number) => void;
  onToggleTimelineExpanded: () => void;
  onSelectFrameClick: (uid: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onSelectAll: () => void;
  onClearBatchSelection: () => void;
  onReorderFrame: (fromIdx: number, toIdx: number) => void;
  onMoveFrame: (idx: number, delta: number) => void;
  onDuplicateFrame: (idx: number) => void;
  onBatchDuplicate: () => void;
  onBatchSetDuration: (ms: number) => void;
  onApplyUniformDuration: (ms: number) => void;
  onSetFrameDuration: (uid: string, ms: number) => void;
  onDecimateSelected: (keepEvery: number) => void;
  onReverseTimeline: (selectedOnly: boolean) => void;
  onPingPongTimeline: () => void;
  onRequestDeleteSingle: (frame: FrameItem, idx: number) => void;
  onRequestDeleteSelected: () => void;
  onSwapFrameMedia: (
    uid: string,
    media: UploadedMediaItem,
    resetTransform: boolean
  ) => void;
  onUploadReplacementForFrame: (
    uid: string,
    file: File,
    resetTransform: boolean
  ) => Promise<void> | void;
  onRotateFrameQuick: (uid: string) => void;
  onFlipFrameQuick: (uid: string) => void;
  onSetFrameTransition: (uid: string, transition: TransitionType) => void;
  onBatchRotate90: () => void;
  onCopyFrameLook: (frame: FrameItem) => void;
  onPasteLookToTargets: (uids: string[]) => void;
  onResetFrameOverrides: (uid: string) => void;
  onEditFrameInInspector: (
    uid: string,
    tab?: "motion" | "transform" | "effects" | "text"
  ) => void;
  onInsertMediaAt?: (item: UploadedMediaItem, insertIndex?: number) => void;
  onTriggerAddImages: () => void;
}

function hasCustomFrameOverrides(frame: FrameItem): boolean {
  return Boolean(
    frame.motion !== null ||
      frame.filters !== null ||
      frame.text_overlay !== null ||
      frame.crop !== null ||
      frame.rotate !== 0 ||
      (frame.straighten ?? 0) !== 0 ||
      frame.flip_h ||
      frame.flip_v ||
      frame.transition_in !== "none"
  );
}

const TRANSITION_CHOICES: { id: TransitionType; label: string }[] = [
  { id: "none", label: "Cut" },
  { id: "crossfade", label: "Fade" },
  { id: "slide_left", label: "Slide L" },
  { id: "slide_right", label: "Slide R" },
  { id: "slide_up", label: "Slide Up" },
  { id: "zoom_in", label: "Zoom" },
];

export function TimelinePanel({
  frames,
  mediaBin,
  selectedFrameUid,
  activeSelectedUids,
  globalMotion,
  totalTimelineMs,
  copiedLook,
  timelineExpanded,
  isReplacingUpload = false,
  playingFrameUid = null,
  isPreviewPlaying = false,
  playbackChannel,
  onSeekToFrame,
  onToggleTimelineExpanded,
  onSelectFrameClick,
  onSelectAll,
  onClearBatchSelection,
  onReorderFrame,
  onMoveFrame,
  onDuplicateFrame,
  onBatchDuplicate,
  onBatchSetDuration,
  onApplyUniformDuration,
  onSetFrameDuration,
  onDecimateSelected,
  onReverseTimeline,
  onPingPongTimeline,
  onRequestDeleteSingle,
  onRequestDeleteSelected,
  onSwapFrameMedia,
  onUploadReplacementForFrame,
  onRotateFrameQuick,
  onFlipFrameQuick,
  onSetFrameTransition,
  onBatchRotate90,
  onCopyFrameLook,
  onPasteLookToTargets,
  onResetFrameOverrides,
  onEditFrameInInspector,
  onInsertMediaAt,
  onTriggerAddImages,
}: TimelinePanelProps) {
  const [draggedFrameIdx, setDraggedFrameIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isTrackDropActive, setIsTrackDropActive] = useState(false);
  const [density, setDensity] = useState<FrameDensity>("m");
  const [swapTargetUid, setSwapTargetUid] = useState<string | null>(null);
  const [swapSearch, setSwapSearch] = useState("");
  const [resetTransformOnSwap, setResetTransformOnSwap] = useState(false);
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const scrubTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubFillRef = useRef<HTMLDivElement | null>(null);
  const scrubNeedleRef = useRef<HTMLDivElement | null>(null);
  const scrubReadoutRef = useRef<HTMLSpanElement | null>(null);
  const activeCardTopBarRef = useRef<HTMLDivElement | null>(null);
  const activeCardNeedleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!playbackChannel) return;
    const applySnap = (snap: LivePlaybackSnapshot) => {
      const totalPct = `${(snap.timelineProgress * 100).toFixed(2)}%`;
      const framePct = `${(snap.frameProgress * 100).toFixed(2)}%`;
      if (scrubFillRef.current) {
        scrubFillRef.current.style.width = totalPct;
      }
      if (scrubNeedleRef.current) {
        scrubNeedleRef.current.style.left = totalPct;
      }
      if (scrubReadoutRef.current) {
        const frameNum = snap.activeFrameIndex >= 0 ? `#${snap.activeFrameIndex + 1}` : "--";
        scrubReadoutRef.current.textContent = `${frameNum} · ${(snap.playheadMs / 1000).toFixed(2)}s`;
      }
      if (activeCardTopBarRef.current) {
        activeCardTopBarRef.current.style.width = framePct;
      }
      if (activeCardNeedleRef.current) {
        activeCardNeedleRef.current.style.left = framePct;
      }
    };
    applySnap(playbackChannel.latest);
    return playbackChannel.subscribe(applySnap);
  }, [playbackChannel, playingFrameUid, frames.length]);

  const seekFromTrackPointer = (clientX: number) => {
    const track = scrubTrackRef.current;
    if (!track || frames.length === 0 || !onSeekToFrame) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(0.9999, (clientX - rect.left) / Math.max(1, rect.width)));
    const totalMs = frames.reduce((acc, f) => acc + Math.max(1, f.duration_ms), 0);
    const targetMs = ratio * totalMs;
    let cursor = 0;
    for (const f of frames) {
      const dur = Math.max(1, f.duration_ms);
      if (targetMs <= cursor + dur || f === frames[frames.length - 1]) {
        const within = Math.max(0, Math.min(0.999, (targetMs - cursor) / dur));
        onSeekToFrame(f.uid, within);
        return;
      }
      cursor += dur;
    }
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frames.length === 0 || !onSeekToFrame) return;
    e.preventDefault();
    seekFromTrackPointer(e.clientX);
    const onMove = (ev: PointerEvent) => seekFromTrackPointer(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const playingFrameIndex = useMemo(
    () => (playingFrameUid ? frames.findIndex((f) => f.uid === playingFrameUid) : -1),
    [frames, playingFrameUid]
  );

  const selectedIndex = useMemo(
    () => frames.findIndex((f) => f.uid === selectedFrameUid),
    [frames, selectedFrameUid]
  );

  const selectedFrame =
    selectedIndex >= 0 ? frames[selectedIndex] : frames[0] ?? null;

  const swapTargetFrame = useMemo(
    () => frames.find((f) => f.uid === swapTargetUid) ?? null,
    [frames, swapTargetUid]
  );

  const stillMediaOptions = useMemo(() => {
    const q = swapSearch.trim().toLowerCase();
    return mediaBin.filter((item) => {
      if (item.media_type !== "image") return false;
      if (q && !item.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mediaBin, swapSearch]);

  const maxFrameDuration = useMemo(() => {
    let maxMs = 100;
    for (const f of frames) {
      if (f.duration_ms > maxMs) maxMs = f.duration_ms;
    }
    return maxMs;
  }, [frames]);

  const avgFps =
    frames.length > 0 && totalTimelineMs > 0
      ? ((frames.length * 1000) / totalTimelineMs).toFixed(1)
      : "0.0";

  const triggerPasteFeedback = (targets: string[]) => {
    onPasteLookToTargets(targets);
    setPasteFeedback(true);
    window.setTimeout(() => setPasteFeedback(false), 1200);
  };

  const cardSizeClass =
    density === "s"
      ? "h-20 w-24"
      : density === "l"
      ? "h-28 w-36"
      : "h-24 w-28";

  const isBatchMode = activeSelectedUids.length >= 2;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Row 1: Sequence Overview, Mode Switch & Action Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-black/[0.08] dark:border-zinc-800/70 px-3 sm:px-4 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-zinc-700 dark:text-zinc-300">
          <span className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
            <Stack className="h-3.5 w-3.5 studio-accent-text" />
            <span>
              Timeline ({frames.length} {frames.length === 1 ? "frame" : "frames"})
            </span>
          </span>
          <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
            {(totalTimelineMs / 1000).toFixed(2)}s
            {frames.length > 0 ? ` · ${avgFps} fps` : ""}
          </span>
          {frames.length > 0 && playingFrameIndex >= 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-zinc-900 ring-1 ring-black/[0.08] dark:bg-white/[0.08] dark:text-zinc-100 dark:ring-white/[0.1]">
              <span
                className={`h-1.5 w-1.5 rounded-full bg-[var(--studio-accent)] ${
                  isPreviewPlaying ? "animate-pulse" : ""
                }`}
              />
              <span>
                {isPreviewPlaying ? "Playing" : "Preview"} #{playingFrameIndex + 1}
              </span>
            </span>
          )}

          {isBatchMode ? (
            <span className="rounded-md bg-[var(--studio-accent-soft)] px-2 py-0.5 text-[11px] font-semibold studio-accent-text">
              {activeSelectedUids.length} selected
            </span>
          ) : selectedFrame ? (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-black/[0.05] dark:bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-zinc-800 dark:text-zinc-200 tabular-nums">
              #{selectedIndex + 1} · {selectedFrame.media.filename.slice(0, 18)}
              {selectedFrame.media.filename.length > 18 ? "…" : ""}
            </span>
          ) : null}
        </div>

        {/* Right Controls: Batch OR Quick Sequence Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isBatchMode ? (
            <>
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--studio-accent-soft)] px-1.5 py-0.5 text-[11px] ring-1 ring-[var(--studio-accent-ring)]">
                {[120, 250, 500].map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    onClick={() => onBatchSetDuration(ms)}
                    className="rounded px-1.5 py-0.5 font-mono studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    {ms}ms
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onReverseTimeline(true)}
                  className="rounded px-1.5 py-0.5 font-medium studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  title="Reverse selected frames order"
                >
                  Reverse
                </button>
                <button
                  type="button"
                  onClick={onBatchRotate90}
                  className="rounded px-1.5 py-0.5 font-medium studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  title="Rotate selected images 90° clockwise"
                >
                  Rotate 90°
                </button>
                <button
                  type="button"
                  onClick={() => onDecimateSelected(2)}
                  className="rounded px-1.5 py-0.5 font-medium studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  title="Keep every 2nd selected frame"
                >
                  Keep 1/2
                </button>
                <button
                  type="button"
                  onClick={() => onDecimateSelected(3)}
                  className="rounded px-1.5 py-0.5 font-medium studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  title="Keep every 3rd selected frame"
                >
                  Keep 1/3
                </button>
                {copiedLook && (
                  <button
                    type="button"
                    onClick={() => triggerPasteFeedback(activeSelectedUids)}
                    className="rounded px-1.5 py-0.5 font-semibold studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    {pasteFeedback ? "Pasted!" : "Paste Look"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onBatchDuplicate}
                  className="rounded px-1.5 py-0.5 font-medium studio-accent-text hover:bg-black/10 dark:hover:bg-white/10"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={onRequestDeleteSelected}
                  className="rounded px-1.5 py-0.5 font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/20"
                >
                  Delete ({activeSelectedUids.length})
                </button>
              </div>
              <button
                type="button"
                onClick={onClearBatchSelection}
                className="rounded-md bg-[#efede8] dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
              >
                Done
              </button>
            </>
          ) : (
            <>
              {/* Quick Selected Frame Customization Controls (visible when 1 frame active) */}
              {selectedFrame && (
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#efede8] dark:bg-zinc-900 px-1.5 py-0.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setSwapTargetUid(selectedFrame.uid)}
                    title="Swap or upload a custom replacement image for this frame"
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold studio-accent-text hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  >
                    <Swap className="h-3.5 w-3.5" />
                    <span>Swap Image</span>
                  </button>

                  <div className="h-3.5 w-px bg-black/10 dark:bg-white/10" />

                  <button
                    type="button"
                    onClick={() =>
                      onSetFrameDuration(
                        selectedFrame.uid,
                        Math.max(30, selectedFrame.duration_ms - 50)
                      )
                    }
                    aria-label="Decrease frame duration by 50ms"
                    className="rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  >
                    -50
                  </button>
                  <label className="flex items-center gap-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                    <span className="sr-only">Frame duration in milliseconds</span>
                    <input
                      type="number"
                      min={30}
                      max={10000}
                      step={10}
                      value={selectedFrame.duration_ms}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onSetFrameDuration(
                            selectedFrame.uid,
                            Math.min(10000, Math.max(30, Math.round(val)))
                          );
                        }
                      }}
                      className="w-12 appearance-none rounded bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-center font-mono text-base md:text-[11px] text-zinc-900 dark:text-zinc-100 ring-1 ring-black/10 dark:ring-zinc-700 tabular-nums focus:ring-[var(--studio-accent)] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                      ms
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onSetFrameDuration(
                        selectedFrame.uid,
                        Math.min(10000, selectedFrame.duration_ms + 50)
                      )
                    }
                    aria-label="Increase frame duration by 50ms"
                    className="rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  >
                    +50
                  </button>

                  <div className="h-3.5 w-px bg-black/10 dark:bg-white/10" />

                  <button
                    type="button"
                    onClick={() => onRotateFrameQuick(selectedFrame.uid)}
                    title="Rotate this frame 90° clockwise"
                    aria-label="Rotate selected frame 90 degrees"
                    className="rounded p-1 text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] hover:text-zinc-950 dark:hover:bg-white/[0.08] dark:hover:text-white"
                  >
                    <ArrowClockwise className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onFlipFrameQuick(selectedFrame.uid)}
                    title="Flip this frame horizontally"
                    aria-label="Flip selected frame horizontally"
                    className={`rounded p-1 transition ${
                      selectedFrame.flip_h
                        ? "bg-[var(--studio-accent-soft)] studio-accent-text"
                        : "text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] hover:text-zinc-950 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    }`}
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" />
                  </button>

                  {selectedIndex > 0 && (
                    <select
                      value={selectedFrame.transition_in}
                      onChange={(e) =>
                        onSetFrameTransition(
                          selectedFrame.uid,
                          e.target.value as TransitionType
                        )
                      }
                      aria-label="Transition into selected frame"
                      title="Transition into this frame"
                      className="rounded bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 ring-1 ring-black/10 dark:ring-zinc-700 focus:outline-none"
                    >
                      {TRANSITION_CHOICES.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => onCopyFrameLook(selectedFrame)}
                    title="Copy this frame's timing, crop, filters & motion"
                    className="hidden lg:inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy Look</span>
                  </button>

                  {copiedLook && (
                    <button
                      type="button"
                      onClick={() => triggerPasteFeedback([selectedFrame.uid])}
                      title="Paste copied look onto this frame"
                      className="inline-flex items-center gap-1 rounded bg-[var(--studio-accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold studio-accent-text"
                    >
                      <ClipboardText className="h-3 w-3" />
                      <span>{pasteFeedback ? "Pasted" : "Paste"}</span>
                    </button>
                  )}

                  {hasCustomFrameOverrides(selectedFrame) && (
                    <button
                      type="button"
                      onClick={() => onResetFrameOverrides(selectedFrame.uid)}
                      title="Reset this frame's custom overrides back to global defaults"
                      aria-label="Reset frame overrides"
                      className="rounded p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                    >
                      <ArrowCounterClockwise className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onEditFrameInInspector(selectedFrame.uid)}
                    title="Customize Motion, Crop, Filters & Text for just this frame"
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    <span>Edit Frame</span>
                  </button>
                </div>
              )}

              {frames.length > 0 && (
                <div className="hidden 2xl:flex items-center gap-1 rounded-lg bg-[#efede8] dark:bg-zinc-900 px-1.5 py-0.5 text-[11px]">
                  <span className="px-1 text-zinc-600 dark:text-zinc-400">
                    All:
                  </span>
                  {[120, 250, 500].map((ms) => (
                    <button
                      key={ms}
                      type="button"
                      onClick={() => onApplyUniformDuration(ms)}
                      title={`Set every frame to ${ms}ms`}
                      className="rounded px-1.5 py-0.5 font-mono text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    >
                      {ms}ms
                    </button>
                  ))}
                </div>
              )}

              {frames.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="flex items-center gap-1 rounded-md bg-[#efede8] dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    title="Select all frames (Shift+Click for range)"
                  >
                    <CheckSquare className="h-3 w-3" />
                    <span>Select All</span>
                  </button>
                  <button
                    type="button"
                    onClick={onPingPongTimeline}
                    title="Append reversed intermediate frames to build a boomerang sequence on Timeline"
                    className="hidden sm:flex items-center gap-1 rounded-md bg-[#efede8] dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                  >
                    <Repeat className="h-3 w-3" />
                    <span>Ping-Pong</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onReverseTimeline(false)}
                    className="rounded-md bg-[#efede8] dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                  >
                    Reverse
                  </button>
                </>
              )}

              {/* Card Density Switcher */}
              <div
                role="group"
                aria-label="Timeline card size"
                className="hidden md:flex items-center rounded-md bg-[#efede8] dark:bg-zinc-900 p-0.5 text-[11px]"
              >
                {(["s", "m", "l"] as FrameDensity[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setDensity(sz)}
                    className={`rounded px-1.5 py-0.5 font-mono uppercase transition ${
                      density === sz
                        ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onToggleTimelineExpanded}
                title={
                  timelineExpanded
                    ? "Compact timeline height"
                    : "Expand timeline height"
                }
                aria-label={
                  timelineExpanded
                    ? "Compact timeline height"
                    : "Expand timeline height"
                }
                className="hidden md:flex rounded-md bg-[#efede8] dark:bg-zinc-900 p-1 text-zinc-700 dark:text-zinc-300 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
              >
                {timelineExpanded ? (
                  <ArrowsInSimple className="h-3.5 w-3.5" />
                ) : (
                  <ArrowsOutSimple className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={onTriggerAddImages}
                className="flex items-center gap-1 rounded-md bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
              >
                <Plus className="h-3 w-3" />
                <span>Add Images</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Continuous Playhead Progress Scrubber Line */}
      {frames.length > 0 && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-black/[0.06] dark:border-zinc-800/70 bg-[#efede8]/75 dark:bg-zinc-950/75 px-3 sm:px-4 py-1">
          <div
            ref={scrubTrackRef}
            onPointerDown={handleTrackPointerDown}
            role="slider"
            aria-label="Timeline playhead progress"
            aria-valuemin={1}
            aria-valuemax={frames.length}
            aria-valuenow={Math.max(1, playingFrameIndex + 1)}
            title="Click or drag to scrub preview across timeline frames"
            className="relative flex h-3.5 flex-1 cursor-pointer items-center touch-none select-none"
          >
            {/* Segmented Base Track Showing Per-Frame Slices */}
            <div className="relative flex h-1.5 w-full overflow-hidden rounded-full bg-black/[0.09] dark:bg-zinc-800">
              {frames.map((f, sliceIdx) => {
                const isPlayingSlice = f.uid === playingFrameUid;
                return (
                  <div
                    key={f.uid}
                    style={{ flexGrow: Math.max(1, f.duration_ms) }}
                    className={`h-full transition-colors ${
                      sliceIdx > 0
                        ? "border-l border-black/15 dark:border-zinc-950/80"
                        : ""
                    } ${
                      isPlayingSlice
                        ? "bg-[var(--studio-accent-soft)]"
                        : ""
                    }`}
                  />
                );
              })}
              {/* Elapsed Progress Fill */}
              <div
                ref={scrubFillRef}
                style={{ width: "0%" }}
                className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[var(--studio-accent)]/75"
              />
            </div>

            {/* Precision Vertical Playhead Cursor Needle */}
            <div
              ref={scrubNeedleRef}
              style={{ left: "0%" }}
              className="pointer-events-none absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center"
            >
              <span className="h-1.5 w-2 rounded-b-[2px] bg-[var(--studio-accent)]" />
              <span className="w-[2px] flex-1 bg-zinc-950 dark:bg-white" />
            </div>
          </div>

          <span
            ref={scrubReadoutRef}
            className="w-20 shrink-0 text-right font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-300 tabular-nums"
          >
            #1 · 0.00s
          </span>
        </div>
      )}

      {/* Row 2: Filmstrip Cards Track */}
      <div
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer?.types ?? []);
          if (types.includes("application/x-gif-studio-media") || draggedFrameIdx !== null) {
            e.preventDefault();
            e.dataTransfer.dropEffect = draggedFrameIdx !== null ? "move" : "copy";
            if (dragOverIdx === null) setIsTrackDropActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsTrackDropActive(false);
        }}
        onDrop={(e) => {
          setIsTrackDropActive(false);
          setDragOverIdx(null);
          const rawMedia = e.dataTransfer?.getData("application/x-gif-studio-media");
          if (rawMedia && onInsertMediaAt) {
            e.preventDefault();
            e.stopPropagation();
            try {
              const parsed = JSON.parse(rawMedia) as UploadedMediaItem;
              onInsertMediaAt(parsed);
            } catch {
              // ignore invalid payload
            }
          }
        }}
        className={`flex shrink-0 md:flex-1 items-start md:items-center gap-2.5 overflow-x-auto px-3 sm:px-4 py-3 md:py-2.5 transition-colors ${
          isTrackDropActive ? "bg-[var(--studio-accent-soft)]" : ""
        }`}
      >
        {frames.length === 0 ? (
          <div className="flex w-full items-center justify-center rounded-xl border border-dashed border-black/15 dark:border-zinc-700/80 py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">
            Drag images from Media Bin or drop JPEGs, HEICs, SVGs, or videos here.
          </div>
        ) : (
          frames.map((frame, idx) => {
            const isSelected = activeSelectedUids.includes(frame.uid);
            const isPrimary = frame.uid === selectedFrame?.uid;
            const isPlayingNow = frame.uid === playingFrameUid;
            const isDraggingThis = draggedFrameIdx === idx;
            const isDropTarget = dragOverIdx === idx && draggedFrameIdx !== idx;
            const effMotion = frame.motion ?? globalMotion;
            const hasTransform =
              frame.rotate !== 0 ||
              (frame.straighten ?? 0) !== 0 ||
              frame.flip_h ||
              frame.flip_v ||
              frame.crop !== null;
            const hasFilters = frame.filters !== null;
            const hasText = Boolean(frame.text_overlay?.text?.trim());
            const durationBarPct = Math.min(
              100,
              Math.max(12, Math.round((frame.duration_ms / maxFrameDuration) * 100))
            );

            return (
              <div
                key={frame.uid}
                draggable
                onDragStart={(e) => {
                  setDraggedFrameIdx(idx);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", frame.uid);
                }}
                onDragEnd={() => {
                  setDraggedFrameIdx(null);
                  setDragOverIdx(null);
                  setIsTrackDropActive(false);
                }}
                onDragOver={(e) => {
                  const types = Array.from(e.dataTransfer?.types ?? []);
                  if (
                    draggedFrameIdx !== null ||
                    types.includes("application/x-gif-studio-media")
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = draggedFrameIdx !== null ? "move" : "copy";
                    setDragOverIdx(idx);
                    setIsTrackDropActive(false);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverIdx === idx) setDragOverIdx(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverIdx(null);
                  setIsTrackDropActive(false);
                  const rawMedia = e.dataTransfer?.getData("application/x-gif-studio-media");
                  if (rawMedia && onInsertMediaAt) {
                    try {
                      const parsed = JSON.parse(rawMedia) as UploadedMediaItem;
                      onInsertMediaAt(parsed, idx);
                    } catch {
                      // ignore invalid payload
                    }
                    setDraggedFrameIdx(null);
                    return;
                  }
                  if (draggedFrameIdx !== null && draggedFrameIdx !== idx) {
                    onReorderFrame(draggedFrameIdx, idx);
                  }
                  setDraggedFrameIdx(null);
                }}
                onClick={(e) => onSelectFrameClick(frame.uid, e)}
                className={`group relative flex ${cardSizeClass} shrink-0 cursor-grab active:cursor-grabbing flex-col overflow-hidden studio-control-radius bg-zinc-950 transition ${
                  isDraggingThis
                    ? "opacity-45 scale-95 ring-2 ring-[var(--studio-accent)]"
                    : isDropTarget
                    ? "ring-2 ring-[var(--studio-accent)] scale-[1.03] shadow-lg"
                    : isPlayingNow && !isPrimary
                    ? "ring-2 ring-zinc-900 dark:ring-white shadow-md"
                    : isPrimary
                    ? "ring-2 ring-[var(--studio-accent)] shadow-md"
                    : isSelected
                    ? "ring-2 ring-zinc-500 dark:ring-zinc-300"
                    : "ring-1 ring-black/[0.1] dark:ring-zinc-800 hover:ring-zinc-400 dark:hover:ring-zinc-600"
                }`}
              >
                {isDropTarget && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 z-30 w-1 bg-[var(--studio-accent)]"
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveMediaUrl(frame.media.preview_url)}
                  alt={frame.media.filename}
                  style={{
                    transform: `rotate(${frame.rotate + (frame.straighten ?? 0)}deg) scaleX(${
                      frame.flip_h ? -1 : 1
                    }) scaleY(${frame.flip_v ? -1 : 1})`,
                  }}
                  className="h-full w-full object-cover transition-transform duration-150"
                />

                {/* Live Playhead Progress Overlay Inside Currently Playing Frame */}
                {isPlayingNow && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-black/50">
                      <div
                        ref={activeCardTopBarRef}
                        style={{ width: "0%" }}
                        className="h-full bg-[var(--studio-accent)]"
                      />
                    </div>
                    <div
                      ref={activeCardNeedleRef}
                      style={{ left: "0%" }}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-[var(--studio-accent)]"
                    />
                    {!isPrimary && (
                      <span className="pointer-events-none absolute left-1 top-1.5 z-10 hidden md:inline-flex items-center gap-1 rounded bg-zinc-950/90 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/20 shadow-xs transition-opacity md:group-hover:opacity-0">
                        <span
                          className={`h-1.5 w-1.5 rounded-full bg-[var(--studio-accent)] ${
                            isPreviewPlaying ? "animate-pulse" : ""
                          }`}
                        />
                        {isPreviewPlaying ? "Live" : "Now"}
                      </span>
                    )}
                  </>
                )}

                {/* Status Badges tucked cleanly above bottom footer (unified studio micro-tags) */}
                <div className="pointer-events-none absolute inset-x-1 bottom-[26px] flex flex-wrap gap-1">
                  {effMotion.type !== "none" && (
                    <span className="rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100 ring-1 ring-white/15 backdrop-blur-xs">
                      {effMotion.type.replace("_", " ")}
                    </span>
                  )}
                  {frame.transition_in !== "none" && idx > 0 && (
                    <span className="rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100 ring-1 ring-white/15 backdrop-blur-xs">
                      {frame.transition_in === "crossfade" ? "Fade" : "FX"}
                    </span>
                  )}
                  {hasTransform && (
                    <span className="rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100 ring-1 ring-white/15 backdrop-blur-xs">
                      Crop
                    </span>
                  )}
                  {hasFilters && (
                    <span className="rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100 ring-1 ring-white/15 backdrop-blur-xs">
                      LUT
                    </span>
                  )}
                  {hasText && (
                    <span className="rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xs">
                      T
                    </span>
                  )}
                </div>

                {/* Quick Actions: clean top strip with zero collision */}
                <div
                  className={`absolute inset-x-1 top-1 z-20 flex justify-end gap-0.5 transition ${
                    isPrimary
                      ? "opacity-100"
                      : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSwapTargetUid(frame.uid);
                    }}
                    className="rounded bg-black/80 p-1 text-white hover:bg-[var(--studio-accent)] hover:text-[var(--studio-accent-contrast)]"
                    title="Swap this frame's image"
                    aria-label={`Swap image for frame ${idx + 1}`}
                  >
                    <Swap className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveFrame(idx, -1);
                    }}
                    disabled={idx === 0}
                    className="rounded bg-black/80 p-1 text-white hover:bg-zinc-800 disabled:opacity-35"
                    title="Move Left"
                    aria-label={`Move frame ${idx + 1} left`}
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveFrame(idx, 1);
                    }}
                    disabled={idx === frames.length - 1}
                    className="rounded bg-black/80 p-1 text-white hover:bg-zinc-800 disabled:opacity-35"
                    title="Move Right"
                    aria-label={`Move frame ${idx + 1} right`}
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateFrame(idx);
                    }}
                    className="hidden sm:inline-flex rounded bg-black/80 p-1 text-white hover:bg-zinc-800"
                    title="Duplicate Frame"
                    aria-label={`Duplicate frame ${idx + 1}`}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDeleteSingle(frame, idx);
                    }}
                    className="rounded bg-black/80 p-1 text-red-300 hover:bg-red-600 hover:text-white"
                    title="Remove Frame"
                    aria-label={`Remove frame ${idx + 1}`}
                  >
                    <Trash className="h-3 w-3" />
                  </button>
                </div>

                {/* High-Contrast Footer Scrim + Proportional Duration Bar */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-1.5 pb-1.5 pt-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-mono font-semibold ${
                        isPrimary ? "text-amber-300" : "text-white"
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <span className="font-mono text-zinc-100 tabular-nums">
                      {frame.duration_ms}ms
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-[var(--studio-accent)]"
                      style={{ width: `${durationBarPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Mobile (< md) Selected Frame Studio Summary & Per-Image Shortcuts */}
      {selectedFrame && !isBatchMode && (
        <div className="mx-3 mb-3 md:hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-zinc-900/70 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveMediaUrl(selectedFrame.media.preview_url)}
                alt={selectedFrame.media.filename}
                className="h-10 w-10 shrink-0 rounded-lg bg-[#efede8] dark:bg-zinc-950 object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  #{selectedIndex + 1} · {selectedFrame.media.filename}
                </div>
                <div className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {selectedFrame.media.width}×{selectedFrame.media.height} ·{" "}
                  {selectedFrame.duration_ms}ms · {selectedFrame.rotate}°
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onDuplicateFrame(selectedIndex)}
                aria-label="Duplicate selected frame"
                className="rounded-lg bg-[#efede8] dark:bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => onCopyFrameLook(selectedFrame)}
                className="rounded-lg bg-[#efede8] dark:bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200"
              >
                Copy Look
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                { id: "motion", label: "Motion" },
                { id: "transform", label: "Crop" },
                { id: "effects", label: "Effects" },
                { id: "text", label: "Text" },
              ] as const
            ).map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => onEditFrameInInspector(selectedFrame.uid, target.id)}
                className="rounded-lg bg-[#efede8] dark:bg-zinc-800/90 py-1.5 text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-[var(--studio-accent-soft)]"
              >
                {target.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden Single-Frame Replacement Upload Input */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.apng,.gif,.webp,.avif,.heic,.heif,.hif,.bmp,.tiff,.tif,.svg,.json,.lottie"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const targetUid = swapTargetUid;
          e.target.value = "";
          if (file && targetUid) {
            await onUploadReplacementForFrame(
              targetUid,
              file,
              resetTransformOnSwap
            );
            setSwapTargetUid(null);
            setSwapSearch("");
          }
        }}
      />

      {/* Replace / Customize Individual Frame Image Modal */}
      {swapTargetFrame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={() => {
            setSwapTargetUid(null);
            setSwapSearch("");
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-frame-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-black/10 dark:border-white/10 bg-[#fbfaf8] dark:bg-[#111116] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/[0.08] dark:border-white/[0.08] px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Swap className="h-4 w-4 shrink-0 studio-accent-text" />
                <div className="min-w-0">
                  <h3
                    id="swap-frame-title"
                    className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    Replace Frame #{frames.findIndex((f) => f.uid === swapTargetFrame.uid) + 1} Image
                  </h3>
                  <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                    Current: {swapTargetFrame.media.filename} ({swapTargetFrame.media.width}×{swapTargetFrame.media.height})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSwapTargetUid(null);
                  setSwapSearch("");
                }}
                aria-label="Close replace image dialog"
                className="rounded-lg p-1.5 text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 border-b border-black/[0.08] dark:border-white/[0.08] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isReplacingUpload}
                  onClick={() => replaceFileInputRef.current?.click()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--studio-accent)] px-3.5 py-2.5 text-xs font-semibold text-[var(--studio-accent-contrast)] hover:opacity-90 disabled:opacity-60"
                >
                  {isReplacingUpload ? (
                    <SpinnerGap className="h-4 w-4 animate-spin" />
                  ) : (
                    <CloudArrowUp className="h-4 w-4" />
                  )}
                  <span>
                    {isReplacingUpload
                      ? "Uploading replacement..."
                      : "Upload New Photo / SVG / GIF"}
                  </span>
                </button>
              </div>

              <label className="flex items-center justify-between gap-2 rounded-lg bg-[#efede8] dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 cursor-pointer">
                <span>Reset existing crop &amp; rotation when swapping</span>
                <input
                  type="checkbox"
                  checked={resetTransformOnSwap}
                  onChange={(e) => setResetTransformOnSwap(e.target.checked)}
                  className="h-4 w-4 accent-[var(--studio-accent)]"
                />
              </label>

              {mediaBin.filter((m) => m.media_type === "image").length >= 4 && (
                <div className="relative">
                  <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={swapSearch}
                    onChange={(e) => setSwapSearch(e.target.value)}
                    placeholder="Filter Media Bin images..."
                    aria-label="Filter replacement images"
                    className="w-full rounded-lg bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-7 text-base md:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/10 dark:ring-zinc-700 focus:ring-[var(--studio-accent)] focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {stillMediaOptions.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-600 dark:text-zinc-400">
                  No matching images in Media Bin. Upload a new image above.
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {stillMediaOptions.map((item) => {
                    const isCurrent = item.id === swapTargetFrame.media.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onSwapFrameMedia(
                            swapTargetFrame.uid,
                            item,
                            resetTransformOnSwap
                          );
                          setSwapTargetUid(null);
                          setSwapSearch("");
                        }}
                        className={`group relative flex flex-col overflow-hidden rounded-xl bg-white dark:bg-zinc-900 text-left ring-1 transition ${
                          isCurrent
                            ? "ring-2 ring-[var(--studio-accent)]"
                            : "ring-black/10 dark:ring-zinc-800 hover:ring-[var(--studio-accent)]"
                        }`}
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-[#efede8] dark:bg-zinc-950">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveMediaUrl(item.preview_url)}
                            alt={item.filename}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                          {isCurrent && (
                            <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--studio-accent)] text-[var(--studio-accent-contrast)] shadow-xs">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <div className="truncate px-1.5 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                          {item.filename}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
