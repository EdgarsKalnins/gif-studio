"use client";

import React, { useMemo, useState } from "react";
import {
  Check,
  CloudArrowUp,
  Eye,
  FilmStrip,
  Images,
  ListBullets,
  LoopModeGlyph,
  MagnifyingGlass,
  Plus,
  Sparkle,
  SpinnerGap,
  SquaresFour,
  Trash,
  X,
} from "@/components/StudioIcons";
import { MediaPreviewModal } from "@/components/MediaPreviewModal";
import { resolveMediaUrl } from "@/lib/api";
import type { FrameItem, UploadedMediaItem } from "@/types/studio";

interface MediaBinPanelProps {
  mediaBin: UploadedMediaItem[];
  frames: FrameItem[];
  isDraggingUpload: boolean;
  isUploading: boolean;
  isLoadingSamples: boolean;
  uploadError: string | null;
  onTriggerUpload: () => void;
  onLoadSamples: (pack?: "stock" | "motion" | "video") => void;
  onAddImage: (item: UploadedMediaItem) => void;
  onAddManyImages: (items: UploadedMediaItem[]) => void;
  onExtractVideo: (item: UploadedMediaItem) => void;
  onDeleteMedia: (mediaId: string) => void;
  onPruneUnused: (mediaIds: string[]) => void;
}

type MediaFilter = "all" | "image" | "video";
type MediaView = "grid" | "list";

