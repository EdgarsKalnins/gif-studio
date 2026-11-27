"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  ArrowArcLeft,
  ArrowArcRight,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOutCardinal,
  BookOpenText,
  Check,
  CloudArrowUp,
  Crop,
  DownloadSimple,
  FadersHorizontal,
  FlipHorizontal,
  FlipVertical,
  LoopModeGlyph,
  MagicWand,
  Moon,
  Palette,
  Repeat,
  Scales,
  SidebarSimple,
  StudioIconProvider,
  Sun,
  Swatches,
  TextT,
  Warning,
  X,
  type StudioAccent,
  type StudioFont,
  type StudioIconSize,
  type StudioIconWeight,
  type StudioRadius,
} from "@/components/StudioIcons";
import { BezierCurveEditor } from "@/components/BezierCurveEditor";
import { CanvasPreview } from "@/components/CanvasPreview";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ExportModal } from "@/components/ExportModal";
import { MediaBinPanel } from "@/components/MediaBinPanel";
import {
  TimelinePanel,
  type CopiedFrameLook,
} from "@/components/TimelinePanel";
import {
  StudioGuideModal,
  type GuideModalSection,
} from "@/components/StudioGuideModal";
import { VideoExtractModal } from "@/components/VideoExtractModal";
import { FORMAT_META } from "@/lib/embedSnippets";
import { prepareUploadFiles } from "@/lib/lottieImport";
import {
  API_BASE,
  checkBackendHealth,
  deleteMediaItem,
  exportProject,
  listMediaItems,
  loadDemoSamples,
  uploadMediaFiles,
} from "@/lib/api";
import {
  DEFAULT_BORDER,
  DEFAULT_EXPORT,
  DEFAULT_FILTERS,
  DEFAULT_MOTION,
  DEFAULT_TEXT,
  DEFAULT_TEXT_LAYER,
  FILTER_PRESETS,
  LOOP_MODES,
  MOTION_EASING_OPTIONS,
  MOTION_OPTIONS,
  TRANSITION_OPTIONS,
  type AspectRatioPreset,
  type BgMatteMode,
  type BorderConfig,
  type BorderStyle,
  type CropAspectLock,
  type CropConfig,
  type ExportConfig,
  type ExportResponse,
  type FilterConfig,
  type FitMode,
  type FrameItem,
  type LivePlaybackSnapshot,
  type LoopMode,
  type MotionConfig,
  type PlaybackProgressChannel,
  type RotateDegrees,
  type StudioExperienceMode,
  type TextBadgeLayer,
  type TextOverlayConfig,
  type TransitionType,
  type UploadedMediaItem,
} from "@/types/studio";

type InspectorTab = "loop" | "motion" | "transform" | "effects" | "text" | "export";
type MobilePane = "media" | "timeline" | "inspector";

type PendingDeleteAction =
  | { kind: "single"; uid: string; index: number; filename: string }
  | { kind: "batch"; uids: string[] }
  | { kind: "clear_all"; count: number }
  | {
      kind: "media_single";
      mediaId: string;
      filename: string;
      usedCount: number;
      isVideo: boolean;
    }
  | { kind: "media_prune"; mediaIds: string[] };

interface ProjectSnapshot {
  frames: FrameItem[];
  aspectRatio: AspectRatioPreset;
  fitMode: FitMode;
  bgColor: string;
  loopMode: LoopMode;
  loopCount: number;
  speedMultiplier: number;
  endHoldMs: number;
  crossfadeLoopMs: number;
  globalMotion: MotionConfig;
  globalFilters: FilterConfig;
  globalText: TextOverlayConfig;
  border: BorderConfig;
}

