"use client";

import React, { useEffect, useState } from "react";
import {
  Aperture,
  ArrowSquareOut,
  BookOpenText,
  Check,
  CloudArrowUp,
  Copy,
  Eye,
  EyeSlash,
  FilmStrip,
  Images,
  Keyboard,
  Scales,
  SlidersHorizontal,
  Stack,
  X,
} from "@/components/StudioIcons";

export type GuideModalSection = "guide" | "license";

interface StudioGuideModalProps {
  isOpen: boolean;
  initialSection: GuideModalSection;
  hideOnStartup?: boolean;
  onDontShowAgain?: () => void;
  onResetStartupPrompt?: () => void;
  onClose: () => void;
  onLoadSamples: () => void;
  onTriggerUpload: () => void;
}

const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2026 Edgars Kalnins (https://github.com/EdgarsKalnins, https://momentbox.lv) & GIF Studio Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.`;

const WORKFLOW_STEPS = [
  {
    step: "01",
    icon: CloudArrowUp,
    title: "Import Media, Vectors & Video",
    desc: "Drop JPEGs, PNGs, HEICs, SVGs, .lottie, animated GIFs/WebPs, or MP4/MOV/MKV clips. Click any Media Bin item to preview it in a popup, or drag it straight onto the Timeline.",
  },
  {
    step: "02",
    icon: Stack,
    title: "Trim Video, Shape & Track Playhead",
    desc: "Scrub clips in the live video trimmer, reorder Timeline frames, watch the live playhead progress line, and notice used Media Bin items dim automatically until removed.",
  },
  {
    step: "03",
    icon: SlidersHorizontal,
    title: "Style Borders, Crop & Motion",
    desc: "Switch Beginner/Expert mode, animate stills with Ken Burns or custom Bezier curves, drag the interactive Crop box, and add Polaroid/35mm borders or captions.",
  },
  {
    step: "04",
    icon: FilmStrip,
    title: "Export 11 Formats Locally",
    desc: "Export 2-pass GIFs, WebP, AVIF, APNG, MP4, WebM/MOV alpha, Sprite Sheets, dotLottie, Lottie, or Animated SVG with copy-ready HTML/CSS/React/Tailwind snippets.",
  },
];

const SHORTCUTS = [
  { keys: "Space", action: "Play / pause live canvas preview" },
  { keys: "← / →", action: "Step backward or forward one frame" },
  { keys: "Cmd/Ctrl + Z", action: "Undo timeline or effect changes (40 steps)" },
  { keys: "Shift + Click", action: "Multi-select timeline range for batch edit" },
  { keys: "Delete", action: "Remove selected frames (with confirmation)" },
];

const SAMPLE_SOURCES = [
  {
    title: "Apollo 8 Earthrise (1968)",
    file: "nasa_earthrise.jpg",
    attribution: "NASA · Archival Photo",
    license: "Public Domain",
    url: "https://commons.wikimedia.org/wiki/File:NASA-Apollo8-Dec24-Earthrise.jpg",
    linkLabel: "commons.wikimedia.org · NASA-Apollo8-Dec24-Earthrise.jpg",
  },
  {
    title: "Mars Sunset — Spirit Rover",
    file: "nasa_mars_sunset.jpg",
    attribution: "NASA / JPL-Caltech",
    license: "Public Domain",
    url: "https://commons.wikimedia.org/wiki/File:MarsSunset.jpg",
    linkLabel: "commons.wikimedia.org · MarsSunset.jpg",
  },
  {
    title: "Vintage Film Camera Shelf",
    file: "vintage_camera.jpg",
    attribution: "Wikimedia Commons",
    license: "CC0 1.0",
    url: "https://commons.wikimedia.org/wiki/File:Vintage_camera.jpg",
    linkLabel: "commons.wikimedia.org · Vintage_camera.jpg",
  },
  {
    title: "The Horse in Motion Plate (1878)",
    file: "muybridge_horse_plate.jpg",
    attribution: "Eadweard Muybridge",
    license: "Public Domain",
    url: "https://commons.wikimedia.org/wiki/File:The_Horse_in_Motion.jpg",
    linkLabel: "commons.wikimedia.org · The_Horse_in_Motion.jpg",
  },
  {
    title: "Animated Gallop Sequence (15 frames)",
    file: "muybridge_gallop.gif",
    attribution: "Eadweard Muybridge",
    license: "Public Domain",
    url: "https://commons.wikimedia.org/wiki/File:Muybridge_race_horse_animated.gif",
    linkLabel: "commons.wikimedia.org · Muybridge_race_horse_animated.gif",
  },
  {
    title: "Gallop Sample Video Clip (3.0s MP4)",
    file: "sample_clip.mp4",
    attribution: "Eadweard Muybridge (H.264 encode)",
    license: "Public Domain",
    url: "https://commons.wikimedia.org/wiki/File:Muybridge_race_horse_animated.gif",
    linkLabel: "commons.wikimedia.org · Muybridge_race_horse_animated.gif",
  },
];

export function StudioGuideModal({
  isOpen,
  initialSection,
  hideOnStartup = false,
  onDontShowAgain,
  onResetStartupPrompt,
  onClose,
  onLoadSamples,
  onTriggerUpload,
}: StudioGuideModalProps) {
  const [section, setSection] = useState<GuideModalSection>(initialSection);
  const [prevInitial, setPrevInitial] = useState<GuideModalSection>(initialSection);
  const [copiedMit, setCopiedMit] = useState(false);

  if (initialSection !== prevInitial) {
    setPrevInitial(initialSection);
    setSection(initialSection);
  }

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

  const handleCopyMit = async () => {
    try {
      await navigator.clipboard.writeText(MIT_LICENSE_TEXT);
      setCopiedMit(true);
      setTimeout(() => setCopiedMit(false), 1800);
    } catch {
      // Ignore clipboard denials
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-guide-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="studio-panel-radius flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden bg-[#fbfaf8] text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.35),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_24px_60px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950">
              <Aperture className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2
                id="studio-guide-title"
                className="studio-display-font text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                GIF Studio Guide &amp; Open Source
              </h2>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
                100% local · Offline FFmpeg · MIT licensed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="studio-control-radius flex items-center gap-1 bg-[#efede8] dark:bg-zinc-950 p-1 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
              <button
                type="button"
                onClick={() => setSection("guide")}
                className={`studio-pill-radius flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition ${
                  section === "guide"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-xs"
                    : "text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                }`}
              >
                <BookOpenText className="h-3.5 w-3.5" />
                How to Use
              </button>
              <button
                type="button"
                onClick={() => setSection("license")}
                className={`studio-pill-radius flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition ${
                  section === "license"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-xs"
                    : "text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                }`}
              >
                <Scales className="h-3.5 w-3.5" />
                Open Source (MIT)
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close guide modal"
              className="studio-accent-ring rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {section === "guide" ? (
            <>
              <section aria-labelledby="how-to-use-heading" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    id="how-to-use-heading"
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200"
                  >
                    4-Step Local Workflow
                  </h3>
                  <span className="rounded-md bg-[#efede8] dark:bg-zinc-950 px-2 py-0.5 text-[11px] font-mono text-zinc-700 dark:text-zinc-300">
                    JPEG · PNG · GIF · WebP · HEIC · MOV/MP4
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {WORKFLOW_STEPS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.step}
                        className="studio-control-radius bg-[#f3f1ec] dark:bg-zinc-950/70 p-3.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="studio-accent-soft studio-accent-text flex h-6 w-6 items-center justify-center rounded-lg">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                              {item.title}
                            </span>
                          </div>
                          <span className="studio-accent-text font-mono text-[11px] font-semibold tabular-nums">
                            {item.step}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {item.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="studio-control-radius bg-[#f3f1ec] dark:bg-zinc-950/70 p-3.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                <div className="mb-2.5 flex items-center gap-2">
                  <Keyboard className="studio-accent-text h-3.5 w-3.5" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
                    Keyboard Shortcuts
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SHORTCUTS.map((sc) => (
                    <div
                      key={sc.keys}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/80 dark:bg-zinc-900/80 px-2.5 py-2 ring-1 ring-black/[0.04] dark:ring-white/[0.04]"
                    >
                      <span className="text-xs text-zinc-700 dark:text-zinc-300">
                        {sc.action}
                      </span>
                      <kbd className="shrink-0 rounded-md bg-[#eceae4] dark:bg-zinc-800 px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-white/10">
                        {sc.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>

              <section
                aria-labelledby="sample-sources-heading"
                className="studio-control-radius bg-[#f3f1ec] dark:bg-zinc-950/70 p-3.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]"
              >
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Images className="studio-accent-text h-3.5 w-3.5" />
                    <h3
                      id="sample-sources-heading"
                      className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200"
                    >
                      Sample Media Sources &amp; Licenses
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Bundled offline from public domain archives
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {SAMPLE_SOURCES.map((src) => (
                    <div
                      key={src.file}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 dark:bg-zinc-900/80 px-3 py-2 ring-1 ring-black/[0.04] dark:ring-white/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                            {src.title}
                          </span>
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            · {src.attribution}
                          </span>
                        </div>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="studio-accent-text mt-0.5 inline-flex max-w-full items-center gap-1 text-[11px] hover:underline"
                        >
                          <span className="truncate">{src.linkLabel}</span>
                          <ArrowSquareOut className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                      <span className="shrink-0 rounded-md bg-black/[0.06] px-2 py-0.5 text-[11px] font-semibold text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-200">
                        {src.license}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <>
              {/* Simple Open Source & GitHub Link Block */}
              <section className="studio-control-radius bg-[#f3f1ec] dark:bg-zinc-950/70 p-4 ring-1 ring-black/[0.06] dark:ring-white/[0.06] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                  Runs locally on your machine with zero cloud uploads or
                  tracking. Free and open source under the MIT License.
                </p>
                <a
                  href="https://github.com/EdgarsKalnins/gif-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="studio-accent-text inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                >
                  github.com/EdgarsKalnins/gif-studio
                  <ArrowSquareOut className="h-3 w-3" />
                </a>
              </section>

              {/* MIT License Text */}
              <section className="studio-control-radius bg-[#f3f1ec] dark:bg-zinc-950/70 p-4 ring-1 ring-black/[0.06] dark:ring-white/[0.06] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
                    MIT License
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopyMit}
                    className="flex items-center gap-1.5 rounded-lg bg-[#e6e4de] px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition hover:bg-[#dcd9d1] dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
                  >
                    {copiedMit ? (
                      <Check className="h-3 w-3 studio-accent-text" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedMit ? "Copied License" : "Copy MIT Text"}
                  </button>
                </div>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/85 dark:bg-zinc-900/90 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                  {MIT_LICENSE_TEXT}
                </pre>
              </section>
            </>
          )}
        </div>

        {/* Footer CTA */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setSection((s) => (s === "guide" ? "license" : "guide"))
              }
              className="studio-accent-text text-xs font-medium hover:underline"
            >
              {section === "guide"
                ? "View Open Source (MIT) →"
                : "← Back to Workflow"}
            </button>

            {!hideOnStartup && onDontShowAgain && (
              <button
                type="button"
                onClick={onDontShowAgain}
                className="studio-accent-ring studio-pill-radius flex items-center gap-1.5 bg-[#efede8] px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-[#e5e2db] hover:text-zinc-950 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
              >
                <EyeSlash className="h-3.5 w-3.5" />
                Don&apos;t show again
              </button>
            )}

            {hideOnStartup && onResetStartupPrompt && (
              <button
                type="button"
                onClick={onResetStartupPrompt}
                className="studio-accent-ring studio-pill-radius flex items-center gap-1.5 bg-[#efede8] px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-[#e5e2db] hover:text-zinc-950 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
              >
                <Eye className="h-3.5 w-3.5" />
                Show on startup
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onLoadSamples();
              }}
              className="studio-pill-radius bg-[#efede8] px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-[#e5e2db] dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              Try Sample Photos
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onTriggerUpload();
              }}
              className="studio-pill-radius bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              Import Media
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