export function MediaBinPanel({
  mediaBin,
  frames,
  isDraggingUpload,
  isUploading,
  isLoadingSamples,
  uploadError,
  onTriggerUpload,
  onLoadSamples,
  onAddImage,
  onAddManyImages,
  onExtractVideo,
  onDeleteMedia,
  onPruneUnused,
}: MediaBinPanelProps) {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<MediaFilter>("all");
  const [viewMode, setViewMode] = useState<MediaView>("grid");
  const [draggingMediaId, setDraggingMediaId] = useState<string | null>(null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);

  const handleDragStartItem = (
    e: React.DragEvent<HTMLElement>,
    item: UploadedMediaItem
  ) => {
    setDraggingMediaId(item.id);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-gif-studio-media", JSON.stringify(item));
  };

  // Map media.id -> usage count on Timeline
  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of frames) {
      counts.set(f.media.id, (counts.get(f.media.id) ?? 0) + 1);
    }
    return counts;
  }, [frames]);

  const { imageCount, videoCount, unusedIds } = useMemo(() => {
    let imgs = 0;
    let vids = 0;
    const unused: string[] = [];
    for (const item of mediaBin) {
      if (item.media_type === "video") vids += 1;
      else imgs += 1;
      if (!usageCounts.has(item.id)) {
        unused.push(item.id);
      }
    }
    return { imageCount: imgs, videoCount: vids, unusedIds: unused };
  }, [mediaBin, usageCounts]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mediaBin.filter((item) => {
      if (filterType !== "all" && item.media_type !== filterType) return false;
      if (q && !item.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mediaBin, filterType, query]);

  // Partition into active (unused) items first and already-used timeline items below
  const { activeItems, inTimelineItems } = useMemo(() => {
    const active: UploadedMediaItem[] = [];
    const inTimeline: UploadedMediaItem[] = [];
    for (const item of filteredItems) {
      if ((usageCounts.get(item.id) ?? 0) > 0) {
        inTimeline.push(item);
      } else {
        active.push(item);
      }
    }
    return { activeItems: active, inTimelineItems: inTimeline };
  }, [filteredItems, usageCounts]);

  const addableImages = useMemo(
    () => activeItems.filter((item) => item.media_type === "image"),
    [activeItems]
  );

  const orderedVisibleItems = useMemo(
    () => [...activeItems, ...inTimelineItems],
    [activeItems, inTimelineItems]
  );
  const previewIndex = useMemo(
    () => (previewItemId ? orderedVisibleItems.findIndex((i) => i.id === previewItemId) : -1),
    [orderedVisibleItems, previewItemId]
  );
  const previewItem = previewIndex >= 0 ? orderedVisibleItems[previewIndex] : null;

  const hasMedia = mediaBin.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfaf8] dark:bg-[#0b0b0f]">
      {/* Responsive Upload Header: generous empty dropzone, sleek bar when populated */}
      <div className="shrink-0 p-3 pb-2">
        <button
          type="button"
          onClick={onTriggerUpload}
          className={`studio-accent-ring studio-control-radius flex w-full transition ${
            hasMedia
              ? "items-center justify-between gap-2.5 border border-dashed px-3 py-2.5 text-left"
              : "flex-col items-center justify-center border border-dashed px-3 py-5 text-center"
          } ${
            isDraggingUpload
              ? "border-[var(--studio-accent)] bg-[var(--studio-accent-soft)]"
              : "border-zinc-300 dark:border-zinc-700/90 bg-[#efede8]/80 dark:bg-zinc-900/60 hover:border-[var(--studio-accent)] hover:bg-[#e7e4dc] dark:hover:bg-zinc-900"
          }`}
        >
          <div className={`flex items-center ${hasMedia ? "gap-2.5 min-w-0" : "flex-col"}`}>
            {isUploading ? (
              <SpinnerGap
                className={`h-5 w-5 shrink-0 animate-spin studio-accent-text ${
                  hasMedia ? "" : "mb-1.5"
                }`}
              />
            ) : (
              <CloudArrowUp
                className={`h-5 w-5 shrink-0 studio-accent-text ${
                  hasMedia ? "" : "mb-1.5"
                }`}
              />
            )}
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {isUploading
                  ? "Processing media..."
                  : hasMedia
                  ? "Import Media"
                  : "Drop or Click to Upload"}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                Images, SVG, .lottie, MP4/MOV
              </div>
            </div>
          </div>
          {hasMedia && (
            <span className="shrink-0 rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              + Add
            </span>
          )}
        </button>

        {uploadError && (
          <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-800 dark:text-red-200">
            {uploadError}
          </div>
        )}
      </div>

      {/* Header + View Switcher + Filter Toolbar */}
      <div className="shrink-0 border-y border-black/[0.07] dark:border-zinc-800/80 px-3 py-2 space-y-2 bg-[#f5f3ee]/80 dark:bg-zinc-950/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Images className="h-3.5 w-3.5 shrink-0 studio-accent-text" />
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              Media Bin ({mediaBin.length})
            </span>
          </div>

          {hasMedia && (
            <div
              role="group"
              aria-label="Media bin layout"
              className="flex shrink-0 items-center rounded-md bg-black/[0.06] p-0.5 dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                className={`rounded p-1 transition ${
                  viewMode === "grid"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                <SquaresFour className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                className={`rounded p-1 transition ${
                  viewMode === "list"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                <ListBullets className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Batch Add / Prune Unused + Search + Type Filter Pills */}
        {(addableImages.length > 1 || unusedIds.length > 0 || mediaBin.length >= 2) && (
          <div className="space-y-1.5">
            {(addableImages.length > 1 || unusedIds.length > 0) && (
              <div className="flex items-center justify-end gap-1.5">
                {addableImages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onAddManyImages(addableImages)}
                    title={`Append all ${addableImages.length} visible photos to Timeline`}
                    className="flex-1 rounded-lg bg-[var(--studio-accent-soft)] px-2.5 py-1 text-[11px] font-semibold studio-accent-text hover:opacity-90 transition"
                  >
                    + Add All ({addableImages.length})
                  </button>
                )}
                {unusedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onPruneUnused(unusedIds)}
                    title={`Remove ${unusedIds.length} unused item(s) not on Timeline`}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-white transition"
                  >
                    Prune ({unusedIds.length})
                  </button>
                )}
              </div>
            )}
            {mediaBin.length >= 4 && (
              <div className="relative">
                <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 dark:text-zinc-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search assets..."
                  aria-label="Filter media bin by filename"
                  className="w-full rounded-lg bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-7 text-base md:text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-600 dark:placeholder:text-zinc-400 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {videoCount > 0 && (
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/[0.05] dark:bg-zinc-900 p-0.5">
                {(
                  [
                    { id: "all", label: `All (${mediaBin.length})` },
                    { id: "image", label: `Stills (${imageCount})` },
                    { id: "video", label: `Video (${videoCount})` },
                  ] as { id: MediaFilter; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterType(tab.id)}
                    className={`rounded-md py-1 text-[11px] font-medium transition ${
                      filterType === tab.id
                        ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Media Gallery */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mediaBin.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-6 text-center">
            <p className="max-w-[200px] text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              Your imported photos, vectors, loops, and iPhone clips appear here.
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[210px]">
              <button
                type="button"
                disabled={isLoadingSamples}
                onClick={() => onLoadSamples("stock")}
                className="studio-control-radius inline-flex items-center justify-center gap-1.5 bg-[#e6e3db] dark:bg-zinc-800 px-3 py-2 text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-[#dad6cc] dark:hover:bg-zinc-700 disabled:opacity-60"
              >
                <Sparkle className="h-3.5 w-3.5 studio-accent-text" />
                {isLoadingSamples ? "Loading..." : "Load Sample Photos"}
              </button>
              <button
                type="button"
                disabled={isLoadingSamples}
                onClick={() => onLoadSamples("motion")}
                className="studio-control-radius inline-flex items-center justify-center gap-1.5 bg-[#efede8] dark:bg-zinc-900 px-3 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 ring-1 ring-black/[0.06] dark:ring-white/[0.06] hover:bg-[#e5e2da] dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                <LoopModeGlyph mode="forward" className="h-3.5 w-3.5 studio-accent-text" />
                15-Frame Motion Loop
              </button>
              <button
                type="button"
                disabled={isLoadingSamples}
                onClick={() => onLoadSamples("video")}
                className="studio-control-radius inline-flex items-center justify-center gap-1.5 bg-[#efede8] dark:bg-zinc-900 px-3 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 ring-1 ring-black/[0.06] dark:ring-white/[0.06] hover:bg-[#e5e2da] dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                <FilmStrip className="h-3.5 w-3.5 studio-accent-text" />
                Try Sample Video
              </button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              No matching assets found.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilterType("all");
              }}
              className="text-[11px] font-medium studio-accent-text hover:underline"
            >
              Reset filter
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {[
              {
                key: "active",
                label: "Active Library",
                items: activeItems,
                isUsedSection: false,
              },
              {
                key: "timeline",
                label: "In Timeline",
                items: inTimelineItems,
                isUsedSection: true,
              },
            ]
              .filter((section) => section.items.length > 0)
              .map((section) => (
                <section
                  key={section.key}
                  aria-label={section.label}
                  className={
                    section.isUsedSection && activeItems.length > 0
                      ? "border-t border-black/[0.06] pt-3 dark:border-white/[0.06]"
                      : undefined
                  }
                >
                  {inTimelineItems.length > 0 && (
                    <div className="mb-1.5 flex items-center justify-between px-0.5 text-[11px] font-semibold uppercase tracking-wider">
                      <span
                        className={`flex items-center gap-1.5 ${
                          section.isUsedSection
                            ? "text-zinc-500 dark:text-zinc-400"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {section.isUsedSection ? (
                          <Check className="h-3 w-3 studio-accent-text" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--studio-accent)]" />
                        )}
                        {section.label}
                      </span>
                      <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                        {section.items.length}
                      </span>
                    </div>
                  )}

                  {viewMode === "grid" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-2">
                      {section.items.map((item) => {
                        const countInTimeline = usageCounts.get(item.id) ?? 0;
                        const isUsed = countInTimeline > 0;
                        const isVideo = item.media_type === "video";
                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => handleDragStartItem(e, item)}
                            onDragEnd={() => setDraggingMediaId(null)}
                            data-in-timeline={isUsed ? "true" : "false"}
                            className={`group relative flex flex-col overflow-hidden studio-control-radius ring-1 transition-all cursor-grab active:cursor-grabbing ${
                              draggingMediaId === item.id
                                ? "opacity-50 scale-95 ring-2 ring-[var(--studio-accent)]"
                                : isUsed
                                ? "bg-black/[0.03] dark:bg-white/[0.02] ring-black/[0.06] dark:ring-white/[0.05] hover:bg-white/80 dark:hover:bg-zinc-900/75"
                                : "bg-white dark:bg-zinc-900/95 ring-black/[0.08] dark:ring-white/[0.08] hover:ring-zinc-400 dark:hover:ring-zinc-600 shadow-2xs"
                            }`}
                          >
                            {/* Thumbnail -> Opens Image/Video Preview Popup Modal */}
                            <button
                              type="button"
                              onClick={() => setPreviewItemId(item.id)}
                              title={`Preview ${item.filename}`}
                              aria-label={`Preview ${item.filename}`}
                              className={`relative aspect-[4/3] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-accent)] ${
                                isUsed
                                  ? "bg-transparent"
                                  : "bg-[#efede8] dark:bg-zinc-950"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={resolveMediaUrl(item.preview_url)}
                                alt={item.filename}
                                loading="lazy"
                                className={`h-full w-full object-cover transition-all duration-200 ${
                                  isUsed
                                    ? "opacity-40 brightness-[0.72] contrast-[0.9] saturate-[0.35] group-hover:opacity-85 group-hover:brightness-95 group-hover:saturate-95"
                                    : "group-hover:scale-105"
                                }`}
                              />

                              {isUsed && (
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 bg-zinc-950/15 dark:bg-black/30"
                                />
                              )}

                              {/* Top-Left Status Badge */}
                              {isVideo ? (
                                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-xs">
                                  <FilmStrip className="h-3 w-3" />
                                  {item.duration_sec ? `${item.duration_sec.toFixed(1)}s` : "MOV"}
                                </span>
                              ) : isUsed ? (
                                <span className="absolute left-1.5 top-1.5 flex max-w-[calc(100%-2.25rem)] md:max-w-[calc(100%-0.75rem)] md:group-hover:max-w-[calc(100%-2.25rem)] items-center gap-1 truncate rounded-md bg-zinc-950/85 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/15 backdrop-blur-xs transition-all">
                                  <Check className="h-3 w-3 shrink-0 studio-accent-text" />
                                  <span className="truncate">In Timeline</span>
                                </span>
                              ) : null}

                              {/* Desktop Hover Pill */}
                              <span className="pointer-events-none absolute inset-0 hidden md:flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                                <span className="flex items-center gap-1 rounded-lg bg-zinc-950/90 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20 shadow-sm">
                                  <Eye className="h-3.5 w-3.5 studio-accent-text" />
                                  Preview
                                </span>
                              </span>
                            </button>

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteMedia(item.id);
                              }}
                              title={`Delete ${item.filename}`}
                              aria-label={`Delete ${item.filename}`}
                              className="absolute right-1.5 top-1.5 rounded-md bg-black/75 p-1 text-zinc-200 opacity-100 md:opacity-0 transition hover:bg-red-600 hover:text-white md:group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <Trash className="h-3 w-3" />
                            </button>

                            {/* Metadata Footer + Quick Add/Cut Action */}
                            <div className="flex items-center justify-between gap-1 border-t border-black/[0.05] dark:border-white/[0.06] px-2 py-1.5">
                              <div className="min-w-0">
                                <div
                                  className={`truncate text-[11px] font-medium ${
                                    isUsed
                                      ? "text-zinc-700 dark:text-zinc-300"
                                      : "text-zinc-900 dark:text-zinc-100"
                                  }`}
                                >
                                  {item.filename}
                                </div>
                                <div className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                                  <span>
                                    {item.width}×{item.height}
                                  </span>
                                  {isUsed && (
                                    <span className="rounded bg-zinc-200/80 px-1 text-[11px] font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                                      ×{countInTimeline}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  isVideo ? onExtractVideo(item) : onAddImage(item)
                                }
                                title={
                                  isVideo
                                    ? `Trim & extract frames from ${item.filename}`
                                    : isUsed
                                    ? `Add another copy of ${item.filename}`
                                    : `Add ${item.filename} to Timeline`
                                }
                                aria-label={
                                  isVideo
                                    ? `Extract frames from ${item.filename}`
                                    : `Add ${item.filename} to timeline`
                                }
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--studio-accent-soft)] studio-accent-text hover:bg-[var(--studio-accent)] hover:text-[var(--studio-accent-contrast)] transition"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Compact List View — Full readable filenames & touch-friendly controls */
                    <div className="flex flex-col gap-1.5">
                      {section.items.map((item) => {
                        const countInTimeline = usageCounts.get(item.id) ?? 0;
                        const isUsed = countInTimeline > 0;
                        const isVideo = item.media_type === "video";
                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => handleDragStartItem(e, item)}
                            onDragEnd={() => setDraggingMediaId(null)}
                            data-in-timeline={isUsed ? "true" : "false"}
                            className={`group flex items-center gap-2.5 studio-control-radius p-1.5 pr-2 ring-1 transition-all cursor-grab active:cursor-grabbing ${
                              draggingMediaId === item.id
                                ? "opacity-50 scale-[0.98] ring-2 ring-[var(--studio-accent)]"
                                : isUsed
                                ? "bg-black/[0.03] dark:bg-white/[0.02] ring-black/[0.06] dark:ring-white/[0.05] hover:bg-white/80 dark:hover:bg-zinc-900/75"
                                : "bg-white dark:bg-zinc-900/95 ring-black/[0.08] dark:ring-white/[0.08] hover:ring-zinc-400 dark:hover:ring-zinc-600"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewItemId(item.id)}
                              title={`Preview ${item.filename}`}
                              aria-label={`Preview ${item.filename}`}
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
                            >
                              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#efede8] dark:bg-zinc-950">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={resolveMediaUrl(item.preview_url)}
                                  alt={item.filename}
                                  loading="lazy"
                                  className={`h-full w-full object-cover transition-all ${
                                    isUsed
                                      ? "opacity-40 brightness-[0.72] saturate-[0.35] group-hover:opacity-85 group-hover:saturate-95"
                                      : ""
                                  }`}
                                />
                                {isUsed && (
                                  <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25"
                                  >
                                    <Check className="h-3.5 w-3.5 text-white drop-shadow" />
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`truncate text-xs font-medium ${
                                      isUsed
                                        ? "text-zinc-700 dark:text-zinc-300"
                                        : "text-zinc-900 dark:text-zinc-100"
                                    }`}
                                  >
                                    {item.filename}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                                  <span className="truncate">
                                    {item.width}×{item.height}
                                  </span>
                                  {isUsed && (
                                    <span
                                      title={`In Timeline ${countInTimeline}×`}
                                      className="shrink-0 rounded bg-zinc-900 px-1.5 text-[11px] font-semibold text-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
                                    >
                                      ×{countInTimeline}
                                    </span>
                                  )}
                                  {isVideo ? (
                                    <span className="shrink-0">
                                      · {item.duration_sec ? `${item.duration_sec.toFixed(1)}s` : "video"}
                                    </span>
                                  ) : item.frame_duration_ms ? (
                                    <span className="shrink-0">· {item.frame_duration_ms}ms</span>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  isVideo ? onExtractVideo(item) : onAddImage(item)
                                }
                                className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                                  isUsed
                                    ? "bg-zinc-200/85 text-zinc-800 hover:bg-[var(--studio-accent)] hover:text-[var(--studio-accent-contrast)] dark:bg-zinc-800 dark:text-zinc-200"
                                    : "bg-[#efede8] text-zinc-900 hover:bg-[var(--studio-accent)] hover:text-[var(--studio-accent-contrast)] dark:bg-zinc-800 dark:text-zinc-100"
                                }`}
                              >
                                {isVideo ? "Extract" : isUsed ? "+ Again" : "+ Add"}
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteMedia(item.id)}
                                aria-label={`Delete ${item.filename}`}
                                className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/15 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-300 transition"
                              >
                                <Trash className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
          </div>
        )}
      </div>

      {previewItem && (
        <MediaPreviewModal
          item={previewItem}
          countInTimeline={usageCounts.get(previewItem.id) ?? 0}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < orderedVisibleItems.length - 1}
          onPrev={() => {
            if (previewIndex > 0) {
              setPreviewItemId(orderedVisibleItems[previewIndex - 1].id);
            }
          }}
          onNext={() => {
            if (previewIndex < orderedVisibleItems.length - 1) {
              setPreviewItemId(orderedVisibleItems[previewIndex + 1].id);
            }
          }}
          onClose={() => setPreviewItemId(null)}
          onAddToTimeline={onAddImage}
          onExtractVideo={onExtractVideo}
          onDeleteMedia={onDeleteMedia}
        />
      )}
    </div>
  );
}