const DRAFT_STORAGE_KEY = "gif-studio-draft-v1";
const GUIDE_HIDE_COOKIE = "gif_studio_hide_guide";
const MODE_STORAGE_KEY = "gif_studio_mode";
const MAX_HISTORY = 40;

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function setHideGuideCookie(hide: boolean) {
  if (typeof document === "undefined") return;
  if (hide) {
    document.cookie = `${GUIDE_HIDE_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
  } else {
    document.cookie = `${GUIDE_HIDE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

const INITIAL_PROJECT: ProjectSnapshot = {
  frames: [],
  aspectRatio: "1:1",
  fitMode: "fill",
  bgColor: "#09090B",
  loopMode: "forward",
  loopCount: 0,
  speedMultiplier: 1.0,
  endHoldMs: 0,
  crossfadeLoopMs: 350,
  globalMotion: DEFAULT_MOTION,
  globalFilters: DEFAULT_FILTERS,
  globalText: DEFAULT_TEXT,
  border: DEFAULT_BORDER,
};

const CUSTOM_RECIPES_KEY = "gifstudio_custom_recipes_v1";

interface SavedCustomRecipe {
  id: string;
  name: string;
  loopMode: LoopMode;
  speedMultiplier: number;
  endHoldMs: number;
  crossfadeLoopMs: number;
  globalMotion: MotionConfig;
  globalFilters: FilterConfig;
  globalText: TextOverlayConfig;
  border: BorderConfig;
}

function createFrameFromMedia(
  media: UploadedMediaItem,
  durationMs = 500
): FrameItem {
  return {
    uid: `${media.id}_${Math.random().toString(36).slice(2, 9)}`,
    media,
    duration_ms: durationMs,
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
  };
}

const ACCENT_PRESETS: { id: StudioAccent; label: string; swatch: string }[] = [
  { id: "amber", label: "Amber", swatch: "#d97706" },
  { id: "vermilion", label: "Vermilion", swatch: "#ea580c" },
  { id: "teal", label: "Teal", swatch: "#0f766e" },
  { id: "monochrome", label: "Ink", swatch: "#52525b" },
];

const ANCHOR_POINTS = [
  { x: 0.15, y: 0.15 },
  { x: 0.5, y: 0.15 },
  { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.85, y: 0.5 },
  { x: 0.15, y: 0.85 },
  { x: 0.5, y: 0.85 },
  { x: 0.85, y: 0.85 },
];

export function StudioApp() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mediaBin, setMediaBin] = useState<UploadedMediaItem[]>([]);
  const [project, setProject] = useState<ProjectSnapshot>(INITIAL_PROJECT);
  const [past, setPast] = useState<ProjectSnapshot[]>([]);
  const [future, setFuture] = useState<ProjectSnapshot[]>([]);
  const [exportConfig, setExportConfig] = useState<ExportConfig>(DEFAULT_EXPORT);

  const [selectedFrameUids, setSelectedFrameUids] = useState<string[]>([]);
  const [selectionAnchorUid, setSelectionAnchorUid] = useState<string | null>(null);

  const [inspectorScope, setInspectorScope] = useState<"global" | "frame">("global");
  const [studioMode, setStudioMode] = useState<StudioExperienceMode>("beginner");
  const [activeTab, setActiveTab] = useState<InspectorTab>("loop");
  const [mobilePane, setMobilePane] = useState<MobilePane>("inspector");
  const [desktopMediaOpen, setDesktopMediaOpen] = useState(true);
  const [tabletMediaDrawerOpen, setTabletMediaDrawerOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [mobileStageCompact, setMobileStageCompact] = useState(false);
  const [cropEditEnabled, setCropEditEnabled] = useState(true);
  const [cropAspectLock, setCropAspectLock] = useState<CropAspectLock>("free");

  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [pendingVideosQueue, setPendingVideosQueue] = useState<UploadedMediaItem[]>([]);
  const pendingVideo = pendingVideosQueue[0] ?? null;

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResponse | null>(null);

  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [copiedLook, setCopiedLook] = useState<CopiedFrameLook | null>(null);
  const [isReplacingFrameUpload, setIsReplacingFrameUpload] = useState(false);
  const [showSafeGuides, setShowSafeGuides] = useState(false);
  const [seekToMsRequest, setSeekToMsRequest] = useState<{
    ms?: number;
    frameUid?: string;
    frameRatio?: number;
    play?: boolean;
    nonce: number;
  } | null>(null);
  const [playingFrameUid, setPlayingFrameUid] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
  const playbackSubscribersRef = useRef<Set<(snap: LivePlaybackSnapshot) => void>>(
    new Set()
  );
  const latestPlaybackRef = useRef<LivePlaybackSnapshot>({
    activeFrameUid: null,
    activeFrameIndex: -1,
    frameProgress: 0,
    timelineProgress: 0,
    playheadMs: 0,
    totalDurationMs: 0,
    isPlaying: true,
  });
  const playbackChannel = useMemo<PlaybackProgressChannel>(
    () => ({
      get latest() {
        return latestPlaybackRef.current;
      },
      subscribe: (fn) => {
        playbackSubscribersRef.current.add(fn);
        return () => {
          playbackSubscribersRef.current.delete(fn);
        };
      },
    }),
    []
  );
  const handleEmitPlayback = useCallback((snap: LivePlaybackSnapshot) => {
    latestPlaybackRef.current = snap;
    for (const fn of playbackSubscribersRef.current) {
      fn(snap);
    }
  }, []);
  const handleActivePlayingChange = useCallback(
    (uid: string | null, isPlaying: boolean) => {
      setPlayingFrameUid(uid);
      setIsPreviewPlaying(isPlaying);
    },
    []
  );
  const [bpmValue, setBpmValue] = useState(120);
  const [bpmSubdivision, setBpmSubdivision] = useState<1 | 2 | 4>(2);
  const [savedRecipes, setSavedRecipes] = useState<SavedCustomRecipe[]>([]);
  const [newRecipeName, setNewRecipeName] = useState("");
  const [activeTextLayerIdx, setActiveTextLayerIdx] = useState(-1);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteAction | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [guideModalSection, setGuideModalSection] =
    useState<GuideModalSection | null>(null);
  const [hideGuideOnStartup, setHideGuideOnStartup] = useState(false);

  // Customizable CSS Appearance State (accent, font, corner radius, icon weight/size)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [accent, setAccent] = useState<StudioAccent>("amber");
  const [radiusMode, setRadiusMode] = useState<StudioRadius>("balanced");
  const [fontMode, setFontMode] = useState<StudioFont>("technical");
  const [iconWeight, setIconWeight] = useState<StudioIconWeight>("duotone");
  const [iconSize, setIconSize] = useState<StudioIconSize>("default");
  const styleMenuRef = useRef<HTMLDivElement | null>(null);

  const applyStudioMode = useCallback((next: StudioExperienceMode) => {
    setStudioMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const applyAccent = useCallback((val: StudioAccent) => {
    setAccent(val);
    document.documentElement.setAttribute("data-accent", val);
    try {
      localStorage.setItem("gif_studio_accent", val);
    } catch {
      // ignore
    }
  }, []);

  const applyRadius = useCallback((val: StudioRadius) => {
    setRadiusMode(val);
    document.documentElement.setAttribute("data-radius", val);
    try {
      localStorage.setItem("gif_studio_radius", val);
    } catch {
      // ignore
    }
  }, []);

  const applyFont = useCallback((val: StudioFont) => {
    setFontMode(val);
    document.documentElement.setAttribute("data-font", val);
    try {
      localStorage.setItem("gif_studio_font", val);
    } catch {
      // ignore
    }
  }, []);

  const applyIconWeight = useCallback((val: StudioIconWeight) => {
    setIconWeight(val);
    try {
      localStorage.setItem("gif_studio_icon_weight", val);
    } catch {
      // ignore
    }
  }, []);

  const applyIconSize = useCallback((val: StudioIconSize) => {
    setIconSize(val);
    document.documentElement.setAttribute("data-icon-size", val);
    try {
      localStorage.setItem("gif_studio_icon_size", val);
    } catch {
      // ignore
    }
  }, []);

  const resetStudioStyles = useCallback(() => {
    applyAccent("amber");
    applyRadius("balanced");
    applyFont("technical");
    applyIconWeight("duotone");
    applyIconSize("default");
  }, [applyAccent, applyRadius, applyFont, applyIconWeight, applyIconSize]);

  useEffect(() => {
    if (!styleMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setStyleMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStyleMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [styleMenuOpen]);

  const handleDontShowGuideAgain = useCallback(() => {
    setHideGuideCookie(true);
    setHideGuideOnStartup(true);
    setGuideModalSection(null);
  }, []);

  const handleResetGuidePrompt = useCallback(() => {
    setHideGuideCookie(false);
    setHideGuideOnStartup(false);
  }, []);

  const handleToggleTheme = useCallback(() => {
    const root = document.documentElement;
    const isDarkNow = root.classList.contains("dark");
    const nextDark = !isDarkNow;
    root.classList.toggle("dark", nextDark);
    root.style.colorScheme = nextDark ? "dark" : "light";
    try {
      localStorage.setItem("gif_studio_theme", nextDark ? "dark" : "light");
    } catch {
      // Ignore storage failures
    }
  }, []);

  // Refs for slider-coalescing history
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const coalesceBaseRef = useRef<ProjectSnapshot | null>(null);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitProject = useCallback(
    (
      updater: ProjectSnapshot | ((prev: ProjectSnapshot) => ProjectSnapshot),
      options?: { coalesce?: boolean }
    ) => {
      if (options?.coalesce) {
        if (!coalesceBaseRef.current) {
          coalesceBaseRef.current = projectRef.current;
        }
        setProject((prev) =>
          typeof updater === "function" ? updater(prev) : updater
        );
        if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = setTimeout(() => {
          const base = coalesceBaseRef.current;
          coalesceBaseRef.current = null;
          if (base) {
            setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), base]);
            setFuture([]);
          }
        }, 380);
        return;
      }

      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
      const base = coalesceBaseRef.current ?? projectRef.current;
      coalesceBaseRef.current = null;
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), base]);
      setFuture([]);
      setProject((prev) =>
        typeof updater === "function" ? updater(prev) : updater
      );
    },
    []
  );

  const flushCoalescedHistory = useCallback(() => {
    if (coalesceTimerRef.current) {
      clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
    }
    const base = coalesceBaseRef.current;
    coalesceBaseRef.current = null;
    if (base) {
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), base]);
      setFuture([]);
    }
  }, []);

  const handleUndo = useCallback(() => {
    flushCoalescedHistory();
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((f) => [projectRef.current, ...f.slice(0, MAX_HISTORY - 1)]);
      setProject(previous);
      return prevPast.slice(0, -1);
    });
  }, [flushCoalescedHistory]);

  const handleRedo = useCallback(() => {
    flushCoalescedHistory();
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), projectRef.current]);
      setProject(next);
      return prevFuture.slice(1);
    });
  }, [flushCoalescedHistory]);

  // Health check + restore persistent draft validated against GET /api/media
  const verifyBackend = useCallback(async () => {
    const ok = await checkBackendHealth();
    setBackendOnline(ok);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (!active) return;
      const hiddenByCookie = getCookieValue(GUIDE_HIDE_COOKIE) === "1";
      setHideGuideOnStartup(hiddenByCookie);
      if (!hiddenByCookie) {
        setGuideModalSection("guide");
      }
      try {
        const savedAccent = localStorage.getItem("gif_studio_accent") as StudioAccent | null;
        if (savedAccent) setAccent(savedAccent);
        const savedRadius = localStorage.getItem("gif_studio_radius") as StudioRadius | null;
        if (savedRadius) setRadiusMode(savedRadius);
        const savedFont = localStorage.getItem("gif_studio_font") as StudioFont | null;
        if (savedFont) setFontMode(savedFont);
        const savedWeight = localStorage.getItem("gif_studio_icon_weight") as StudioIconWeight | null;
        if (savedWeight) setIconWeight(savedWeight);
        const savedIconSz = localStorage.getItem("gif_studio_icon_size") as StudioIconSize | null;
        if (savedIconSz) setIconSize(savedIconSz);
        const savedMode = localStorage.getItem(MODE_STORAGE_KEY) as StudioExperienceMode | null;
        if (savedMode === "beginner" || savedMode === "expert") setStudioMode(savedMode);
        const savedRecRaw = localStorage.getItem(CUSTOM_RECIPES_KEY);
        if (savedRecRaw) {
          const parsedRec = JSON.parse(savedRecRaw) as SavedCustomRecipe[];
          if (Array.isArray(parsedRec)) setSavedRecipes(parsedRec.slice(0, 12));
        }
      } catch {
        // ignore storage errors
      }

      const ok = await checkBackendHealth();
      if (!active) return;
      setBackendOnline(ok);

      let serverMedia: UploadedMediaItem[] = [];
      if (ok) {
        try {
          serverMedia = await listMediaItems();
        } catch {
          serverMedia = [];
        }
      }
      const validIds = new Set(serverMedia.map((m) => m.id));

      try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            mediaBin?: UploadedMediaItem[];
            project?: Partial<ProjectSnapshot>;
            exportConfig?: Partial<ExportConfig>;
          };
          if (parsed.mediaBin) {
            const restoredBin = ok
              ? parsed.mediaBin.filter((m) => validIds.has(m.id))
              : parsed.mediaBin;
            if (active) setMediaBin(restoredBin);
          } else if (ok && serverMedia.length > 0 && active) {
            setMediaBin(serverMedia);
          }

          if (parsed.project && active) {
            const rawFrames = Array.isArray(parsed.project.frames)
              ? parsed.project.frames
              : [];
            const validFrames = (
              ok ? rawFrames.filter((f) => validIds.has(f.media?.id)) : rawFrames
            ).map((f) => ({
              ...f,
              crop: f.crop ?? null,
              rotate: f.rotate ?? 0,
              straighten: f.straighten ?? 0,
              flip_h: Boolean(f.flip_h),
              flip_v: Boolean(f.flip_v),
            }));
            setProject({
              ...INITIAL_PROJECT,
              ...parsed.project,
              speedMultiplier: parsed.project.speedMultiplier ?? 1.0,
              endHoldMs: parsed.project.endHoldMs ?? 0,
              crossfadeLoopMs: parsed.project.crossfadeLoopMs ?? 350,
              globalMotion: { ...DEFAULT_MOTION, ...(parsed.project.globalMotion ?? {}) },
              globalFilters: { ...DEFAULT_FILTERS, ...(parsed.project.globalFilters ?? {}) },
              globalText: { ...DEFAULT_TEXT, ...(parsed.project.globalText ?? {}) },
              border: { ...DEFAULT_BORDER, ...(parsed.project.border ?? {}) },
              frames: validFrames,
            });
            if (validFrames.length > 0) {
              setSelectedFrameUids([validFrames[0].uid]);
              setSelectionAnchorUid(validFrames[0].uid);
            }
          }
          if (parsed.exportConfig && active) {
            setExportConfig({
              ...DEFAULT_EXPORT,
              ...parsed.exportConfig,
              transparent_bg: Boolean(parsed.exportConfig.transparent_bg),
            });
          }
        } else if (ok && serverMedia.length > 0 && active) {
          setMediaBin(serverMedia);
        }
      } catch {
        // Ignore corrupt localStorage draft
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Auto-save draft to localStorage after hydration
  const flushDraftToStorage = useCallback(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ mediaBin, project, exportConfig })
      );
    } catch {
      // Ignore quota errors
    }
  }, [hydrated, mediaBin, project, exportConfig]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(flushDraftToStorage, 250);
    return () => clearTimeout(timer);
  }, [hydrated, flushDraftToStorage]);

  const flushDraftRef = useRef(flushDraftToStorage);
  useEffect(() => {
    flushDraftRef.current = flushDraftToStorage;
  }, [flushDraftToStorage]);

  // Desktop close confirmation IPC hook (window close button, Cmd+W, Cmd+Q, Dock Quit)
  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.gifStudioDesktop : undefined;
    if (!desktop?.isDesktopApp) return;

    desktop.setCloseConfirmReady?.(true);
    const unsubscribe = desktop.onCloseRequest?.(() => {
      desktop.ackCloseRequest?.();
      flushDraftRef.current();
      setCloseConfirmOpen(true);
    });

    return () => {
      unsubscribe?.();
      desktop.setCloseConfirmReady?.(false);
    };
  }, []);

  // Browser tab fallback guard when not inside the Electron desktop shell
  const hasActiveBackgroundJob =
    isUploading || isExporting || isLoadingSamples || isReplacingFrameUpload;

  useEffect(() => {
    if (typeof window === "undefined" || window.gifStudioDesktop?.isDesktopApp) return;
    const shouldWarnWebClose = project.frames.length > 0 || hasActiveBackgroundJob;
    if (!shouldWarnWebClose) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      flushDraftRef.current();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [project.frames.length, hasActiveBackgroundJob]);

  const handleConfirmCloseApp = useCallback(() => {
    flushDraftRef.current();
    setCloseConfirmOpen(false);
    window.gifStudioDesktop?.respondCloseRequest?.(true);
  }, []);

  const handleCancelCloseApp = useCallback(() => {
    setCloseConfirmOpen(false);
    window.gifStudioDesktop?.respondCloseRequest?.(false);
  }, []);

  const {
    frames,
    aspectRatio,
    fitMode,
    bgColor,
    loopMode,
    loopCount,
    speedMultiplier,
    endHoldMs,
    crossfadeLoopMs,
    globalMotion,
    globalFilters,
    globalText,
    border,
  } = project;

  const hasExpertTweaks = useMemo(() => {
    if (
      Math.abs(speedMultiplier - 1) > 0.02 ||
      endHoldMs > 0 ||
      crossfadeLoopMs !== 350
    ) {
      return true;
    }
    if (
      globalMotion.type === "tilt_sway" ||
      globalMotion.type === "float_orbit" ||
      (globalMotion.easing && globalMotion.easing !== "ease_in_out") ||
      Math.abs((globalMotion.anchor_x ?? 0.5) - 0.5) > 0.02 ||
      Math.abs((globalMotion.anchor_y ?? 0.5) - 0.5) > 0.02
    ) {
      return true;
    }
    if (
      (border.inner_padding ?? 0) > 0 ||
      Boolean(border.shadow) ||
      frames.some((f) => Math.abs(f.straighten ?? 0) > 0.05)
    ) {
      return true;
    }
    if (
      ["duotone", "noir", "sunset", "pastel"].includes(globalFilters.preset) ||
      (globalFilters.sharpen ?? 0) > 0.02 ||
      Math.abs(globalFilters.temperature ?? 0) > 0.02 ||
      (globalFilters.chromatic ?? 0) > 0.02 ||
      (globalFilters.pixelate ?? 0) > 0 ||
      Math.abs(globalFilters.hue_shift ?? 0) > 1 ||
      (globalFilters.bloom ?? 0) > 0.02 ||
      Math.abs(globalFilters.split_tone ?? 0) > 0.02 ||
      (globalFilters.bg_matte ?? "none") !== "none"
    ) {
      return true;
    }
    if (
      (globalText.font_family && globalText.font_family !== "sans") ||
      (globalText.align && globalText.align !== "center") ||
      (globalText.entrance && globalText.entrance !== "none") ||
      (globalText.opacity ?? 1) < 0.99 ||
      (globalText.margin_pct ?? 6) !== 6 ||
      (globalText.letter_spacing ?? 0) !== 0 ||
      Math.abs(globalText.rotation ?? 0) > 0.25 ||
      (globalText.extra_layers?.length ?? 0) > 0
    ) {
      return true;
    }
    if (
      exportConfig.resolution === "retina_2x" ||
      exportConfig.lossless ||
      exportConfig.custom_quality != null ||
      exportConfig.video_crf != null ||
      (exportConfig.sprite_padding ?? 0) > 0 ||
      exportConfig.format === "bundle_zip"
    ) {
      return true;
    }
    return false;
  }, [
    speedMultiplier,
    endHoldMs,
    crossfadeLoopMs,
    globalMotion,
    border,
    frames,
    globalFilters,
    globalText,
    exportConfig,
  ]);

  const selectedFrameUid = useMemo(() => {
    const valid = selectedFrameUids.filter((uid) =>
      frames.some((f) => f.uid === uid)
    );
    if (valid.length > 0) return valid[valid.length - 1];
    return frames[0]?.uid ?? null;
  }, [selectedFrameUids, frames]);

  const activeSelectedUids = useMemo(
    () => selectedFrameUids.filter((uid) => frames.some((f) => f.uid === uid)),
    [selectedFrameUids, frames]
  );

  const selectedFrame = useMemo(
    () => frames.find((f) => f.uid === selectedFrameUid) ?? null,
    [frames, selectedFrameUid]
  );

  const editingSelectedFrame = inspectorScope === "frame" && selectedFrame !== null;

  const activeMotion: MotionConfig = editingSelectedFrame
    ? selectedFrame.motion ?? globalMotion
    : globalMotion;

  const activeFilters: FilterConfig = editingSelectedFrame
    ? selectedFrame.filters ?? globalFilters
    : globalFilters;

  const activeText: TextOverlayConfig = editingSelectedFrame
    ? selectedFrame.text_overlay ?? globalText
    : globalText;

  const requestBatchDeleteSelected = useCallback(() => {
    const targets =
      activeSelectedUids.length > 0
        ? activeSelectedUids
        : selectedFrameUid
        ? [selectedFrameUid]
        : [];
    if (targets.length === 0) return;
    if (targets.length === 1) {
      const idx = frames.findIndex((f) => f.uid === targets[0]);
      const frame = frames[idx];
      if (frame) {
        setPendingDelete({
          kind: "single",
          uid: frame.uid,
          index: idx,
          filename: frame.media.filename,
        });
      }
      return;
    }
    setPendingDelete({ kind: "batch", uids: targets });
  }, [activeSelectedUids, selectedFrameUid, frames]);

  const handleDeleteMedia = useCallback(
    async (mediaId: string) => {
      try {
        await deleteMediaItem(mediaId);
        setMediaBin((prev) => prev.filter((m) => m.id !== mediaId));
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.filter((f) => f.media.id !== mediaId),
        }));
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to delete media item"
        );
      }
    },
    [commitProject]
  );

  const handlePruneUnusedMedia = useCallback(async (mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    const settled = await Promise.allSettled(
      mediaIds.map(async (id) => {
        await deleteMediaItem(id);
        return id;
      })
    );
    const removedIds = new Set<string>();
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        removedIds.add(outcome.value);
      }
    }
    if (removedIds.size > 0) {
      setMediaBin((prev) => prev.filter((m) => !removedIds.has(m.id)));
    }
    if (removedIds.size < mediaIds.length) {
      setUploadError("Some unused items could not be removed from the library.");
    }
  }, []);

  const confirmPendingDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "single") {
      const targetUid = pendingDelete.uid;
      commitProject((prev) => ({
        ...prev,
        frames: prev.frames.filter((f) => f.uid !== targetUid),
      }));
      setSelectedFrameUids((prev) => prev.filter((id) => id !== targetUid));
    } else if (pendingDelete.kind === "batch") {
      const targets = new Set(pendingDelete.uids);
      commitProject((prev) => ({
        ...prev,
        frames: prev.frames.filter((f) => !targets.has(f.uid)),
      }));
      setSelectedFrameUids([]);
      setSelectionAnchorUid(null);
    } else if (pendingDelete.kind === "clear_all") {
      commitProject((prev) => ({ ...prev, frames: [] }));
      setSelectedFrameUids([]);
      setSelectionAnchorUid(null);
    } else if (pendingDelete.kind === "media_single") {
      void handleDeleteMedia(pendingDelete.mediaId);
    } else if (pendingDelete.kind === "media_prune") {
      void handlePruneUnusedMedia(pendingDelete.mediaIds);
    }
    setPendingDelete(null);
  }, [pendingDelete, commitProject, handleDeleteMedia, handlePruneUnusedMedia]);

  // Global keyboard shortcuts: Undo (Cmd/Ctrl+Z), Redo (Cmd+Shift+Z / Ctrl+Y), Delete/Backspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (inInput) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeTab !== "transform" &&
        !pendingDelete
      ) {
        if (activeSelectedUids.length > 0) {
          e.preventDefault();
          requestBatchDeleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    activeSelectedUids,
    activeTab,
    pendingDelete,
    requestBatchDeleteSelected,
  ]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;
      setIsUploading(true);
      setUploadError(null);

      try {
        const prepared = await prepareUploadFiles(fileArr);
        const uploaded = await uploadMediaFiles(prepared);
        setMediaBin((prev) => [...prev, ...uploaded]);

        const imageItems = uploaded.filter((u) => u.media_type === "image");
        const videoItems = uploaded.filter((u) => u.media_type === "video");

        if (imageItems.length > 0) {
          const added = imageItems.map((img) =>
            createFrameFromMedia(img, img.frame_duration_ms ?? 500)
          );
          commitProject((prev) => ({
            ...prev,
            frames: [...prev.frames, ...added],
          }));
          setSelectedFrameUids([added[0].uid]);
          setSelectionAnchorUid(added[0].uid);
        }

        if (videoItems.length > 0) {
          setPendingVideosQueue((prev) => [...prev, ...videoItems]);
        }
        setBackendOnline(true);
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : "Upload failed. Check that the Python backend is running."
        );
      } finally {
        setIsUploading(false);
      }
    },
    [commitProject]
  );

  const handleLoadSamples = useCallback(
    async (pack: "stock" | "motion" | "video" = "stock") => {
      setIsLoadingSamples(true);
      setUploadError(null);
      try {
        const samples = await loadDemoSamples(pack);
        setMediaBin((prev) => [...prev, ...samples]);
        if (pack === "video") {
          const videos = samples.filter((s) => s.media_type === "video");
          if (videos.length > 0) {
            setPendingVideosQueue((prev) => [...prev, ...videos]);
          }
          return;
        }
        const isMotion = pack === "motion";
        const added = samples.map((img, idx) => ({
          ...createFrameFromMedia(img, isMotion ? img.frame_duration_ms ?? 90 : 650),
          transition_in: (!isMotion && idx > 0
            ? "crossfade"
            : "none") as FrameItem["transition_in"],
          transition_ms: 250,
        }));
        commitProject((prev) => ({
          ...prev,
          frames: [...prev.frames, ...added],
          globalMotion: isMotion
            ? { type: "none", intensity: 0.5, frames: 12 }
            : { type: "ken_burns", intensity: 0.55, frames: 12 },
          loopMode: isMotion ? "forward" : "boomerang",
        }));
        if (added[0]) {
          setSelectedFrameUids([added[0].uid]);
          setSelectionAnchorUid(added[0].uid);
        }
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : "Could not load samples. Check backend connection."
        );
      } finally {
        setIsLoadingSamples(false);
      }
    },
    [commitProject]
  );

  const updateSelectedFrame = useCallback(
    (
      updater: (frame: FrameItem) => FrameItem,
      options?: { coalesce?: boolean }
    ) => {
      if (!selectedFrameUid) return;
      commitProject(
        (prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === selectedFrameUid ? updater(f) : f
          ),
        }),
        options
      );
    },
    [selectedFrameUid, commitProject]
  );

  const updateMotion = (patch: Partial<MotionConfig>, coalesce = true) => {
    if (editingSelectedFrame) {
      updateSelectedFrame(
        (f) => ({
          ...f,
          motion: { ...(f.motion ?? globalMotion), ...patch },
        }),
        { coalesce }
      );
    } else {
      commitProject(
        (prev) => ({
          ...prev,
          globalMotion: { ...prev.globalMotion, ...patch },
        }),
        { coalesce }
      );
    }
  };

  const updateFilters = (patch: Partial<FilterConfig>, coalesce = true) => {
    if (editingSelectedFrame) {
      updateSelectedFrame(
        (f) => ({
          ...f,
          filters: { ...(f.filters ?? globalFilters), ...patch },
        }),
        { coalesce }
      );
    } else {
      commitProject(
        (prev) => ({
          ...prev,
          globalFilters: { ...prev.globalFilters, ...patch },
        }),
        { coalesce }
      );
    }
  };

  const updateText = (patch: Partial<TextOverlayConfig>, coalesce = true) => {
    if (editingSelectedFrame) {
      updateSelectedFrame(
        (f) => ({
          ...f,
          text_overlay: { ...(f.text_overlay ?? globalText), ...patch },
        }),
        { coalesce }
      );
    } else {
      commitProject(
        (prev) => ({
          ...prev,
          globalText: { ...prev.globalText, ...patch },
        }),
        { coalesce }
      );
    }
  };

  const extraTextLayers = activeText.extra_layers ?? [];
  const safeTextLayerIdx =
    activeTextLayerIdx >= extraTextLayers.length ? -1 : activeTextLayerIdx;
  const currTextLayer: TextBadgeLayer =
    safeTextLayerIdx === -1 ? activeText : extraTextLayers[safeTextLayerIdx];

  const updateCurrTextLayer = (
    patch: Partial<TextBadgeLayer>,
    coalesce = true
  ) => {
    if (safeTextLayerIdx === -1) {
      updateText(patch, coalesce);
    } else {
      const nextExtras = extraTextLayers.map((l, i) =>
        i === safeTextLayerIdx ? { ...l, ...patch } : l
      );
      updateText({ extra_layers: nextExtras }, coalesce);
    }
  };

  const saveCustomRecipe = () => {
    const trimmed = newRecipeName.trim();
    if (!trimmed) return;
    const rec: SavedCustomRecipe = {
      id: Math.random().toString(36).slice(2, 9),
      name: trimmed,
      loopMode,
      speedMultiplier,
      endHoldMs,
      crossfadeLoopMs,
      globalMotion,
      globalFilters,
      globalText,
      border,
    };
    const next = [rec, ...savedRecipes].slice(0, 12);
    setSavedRecipes(next);
    setNewRecipeName("");
    try {
      localStorage.setItem(CUSTOM_RECIPES_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  };

  const deleteSavedRecipe = (id: string) => {
    const next = savedRecipes.filter((r) => r.id !== id);
    setSavedRecipes(next);
    try {
      localStorage.setItem(CUSTOM_RECIPES_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  };

  const applySavedRecipe = (rec: SavedCustomRecipe) => {
    commitProject((prev) => ({
      ...prev,
      loopMode: rec.loopMode,
      speedMultiplier: rec.speedMultiplier,
      endHoldMs: rec.endHoldMs,
      crossfadeLoopMs: rec.crossfadeLoopMs,
      globalMotion: rec.globalMotion,
      globalFilters: rec.globalFilters,
      globalText: rec.globalText,
      border: rec.border,
      frames: prev.frames.map((f) => ({
        ...f,
        motion: null,
        filters: null,
        text_overlay: null,
      })),
    }));
  };

  const applyQuickRecipe = (
    recipe: "cinema" | "boomerang" | "vhs" | "product_demo" | "stop_motion" | "sticker"
  ) => {
    if (recipe === "cinema") {
      commitProject((prev) => ({
        ...prev,
        loopMode: "crossfade_loop",
        speedMultiplier: 1.0,
        endHoldMs: 0,
        globalMotion: { ...DEFAULT_MOTION, type: "ken_burns", intensity: 0.6, frames: 16, easing: "ease_in_out" },
        globalFilters: { ...DEFAULT_FILTERS, preset: "vivid", vignette: 0.35 },
        frames: prev.frames.map((f, idx) => ({
          ...f,
          duration_ms: 800,
          transition_in: idx === 0 ? "none" : "crossfade",
          transition_ms: 300,
        })),
      }));
    } else if (recipe === "boomerang") {
      commitProject((prev) => ({
        ...prev,
        loopMode: "boomerang",
        speedMultiplier: 1.0,
        endHoldMs: 0,
        globalMotion: { ...DEFAULT_MOTION, type: "pulse", intensity: 0.45, frames: 10 },
        globalFilters: { ...DEFAULT_FILTERS, preset: "warm" },
        frames: prev.frames.map((f) => ({
          ...f,
          duration_ms: 300,
          transition_in: "none",
        })),
      }));
    } else if (recipe === "product_demo") {
      commitProject((prev) => ({
        ...prev,
        loopMode: "forward",
        speedMultiplier: 1.0,
        endHoldMs: 800,
        globalMotion: { ...DEFAULT_MOTION, type: "zoom_in", intensity: 0.4, frames: 12, easing: "ease_out" },
        globalFilters: { ...DEFAULT_FILTERS, sharpen: 0.35, contrast: 1.06 },
        frames: prev.frames.map((f, idx) => ({
          ...f,
          duration_ms: 650,
          transition_in: idx === 0 ? "none" : "slide_left",
          transition_ms: 250,
        })),
      }));
    } else if (recipe === "stop_motion") {
      commitProject((prev) => ({
        ...prev,
        loopMode: "forward",
        speedMultiplier: 1.2,
        endHoldMs: 0,
        globalMotion: { ...DEFAULT_MOTION, type: "none" },
        globalFilters: { ...DEFAULT_FILTERS, contrast: 1.1, sharpen: 0.25 },
        frames: prev.frames.map((f) => ({
          ...f,
          duration_ms: 160,
          transition_in: "none",
        })),
      }));
    } else if (recipe === "sticker") {
      commitProject((prev) => ({
        ...prev,
        loopMode: "boomerang",
        speedMultiplier: 1.0,
        endHoldMs: 0,
        globalMotion: { ...DEFAULT_MOTION, type: "float_orbit", intensity: 0.5, frames: 12 },
        globalFilters: { ...DEFAULT_FILTERS, saturation: 1.15, sharpen: 0.25 },
        border: { ...prev.border, corner_radius: 28, shadow: true },
        frames: prev.frames.map((f) => ({
          ...f,
          duration_ms: 320,
          transition_in: "none",
        })),
      }));
      setExportConfig((prev) => ({ ...prev, transparent_bg: true }));
    } else {
      commitProject((prev) => ({
        ...prev,
        loopMode: "forward",
        speedMultiplier: 1.0,
        endHoldMs: 0,
        globalMotion: { ...DEFAULT_MOTION, type: "shake", intensity: 0.4, frames: 10 },
        globalFilters: {
          ...DEFAULT_FILTERS,
          preset: "vintage",
          film_grain: 0.45,
          vignette: 0.4,
          glitch: 0.3,
        },
        frames: prev.frames.map((f) => ({
          ...f,
          duration_ms: 350,
          transition_in: "none",
        })),
      }));
    }
  };

  const handleSelectFrameClick = (
    uid: string,
    e: React.MouseEvent | React.KeyboardEvent
  ) => {
    const meta = e.metaKey || e.ctrlKey;
    if (e.shiftKey && selectionAnchorUid) {
      const anchorIdx = frames.findIndex((f) => f.uid === selectionAnchorUid);
      const currIdx = frames.findIndex((f) => f.uid === uid);
      if (anchorIdx !== -1 && currIdx !== -1) {
        const [lo, hi] =
          anchorIdx <= currIdx ? [anchorIdx, currIdx] : [currIdx, anchorIdx];
        const rangeUids = frames.slice(lo, hi + 1).map((f) => f.uid);
        setSelectedFrameUids(rangeUids);
        return;
      }
    }
    if (meta) {
      setSelectedFrameUids((prev) =>
        prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
      );
      setSelectionAnchorUid(uid);
      return;
    }
    setSelectedFrameUids([uid]);
    setSelectionAnchorUid(uid);
  };

  const handleBatchSetDuration = (ms: number) => {
    const targets = new Set(activeSelectedUids);
    if (targets.size === 0) return;
    commitProject((prev) => ({
      ...prev,
      frames: prev.frames.map((f) =>
        targets.has(f.uid) ? { ...f, duration_ms: ms } : f
      ),
    }));
  };

  const handleBatchDuplicate = () => {
    const targets = new Set(activeSelectedUids);
    if (targets.size === 0) return;
    commitProject((prev) => {
      const next: FrameItem[] = [];
      for (const f of prev.frames) {
        next.push(f);
        if (targets.has(f.uid)) {
          next.push({
            ...f,
            uid: `${f.media.id}_${Math.random().toString(36).slice(2, 9)}`,
          });
        }
      }
      return { ...prev, frames: next };
    });
  };

  const handleDecimateSelected = (keepEvery: number) => {
    const targets = new Set(activeSelectedUids);
    if (targets.size < 2) return;
    commitProject((prev) => {
      let seenInSelection = 0;
      const nextFrames = prev.frames.filter((f) => {
        if (!targets.has(f.uid)) return true;
        const keep = seenInSelection % keepEvery === 0;
        seenInSelection += 1;
        return keep;
      });
      return { ...prev, frames: nextFrames };
    });
  };

  const handleMoveFrame = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= frames.length) return;
    commitProject((prev) => {
      const next = [...prev.frames];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return { ...prev, frames: next };
    });
  };

  const handleDuplicateFrame = (idx: number) => {
    commitProject((prev) => {
      const src = prev.frames[idx];
      const copy: FrameItem = {
        ...src,
        uid: `${src.media.id}_${Math.random().toString(36).slice(2, 9)}`,
      };
      const next = [...prev.frames];
      next.splice(idx + 1, 0, copy);
      return { ...prev, frames: next };
    });
  };

  const handleApplyUniformDuration = (ms: number) => {
    commitProject((prev) => ({
      ...prev,
      frames: prev.frames.map((f) => ({ ...f, duration_ms: ms })),
    }));
  };

  const runExportWith = async (
    targetFrames: FrameItem[],
    overrides?: { loopMode?: LoopMode; forceGif?: boolean }
  ) => {
    if (targetFrames.length === 0) return;
    setIsExportModalOpen(true);
    setIsExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      const res = await exportProject({
        frames: targetFrames,
        aspect_ratio: aspectRatio,
        fit_mode: fitMode,
        bg_color: bgColor,
        loop_mode: overrides?.loopMode ?? loopMode,
        loop_count: loopCount,
        speed_multiplier: speedMultiplier,
        end_hold_ms: endHoldMs,
        crossfade_loop_ms: crossfadeLoopMs,
        global_motion: globalMotion,
        global_filters: globalFilters,
        global_text: globalText,
        border,
        export: overrides?.forceGif
          ? { ...exportConfig, format: "gif" }
          : exportConfig,
      });
      setExportResult(res);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => runExportWith(frames);

  const totalTimelineMs = useMemo(
    () => frames.reduce((acc, f) => acc + f.duration_ms, 0),
    [frames]
  );

  const exportEstimate = useMemo(() => {
    const first = frames[0];
    let rawW = first?.media.width || 720;
    let rawH = first?.media.height || 720;
    if (first) {
      const swapped = first.rotate === 90 || first.rotate === 270;
      const ow = swapped ? first.media.height : first.media.width;
      const oh = swapped ? first.media.width : first.media.height;
      rawW = Math.max(2, Math.round(ow * (first.crop?.w ?? 1)));
      rawH = Math.max(2, Math.round(oh * (first.crop?.h ?? 1)));
    }
    const ratioMap: Record<string, [number, number]> = {
      "1:1": [1, 1],
      "9:16": [9, 16],
      "16:9": [16, 9],
      "4:5": [4, 5],
      "4:3": [4, 3],
    };
    const [rw, rh] =
      aspectRatio === "original"
        ? [rawW, rawH]
        : ratioMap[aspectRatio] ?? [1, 1];
    const targetLong =
      exportConfig.resolution === "480p"
        ? 480
        : exportConfig.resolution === "720p"
        ? 720
        : exportConfig.resolution === "1080p"
        ? 1080
        : exportConfig.resolution === "retina_2x"
        ? Math.min(Math.max(rawW, rawH) * 2, 2160)
        : exportConfig.resolution === "custom"
        ? exportConfig.custom_width ?? 640
        : Math.min(Math.max(rawW, rawH), 1280);

    let outW = 720;
    let outH = 720;
    if (exportConfig.resolution === "custom") {
      outW = targetLong;
      outH = Math.round(targetLong * (rh / Math.max(1, rw)));
    } else if (rw >= rh) {
      outW = targetLong;
      outH = Math.round(targetLong * (rh / Math.max(1, rw)));
    } else {
      outH = targetLong;
      outW = Math.round(targetLong * (rw / Math.max(1, rh)));
    }
    outW = Math.max(2, Math.round(outW / 2) * 2);
    outH = Math.max(2, Math.round(outH / 2) * 2);

    const effSpeed = Math.max(0.25, speedMultiplier);
    let renderFrames = 0;
    let renderMs = 0;
    frames.forEach((f, idx) => {
      const effMotion = f.motion ?? globalMotion;
      if (idx > 0 && f.transition_in !== "none") {
        const effTrans = f.transition_ms / effSpeed;
        const tf = Math.max(2, Math.round((effTrans / 1000) * exportConfig.fps));
        renderFrames += tf;
        renderMs += effTrans;
      }
      if (effMotion.type !== "none") {
        renderFrames += Math.max(2, effMotion.frames);
      } else {
        renderFrames += 1;
      }
      renderMs += Math.max(30, Math.round(f.duration_ms / effSpeed));
    });
    if (loopMode === "boomerang" && renderFrames > 2) {
      renderFrames = renderFrames * 2 - 2;
      renderMs = Math.round(renderMs * 1.85);
    } else if (loopMode === "crossfade_loop" && frames.length >= 2) {
      const effCross = crossfadeLoopMs / effSpeed;
      renderFrames += Math.max(2, Math.round((effCross / 1000) * exportConfig.fps));
      renderMs += effCross;
    }
    renderMs += endHoldMs;

    const pxCount = outW * outH;
    const perFrameBytesMap: Record<string, number> = {
      gif: 0.24,
      webp: 0.14,
      avif: 0.07,
      apng: 0.42,
      mp4: 0.045,
      webm: 0.05,
      mov_alpha: 0.16,
      spritesheet: 0.36,
      dotlottie: 0.16,
      lottie: 0.22,
      svg: 0.28,
      bundle_zip: 0.48,
    };
    const qFactor = exportConfig.lossless
      ? 1.55
      : exportConfig.quality === "compact"
      ? 0.58
      : exportConfig.quality === "balanced"
      ? 0.78
      : 1.0;
    const rawEstBytes = Math.max(
      14_000,
      pxCount * (perFrameBytesMap[exportConfig.format] ?? 0.2) * Math.max(1, renderFrames) * qFactor * 0.22
    );
    const estSizeMb = rawEstBytes / (1024 * 1024);
    const overBudget = Boolean(
      exportConfig.target_size_mb && estSizeMb > exportConfig.target_size_mb
    );

    return {
      width: outW,
      height: outH,
      renderFrames,
      durationSec: (renderMs / 1000).toFixed(1),
      estSizeLabel:
        estSizeMb >= 1
          ? `~${estSizeMb.toFixed(1)} MB`
          : `~${Math.max(12, Math.round(rawEstBytes / 1024))} KB`,
      overBudget,
    };
  }, [frames, aspectRatio, exportConfig, globalMotion, loopMode, speedMultiplier, endHoldMs, crossfadeLoopMs]);

  const isEditingCrop =
    activeTab === "transform" && cropEditEnabled && selectedFrame !== null;

  // Live drag update without creating 50 undo entries; commits on pointerup via onCommitCrop
  const handleLiveCropUpdate = useCallback(
    (crop: CropConfig) => {
      if (!selectedFrameUid) return;
      if (!coalesceBaseRef.current) {
        coalesceBaseRef.current = projectRef.current;
      }
      setProject((prev) => ({
        ...prev,
        frames: prev.frames.map((f) =>
          f.uid === selectedFrameUid ? { ...f, crop } : f
        ),
      }));
    },
    [selectedFrameUid]
  );

  const requestDeleteMedia = useCallback(
    (mediaId: string) => {
      const target = mediaBin.find((m) => m.id === mediaId);
      const usedCount = frames.filter((f) => f.media.id === mediaId).length;
      setPendingDelete({
        kind: "media_single",
        mediaId,
        filename: target?.filename ?? "this asset",
        usedCount,
        isVideo: target?.media_type === "video",
      });
    },
    [mediaBin, frames]
  );

  const requestPruneUnusedMedia = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    setPendingDelete({ kind: "media_prune", mediaIds });
  }, []);

  // Reusable Media Bin Panel
  const mediaBinContent = (
    <MediaBinPanel
      mediaBin={mediaBin}
      frames={frames}
      isDraggingUpload={isDraggingUpload}
      isUploading={isUploading}
      isLoadingSamples={isLoadingSamples}
      uploadError={uploadError}
      onTriggerUpload={() => fileInputRef.current?.click()}
      onLoadSamples={handleLoadSamples}
      onAddImage={(item) => {
        const newFrame = createFrameFromMedia(
          item,
          item.frame_duration_ms ?? 500
        );
        commitProject((prev) => ({
          ...prev,
          frames: [...prev.frames, newFrame],
        }));
        setSelectedFrameUids([newFrame.uid]);
        setSelectionAnchorUid(newFrame.uid);
      }}
      onAddManyImages={(items) => {
        const added = items.map((item) =>
          createFrameFromMedia(item, item.frame_duration_ms ?? 500)
        );
        if (added.length === 0) return;
        commitProject((prev) => ({
          ...prev,
          frames: [...prev.frames, ...added],
        }));
        setSelectedFrameUids([added[added.length - 1].uid]);
        setSelectionAnchorUid(added[added.length - 1].uid);
      }}
      onExtractVideo={(item) => {
        setPendingVideosQueue((prev) => [
          item,
          ...prev.filter((v) => v.id !== item.id),
        ]);
      }}
      onDeleteMedia={requestDeleteMedia}
      onPruneUnused={requestPruneUnusedMedia}
    />
  );

  // Reusable Inspector Panel
  const inspectorContent = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Inspector Tab Bar (6 crisp tabs) */}
      <div className="shrink-0 grid grid-cols-6 border-b border-black/[0.08] dark:border-zinc-800/80 bg-[#efede8] dark:bg-zinc-950 p-1 gap-0.5">
        {(
          [
            { id: "loop", label: "Loop", icon: Repeat },
            { id: "motion", label: "Motion", icon: ArrowsOutCardinal },
            { id: "transform", label: "Crop", icon: Crop },
            { id: "effects", label: "Effects", icon: Palette },
            { id: "text", label: "Text", icon: TextT },
            { id: "export", label: "Export", icon: FadersHorizontal },
          ] as { id: InspectorTab; label: string; icon: React.ElementType }[]
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-accent)] ${
                activeTab === tab.id
                  ? "studio-accent-text bg-white shadow-xs ring-1 ring-black/[0.06] dark:bg-zinc-800 dark:ring-transparent"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-[#e5e2db] dark:hover:bg-zinc-900 hover:text-zinc-950 dark:hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Mode Banner / Mobile Beginner-Expert Toggle + Active Expert Tweaks Notice */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.07] dark:border-zinc-800/70 bg-[#f5f3ee] dark:bg-zinc-950/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              studioMode === "expert"
                ? "bg-[var(--studio-accent)]"
                : "bg-zinc-400 dark:bg-zinc-500"
            }`}
          />
          <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
            {studioMode === "expert" ? "Expert Workspace" : "Beginner Mode"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {studioMode === "beginner" && hasExpertTweaks && (
            <button
              type="button"
              onClick={() => applyStudioMode("expert")}
              className="rounded-md bg-[var(--studio-accent-soft)] px-2 py-0.5 text-[11px] font-semibold studio-accent-text ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
            >
              Expert tweaks active
            </button>
          )}
          <div className="flex md:hidden items-center rounded-md bg-black/[0.06] p-0.5 dark:bg-zinc-900">
            {(["beginner", "expert"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => applyStudioMode(m)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold capitalize transition ${
                  studioMode === m
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scope Toggle (for Motion, Effects, Text) */}
      {(activeTab === "motion" || activeTab === "effects" || activeTab === "text") && (
        <div className="shrink-0 border-b border-black/[0.08] dark:border-zinc-800/70 px-4 py-2.5">
          <div className="flex items-center gap-1 rounded-lg bg-[#efede8] dark:bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setInspectorScope("global")}
              className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition ${
                inspectorScope === "global"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
              }`}
            >
              All Frames (Global)
            </button>
            <button
              type="button"
              disabled={!selectedFrame}
              onClick={() => setInspectorScope("frame")}
              className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
                editingSelectedFrame
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
              }`}
            >
              Selected Frame
            </button>
          </div>
          {editingSelectedFrame && (
            <button
              type="button"
              onClick={() =>
                updateSelectedFrame(
                  (f) => ({
                    ...f,
                    motion: activeTab === "motion" ? null : f.motion,
                    filters: activeTab === "effects" ? null : f.filters,
                    text_overlay: activeTab === "text" ? null : f.text_overlay,
                  }),
                  { coalesce: false }
                )
              }
              className="mt-1.5 w-full text-right text-[11px] studio-accent-text hover:underline"
            >
              Reset frame override to inherit Global
            </button>
          )}
        </div>
      )}

      {/* Inspector Scroll Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
        {/* LOOP & TIMING TAB */}
        {activeTab === "loop" && (
          <>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Loop Mode
              </h3>
              <div className="divide-y divide-black/[0.06] dark:divide-zinc-800/70 overflow-hidden rounded-xl bg-[#efede8] dark:bg-zinc-900/70">
                {LOOP_MODES.map((mode) => {
                  const active = loopMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() =>
                        commitProject((prev) => ({ ...prev, loopMode: mode.id }))
                      }
                      className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left transition ${
                        active
                          ? "border-l-2 border-l-[var(--studio-accent)] bg-[var(--studio-accent-soft)] text-zinc-900 dark:text-white"
                          : "text-zinc-800 dark:text-zinc-200 hover:bg-[#e4e1d9] dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <LoopModeGlyph
                          mode={mode.id}
                          className={`h-4 w-4 shrink-0 ${
                            active
                              ? "studio-accent-text"
                              : "text-zinc-600 dark:text-zinc-400"
                          }`}
                        />
                        <div>
                          <div className="text-xs font-semibold">{mode.label}</div>
                          <div className="text-[11px] text-zinc-700 dark:text-zinc-300">
                            {mode.desc}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          active
                            ? "bg-[var(--studio-accent)]"
                            : "bg-zinc-300 dark:bg-zinc-700"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {loopMode !== "once" && (
              <div>
                <label className="mb-1.5 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                  <span>Repeat Count</span>
                  <span className="font-mono studio-accent-text tabular-nums">
                    {loopCount === 0 ? "Infinite (∞)" : `${loopCount}×`}
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={loopCount}
                  onChange={(e) =>
                    commitProject(
                      (prev) => ({
                        ...prev,
                        loopCount: Number(e.target.value),
                      }),
                      { coalesce: true }
                    )
                  }
                  className="w-full"
                />
              </div>
            )}

            {studioMode === "expert" && (
              <div className="space-y-3 border-t border-black/[0.08] dark:border-zinc-800/80 pt-3.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Pro Loop Pacing
                </h3>
                <div>
                  <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                    <span>Playback Speed</span>
                    <span className="font-mono studio-accent-text tabular-nums">
                      {speedMultiplier.toFixed(2)}×
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={speedMultiplier}
                    onChange={(e) =>
                      commitProject(
                        (prev) => ({
                          ...prev,
                          speedMultiplier: Number(e.target.value),
                        }),
                        { coalesce: true }
                      )
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                    <span>End Hold Pause</span>
                    <span className="font-mono studio-accent-text tabular-nums">
                      {endHoldMs} ms
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={2000}
                    step={100}
                    value={endHoldMs}
                    onChange={(e) =>
                      commitProject(
                        (prev) => ({
                          ...prev,
                          endHoldMs: Number(e.target.value),
                        }),
                        { coalesce: true }
                      )
                    }
                    className="w-full"
                  />
                </div>
                {loopMode === "crossfade_loop" && (
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Seamless Fade Overlap</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {crossfadeLoopMs} ms
                      </span>
                    </label>
                    <input
                      type="range"
                      min={100}
                      max={1200}
                      step={50}
                      value={crossfadeLoopMs}
                      onChange={(e) =>
                        commitProject(
                          (prev) => ({
                            ...prev,
                            crossfadeLoopMs: Number(e.target.value),
                          }),
                          { coalesce: true }
                        )
                      }
                      className="w-full"
                    />
                  </div>
                )}

                {/* Seam Preview & BPM Beat Sync */}
                <div className="rounded-xl bg-[#efede8] dark:bg-zinc-900/75 p-2.5 space-y-2 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      BPM &amp; Seam Check
                    </span>
                    <button
                      type="button"
                      disabled={frames.length === 0}
                      onClick={() =>
                        setSeekToMsRequest({
                          ms: Math.max(0, totalTimelineMs - 650),
                          play: true,
                          nonce: Date.now(),
                        })
                      }
                      className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-45 dark:bg-zinc-100 dark:text-zinc-950"
                    >
                      Preview Seam →
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={40}
                      max={240}
                      value={bpmValue}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setBpmValue(Math.min(240, Math.max(40, Math.round(v))));
                      }}
                      aria-label="Tempo in BPM"
                      className="w-16 rounded-md bg-white dark:bg-zinc-950 px-2 py-1 text-center font-mono text-base md:text-[11px] text-zinc-900 dark:text-zinc-100 ring-1 ring-black/10 dark:ring-zinc-700"
                    />
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-400">BPM</span>
                    <div className="flex rounded-md bg-white/70 dark:bg-zinc-950 p-0.5 text-[11px]">
                      {([1, 2, 4] as const).map((sub) => (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => setBpmSubdivision(sub)}
                          className={`rounded px-1.5 py-0.5 font-mono transition ${
                            bpmSubdivision === sub
                              ? "bg-zinc-900 text-white dark:bg-[var(--studio-accent)] dark:text-zinc-950"
                              : "text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          1/{sub}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={frames.length === 0}
                      onClick={() => {
                        const beatMs = Math.max(
                          40,
                          Math.min(4000, Math.round(60000 / Math.max(40, bpmValue) / bpmSubdivision))
                        );
                        handleApplyUniformDuration(beatMs);
                      }}
                      className="ml-auto rounded-md bg-[var(--studio-accent-soft)] px-2 py-1 font-mono text-[11px] font-semibold studio-accent-text hover:opacity-90 disabled:opacity-45"
                    >
                      Set {Math.max(40, Math.round(60000 / Math.max(40, bpmValue) / bpmSubdivision))}ms
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 1-Click & Custom Saved Recipes */}
            <div className="border-t border-black/[0.08] dark:border-zinc-800/80 pt-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                <MagicWand className="h-3.5 w-3.5 studio-accent-text" />
                Quick Recipes
              </div>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#efede8] dark:bg-zinc-900/70 p-1">
                <button
                  type="button"
                  onClick={() => applyQuickRecipe("cinema")}
                  className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                >
                  Ken Burns
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickRecipe("boomerang")}
                  className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                >
                  Boomerang
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickRecipe("vhs")}
                  className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                >
                  Retro VHS
                </button>
                {studioMode === "expert" && (
                  <>
                    <button
                      type="button"
                      onClick={() => applyQuickRecipe("product_demo")}
                      className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                    >
                      Product Demo
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickRecipe("stop_motion")}
                      className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                    >
                      Stop Motion
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickRecipe("sticker")}
                      className="rounded-lg px-2 py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 transition hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                    >
                      Sticker Loop
                    </button>
                  </>
                )}
              </div>

              {/* Save & Recall Custom Local Recipes */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newRecipeName}
                  onChange={(e) => setNewRecipeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newRecipeName.trim()) {
                      e.preventDefault();
                      saveCustomRecipe();
                    }
                  }}
                  placeholder="Save look as preset..."
                  aria-label="Custom recipe name"
                  className="min-w-0 flex-1 rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1.5 text-base md:text-[11px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-600 dark:placeholder:text-zinc-400 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newRecipeName.trim()}
                  onClick={saveCustomRecipe}
                  className="shrink-0 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-45 dark:bg-zinc-100 dark:text-zinc-950"
                >
                  Save Look
                </button>
              </div>
              {savedRecipes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {savedRecipes.map((rec) => (
                    <div
                      key={rec.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--studio-accent-soft)] pl-2 pr-1 py-1 text-[11px] font-medium studio-accent-text ring-1 ring-[var(--studio-accent-ring)]"
                    >
                      <button
                        type="button"
                        onClick={() => applySavedRecipe(rec)}
                        className="hover:underline"
                      >
                        {rec.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedRecipe(rec.id)}
                        aria-label={`Delete recipe ${rec.name}`}
                        className="rounded p-0.5 hover:bg-black/15"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedFrame && (
              <div className="space-y-3 border-t border-black/[0.08] dark:border-zinc-800/80 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Selected Frame Timing &amp; Transition
                </h3>
                <div>
                  <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                    <span>Frame Duration</span>
                    <span className="font-mono studio-accent-text tabular-nums">
                      {selectedFrame.duration_ms} ms
                    </span>
                  </label>
                  <input
                    type="range"
                    min={50}
                    max={3000}
                    step={25}
                    value={selectedFrame.duration_ms}
                    onChange={(e) =>
                      updateSelectedFrame(
                        (f) => ({
                          ...f,
                          duration_ms: Number(e.target.value),
                        }),
                        { coalesce: true }
                      )
                    }
                    className="w-full"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleApplyUniformDuration(selectedFrame.duration_ms)
                    }
                    className="mt-1.5 text-[11px] studio-accent-text hover:underline"
                  >
                    Apply {selectedFrame.duration_ms}ms to all frames
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                    Transition Into Frame
                  </label>
                  <select
                    value={selectedFrame.transition_in}
                    onChange={(e) =>
                      updateSelectedFrame(
                        (f) => ({
                          ...f,
                          transition_in: e.target.value as FrameItem["transition_in"],
                        }),
                        { coalesce: false }
                      )
                    }
                    className="w-full rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2.5 py-2 text-base sm:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                  >
                    {TRANSITION_OPTIONS.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.label}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFrame.transition_in !== "none" && (
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Transition Duration</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {selectedFrame.transition_ms} ms
                      </span>
                    </label>
                    <input
                      type="range"
                      min={100}
                      max={1000}
                      step={50}
                      value={selectedFrame.transition_ms}
                      onChange={(e) =>
                        updateSelectedFrame(
                          (f) => ({
                            ...f,
                            transition_ms: Number(e.target.value),
                          }),
                          { coalesce: true }
                        )
                      }
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* MOTION TAB */}
        {activeTab === "motion" && (
          <>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Camera &amp; Photo Movement
              </h3>
              <p className="mb-3 text-[11px] text-zinc-700 dark:text-zinc-300">
                Turn a still JPEG/HEIC into a lively GIF, or animate slides.
              </p>
              {frames.length === 1 && activeMotion.type === "none" && (
                <div className="mb-3 rounded-lg bg-[var(--studio-accent-soft)] px-3 py-2 text-[11px] text-[var(--studio-accent-text)] ring-1 ring-[var(--studio-accent-ring)]">
                  Tip: Pick <span className="font-semibold">Ken Burns</span>,{" "}
                  <span className="font-semibold">Zoom In</span>, or{" "}
                  <span className="font-semibold">Shake</span> below to turn this
                  single photo into an animated GIF.
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {MOTION_OPTIONS.filter(
                  (m) =>
                    studioMode === "expert" ||
                    (m.id !== "tilt_sway" && m.id !== "float_orbit")
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => updateMotion({ type: m.id }, false)}
                    className={`rounded-lg px-2.5 py-2 text-left transition ${
                      activeMotion.type === m.id
                        ? "bg-zinc-900 text-white ring-1 ring-zinc-900 dark:bg-[var(--studio-accent-soft)] dark:text-white dark:ring-[var(--studio-accent)]"
                        : "bg-[#efede8] dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className="text-xs font-medium">{m.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {activeMotion.type !== "none" && (
              <div className="space-y-4 border-t border-black/[0.08] dark:border-zinc-800/80 pt-4">
                <div>
                  <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                    <span>Motion Intensity</span>
                    <span className="font-mono studio-accent-text tabular-nums">
                      {Math.round(activeMotion.intensity * 100)}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={activeMotion.intensity}
                    onChange={(e) =>
                      updateMotion({ intensity: Number(e.target.value) }, true)
                    }
                    className="w-full"
                  />
                </div>

                {studioMode === "expert" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                        Easing Curve
                      </label>
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                        {MOTION_EASING_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateMotion({ easing: opt.id }, false)}
                            className={`rounded-lg py-1.5 text-[11px] font-medium transition ${
                              (activeMotion.easing ?? "ease_in_out") === opt.id
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                                : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(activeMotion.easing ?? "ease_in_out") === "custom_bezier" && (
                      <BezierCurveEditor
                        value={activeMotion.bezier ?? [0.42, 0, 0.58, 1]}
                        onChange={(pts, coalesce) =>
                          updateMotion({ easing: "custom_bezier", bezier: pts }, coalesce)
                        }
                      />
                    )}

                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Focal Anchor Target (drag on canvas)</span>
                        <span className="font-mono text-[11px] studio-accent-text tabular-nums">
                          {Math.round((activeMotion.anchor_x ?? 0.5) * 100)}% ·{" "}
                          {Math.round((activeMotion.anchor_y ?? 0.5) * 100)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1.5 w-36">
                        {ANCHOR_POINTS.map((pt) => {
                          const selected =
                            Math.abs((activeMotion.anchor_x ?? 0.5) - pt.x) < 0.08 &&
                            Math.abs((activeMotion.anchor_y ?? 0.5) - pt.y) < 0.08;
                          return (
                            <button
                              key={`${pt.x}-${pt.y}`}
                              type="button"
                              aria-label={`Set focal anchor ${Math.round(pt.x * 100)}% ${Math.round(pt.y * 100)}%`}
                              onClick={() =>
                                updateMotion({ anchor_x: pt.x, anchor_y: pt.y }, false)
                              }
                              className={`h-6 rounded flex items-center justify-center transition ${
                                selected
                                  ? "bg-zinc-900 text-white dark:bg-[var(--studio-accent)] dark:text-zinc-950"
                                  : "bg-white/70 dark:bg-zinc-800/80 hover:bg-white dark:hover:bg-zinc-700"
                              }`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Motion Sub-frames (Smoothness)</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {activeMotion.frames} frames
                        </span>
                      </label>
                      <input
                        type="range"
                        min={4}
                        max={36}
                        step={2}
                        value={activeMotion.frames}
                        onChange={(e) =>
                          updateMotion({ frames: Number(e.target.value) }, true)
                        }
                        className="w-full"
                      />
                    </div>
                  </>
                )}

                {frames.length > 1 && studioMode === "expert" && (
                  <button
                    type="button"
                    onClick={() =>
                      commitProject((prev) => ({
                        ...prev,
                        globalMotion: activeMotion,
                        frames: prev.frames.map((f) => ({ ...f, motion: null })),
                      }))
                    }
                    className="w-full rounded-lg bg-[var(--studio-accent-soft)] px-3 py-2 text-xs font-semibold studio-accent-text ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
                  >
                    Apply Motion to All Frames
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* TRANSFORM / CROP TAB */}
        {activeTab === "transform" && (
          <div className="space-y-4">
            {!selectedFrame ? (
              <p className="py-6 text-center text-xs text-zinc-700 dark:text-zinc-300">
                Select a frame in the Timeline to crop, rotate, or flip it.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                    Orientation
                  </h3>
                  <span className="font-mono text-[11px] studio-accent-text">
                    {selectedFrame.rotate}°
                    {selectedFrame.flip_h ? " · Flip H" : ""}
                    {selectedFrame.flip_v ? " · Flip V" : ""}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-[#efede8] dark:bg-zinc-900/70 p-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedFrame(
                        (f) => ({
                          ...f,
                          rotate: ((f.rotate + 270) % 360) as RotateDegrees,
                        }),
                        { coalesce: false }
                      )
                    }
                    className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                  >
                    <ArrowCounterClockwise className="h-3.5 w-3.5" />
                    -90°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedFrame(
                        (f) => ({
                          ...f,
                          rotate: ((f.rotate + 90) % 360) as RotateDegrees,
                        }),
                        { coalesce: false }
                      )
                    }
                    className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                  >
                    <ArrowClockwise className="h-3.5 w-3.5" />
                    +90°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedFrame(
                        (f) => ({ ...f, flip_h: !f.flip_h }),
                        { coalesce: false }
                      )
                    }
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition ${
                      selectedFrame.flip_h
                        ? "bg-zinc-900 text-white ring-1 ring-zinc-900 dark:bg-[var(--studio-accent-soft)] dark:text-white dark:ring-[var(--studio-accent)]"
                        : "text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    }`}
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" />
                    Flip H
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedFrame(
                        (f) => ({ ...f, flip_v: !f.flip_v }),
                        { coalesce: false }
                      )
                    }
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition ${
                      selectedFrame.flip_v
                        ? "bg-zinc-900 text-white ring-1 ring-zinc-900 dark:bg-[var(--studio-accent-soft)] dark:text-white dark:ring-[var(--studio-accent)]"
                        : "text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    }`}
                  >
                    <FlipVertical className="h-3.5 w-3.5" />
                    Flip V
                  </button>
                </div>

                <div className="space-y-3 border-t border-black/[0.08] dark:border-zinc-800/80 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      Interactive Crop
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowSafeGuides((v) => !v)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          showSafeGuides
                            ? "bg-[var(--studio-accent-soft)] studio-accent-text ring-1 ring-[var(--studio-accent-ring)]"
                            : "bg-[#efede8] dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        Guides
                      </button>
                      <button
                        type="button"
                        onClick={() => setCropEditEnabled((v) => !v)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                          cropEditEnabled
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "bg-[#e4e1d9] dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-[#d8d4cb] dark:hover:bg-zinc-700"
                        }`}
                      >
                        {cropEditEnabled ? "Editing Crop" : "Preview Result"}
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-700 dark:text-zinc-300">
                    Drag the handles on the canvas to frame this photo.
                  </p>

                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                      Crop Aspect Lock
                    </label>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                      {(
                        [
                          { id: "free", label: "Free" },
                          { id: "canvas", label: "Canvas" },
                          { id: "1:1", label: "1:1" },
                          { id: "4:5", label: "4:5" },
                          { id: "16:9", label: "16:9" },
                          { id: "9:16", label: "9:16" },
                        ] as { id: CropAspectLock; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setCropAspectLock(opt.id)}
                          className={`rounded-lg py-1.5 text-[11px] font-medium transition ${
                            cropAspectLock === opt.id
                              ? "bg-zinc-900 text-white dark:bg-zinc-700 dark:text-white"
                              : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedFrame.crop && (
                    <div className="rounded-lg bg-[#efede8] dark:bg-zinc-900/70 px-3 py-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 tabular-nums">
                      x:{Math.round(selectedFrame.crop.x * 100)}% · y:
                      {Math.round(selectedFrame.crop.y * 100)}% · w:
                      {Math.round(selectedFrame.crop.w * 100)}% · h:
                      {Math.round(selectedFrame.crop.h * 100)}%
                    </div>
                  )}

                  {studioMode === "expert" && (
                    <div className="space-y-3 rounded-xl bg-[#efede8]/75 dark:bg-zinc-900/50 p-2.5 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                      <div>
                        <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                          <span>Fine Straighten Angle</span>
                          <span className="font-mono studio-accent-text tabular-nums">
                            {(selectedFrame.straighten ?? 0).toFixed(1)}°
                          </span>
                        </label>
                        <input
                          type="range"
                          min={-15}
                          max={15}
                          step={0.5}
                          value={selectedFrame.straighten ?? 0}
                          onChange={(e) =>
                            updateSelectedFrame(
                              (f) => ({
                                ...f,
                                straighten: Number(e.target.value),
                              }),
                              { coalesce: true }
                            )
                          }
                          className="w-full"
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        {(["x", "y", "w", "h"] as const).map((field) => {
                          const currCrop = selectedFrame.crop ?? {
                            x: 0,
                            y: 0,
                            w: 1,
                            h: 1,
                          };
                          const pctVal = Math.round(currCrop[field] * 100);
                          return (
                            <label key={field} className="block text-center">
                              <span className="mb-0.5 block font-mono text-[11px] uppercase text-zinc-600 dark:text-zinc-400">
                                {field}%
                              </span>
                              <input
                                type="number"
                                min={field === "w" || field === "h" ? 8 : 0}
                                max={100}
                                value={pctVal}
                                onChange={(e) => {
                                  const raw = Math.max(
                                    field === "w" || field === "h" ? 8 : 0,
                                    Math.min(100, Number(e.target.value) || 0)
                                  );
                                  const next = { ...currCrop, [field]: raw / 100 };
                                  next.w = Math.max(0.08, Math.min(1 - next.x, next.w));
                                  next.h = Math.max(0.08, Math.min(1 - next.y, next.h));
                                  updateSelectedFrame(
                                    (f) => ({ ...f, crop: next }),
                                    { coalesce: true }
                                  );
                                }}
                                className="w-full rounded-md bg-white dark:bg-zinc-950 px-1 py-1 text-center font-mono text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedFrame(
                          (f) => ({
                            ...f,
                            crop: null,
                            rotate: 0,
                            straighten: 0,
                            flip_h: false,
                            flip_v: false,
                          }),
                          { coalesce: false }
                        )
                      }
                      className={`rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800 ${
                        frames.length <= 1 ? "col-span-2" : ""
                      }`}
                    >
                      Reset Crop
                    </button>
                    {frames.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          commitProject((prev) => ({
                            ...prev,
                            frames: prev.frames.map((f) => ({
                              ...f,
                              crop: selectedFrame.crop,
                              rotate: selectedFrame.rotate,
                              straighten: selectedFrame.straighten ?? 0,
                              flip_h: selectedFrame.flip_h,
                              flip_v: selectedFrame.flip_v,
                            })),
                          }))
                        }
                        className="rounded-lg bg-[var(--studio-accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--studio-accent-text)] ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
                      >
                        Apply to All
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Global Canvas Framing Borders & Rounded Corners */}
            <div className="space-y-3 border-t border-black/[0.08] dark:border-zinc-800/80 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Frame &amp; Rounded Corners
                </h3>
                {(border.style !== "none" || border.corner_radius > 0 || (border.inner_padding ?? 0) > 0 || Boolean(border.shadow)) && (
                  <button
                    type="button"
                    onClick={() =>
                      commitProject((prev) => ({ ...prev, border: DEFAULT_BORDER }))
                    }
                    className="text-[11px] text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                {(
                  [
                    { id: "none", label: "None" },
                    { id: "clean", label: "Clean" },
                    { id: "polaroid", label: "Polaroid" },
                    { id: "film", label: "35mm" },
                  ] as { id: BorderStyle; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      commitProject((prev) => ({
                        ...prev,
                        border: { ...prev.border, style: opt.id },
                      }))
                    }
                    className={`rounded-lg py-1.5 text-[11px] font-medium transition ${
                      border.style === opt.id
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                        : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {border.style !== "none" && (
                <>
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Border Size</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {border.thickness}px
                      </span>
                    </label>
                    <input
                      type="range"
                      min={4}
                      max={48}
                      step={2}
                      value={border.thickness}
                      onChange={(e) =>
                        commitProject(
                          (prev) => ({
                            ...prev,
                            border: {
                              ...prev.border,
                              thickness: Number(e.target.value),
                            },
                          }),
                          { coalesce: true }
                        )
                      }
                      className="w-full"
                    />
                  </div>

                  {border.style !== "film" && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Frame Color</span>
                        <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 uppercase">
                          {border.color}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {["#FFFFFF", "#F4EFE6", "#09090B", "#D97706"].map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() =>
                              commitProject((prev) => ({
                                ...prev,
                                border: { ...prev.border, color: hex },
                              }))
                            }
                            aria-label={`Set frame color ${hex}`}
                            style={{ backgroundColor: hex }}
                            className={`h-6 w-6 rounded-md ring-1 transition ${
                              border.color.toUpperCase() === hex
                                ? "ring-2 ring-[var(--studio-accent)] scale-105"
                                : "ring-white/20 hover:ring-white/50"
                            }`}
                          />
                        ))}
                        <input
                          type="color"
                          value={border.color}
                          onChange={(e) =>
                            commitProject(
                              (prev) => ({
                                ...prev,
                                border: { ...prev.border, color: e.target.value },
                              }),
                              { coalesce: true }
                            )
                          }
                          aria-label="Custom frame color"
                          className="h-7 w-9 cursor-pointer rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                  <span>Corner Radius</span>
                  <span className="font-mono studio-accent-text tabular-nums">
                    {border.corner_radius}px
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={48}
                  step={2}
                  value={border.corner_radius}
                  onChange={(e) =>
                    commitProject(
                      (prev) => ({
                        ...prev,
                        border: {
                          ...prev.border,
                          corner_radius: Number(e.target.value),
                        },
                      }),
                      { coalesce: true }
                    )
                  }
                  className="w-full"
                />
              </div>

              {studioMode === "expert" && (
                <>
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Inner Matte Padding</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {border.inner_padding ?? 0}px
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={48}
                      step={2}
                      value={border.inner_padding ?? 0}
                      onChange={(e) =>
                        commitProject(
                          (prev) => ({
                            ...prev,
                            border: {
                              ...prev.border,
                              inner_padding: Number(e.target.value),
                            },
                          }),
                          { coalesce: true }
                        )
                      }
                      className="w-full"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[#efede8] dark:bg-zinc-900/75 px-3 py-2">
                    <span className="text-xs text-zinc-800 dark:text-zinc-200">
                      Card Drop Shadow
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Toggle frame drop shadow"
                      checked={Boolean(border.shadow)}
                      onChange={(e) =>
                        commitProject((prev) => ({
                          ...prev,
                          border: { ...prev.border, shadow: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 accent-[var(--studio-accent)]"
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* EFFECTS / FILTERS TAB */}
        {activeTab === "effects" && (
          <>
            <div>
              <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Color Presets
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {FILTER_PRESETS.filter(
                  (p) => studioMode === "expert" || !p.expertOnly
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => updateFilters({ preset: p.id }, false)}
                    className={`flex flex-col items-center gap-1 rounded-lg p-1.5 transition ${
                      activeFilters.preset === p.id
                        ? "bg-[var(--studio-accent-soft)] ring-1 ring-[var(--studio-accent)]"
                        : "bg-[#efede8] dark:bg-zinc-900/70 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div
                      className={`h-7 w-full rounded bg-gradient-to-br ${p.swatch}`}
                    />
                    <span className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100">
                      {p.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t border-black/[0.08] dark:border-zinc-800/80 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  {studioMode === "expert" ? "Pro Grading & FX" : "Quick Adjustments"}
                </h3>
                <button
                  type="button"
                  onClick={() => updateFilters(DEFAULT_FILTERS, false)}
                  className="text-[11px] text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                >
                  Reset
                </button>
              </div>

              {[
                { key: "brightness", label: "Brightness", min: 0.4, max: 1.8, step: 0.05, expert: false },
                { key: "contrast", label: "Contrast", min: 0.4, max: 1.8, step: 0.05, expert: false },
                { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.05, expert: false },
                { key: "film_grain", label: "Film Grain", min: 0, max: 1, step: 0.05, expert: false },
                { key: "saturation", label: "Saturation", min: 0, max: 2.2, step: 0.05, expert: true },
                { key: "hue_shift", label: "Hue Shift (°)", min: -180, max: 180, step: 5, expert: true },
                { key: "temperature", label: "Color Temperature", min: -1, max: 1, step: 0.05, expert: true },
                { key: "split_tone", label: "Split Tone (Cool ↔ Warm)", min: -1, max: 1, step: 0.05, expert: true },
                { key: "bloom", label: "Soft Bloom Glow", min: 0, max: 1, step: 0.05, expert: true },
                { key: "sharpen", label: "Crisp Sharpen", min: 0, max: 1, step: 0.05, expert: true },
                { key: "chromatic", label: "Chromatic RGB Split", min: 0, max: 1, step: 0.05, expert: true },
                { key: "pixelate", label: "Pixelate Mosaic (px)", min: 0, max: 16, step: 2, expert: true },
                { key: "glitch", label: "Glitch / VHS", min: 0, max: 1, step: 0.05, expert: true },
                { key: "blur", label: "Soft Blur", min: 0, max: 8, step: 0.5, expert: true },
              ]
                .filter((slider) => studioMode === "expert" || !slider.expert)
                .map((slider) => {
                  const val =
                    (activeFilters[slider.key as keyof FilterConfig] as number | undefined) ?? 0;
                  return (
                    <div key={slider.key}>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>{slider.label}</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300 tabular-nums">
                          {slider.key === "pixelate"
                            ? val === 0
                              ? "Off"
                              : `${val}px`
                            : slider.key === "hue_shift"
                            ? `${Math.round(val)}°`
                            : val.toFixed(2)}
                        </span>
                      </label>
                      <input
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={val}
                        onChange={(e) =>
                          updateFilters(
                            {
                              [slider.key]: Number(e.target.value),
                            } as Partial<FilterConfig>,
                            true
                          )
                        }
                        className="w-full"
                      />
                    </div>
                  );
                })}

              {studioMode === "expert" && (
                <div className="space-y-2.5 rounded-xl bg-[#efede8] dark:bg-zinc-900/75 p-3 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      Background Knockout Matte
                    </span>
                    <span className="font-mono text-[11px] studio-accent-text">
                      Local Key
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: "none", label: "Off" },
                        { id: "chroma_green", label: "Green Key" },
                        { id: "chroma_blue", label: "Blue Key" },
                        { id: "edge_flood", label: "Auto Edge" },
                        { id: "custom", label: "Custom" },
                      ] as { id: BgMatteMode; label: string }[]
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateFilters({ bg_matte: m.id }, false)}
                        className={`rounded-md py-1 text-[11px] font-medium transition ${
                          (activeFilters.bg_matte ?? "none") === m.id
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "bg-white/75 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {(activeFilters.bg_matte ?? "none") !== "none" && (
                    <div className="space-y-2 pt-1">
                      {(activeFilters.bg_matte ?? "none") === "custom" && (
                        <div className="flex items-center justify-between text-xs">
                          <span>Key Color</span>
                          <input
                            type="color"
                            value={activeFilters.matte_color ?? "#00FF00"}
                            onChange={(e) =>
                              updateFilters({ matte_color: e.target.value }, true)
                            }
                            className="h-7 w-12 cursor-pointer rounded bg-white p-0.5 ring-1 ring-black/10"
                          />
                        </div>
                      )}
                      <div>
                        <label className="mb-1 flex justify-between text-[11px] text-zinc-700 dark:text-zinc-300">
                          <span>Tolerance</span>
                          <span className="font-mono studio-accent-text tabular-nums">
                            {Math.round((activeFilters.matte_tolerance ?? 0.22) * 100)}%
                          </span>
                        </label>
                        <input
                          type="range"
                          min={0.04}
                          max={0.65}
                          step={0.02}
                          value={activeFilters.matte_tolerance ?? 0.22}
                          onChange={(e) =>
                            updateFilters({ matte_tolerance: Number(e.target.value) }, true)
                          }
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="mb-1 flex justify-between text-[11px] text-zinc-700 dark:text-zinc-300">
                          <span>Edge Feather</span>
                          <span className="font-mono studio-accent-text tabular-nums">
                            {Math.round((activeFilters.matte_feather ?? 0.08) * 100)}%
                          </span>
                        </label>
                        <input
                          type="range"
                          min={0.01}
                          max={0.35}
                          step={0.01}
                          value={activeFilters.matte_feather ?? 0.08}
                          onChange={(e) =>
                            updateFilters({ matte_feather: Number(e.target.value) }, true)
                          }
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {frames.length > 1 && studioMode === "expert" && (
                <button
                  type="button"
                  onClick={() =>
                    commitProject((prev) => ({
                      ...prev,
                      globalFilters: activeFilters,
                      frames: prev.frames.map((f) => ({ ...f, filters: null })),
                    }))
                  }
                  className="w-full rounded-lg bg-[var(--studio-accent-soft)] px-3 py-2 text-xs font-semibold studio-accent-text ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
                >
                  Apply Effects to All Frames
                </button>
              )}
            </div>
          </>
        )}

        {/* TEXT OVERLAY TAB */}
        {activeTab === "text" && (
            <div className="space-y-4">
              {studioMode === "expert" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveTextLayerIdx(-1)}
                      className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                        safeTextLayerIdx === -1
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      Headline 1
                    </button>
                    {extraTextLayers.map((_, lIdx) => (
                      <button
                        key={`badge-tab-${lIdx}`}
                        type="button"
                        onClick={() => setActiveTextLayerIdx(lIdx)}
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                          safeTextLayerIdx === lIdx
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        Badge {lIdx + 2}
                      </button>
                    ))}
                    {extraTextLayers.length < 3 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newBadge: TextBadgeLayer = {
                            ...DEFAULT_TEXT_LAYER,
                            text: `BADGE ${extraTextLayers.length + 2}`,
                            font_size: 24,
                            position: "top",
                            x_pct: 0.5,
                            y_pct: Math.min(0.85, 0.2 + extraTextLayers.length * 0.14),
                          };
                          const nextExtras = [...extraTextLayers, newBadge];
                          updateText({ extra_layers: nextExtras }, false);
                          setActiveTextLayerIdx(nextExtras.length - 1);
                        }}
                        className="ml-auto rounded-lg bg-[var(--studio-accent-soft)] px-2 py-1 text-[11px] font-semibold studio-accent-text"
                      >
                        + Add Badge
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
                    <span>Drag T1–T4 handles directly on canvas</span>
                    <div className="flex items-center gap-2">
                      {currTextLayer.x_pct != null && (
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrTextLayer({ x_pct: null, y_pct: null }, false)
                          }
                          className="font-medium studio-accent-text hover:underline"
                        >
                          Snap Align
                        </button>
                      )}
                      {safeTextLayerIdx >= 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextExtras = extraTextLayers.filter(
                              (_, i) => i !== safeTextLayerIdx
                            );
                            updateText({ extra_layers: nextExtras }, false);
                            setActiveTextLayerIdx(-1);
                          }}
                          className="font-medium text-red-600 dark:text-red-400 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  {safeTextLayerIdx === -1 ? "Caption / Meme Text" : `Badge ${safeTextLayerIdx + 2} Text`}
                </label>
                <textarea
                  rows={2}
                  placeholder="Add caption text..."
                  value={currTextLayer.text}
                  onChange={(e) => updateCurrTextLayer({ text: e.target.value }, true)}
                  className="w-full rounded-xl bg-[#efede8] dark:bg-zinc-900 p-2.5 text-base sm:text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-600 dark:placeholder:text-zinc-400 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                  Vertical Position
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                  {(["top", "center", "bottom"] as const).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() =>
                        updateCurrTextLayer({ position: pos, x_pct: null, y_pct: null }, false)
                      }
                      className={`rounded-lg py-1.5 text-xs capitalize transition ${
                        currTextLayer.position === pos && currTextLayer.x_pct == null
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                          : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {studioMode === "expert" && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                        Font Family
                      </label>
                      <select
                        value={currTextLayer.font_family ?? "sans"}
                        onChange={(e) =>
                          updateCurrTextLayer(
                            { font_family: e.target.value as TextOverlayConfig["font_family"] },
                            false
                          )
                        }
                        className="w-full rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2 py-1.5 text-base md:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                      >
                        <option value="sans">Modern Sans</option>
                        <option value="serif">Editorial Serif</option>
                        <option value="mono">Code Mono</option>
                        <option value="display">Heavy Display</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                        Entrance Animation
                      </label>
                      <select
                        value={currTextLayer.entrance ?? "none"}
                        onChange={(e) =>
                          updateCurrTextLayer(
                            { entrance: e.target.value as TextOverlayConfig["entrance"] },
                            false
                          )
                        }
                        className="w-full rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2 py-1.5 text-base md:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                      >
                        <option value="none">Static</option>
                        <option value="fade_in">Fade In</option>
                        <option value="slide_up">Slide Up</option>
                        <option value="typewriter">Typewriter</option>
                        <option value="bounce">Bounce Pop</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                      Horizontal Alignment
                    </label>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                      {(["left", "center", "right"] as const).map((al) => (
                        <button
                          key={al}
                          type="button"
                          onClick={() => updateCurrTextLayer({ align: al }, false)}
                          className={`rounded-lg py-1.5 text-xs capitalize transition ${
                            (currTextLayer.align ?? "center") === al
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                              : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                          }`}
                        >
                          {al}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                  <span>Font Size</span>
                  <span className="font-mono studio-accent-text tabular-nums">
                    {currTextLayer.font_size}px
                  </span>
                </label>
                <input
                  type="range"
                  min={14}
                  max={96}
                  step={2}
                  value={currTextLayer.font_size}
                  onChange={(e) =>
                    updateCurrTextLayer({ font_size: Number(e.target.value) }, true)
                  }
                  className="w-full"
                />
              </div>

              {studioMode === "expert" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Tilt Angle</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {(currTextLayer.rotation ?? 0).toFixed(0)}°
                        </span>
                      </label>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        step={1}
                        value={currTextLayer.rotation ?? 0}
                        onChange={(e) =>
                          updateCurrTextLayer({ rotation: Number(e.target.value) }, true)
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Tracking</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {currTextLayer.letter_spacing ?? 0}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={12}
                        step={1}
                        value={currTextLayer.letter_spacing ?? 0}
                        onChange={(e) =>
                          updateCurrTextLayer({ letter_spacing: Number(e.target.value) }, true)
                        }
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Pill Radius</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {currTextLayer.box_radius ?? 14}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={32}
                        step={2}
                        value={currTextLayer.box_radius ?? 14}
                        onChange={(e) =>
                          updateCurrTextLayer({ box_radius: Number(e.target.value) }, true)
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Opacity</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {Math.round((currTextLayer.opacity ?? 1) * 100)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={currTextLayer.opacity ?? 1}
                        onChange={(e) =>
                          updateCurrTextLayer({ opacity: Number(e.target.value) }, true)
                        }
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Outline Width</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {currTextLayer.stroke_width}px
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={currTextLayer.stroke_width}
                      onChange={(e) =>
                        updateCurrTextLayer({ stroke_width: Number(e.target.value) }, true)
                      }
                      className="w-full"
                    />
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={currTextLayer.bg_pill}
                    onChange={(e) =>
                      updateCurrTextLayer({ bg_pill: e.target.checked }, false)
                    }
                    className="h-4 w-4 accent-[var(--studio-accent)]"
                  />
                  Backdrop Pill
                </label>
                {studioMode === "expert" && (
                  <label className="flex items-center gap-2 text-xs text-zinc-800 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={currTextLayer.shadow ?? true}
                      onChange={(e) =>
                        updateCurrTextLayer({ shadow: e.target.checked }, false)
                      }
                      className="h-4 w-4 accent-[var(--studio-accent)]"
                    />
                    Drop Shadow
                  </label>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs text-zinc-700 dark:text-zinc-300">
                    Text Color
                  </label>
                  <input
                    type="color"
                    value={currTextLayer.color}
                    onChange={(e) => updateCurrTextLayer({ color: e.target.value }, true)}
                    className="h-9 w-full cursor-pointer rounded-lg bg-[#efede8] dark:bg-zinc-900 p-1 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-700 dark:text-zinc-300">
                    Outline Color
                  </label>
                  <input
                    type="color"
                    value={currTextLayer.stroke_color}
                    onChange={(e) =>
                      updateCurrTextLayer({ stroke_color: e.target.value }, true)
                    }
                    className="h-9 w-full cursor-pointer rounded-lg bg-[#efede8] dark:bg-zinc-900 p-1 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-700 dark:text-zinc-300">
                    Canvas BG
                  </label>
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) =>
                      commitProject(
                        (prev) => ({ ...prev, bgColor: e.target.value }),
                        { coalesce: true }
                      )
                    }
                    className="h-9 w-full cursor-pointer rounded-lg bg-[#efede8] dark:bg-zinc-900 p-1 ring-1 ring-black/[0.08] dark:ring-zinc-800"
                  />
                </div>
              </div>

              {frames.length > 1 && studioMode === "expert" && (
                <button
                  type="button"
                  onClick={() =>
                    commitProject((prev) => ({
                      ...prev,
                      globalText: activeText,
                      frames: prev.frames.map((f) => ({ ...f, text_overlay: null })),
                    }))
                  }
                  className="w-full rounded-lg bg-[var(--studio-accent-soft)] px-3 py-2 text-xs font-semibold studio-accent-text ring-1 ring-[var(--studio-accent-ring)] hover:opacity-90"
                >
                  Apply Text to All Frames
                </button>
              )}
            </div>
        )}

        {/* EXPORT SETTINGS TAB */}
        {activeTab === "export" && (
          <div className="space-y-3.5">
            {/* Pre-Export Estimate Summary */}
            <div className="rounded-xl bg-[#efede8] dark:bg-zinc-900/75 p-2.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Render Estimate
                </span>
                <span className="font-mono text-[11px] uppercase studio-accent-text">
                  {FORMAT_META[exportConfig.format].short}
                  {exportConfig.transparent_bg && exportConfig.format !== "mp4"
                    ? " · Alpha"
                    : ""}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="rounded-lg bg-[#e9e7e1] dark:bg-zinc-950/70 px-1.5 py-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">Size</div>
                  <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {exportEstimate.width}×{exportEstimate.height}
                  </div>
                </div>
                <div className="rounded-lg bg-[#e9e7e1] dark:bg-zinc-950/70 px-1.5 py-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">Frames</div>
                  <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {exportEstimate.renderFrames}
                  </div>
                </div>
                <div className="rounded-lg bg-[#e9e7e1] dark:bg-zinc-950/70 px-1.5 py-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">Length</div>
                  <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {exportEstimate.durationSec}s
                  </div>
                </div>
                <div className="rounded-lg bg-[#e9e7e1] dark:bg-zinc-950/70 px-1.5 py-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">Est.</div>
                  <div
                    className={`font-mono text-xs font-semibold tabular-nums ${
                      exportEstimate.overBudget
                        ? "studio-accent-text"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {exportEstimate.estSizeLabel}
                  </div>
                </div>
              </div>
              {exportEstimate.overBudget && (
                <div className="mt-1.5 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
                  Estimated size exceeds {exportConfig.target_size_mb} MB target — auto-shrink will optimize on export.
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Output Format
              </label>
              <div className="space-y-2">
                {(
                  [
                    { title: "Image", items: ["gif", "webp", "avif", "apng"] as const, cols: "grid-cols-4" },
                    { title: "Video Loop", items: ["mp4", "webm", "mov_alpha"] as const, cols: "grid-cols-3" },
                    {
                      title: "Web Dev Assets",
                      items:
                        studioMode === "expert"
                          ? (["spritesheet", "dotlottie", "lottie", "svg", "bundle_zip"] as const)
                          : (["spritesheet", "dotlottie", "lottie", "svg"] as const),
                      cols: studioMode === "expert" ? "grid-cols-3" : "grid-cols-2",
                    },
                  ] as const
                ).map((group) => (
                  <div key={group.title}>
                    <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      <span>{group.title}</span>
                    </div>
                    <div className={`grid ${group.cols} gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1`}>
                      {group.items.map((fmt) => {
                        const meta = FORMAT_META[fmt];
                        const active = exportConfig.format === fmt;
                        return (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() =>
                              setExportConfig((prev) => ({ ...prev, format: fmt }))
                            }
                            className={`flex flex-col items-center justify-center rounded-lg py-1.5 px-1 transition ${
                              active
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                                : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                            }`}
                          >
                            <span className="text-[11px] font-semibold leading-tight">
                              {meta.label}
                            </span>
                            {meta.badge && (
                              <span
                                className={`mt-0.5 text-[11px] leading-none ${
                                  active
                                    ? "text-zinc-300 dark:text-zinc-600"
                                    : "text-zinc-500 dark:text-zinc-400"
                                }`}
                              >
                                {meta.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {exportConfig.format === "spritesheet" && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                    Sprite Atlas Layout
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                    {(
                      [
                        { id: "strip", label: "Horizontal Strip" },
                        { id: "grid", label: "Compact Grid" },
                      ] as const
                    ).map((lay) => (
                      <button
                        key={lay.id}
                        type="button"
                        onClick={() =>
                          setExportConfig((prev) => ({ ...prev, sprite_layout: lay.id }))
                        }
                        className={`rounded-lg py-1.5 text-xs transition ${
                          exportConfig.sprite_layout === lay.id
                            ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white"
                            : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                        }`}
                      >
                        {lay.label}
                      </button>
                    ))}
                  </div>
                </div>
                {studioMode === "expert" && (
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Cell Padding Gap</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {exportConfig.sprite_padding ?? 0}px
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={24}
                      step={2}
                      value={exportConfig.sprite_padding ?? 0}
                      onChange={(e) =>
                        setExportConfig((prev) => ({
                          ...prev,
                          sprite_padding: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                Resolution
              </label>
              <div
                className={`grid ${
                  studioMode === "expert" ? "grid-cols-6" : "grid-cols-4"
                } gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1`}
              >
                {(studioMode === "expert"
                  ? (["480p", "720p", "1080p", "original", "retina_2x", "custom"] as const)
                  : (["480p", "720p", "1080p", "original"] as const)
                ).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() =>
                      setExportConfig((prev) => ({
                        ...prev,
                        resolution: res,
                        custom_width: prev.custom_width ?? 640,
                      }))
                    }
                    className={`rounded-lg py-1.5 text-[11px] font-medium transition ${
                      exportConfig.resolution === res
                        ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white"
                        : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                    }`}
                  >
                    {res === "original"
                      ? "Orig"
                      : res === "retina_2x"
                      ? "2×"
                      : res === "custom"
                      ? "Cust"
                      : res}
                  </button>
                ))}
              </div>
              {exportConfig.resolution === "custom" && studioMode === "expert" && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#efede8] dark:bg-zinc-900/70 px-3 py-2">
                  <label className="text-xs text-zinc-800 dark:text-zinc-200">Width (px)</label>
                  <input
                    type="number"
                    min={64}
                    max={2160}
                    step={16}
                    value={exportConfig.custom_width ?? 640}
                    onChange={(e) =>
                      setExportConfig((prev) => ({
                        ...prev,
                        custom_width: Math.max(
                          64,
                          Math.min(2160, Number(e.target.value) || 640)
                        ),
                      }))
                    }
                    className="w-24 rounded-md bg-[#efede8] dark:bg-zinc-950 px-2 py-1 text-right font-mono text-base sm:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                  />
                </div>
              )}
            </div>

            {exportConfig.format !== "apng" && exportConfig.format !== "spritesheet" && (
              <div>
                <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                  Quality &amp; Palette
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                  {(["high", "balanced", "compact"] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() =>
                        setExportConfig((prev) => ({ ...prev, quality: q }))
                      }
                      className={`rounded-lg py-1.5 text-xs capitalize transition ${
                        exportConfig.quality === q
                          ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white"
                          : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {studioMode === "expert" &&
              (exportConfig.format === "webp" || exportConfig.format === "avif") && (
                <div className="space-y-3 rounded-xl bg-[#efede8]/80 dark:bg-zinc-900/50 p-2.5 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      Lossless Compression
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(exportConfig.lossless)}
                      onChange={(e) =>
                        setExportConfig((prev) => ({
                          ...prev,
                          lossless: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[var(--studio-accent)]"
                    />
                  </div>
                  {!exportConfig.lossless && (
                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Exact Encoder Quality</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {exportConfig.custom_quality ?? 85}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={5}
                        value={exportConfig.custom_quality ?? 85}
                        onChange={(e) =>
                          setExportConfig((prev) => ({
                            ...prev,
                            custom_quality: Number(e.target.value),
                          }))
                        }
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              )}

            {studioMode === "expert" &&
              (exportConfig.format === "mp4" || exportConfig.format === "webm") && (
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                      Video Codec
                    </label>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#efede8] dark:bg-zinc-900 p-1">
                      {(
                        [
                          {
                            id: "auto",
                            label: exportConfig.format === "mp4" ? "H.264 (Compat)" : "VP9 (Alpha)",
                          },
                          { id: "av1", label: "AV1 (Smallest)" },
                        ] as const
                      ).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setExportConfig((prev) => ({
                              ...prev,
                              video_codec: c.id,
                            }))
                          }
                          className={`rounded-lg py-1.5 text-xs transition ${
                            (exportConfig.video_codec ?? "auto") === c.id
                              ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white"
                              : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                      <span>Video CRF Override (Lower = Sharper)</span>
                      <span className="font-mono studio-accent-text tabular-nums">
                        {exportConfig.video_crf ?? "Auto"}
                      </span>
                    </label>
                    <input
                      type="range"
                      min={14}
                      max={40}
                      step={2}
                      value={exportConfig.video_crf ?? (exportConfig.format === "mp4" ? 20 : 28)}
                      onChange={(e) =>
                        setExportConfig((prev) => ({
                          ...prev,
                          video_crf: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                </div>
              )}

            {exportConfig.format === "gif" && (
              <>
                {studioMode === "expert" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                        Dithering
                      </label>
                      <select
                        value={exportConfig.dither}
                        onChange={(e) =>
                          setExportConfig((prev) => ({
                            ...prev,
                            dither: e.target.value as ExportConfig["dither"],
                          }))
                        }
                        className="w-full rounded-lg bg-[#efede8] dark:bg-zinc-900 px-2.5 py-2 text-base sm:text-xs text-zinc-900 dark:text-zinc-100 ring-1 ring-black/[0.08] dark:ring-zinc-800 focus:ring-[var(--studio-accent)] focus:outline-none"
                      >
                        <option value="floyd_steinberg">
                          Floyd-Steinberg (Smooth gradients)
                        </option>
                        <option value="bayer">Bayer (Crisp / smaller file)</option>
                        <option value="none">None (Flat graphic colors)</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                        <span>Max Colors</span>
                        <span className="font-mono studio-accent-text tabular-nums">
                          {exportConfig.max_colors}
                        </span>
                      </label>
                      <input
                        type="range"
                        min={32}
                        max={256}
                        step={32}
                        value={exportConfig.max_colors}
                        onChange={(e) =>
                          setExportConfig((prev) => ({
                            ...prev,
                            max_colors: Number(e.target.value),
                          }))
                        }
                        className="w-full"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="mb-1.5 block text-xs text-zinc-800 dark:text-zinc-200">
                    Platform Size Target
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "No Limit", val: null },
                      { label: "Slack (<5MB)", val: 4.8 },
                      { label: "Discord (<10MB)", val: 9.5 },
                      { label: "X / Twitter (<15MB)", val: 14.5 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setExportConfig((prev) => ({
                            ...prev,
                            target_size_mb: preset.val,
                          }))
                        }
                        className={`rounded-lg px-2 py-2 text-[11px] font-medium transition ${
                          exportConfig.target_size_mb === preset.val
                            ? "bg-zinc-900 text-white ring-1 ring-zinc-900 dark:bg-[var(--studio-accent-soft)] dark:text-white dark:ring-[var(--studio-accent)]"
                            : "bg-[#efede8] dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300 hover:bg-[#e2dfd7] dark:hover:bg-zinc-800"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {studioMode === "expert" && (
              <div>
                <label className="mb-1 flex justify-between text-xs text-zinc-800 dark:text-zinc-200">
                  <span>Transition / Motion FPS</span>
                  <span className="font-mono studio-accent-text tabular-nums">
                    {exportConfig.fps} fps
                  </span>
                </label>
                <input
                  type="range"
                  min={6}
                  max={30}
                  step={1}
                  value={exportConfig.fps}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      fps: Number(e.target.value),
                    }))
                  }
                  className="w-full"
                />
              </div>
            )}

            {exportConfig.format !== "mp4" && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[#efede8] dark:bg-zinc-900/75 px-3 py-2.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
                <div>
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    Transparent Background
                  </div>
                  <div className="text-[11px] text-zinc-700 dark:text-zinc-300">
                    Keep alpha channel for stickers &amp; rounded corners
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={exportConfig.transparent_bg}
                  aria-label="Toggle transparent background"
                  onClick={() =>
                    setExportConfig((prev) => ({
                      ...prev,
                      transparent_bg: !prev.transparent_bg,
                    }))
                  }
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    exportConfig.transparent_bg ? "bg-[var(--studio-accent)]" : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      exportConfig.transparent_bg ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Reusable Timeline Panel with Multi-Select Batch & Individual Image Customization
  const timelineContent = (
    <TimelinePanel
      frames={frames}
      mediaBin={mediaBin}
      selectedFrameUid={selectedFrameUid}
      activeSelectedUids={activeSelectedUids}
      globalMotion={globalMotion}
      totalTimelineMs={totalTimelineMs}
      copiedLook={copiedLook}
      timelineExpanded={timelineExpanded}
      isReplacingUpload={isReplacingFrameUpload}
      playingFrameUid={playingFrameUid}
      isPreviewPlaying={isPreviewPlaying}
      playbackChannel={playbackChannel}
      onSeekToFrame={(frameUid, frameRatio) => {
        setSelectedFrameUids([frameUid]);
        setSelectionAnchorUid(frameUid);
        setSeekToMsRequest({
          frameUid,
          frameRatio,
          play: false,
          nonce: Date.now() + Math.random(),
        });
      }}
      onToggleTimelineExpanded={() => setTimelineExpanded((p) => !p)}
      onSelectFrameClick={handleSelectFrameClick}
      onSelectAll={() => setSelectedFrameUids(frames.map((f) => f.uid))}
      onClearBatchSelection={() => {
        setSelectedFrameUids(selectedFrameUid ? [selectedFrameUid] : []);
      }}
      onReorderFrame={(fromIdx, toIdx) => {
        commitProject((prev) => {
          const next = [...prev.frames];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return { ...prev, frames: next };
        });
      }}
      onMoveFrame={handleMoveFrame}
      onDuplicateFrame={handleDuplicateFrame}
      onBatchDuplicate={handleBatchDuplicate}
      onBatchSetDuration={handleBatchSetDuration}
      onApplyUniformDuration={handleApplyUniformDuration}
      onSetFrameDuration={(uid, ms) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid ? { ...f, duration_ms: ms } : f
          ),
        }));
      }}
      onDecimateSelected={handleDecimateSelected}
      onReverseTimeline={(selectedOnly) => {
        if (!selectedOnly || activeSelectedUids.length < 2) {
          commitProject((prev) => ({
            ...prev,
            frames: [...prev.frames].reverse(),
          }));
          return;
        }
        const selectedSet = new Set(activeSelectedUids);
        commitProject((prev) => {
          const picked = prev.frames.filter((f) => selectedSet.has(f.uid)).reverse();
          let cursor = 0;
          return {
            ...prev,
            frames: prev.frames.map((f) =>
              selectedSet.has(f.uid) ? picked[cursor++] : f
            ),
          };
        });
      }}
      onPingPongTimeline={() => {
        if (frames.length < 2) return;
        commitProject((prev) => {
          const tail = prev.frames
            .slice(1, -1)
            .reverse()
            .map((f) => ({
              ...f,
              uid: `${f.media.id}_${Math.random().toString(36).slice(2, 9)}`,
            }));
          if (tail.length === 0) {
            const rev = [...prev.frames].reverse().map((f) => ({
              ...f,
              uid: `${f.media.id}_${Math.random().toString(36).slice(2, 9)}`,
            }));
            return { ...prev, frames: [...prev.frames, ...rev] };
          }
          return { ...prev, frames: [...prev.frames, ...tail] };
        });
      }}
      onRequestDeleteSingle={(frame, idx) =>
        setPendingDelete({
          kind: "single",
          uid: frame.uid,
          index: idx,
          filename: frame.media.filename,
        })
      }
      onRequestDeleteSelected={requestBatchDeleteSelected}
      onSwapFrameMedia={(uid, newMedia, resetTransform) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid
              ? {
                  ...f,
                  media: newMedia,
                  ...(resetTransform
                    ? {
                        crop: null,
                        rotate: 0 as RotateDegrees,
                        straighten: 0,
                        flip_h: false,
                        flip_v: false,
                      }
                    : {}),
                }
              : f
          ),
        }));
      }}
      onUploadReplacementForFrame={async (uid, file, resetTransform) => {
        setIsReplacingFrameUpload(true);
        setUploadError(null);
        try {
          const prepared = await prepareUploadFiles([file]);
          const uploaded = await uploadMediaFiles(prepared);
          setMediaBin((prev) => [...prev, ...uploaded]);
          const replacement = uploaded.find((u) => u.media_type === "image");
          if (!replacement) {
            setUploadError(
              "Selected replacement file is not a still/animated image."
            );
            return;
          }
          commitProject((prev) => ({
            ...prev,
            frames: prev.frames.map((f) =>
              f.uid === uid
                ? {
                    ...f,
                    media: replacement,
                    ...(resetTransform
                      ? {
                          crop: null,
                          rotate: 0 as RotateDegrees,
                          straighten: 0,
                          flip_h: false,
                          flip_v: false,
                        }
                      : {}),
                  }
                : f
            ),
          }));
        } catch (err) {
          setUploadError(
            err instanceof Error
              ? err.message
              : "Failed to upload replacement image"
          );
        } finally {
          setIsReplacingFrameUpload(false);
        }
      }}
      onRotateFrameQuick={(uid) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid
              ? { ...f, rotate: (((f.rotate + 90) % 360) as RotateDegrees) }
              : f
          ),
        }));
      }}
      onFlipFrameQuick={(uid) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid ? { ...f, flip_h: !f.flip_h } : f
          ),
        }));
      }}
      onSetFrameTransition={(uid, transition: TransitionType) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid ? { ...f, transition_in: transition } : f
          ),
        }));
      }}
      onBatchRotate90={() => {
        const targets = new Set(activeSelectedUids);
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            targets.has(f.uid)
              ? { ...f, rotate: (((f.rotate + 90) % 360) as RotateDegrees) }
              : f
          ),
        }));
      }}
      onCopyFrameLook={(frame) => {
        setCopiedLook({
          duration_ms: frame.duration_ms,
          motion: frame.motion ? { ...frame.motion } : null,
          filters: frame.filters ? { ...frame.filters } : null,
          text_overlay: frame.text_overlay ? { ...frame.text_overlay } : null,
          crop: frame.crop ? { ...frame.crop } : null,
          rotate: frame.rotate,
          straighten: frame.straighten,
          flip_h: frame.flip_h,
          flip_v: frame.flip_v,
          transition_in: frame.transition_in,
          transition_ms: frame.transition_ms,
        });
      }}
      onPasteLookToTargets={(uids) => {
        if (!copiedLook || uids.length === 0) return;
        const targetSet = new Set(uids);
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            targetSet.has(f.uid)
              ? {
                  ...f,
                  duration_ms: copiedLook.duration_ms,
                  motion: copiedLook.motion ? { ...copiedLook.motion } : null,
                  filters: copiedLook.filters ? { ...copiedLook.filters } : null,
                  text_overlay: copiedLook.text_overlay
                    ? { ...copiedLook.text_overlay }
                    : null,
                  crop: copiedLook.crop ? { ...copiedLook.crop } : null,
                  rotate: copiedLook.rotate,
                  straighten: copiedLook.straighten,
                  flip_h: copiedLook.flip_h,
                  flip_v: copiedLook.flip_v,
                  transition_in: copiedLook.transition_in,
                  transition_ms: copiedLook.transition_ms,
                }
              : f
          ),
        }));
      }}
      onResetFrameOverrides={(uid) => {
        commitProject((prev) => ({
          ...prev,
          frames: prev.frames.map((f) =>
            f.uid === uid
              ? {
                  ...f,
                  motion: null,
                  filters: null,
                  text_overlay: null,
                  crop: null,
                  rotate: 0,
                  straighten: 0,
                  flip_h: false,
                  flip_v: false,
                  transition_in: "none",
                }
              : f
          ),
        }));
      }}
      onEditFrameInInspector={(uid, targetTab) => {
        setSelectedFrameUids([uid]);
        setSelectionAnchorUid(uid);
        setInspectorScope("frame");
        setMobilePane("inspector");
        if (targetTab) {
          setActiveTab(targetTab);
        } else if (activeTab === "loop" || activeTab === "export") {
          setActiveTab("effects");
        }
      }}
      onInsertMediaAt={(item, insertIndex) => {
        if (item.media_type === "video") {
          setPendingVideosQueue((prev) => [...prev, item]);
          return;
        }
        const newFrame = createFrameFromMedia(item, item.frame_duration_ms ?? 500);
        commitProject((prev) => {
          const next = [...prev.frames];
          const idx =
            typeof insertIndex === "number"
              ? Math.max(0, Math.min(next.length, insertIndex))
              : next.length;
          next.splice(idx, 0, newFrame);
          return { ...prev, frames: next };
        });
        setSelectedFrameUids([newFrame.uid]);
        setSelectionAnchorUid(newFrame.uid);
      }}
      onTriggerAddImages={() => fileInputRef.current?.click()}
    />
  );

  return (
    <StudioIconProvider weight={iconWeight} iconSize={iconSize}>
      <div
        className="relative flex h-screen flex-col overflow-hidden bg-[#f4f3ef] text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer?.types ?? []);
        if (types.includes("Files") || types.includes("application/x-gif-studio-media")) {
          e.preventDefault();
          if (types.includes("Files")) {
            setIsDraggingUpload(true);
          }
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || e.relatedTarget === null) {
          setIsDraggingUpload(false);
        }
      }}
      onDrop={(e) => {
        setIsDraggingUpload(false);
        const rawMedia = e.dataTransfer?.getData("application/x-gif-studio-media");
        if (rawMedia) {
          e.preventDefault();
          try {
            const parsed = JSON.parse(rawMedia) as UploadedMediaItem;
            if (parsed.media_type === "video") {
              setPendingVideosQueue((prev) => [...prev, parsed]);
            } else {
              const added = createFrameFromMedia(parsed, parsed.frame_duration_ms ?? 500);
              commitProject((prev) => ({ ...prev, frames: [...prev.frames, added] }));
              setSelectedFrameUids([added.uid]);
              setSelectionAnchorUid(added.uid);
            }
          } catch {
            // ignore invalid payload
          }
          return;
        }
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Full-window Drop Overlay */}
      {isDraggingUpload && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/45 dark:bg-black/65 backdrop-blur-xs">
          <div className="flex flex-col items-center studio-panel-radius border-2 border-dashed border-[var(--studio-accent)] bg-[#fbfaf8]/95 dark:bg-zinc-950/90 px-8 py-6 text-center shadow-2xl">
            <CloudArrowUp className="mb-2 h-9 w-9 studio-accent-text" />
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              Drop files anywhere to import
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Supports JPEG, PNG, GIF, WebP, AVIF, APNG, HEIC, SVG, .lottie &amp; MP4/MOV/MKV
            </p>
          </div>
        </div>
      )}

      {/* Architectural Single-Row Studio Header */}
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/[0.08] bg-[#fbfaf8]/95 px-2.5 sm:px-4 backdrop-blur-md dark:border-white/[0.08] dark:bg-[#0b0b0f]/95">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950">
            <Aperture className="h-3.5 w-3.5" />
          </div>
          <span className="studio-display-font truncate text-[13px] sm:text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            GIF Studio
          </span>

          {/* Desktop & Tablet Panel Toggles */}
          <div className="hidden md:flex items-center gap-1 pl-1">
            {/* Tablet / Small Laptop (md..xl): Slide-over Media Bin Drawer */}
            <button
              type="button"
              onClick={() => setTabletMediaDrawerOpen((o) => !o)}
              className={`xl:hidden flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                tabletMediaDrawerOpen
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "bg-black/[0.04] text-zinc-700 hover:bg-black/[0.08] dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
              }`}
            >
              <SidebarSimple className="h-3.5 w-3.5" />
              Media ({mediaBin.length})
            </button>

            {/* Desktop (xl+): Collapse/Expand Left Media Bin */}
            <button
              type="button"
              onClick={() => setDesktopMediaOpen((o) => !o)}
              title={desktopMediaOpen ? "Hide Media Bin" : "Show Media Bin"}
              className={`hidden xl:flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                desktopMediaOpen
                  ? "bg-black/[0.08] text-zinc-900 dark:bg-white/[0.08] dark:text-white"
                  : "bg-black/[0.03] text-zinc-600 hover:bg-black/[0.08] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              <SidebarSimple className="h-3.5 w-3.5" />
              Media ({mediaBin.length})
            </button>

            {/* Collapse/Expand Bottom Timeline (md+) */}
            <button
              type="button"
              onClick={() => setTimelineOpen((o) => !o)}
              title={timelineOpen ? "Hide Timeline" : "Show Timeline"}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                timelineOpen
                  ? "bg-black/[0.08] text-zinc-900 dark:bg-white/[0.08] dark:text-white"
                  : "bg-black/[0.03] text-zinc-600 hover:bg-black/[0.08] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              <FadersHorizontal className="h-3.5 w-3.5" />
              Timeline
            </button>
          </div>
        </div>

          {/* Actions (Beginner/Expert Mode, Guide, MIT, Style Customizer, Day/Night Switch, Undo/Redo, Clear, Export) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {/* Beginner / Expert Mode Switch (Desktop & Tablet Header) */}
            <div
              role="group"
              aria-label="Studio experience mode"
              className="hidden md:flex items-center rounded-lg bg-black/[0.04] p-0.5 ring-1 ring-black/[0.06] dark:bg-white/[0.04] dark:ring-white/[0.06]"
            >
              {(["beginner", "expert"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => applyStudioMode(m)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                    studioMode === m
                      ? "bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950"
                      : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="hidden md:block mx-0.5 h-4 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
            <button
              type="button"
              onClick={() => setGuideModalSection("guide")}
              title="How to Use GIF Studio"
              aria-label="How to Use GIF Studio"
              className="studio-pill-radius flex items-center gap-1.5 bg-black/[0.04] px-1.5 sm:px-2 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-black/[0.06] transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.04] dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-white/[0.09] dark:hover:text-white"
            >
              <BookOpenText className="studio-accent-text h-3.5 w-3.5" />
              <span className="hidden lg:inline">How to Use</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideModalSection("license")}
              title="Open Source MIT License & Privacy"
              aria-label="Open Source MIT License"
              className="studio-pill-radius hidden sm:flex items-center gap-1.5 bg-black/[0.04] px-2 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-black/[0.06] transition hover:bg-black/[0.08] hover:text-zinc-950 dark:bg-white/[0.04] dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-white/[0.09] dark:hover:text-white"
            >
              <Scales className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-300" />
              <span>MIT</span>
            </button>

            {/* Studio Style CSS Customizer Popover (Desktop & Mobile accessible) */}
            <div ref={styleMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setStyleMenuOpen((v) => !v)}
                aria-expanded={styleMenuOpen}
                aria-label="Customize Studio Appearance"
                title="Customize Studio Colors, Fonts, Icons & Corners"
                className={`studio-pill-radius flex items-center gap-1.5 p-1.5 sm:px-2 sm:py-1.5 text-xs font-medium ring-1 transition ${
                  styleMenuOpen
                    ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100"
                    : "bg-black/[0.04] text-zinc-700 ring-black/[0.06] hover:bg-black/[0.08] dark:bg-white/[0.04] dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-white/[0.09]"
                }`}
              >
                <Swatches className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Style</span>
              </button>

              {styleMenuOpen && (
                <div className="studio-panel-radius fixed sm:absolute right-3 sm:right-0 top-12 sm:top-10 z-50 w-[calc(100vw-1.5rem)] max-w-72 bg-[#fbfaf8] p-3.5 text-zinc-900 shadow-[0_20px_50px_-12px_rgba(20,20,22,0.28),0_0_0_1px_rgba(20,20,22,0.08)] dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)] space-y-3.5">
                  <div className="flex items-center justify-between border-b border-black/[0.07] dark:border-white/[0.08] pb-2">
                    <span className="studio-display-font text-xs font-semibold">
                      Studio CSS Tokens
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={resetStudioStyles}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setStyleMenuOpen(false)}
                        aria-label="Close style menu"
                        className="rounded p-1 text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Accent Palette */}
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      Accent Palette
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {ACCENT_PRESETS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyAccent(item.id)}
                          className={`studio-pill-radius flex flex-col items-center gap-1 px-1.5 py-1.5 text-[11px] font-medium transition ${
                            accent === item.id
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                              : "bg-[#efede8] text-zinc-700 hover:bg-[#e5e2db] dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                          }`}
                        >
                          <span
                            className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-black/15 dark:ring-white/20"
                            style={{ backgroundColor: item.swatch }}
                          >
                            {accent === item.id && (
                              <Check className="h-2.5 w-2.5 text-white" weight="bold" />
                            )}
                          </span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Icon Weight */}
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      Icon Pack Weight
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#efede8] p-1 dark:bg-zinc-950">
                      {(["duotone", "regular", "bold"] as StudioIconWeight[]).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => applyIconWeight(w)}
                          className={`rounded-md py-1 text-[11px] capitalize font-medium transition ${
                            iconWeight === w
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                              : "text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Icon Size & Corner Radius */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                        Icon Size
                      </div>
                      <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-[#efede8] p-0.5 dark:bg-zinc-950">
                        {(
                          [
                            { id: "compact", label: "S" },
                            { id: "default", label: "M" },
                            { id: "spacious", label: "L" },
                          ] as { id: StudioIconSize; label: string }[]
                        ).map((sz) => (
                          <button
                            key={sz.id}
                            type="button"
                            onClick={() => applyIconSize(sz.id)}
                            className={`rounded py-1 text-[11px] font-medium ${
                              iconSize === sz.id
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                                : "text-zinc-700 dark:text-zinc-300"
                            }`}
                          >
                            {sz.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                        Corners
                      </div>
                      <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-[#efede8] p-0.5 dark:bg-zinc-950">
                        {(
                          [
                            { id: "sharp", label: "Sharp" },
                            { id: "balanced", label: "Mid" },
                            { id: "soft", label: "Soft" },
                          ] as { id: StudioRadius; label: string }[]
                        ).map((rd) => (
                          <button
                            key={rd.id}
                            type="button"
                            onClick={() => applyRadius(rd.id)}
                            className={`rounded py-1 text-[11px] font-medium ${
                              radiusMode === rd.id
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                                : "text-zinc-700 dark:text-zinc-300"
                            }`}
                          >
                            {rd.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Typography Family */}
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      Typography Style
                    </div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#efede8] p-1 dark:bg-zinc-950">
                      {(
                        [
                          { id: "technical", label: "Geist Tech" },
                          { id: "editorial", label: "Editorial Serif" },
                        ] as { id: StudioFont; label: string }[]
                      ).map((ft) => (
                        <button
                          key={ft.id}
                          type="button"
                          onClick={() => applyFont(ft.id)}
                          className={`rounded-md py-1 text-[11px] font-medium ${
                            fontMode === ft.id
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                              : "text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          {ft.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Day / Night Studio Theme Switch (single compact icon on <sm, dual segmented pill on sm+) */}
          <button
            type="button"
            onClick={handleToggleTheme}
            title="Switch Day / Night Theme"
            aria-label="Switch Day / Night Theme"
            className="flex items-center gap-0.5 rounded-lg bg-black/[0.05] p-0.5 ring-1 ring-black/[0.07] transition hover:bg-black/[0.08] dark:bg-white/[0.05] dark:ring-white/[0.07] dark:hover:bg-white/[0.08]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-zinc-900 shadow-xs transition dark:hidden sm:dark:flex dark:bg-transparent dark:text-zinc-400 dark:shadow-none">
              <Sun className="h-3.5 w-3.5" />
            </span>
            <span className="hidden dark:flex sm:flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-xs">
              <Moon className="h-3.5 w-3.5" />
            </span>
          </button>

          <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.04] p-0.5 ring-1 ring-black/[0.06] dark:bg-white/[0.05] dark:ring-white/[0.06]">
            <button
              type="button"
              disabled={past.length === 0}
              onClick={handleUndo}
              title="Undo (Cmd+Z)"
              aria-label="Undo"
              className="rounded-md p-1.5 text-zinc-700 transition hover:bg-black/[0.07] disabled:opacity-35 dark:text-zinc-200 dark:hover:bg-white/[0.08]"
            >
              <ArrowArcLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={future.length === 0}
              onClick={handleRedo}
              title="Redo (Cmd+Shift+Z)"
              aria-label="Redo"
              className="rounded-md p-1.5 text-zinc-700 transition hover:bg-black/[0.07] disabled:opacity-35 dark:text-zinc-200 dark:hover:bg-white/[0.08]"
            >
              <ArrowArcRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {frames.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setPendingDelete({ kind: "clear_all", count: frames.length })
              }
              title="Clear timeline"
              aria-label="Clear timeline"
              className="flex items-center gap-1.5 rounded-lg bg-black/[0.05] px-2 sm:px-2.5 py-1.5 text-xs font-medium text-zinc-800 ring-1 ring-black/[0.06] transition hover:bg-black/[0.1] dark:bg-white/[0.05] dark:text-zinc-200 dark:ring-white/[0.06] dark:hover:bg-white/[0.1]"
            >
              <ArrowCounterClockwise className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
          <button
            type="button"
            disabled={frames.length === 0 || isExporting}
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-accent)]"
          >
            <DownloadSimple className="h-3.5 w-3.5" />
            <span>Export</span>
            <span className="hidden sm:inline">
              {FORMAT_META[exportConfig.format].short}
            </span>
          </button>
        </div>
      </header>

      {backendOnline === false && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Warning className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              Python backend unreachable at{" "}
              <code className="font-mono text-amber-100">{API_BASE}</code>. Start
              both servers with <code className="font-mono text-amber-100">./start.sh</code>.
            </span>
          </div>
          <button
            type="button"
            onClick={verifyBackend}
            className="shrink-0 rounded-md bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30"
          >
            Retry
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.apng,.gif,.webp,.avif,.heic,.heif,.hif,.bmp,.tiff,.tif,.svg,.json,.lottie,.mov,.mp4,.m4v,.webm,.mkv,.avi,.ogv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* 3-Tier Adaptive Studio Workspace */}
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
        {/* Desktop (xl+) Collapsible Media Bin */}
        <aside
          className={`hidden xl:block shrink-0 border-black/[0.07] dark:border-white/[0.07] bg-[#fbfaf8] dark:bg-[#0b0b0f] transition-all duration-200 overflow-hidden ${
            desktopMediaOpen
              ? "w-[272px] 2xl:w-[292px] border-r"
              : "w-0 border-r-0"
          }`}
        >
          <div className="h-full w-[272px] 2xl:w-[292px]">{mediaBinContent}</div>
        </aside>

        {/* Tablet / Small Laptop (md..xl) Slide-Over Media Drawer */}
        {tabletMediaDrawerOpen && (
          <>
            <div
              onClick={() => setTabletMediaDrawerOpen(false)}
              className="hidden md:block xl:hidden fixed inset-0 top-12 z-20 bg-black/35 dark:bg-black/50 backdrop-blur-xs"
            />
            <aside className="hidden md:flex xl:hidden fixed top-12 bottom-0 left-0 z-30 w-80 flex-col border-r border-black/[0.08] dark:border-white/[0.1] bg-[#fbfaf8]/95 dark:bg-[#0b0b0f]/95 backdrop-blur-xl shadow-2xl">
              <div className="flex items-center justify-between border-b border-black/[0.07] dark:border-white/[0.08] px-3 py-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Media Library
                </span>
                <button
                  type="button"
                  onClick={() => setTabletMediaDrawerOpen(false)}
                  aria-label="Close Media Drawer"
                  className="rounded-lg p-1 text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{mediaBinContent}</div>
            </aside>
          </>
        )}

        {/* Center Stage (Single CanvasPreview across all breakpoints) */}
        <main
          className={`flex min-w-0 flex-col bg-[#f4f3ef] dark:bg-[#08080b] border-b md:border-b-0 border-black/[0.07] dark:border-white/[0.07] transition-all duration-200 ${
            mobileStageCompact
              ? "h-[195px] shrink-0 md:h-auto md:flex-1"
              : "h-[41vh] min-h-[235px] shrink-0 md:h-auto md:flex-1"
          }`}
        >
          <CanvasPreview
            frames={frames}
            aspectRatio={aspectRatio}
            fitMode={fitMode}
            bgColor={bgColor}
            loopMode={loopMode}
            speedMultiplier={speedMultiplier}
            endHoldMs={endHoldMs}
            crossfadeLoopMs={crossfadeLoopMs}
            globalMotion={globalMotion}
            globalFilters={globalFilters}
            globalText={globalText}
            border={border}
            transparentBg={
              (exportConfig.transparent_bg ||
                (activeFilters.bg_matte ?? "none") !== "none" ||
                border.corner_radius > 0 ||
                Boolean(border.shadow)) &&
              exportConfig.format !== "mp4"
            }
            selectedFrameUid={selectedFrameUid}
            onSelectFrame={(uid) => {
              setSelectedFrameUids([uid]);
              setSelectionAnchorUid(uid);
            }}
            onTriggerUpload={() => fileInputRef.current?.click()}
            onLoadSamples={() => handleLoadSamples("stock")}
            onLoadMotionSamples={() => handleLoadSamples("motion")}
            onLoadVideoSample={() => handleLoadSamples("video")}
            isLoadingSamples={isLoadingSamples}
            onChangeAspectRatio={(ratio) =>
              commitProject((prev) => ({ ...prev, aspectRatio: ratio }))
            }
            onChangeFitMode={(mode) =>
              commitProject((prev) => ({ ...prev, fitMode: mode }))
            }
            mobileStageCompact={mobileStageCompact}
            onToggleMobileStageCompact={() => setMobileStageCompact((c) => !c)}
            isEditingCrop={isEditingCrop}
            cropAspectLock={cropAspectLock}
            onUpdateCrop={handleLiveCropUpdate}
            onCommitCrop={flushCoalescedHistory}
            isEditingMotion={
              activeTab === "motion" &&
              activeMotion.type !== "none" &&
              studioMode === "expert"
            }
            motionAnchor={{
              x: activeMotion.anchor_x ?? 0.5,
              y: activeMotion.anchor_y ?? 0.5,
            }}
            onUpdateMotionAnchor={(pt) =>
              updateMotion({ anchor_x: pt.x, anchor_y: pt.y }, true)
            }
            isEditingText={activeTab === "text"}
            activeTextOverlay={activeText}
            onUpdateTextPosition={(layerIdx, pos) => {
              if (layerIdx === -1) {
                updateText({ x_pct: pos.x_pct, y_pct: pos.y_pct }, true);
              } else {
                const extras = [...(activeText.extra_layers ?? [])];
                if (extras[layerIdx]) {
                  extras[layerIdx] = {
                    ...extras[layerIdx],
                    x_pct: pos.x_pct,
                    y_pct: pos.y_pct,
                  };
                  updateText({ extra_layers: extras }, true);
                }
              }
            }}
            showSafeGuides={showSafeGuides}
            seekToMsRequest={seekToMsRequest}
            onEmitPlayback={handleEmitPlayback}
            onActivePlayingChange={handleActivePlayingChange}
            onOpenGuide={(section) => setGuideModalSection(section)}
          />
        </main>

        {/* Tablet & Desktop (md+) Right Inspector */}
        <aside className="hidden md:flex md:flex-col h-full min-h-0 overflow-hidden w-[310px] lg:w-[336px] xl:w-[352px] shrink-0 border-l border-black/[0.07] dark:border-white/[0.07] bg-[#fbfaf8] dark:bg-[#0b0b0f]">
          {inspectorContent}
        </aside>

        {/* Mobile (< md) Bottom Sheet Switcher + Active Panel */}
        <div className="flex md:hidden min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfaf8] dark:bg-[#0b0b0f]">
          <div className="grid grid-cols-3 border-b border-black/[0.07] dark:border-white/[0.07] bg-[#efede8] dark:bg-[#0d0d13] p-1 gap-1">
            {(
              [
                { id: "media", label: `Media (${mediaBin.length})` },
                { id: "timeline", label: `Timeline (${frames.length})` },
                { id: "inspector", label: "Inspector" },
              ] as { id: MobilePane; label: string }[]
            ).map((pane) => (
              <button
                key={pane.id}
                type="button"
                onClick={() => setMobilePane(pane.id)}
                className={`rounded-lg py-1.5 text-xs font-medium transition ${
                  mobilePane === pane.id
                    ? "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 hover:bg-black/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                }`}
              >
                {pane.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-[#fbfaf8] dark:bg-[#0b0b0f]">
            {mobilePane === "media" && mediaBinContent}
            {mobilePane === "timeline" && timelineContent}
            {mobilePane === "inspector" && inspectorContent}
          </div>
        </div>
      </div>

      {/* Tablet & Desktop (md+) Collapsible Bottom Timeline */}
      <footer
        className={`hidden md:block shrink-0 border-black/[0.07] dark:border-white/[0.07] bg-[#fbfaf8]/95 dark:bg-[#0b0b0f]/95 transition-all duration-200 overflow-hidden ${
          timelineOpen
            ? timelineExpanded
              ? "h-60 xl:h-64 border-t"
              : "h-44 xl:h-48 border-t"
            : "h-0 border-t-0"
        }`}
      >
        <div className={timelineExpanded ? "h-60 xl:h-64" : "h-44 xl:h-48"}>
          {timelineContent}
        </div>
      </footer>

      {/* Video / Live Photo Extraction Modal */}
      {pendingVideo && (
        <VideoExtractModal
          video={pendingVideo}
          onClose={() => setPendingVideosQueue((prev) => prev.slice(1))}
          onExtracted={(extracted, options) => {
            commitProject((prev) => ({
              ...prev,
              frames: [...prev.frames, ...extracted],
              ...(options?.loopMode ? { loopMode: options.loopMode } : {}),
            }));
            if (extracted.length > 0) {
              setSelectedFrameUids([extracted[0].uid]);
              setSelectionAnchorUid(extracted[0].uid);
            }
            setPendingVideosQueue((prev) => prev.slice(1));
          }}
          onInstantExportGif={(extracted, options) => {
            const nextLoopMode = options?.loopMode ?? loopMode;
            const combined = [...frames, ...extracted];
            commitProject((prev) => ({
              ...prev,
              frames: [...prev.frames, ...extracted],
              ...(options?.loopMode ? { loopMode: options.loopMode } : {}),
            }));
            if (extracted.length > 0) {
              setSelectedFrameUids([extracted[0].uid]);
              setSelectionAnchorUid(extracted[0].uid);
            }
            setPendingVideosQueue((prev) => prev.slice(1));
            void runExportWith(combined, {
              loopMode: nextLoopMode,
              forceGif: true,
            });
          }}
        />
      )}

      {/* Export Result Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        isExporting={isExporting}
        error={exportError}
        result={exportResult}
        onClose={() => setIsExportModalOpen(false)}
      />

      {/* How to Use & Open Source (MIT) Modal */}
      <StudioGuideModal
        isOpen={guideModalSection !== null}
        initialSection={guideModalSection ?? "guide"}
        hideOnStartup={hideGuideOnStartup}
        onDontShowAgain={handleDontShowGuideAgain}
        onResetStartupPrompt={handleResetGuidePrompt}
        onClose={() => setGuideModalSection(null)}
        onLoadSamples={() => handleLoadSamples("stock")}
        onTriggerUpload={() => fileInputRef.current?.click()}
      />

      {/* Delete Confirmation Modal (Timeline & Media Bin) */}
      <ConfirmModal
        isOpen={pendingDelete !== null}
        title={
          pendingDelete?.kind === "clear_all"
            ? "Clear Timeline?"
            : pendingDelete?.kind === "batch"
            ? `Delete ${pendingDelete.uids.length} Frames?`
            : pendingDelete?.kind === "media_single"
            ? `Delete ${pendingDelete.isVideo ? "Video" : "Image"} from Media Bin?`
            : pendingDelete?.kind === "media_prune"
            ? `Prune ${pendingDelete.mediaIds.length} Unused Assets?`
            : "Remove Frame from Timeline?"
        }
        description={
          pendingDelete?.kind === "clear_all"
            ? `This will remove all ${pendingDelete.count} frames from your timeline. Your uploaded files will remain in the Media Bin (and you can still Undo with Cmd+Z).`
            : pendingDelete?.kind === "batch"
            ? `This will remove ${pendingDelete.uids.length} selected frames from the timeline. You can undo this anytime with Cmd+Z.`
            : pendingDelete?.kind === "media_single"
            ? pendingDelete.usedCount > 0
              ? `Permanently delete "${pendingDelete.filename}" from your Media Bin? This will also remove ${pendingDelete.usedCount} ${
                  pendingDelete.usedCount === 1 ? "frame" : "frames"
                } using it from the Timeline.`
              : pendingDelete.isVideo
              ? `Permanently delete "${pendingDelete.filename}" (plus any extracted video frames and stream cache) from your Media Bin?`
              : `Permanently delete "${pendingDelete.filename}" from your Media Bin? This removes the uploaded file from local storage.`
            : pendingDelete?.kind === "media_prune"
            ? `Permanently delete ${pendingDelete.mediaIds.length} unused ${
                pendingDelete.mediaIds.length === 1 ? "file" : "files"
              } not currently used on the Timeline from local storage?`
            : pendingDelete
            ? `Remove Frame #${pendingDelete.index + 1} (${pendingDelete.filename}) from the timeline? The original file stays in your Media Bin.`
            : ""
        }
        confirmLabel={
          pendingDelete?.kind === "clear_all"
            ? "Clear Timeline"
            : pendingDelete?.kind === "batch"
            ? `Delete ${pendingDelete.uids.length} Frames`
            : pendingDelete?.kind === "media_single"
            ? "Delete from Bin"
            : pendingDelete?.kind === "media_prune"
            ? `Delete ${pendingDelete.mediaIds.length} Unused`
            : "Remove Frame"
        }
        onConfirm={confirmPendingDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Desktop App Close Confirmation Modal */}
      <ConfirmModal
        isOpen={closeConfirmOpen}
        zIndexClass="z-[60]"
        tone={hasActiveBackgroundJob ? "danger" : "warning"}
        confirmOnEnter={false}
        title="Close GIF Studio?"
        description={
          hasActiveBackgroundJob
            ? "An upload, sample load, or render export is currently running. Closing GIF Studio now will cancel the active task."
            : frames.length > 0
            ? `Are you sure you want to close GIF Studio? Your ${frames.length} timeline ${
                frames.length === 1 ? "frame" : "frames"
              } and ${mediaBin.length} Media Bin ${
                mediaBin.length === 1 ? "item" : "items"
              } are saved locally for your next session.`
            : mediaBin.length > 0
            ? `Are you sure you want to close GIF Studio? Your ${mediaBin.length} Media Bin ${
                mediaBin.length === 1 ? "file" : "files"
              } will stay in local storage.`
            : "Are you sure you want to close GIF Studio and stop the local engine?"
        }
        cancelLabel={hasActiveBackgroundJob ? "Keep Working" : "Keep Editing"}
        confirmLabel={hasActiveBackgroundJob ? "Close Anyway" : "Close App"}
        onConfirm={handleConfirmCloseApp}
        onCancel={handleCancelCloseApp}
      />
      </div>
    </StudioIconProvider>
  );
}
