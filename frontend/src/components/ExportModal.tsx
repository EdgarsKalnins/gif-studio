"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle,
  Code,
  Copy,
  DownloadSimple,
  SpinnerGap,
  X,
} from "@/components/StudioIcons";
import { resolveMediaUrl } from "@/lib/api";
import { buildEmbedSnippets, FORMAT_META } from "@/lib/embedSnippets";
import type { ExportResponse } from "@/types/studio";

interface ExportModalProps {
  isOpen: boolean;
  isExporting: boolean;
  error: string | null;
  result: ExportResponse | null;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ExportModal({
  isOpen,
  isExporting,
  error,
  result,
  onClose,
}: ExportModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [snippetTab, setSnippetTab] = useState<"html" | "css" | "react" | "tailwind" | "atlasJson">("html");
  const [showAtlasForId, setShowAtlasForId] = useState<string | null>(null);
  const [lottieLoaded, setLottieLoaded] = useState<{
    exportId: string;
    frames: { src: string; ms: number }[];
  } | null>(null);
  const [lottieIdx, setLottieIdx] = useState(0);

  const showAtlas = Boolean(result && showAtlasForId === result.export_id);
  const lottieFrames = useMemo(
    () =>
      result && lottieLoaded?.exportId === result.export_id
        ? lottieLoaded.frames
        : [],
    [result, lottieLoaded]
  );
  const safeLottieIdx =
    lottieFrames.length > 0 ? lottieIdx % lottieFrames.length : 0;

  const snippets = useMemo(
    () => (result ? buildEmbedSnippets(result) : null),
    [result]
  );

  useEffect(() => {
    if (!result || (result.format !== "lottie" && result.format !== "dotlottie")) return;

    const exportId = result.export_id;
    const previewEndpoint =
      result.format === "dotlottie"
        ? `/api/exports/${encodeURIComponent(exportId)}/preview-frames`
        : result.preview_url;
    let cancelled = false;
    fetch(resolveMediaUrl(previewEndpoint))
      .then((res) => res.json())
      .then((doc) => {
        if (cancelled || !doc || !Array.isArray(doc.assets)) return;
        const fr = Number(doc.fr) || 15;
        const byId = new Map<string, string>();
        for (const a of doc.assets as Array<{ id?: string; p?: string }>) {
          if (a?.id && typeof a?.p === "string") {
            byId.set(String(a.id), a.p);
          }
        }
        const layers = Array.isArray(doc.layers)
          ? (doc.layers as Array<{ refId?: string; ip?: number; op?: number }>)
          : [];
        const seq =
          layers.length > 0
            ? layers
                .map((lyr) => {
                  const src = lyr.refId ? byId.get(String(lyr.refId)) : undefined;
                  const span = Math.max(1, Number(lyr.op ?? 1) - Number(lyr.ip ?? 0));
                  const ms = Math.max(40, Math.round((span / fr) * 1000));
                  return src ? { src, ms } : null;
                })
                .filter((x): x is { src: string; ms: number } => Boolean(x))
            : Array.from(byId.values()).map((src) => ({
                src,
                ms: Math.max(40, Math.round(1000 / fr)),
              }));
        if (!cancelled && seq.length > 0) {
          setLottieLoaded({ exportId, frames: seq });
          setLottieIdx(0);
        }
      })
      .catch(() => {
        // Ignore fetch parse error; user can still download JSON
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    if (lottieFrames.length <= 1) return;
    const ms = lottieFrames[safeLottieIdx]?.ms ?? 100;
    const timer = window.setTimeout(() => {
      setLottieIdx((prev) => (prev + 1) % lottieFrames.length);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [lottieFrames, safeLottieIdx]);

  const spritePreviewCss = useMemo(() => {
    if (!result || result.format !== "spritesheet") return null;
    const cols = Math.max(1, result.sprite_cols ?? result.frame_count);
    const rows = Math.max(1, result.sprite_rows ?? 1);
    const fw = result.frame_width ?? Math.round(result.width / cols);
    const fh = result.frame_height ?? Math.round(result.height / rows);
    const pad = Math.max(0, result.sprite_padding ?? 0);
    const maxBox = 240;
    const scale = Math.min(maxBox / fw, maxBox / fh, 1);
    const dw = Math.max(32, Math.round(fw * scale));
    const dh = Math.max(32, Math.round(fh * scale));
    const dPad = pad * scale;
    const bgW = Math.round(result.width * scale);
    const bgH = Math.round(result.height * scale);
    const count = Math.max(1, result.frame_count);
    const durMs = Math.max(120, result.total_duration_ms);
    const animName = `gs_sprite_${result.export_id}`;
    const stops: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const pct = ((i / count) * 100).toFixed(3);
      const col = i % cols;
      const row = Math.floor(i / cols);
      stops.push(
        `${pct}%{background-position:-${Math.round(col * (dw + dPad))}px -${Math.round(row * (dh + dPad))}px;}`
      );
    }
    const keyframes = `@keyframes ${animName}{${stops.join("")}}`;
    return { dw, dh, bgW, bgH, durMs, animName, keyframes };
  }, [result]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resolveMediaUrl(result.download_url));
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore clipboard permission denials
    }
  };

  const activeTabKey =
    snippetTab === "atlasJson" && !snippets?.atlasJson ? "html" : snippetTab;

  const handleCopyCode = async () => {
    if (!snippets) return;
    const content =
      activeTabKey === "atlasJson"
        ? snippets.atlasJson ?? snippets.html
        : snippets[activeTabKey];
    try {
      await navigator.clipboard.writeText(content);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard permission denials
    }
  };

  const isVideo =
    result?.format === "mp4" ||
    result?.format === "webm" ||
    result?.format === "mov_alpha";
  const formatLabel = result
    ? (FORMAT_META[result.format]?.label ?? result.format.toUpperCase())
    : "";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="studio-panel-radius flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden bg-[#fbfaf8] text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.35),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_24px_60px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-3.5">
          <h3
            id="export-modal-title"
            className="studio-display-font text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {isExporting
              ? "Rendering locally with Python + FFmpeg..."
              : error
              ? "Render Failed"
              : "Export Ready"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="studio-accent-ring rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {isExporting && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <SpinnerGap className="studio-accent-text h-9 w-9 animate-spin" />
              <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Synthesizing motion frames &amp; building optimal palette...
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                Two-pass quantization runs privately on your machine.
              </p>
            </div>
          )}

          {error && !isExporting && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
              {error}
            </div>
          )}

