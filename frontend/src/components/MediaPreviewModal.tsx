"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilmStrip,
  Images,
  Plus,
  Scissors,
  Trash,
  X,
} from "@/components/StudioIcons";
import { resolveMediaUrl } from "@/lib/api";
import type { UploadedMediaItem } from "@/types/studio";

interface MediaPreviewModalProps {
  item: UploadedMediaItem;
  countInTimeline: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onAddToTimeline: (item: UploadedMediaItem) => void;
  onExtractVideo: (item: UploadedMediaItem) => void;
  onDeleteMedia: (mediaId: string) => void;
}

export function MediaPreviewModal({
  item,
  countInTimeline,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onAddToTimeline,
  onExtractVideo,
  onDeleteMedia,
}: MediaPreviewModalProps) {
  const isVideo = item.media_type === "video";
  const isUsed = countInTimeline > 0;
  const mediaPreviewUrl = resolveMediaUrl(item.preview_url);
  const videoStreamUrl = resolveMediaUrl(
    item.video_url || `/api/media/${item.id}/video`
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNext, hasPrev, onClose, onNext, onPrev]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-preview-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 dark:bg-black/85 p-3 sm:p-5 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="studio-panel-radius flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#fbfaf8] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.4),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.09)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.08] dark:border-zinc-800 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--studio-accent-soft)] studio-accent-text">
              {isVideo ? (
                <FilmStrip className="h-4 w-4" />
              ) : (
                <Images className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3
                  id="media-preview-title"
                  className="studio-display-font truncate text-sm font-semibold tracking-tight"
                >
                  {item.filename}
                </h3>
                {isUsed && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-zinc-800 ring-1 ring-black/[0.08] dark:bg-white/[0.08] dark:text-zinc-200 dark:ring-white/[0.1]">
                    <Check className="h-3 w-3 studio-accent-text" />
                    In Timeline · ×{countInTimeline}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                {item.width}×{item.height} · {item.mime_type}
                {isVideo && item.duration_sec
                  ? ` · ${item.duration_sec.toFixed(1)}s`
                  : ""}
                {isVideo && item.source_fps ? ` · ${item.source_fps} fps` : ""}
                {!isVideo && item.frame_duration_ms
                  ? ` · ${item.frame_duration_ms}ms`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {(hasPrev || hasNext) && (
              <div className="mr-1 flex items-center gap-1">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={onPrev}
                  aria-label="Previous asset"
                  title="Previous asset (Left Arrow)"
                  className="studio-accent-ring rounded-lg p-1.5 text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={onNext}
                  aria-label="Next asset"
                  title="Next asset (Right Arrow)"
                  className="studio-accent-ring rounded-lg p-1.5 text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close media preview"
              className="studio-accent-ring rounded-lg p-1.5 text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Media Viewport */}
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          <div className="studio-control-radius studio-checkerboard relative flex min-h-[220px] max-h-[60dvh] items-center justify-center overflow-hidden border border-black/[0.08] dark:border-white/[0.08] p-2">
            {isVideo ? (
              <video
                key={item.id}
                src={videoStreamUrl}
                poster={mediaPreviewUrl}
                controls
                autoPlay
                loop
                muted
                playsInline
                className="max-h-[56dvh] max-w-full rounded-lg bg-black object-contain shadow-lg"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={item.id}
                src={mediaPreviewUrl}
                alt={item.filename}
                className="max-h-[56dvh] max-w-full rounded-lg object-contain shadow-md"
              />
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black/[0.08] dark:border-zinc-800 bg-[#efede8]/70 dark:bg-zinc-900/70 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => {
              onDeleteMedia(item.id);
              onClose();
            }}
            className="studio-accent-ring studio-control-radius flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-500/15 dark:text-red-300"
          >
            <Trash className="h-3.5 w-3.5" />
            Delete from Bin
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="studio-accent-ring studio-control-radius px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              Close
            </button>
            {isVideo ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onExtractVideo(item);
                }}
                className="studio-accent-ring studio-control-radius studio-accent-bg flex items-center gap-1.5 px-4 py-2 text-xs font-semibold shadow-sm hover:opacity-95"
              >
                <Scissors className="h-3.5 w-3.5" />
                Trim &amp; Extract Frames
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onAddToTimeline(item);
                  onClose();
                }}
                className="studio-accent-ring studio-control-radius studio-accent-bg flex items-center gap-1.5 px-4 py-2 text-xs font-semibold shadow-sm hover:opacity-95"
              >
                <Plus className="h-3.5 w-3.5" />
                {isUsed ? "Add Another Copy" : "Add to Timeline"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
