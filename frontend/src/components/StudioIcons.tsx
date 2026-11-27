"use client";

import React from "react";
import {
  Aperture,
  ArrowArcLeft,
  ArrowArcRight,
  ArrowBendUpLeft,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsLeftRight,
  ArrowsOutCardinal,
  ArrowsOutSimple,
  BookOpenText,
  Check,
  CheckCircle,
  CheckSquare,
  ClipboardText,
  CloudArrowUp,
  Code,
  Copy,
  Crop,
  DownloadSimple,
  Eye,
  EyeSlash,
  Faders,
  FadersHorizontal,
  FilmSlate,
  FilmStrip,
  FlipHorizontal,
  FlipVertical,
  IconContext,
  Image as ImageIcon,
  Images,
  Keyboard,
  ListBullets,
  MagicWand,
  MagnifyingGlass,
  Moon,
  Palette,
  Pause,
  Play,
  Plus,
  Repeat,
  Scales,
  Scissors,
  SidebarSimple,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  SquaresFour,
  Stack,
  Sun,
  Swap,
  Swatches,
  TextT,
  Trash,
  UploadSimple,
  Warning,
  X,
  type IconWeight,
} from "@phosphor-icons/react";
import type { LoopMode } from "@/types/studio";

export type StudioAccent = "amber" | "vermilion" | "teal" | "monochrome";
export type StudioRadius = "sharp" | "balanced" | "soft";
export type StudioFont = "technical" | "editorial";
export type StudioIconSize = "compact" | "default" | "spacious";
export type StudioIconWeight = Extract<IconWeight, "duotone" | "regular" | "bold">;

const ICON_PX: Record<StudioIconSize, number> = {
  compact: 15,
  default: 16,
  spacious: 18,
};

export function StudioIconProvider({
  weight = "duotone",
  iconSize = "default",
  children,
}: {
  weight?: StudioIconWeight;
  iconSize?: StudioIconSize;
  children: React.ReactNode;
}) {
  return (
    <IconContext.Provider
      value={{
        weight,
        size: ICON_PX[iconSize],
        color: "currentColor",
      }}
    >
      {children}
    </IconContext.Provider>
  );
}

/**
 * Bespoke precision hairline glyphs for the 5 GIF loop playback modes.
 */
export function LoopModeGlyph({
  mode,
  className = "h-4 w-4",
}: {
  mode: LoopMode;
  className?: string;
}) {
  switch (mode) {
    case "boomerang":
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
          <path
            d="M4 7h10.5l-2.5-2.5M16 13H5.5L8 15.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="4" cy="7" r="1.2" fill="currentColor" opacity="0.55" />
          <circle cx="16" cy="13" r="1.2" fill="currentColor" opacity="0.55" />
        </svg>
      );
    case "reverse":
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
          <path
            d="M6.5 6.5H13a3.5 3.5 0 0 1 0 7H6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M8.5 4.2 5.8 6.5l2.7 2.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "crossfade_loop":
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
          <circle cx="8" cy="10" r="4.25" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
          <circle cx="12" cy="10" r="4.25" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "once":
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
          <path
            d="M4 10h9m-2.5-2.8L13.3 10l-2.8 2.8M15.8 5.5v9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
          <path
            d="M13.5 6.5H7a3.5 3.5 0 0 0 0 7h7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M11.5 4.2 14.2 6.5l-2.7 2.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export {
  Aperture,
  ArrowArcLeft,
  ArrowArcRight,
  ArrowBendUpLeft,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsLeftRight,
  ArrowsOutCardinal,
  ArrowsOutSimple,
  BookOpenText,
  Check,
  CheckCircle,
  CheckSquare,
  ClipboardText,
  CloudArrowUp,
  Code,
  Copy,
  Crop,
  DownloadSimple,
  Eye,
  EyeSlash,
  Faders,
  FadersHorizontal,
  FilmSlate,
  FilmStrip,
  FlipHorizontal,
  FlipVertical,
  ImageIcon,
  Images,
  Keyboard,
  ListBullets,
  MagicWand,
  MagnifyingGlass,
  Moon,
  Palette,
  Pause,
  Play,
  Plus,
  Repeat,
  Scales,
  Scissors,
  SidebarSimple,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  SquaresFour,
  Stack,
  Sun,
  Swap,
  Swatches,
  TextT,
  Trash,
  UploadSimple,
  Warning,
  X,
};