          {result && !isExporting && (
            <div className="space-y-4">
              <div
                className={`studio-control-radius relative flex items-center justify-center overflow-hidden p-3 ring-1 ring-black/[0.06] dark:ring-white/[0.06] ${
                  result.format !== "mp4"
                    ? "studio-checkerboard"
                    : "bg-[#eceae4] dark:bg-zinc-950"
                }`}
              >
                {isVideo ? (
                  <video
                    src={resolveMediaUrl(result.preview_url)}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="max-h-64 rounded-lg"
                  />
                ) : result.format === "spritesheet" && spritePreviewCss && !showAtlas ? (
                  <>
                    <style>{spritePreviewCss.keyframes}</style>
                    <div
                      role="img"
                      aria-label="Animated sprite sheet preview"
                      className="rounded-lg shadow-xs"
                      style={{
                        width: `${spritePreviewCss.dw}px`,
                        height: `${spritePreviewCss.dh}px`,
                        backgroundImage: `url(${resolveMediaUrl(result.preview_url)})`,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: `${spritePreviewCss.bgW}px ${spritePreviewCss.bgH}px`,
                        animation: `${spritePreviewCss.animName} ${spritePreviewCss.durMs}ms steps(1, end) infinite`,
                      }}
                    />
                  </>
                ) : result.format === "bundle_zip" ? (
                  <div className="w-full space-y-2 rounded-xl bg-white/85 dark:bg-zinc-950/90 p-3 text-left">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      <span>Web Animation Bundle Archive</span>
                      <span className="font-mono text-[11px] studio-accent-text">
                        {(result.bundle_files ?? []).length} files
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {(result.bundle_files ?? []).map((fname) => (
                        <div
                          key={fname}
                          className="truncate rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
                        >
                          {fname}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : result.format === "lottie" || result.format === "dotlottie" ? (
                  lottieFrames.length > 0 ? (
                    <div className="relative flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={lottieFrames[safeLottieIdx]?.src ?? lottieFrames[0].src}
                        alt="Lottie animation frame preview"
                        className="max-h-64 rounded-lg object-contain"
                      />
                      <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-0.5 font-mono text-[11px] font-medium text-white tabular-nums">
                        Lottie {safeLottieIdx + 1}/{lottieFrames.length}
                      </span>
                    </div>
                  ) : (
                    <div className="py-10 text-xs text-zinc-700 dark:text-zinc-300">
                      Lottie JSON ready ({formatBytes(result.size_bytes)})
                    </div>
                  )
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={resolveMediaUrl(result.preview_url)}
                    alt="Rendered animation preview"
                    className="max-h-64 rounded-lg object-contain"
                  />
                )}

                {result.format === "spritesheet" && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowAtlasForId((prev) =>
                        prev === result.export_id ? null : result.export_id
                      )
                    }
                    className="absolute right-2.5 top-2.5 rounded-md bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs transition hover:bg-black"
                  >
                    {showAtlas ? "Preview Loop" : "Inspect Atlas"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="studio-pill-radius bg-[#efede8] dark:bg-zinc-950/80 p-2.5">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Format
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold uppercase text-zinc-900 dark:text-zinc-100">
                    {formatLabel}
                  </div>
                </div>
                <div className="studio-pill-radius bg-[#efede8] dark:bg-zinc-950/80 p-2.5">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    File Size
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatBytes(result.size_bytes)}
                  </div>
                </div>
                <div className="studio-pill-radius bg-[#efede8] dark:bg-zinc-950/80 p-2.5">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    {result.format === "spritesheet" ? "Atlas Size" : "Resolution"}
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {result.width}×{result.height}
                  </div>
                </div>
                <div className="studio-pill-radius bg-[#efede8] dark:bg-zinc-950/80 p-2.5">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Frames
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {result.frame_count} ({(result.total_duration_ms / 1000).toFixed(1)}s)
                  </div>
                </div>
              </div>

              {snippets && (
                <div className="studio-control-radius bg-[#efede8] dark:bg-zinc-950/80 p-3 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Code className="studio-accent-text h-3.5 w-3.5" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                        Web Dev Snippet
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { id: "html", label: "HTML" },
                          { id: "css", label: "CSS" },
                          { id: "react", label: "React" },
                          { id: "tailwind", label: "Tailwind" },
                          ...(snippets.atlasJson
                            ? [{ id: "atlasJson", label: "Atlas JSON" } as const]
                            : []),
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSnippetTab(tab.id)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                            activeTabKey === tab.id
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="ml-1 inline-flex items-center gap-1 rounded-md bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-800 hover:bg-black/[0.12] dark:bg-white/[0.08] dark:text-zinc-200 dark:hover:bg-white/[0.15]"
                      >
                        {copiedCode ? (
                          <Check className="h-3 w-3 studio-accent-text" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedCode ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    {snippets.note}
                  </p>
                  <pre className="max-h-36 overflow-auto rounded-lg bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-100">
                    <code>
                      {activeTabKey === "atlasJson"
                        ? snippets.atlasJson ?? ""
                        : snippets[activeTabKey]}
                    </code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {result && !isExporting && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 dark:border-zinc-800 px-5 py-3.5">
            <div className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              <CheckCircle className="h-4 w-4 studio-accent-text" />
              Rendered locally (100% offline)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="studio-accent-ring studio-pill-radius flex items-center gap-1.5 bg-[#efede8] px-3 py-2 text-xs font-medium text-zinc-800 transition hover:bg-[#e4e1d9] dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
              >
                {copiedUrl ? (
                  <Check className="h-3.5 w-3.5 studio-accent-text" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedUrl ? "Copied" : "Copy Link"}
              </button>
              <a
                href={resolveMediaUrl(result.download_url)}
                download={result.filename}
                className="studio-accent-ring studio-pill-radius flex items-center gap-2 bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                <DownloadSimple className="h-4 w-4" />
                Download {formatLabel}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
