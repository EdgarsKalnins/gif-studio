import type {
  AspectRatioPreset,
  BorderConfig,
  ExportConfig,
  ExportResponse,
  FilterConfig,
  FitMode,
  FrameItem,
  LoopMode,
  MotionConfig,
  TextOverlayConfig,
  UploadedMediaItem,
} from "@/types/studio";

export const API_BASE =
  process.env.NEXT_PUBLIC_STATIC_EXPORT === "1"
    ? ""
    : process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

export function resolveMediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listMediaItems(): Promise<UploadedMediaItem[]> {
  const res = await fetch(`${API_BASE}/api/media`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to fetch media library");
  }
  return res.json();
}

export async function deleteMediaItem(mediaId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(err.detail || "Delete failed");
  }
}

export async function loadDemoSamples(
  pack: "stock" | "motion" | "video" = "stock"
): Promise<UploadedMediaItem[]> {
  const res = await fetch(
    `${API_BASE}/api/demo-samples?pack=${encodeURIComponent(pack)}`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to load samples" }));
    throw new Error(err.detail || "Failed to load samples");
  }
  return res.json();
}

export async function uploadMediaFiles(
  files: File[]
): Promise<UploadedMediaItem[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function extractVideoFrames(params: {
  media_id: string;
  start_sec: number;
  end_sec: number | null;
  fps: number;
  max_frames: number;
  speed?: number;
}): Promise<{
  frames: UploadedMediaItem[];
  default_frame_duration_ms: number;
  source_duration_sec?: number | null;
}> {
  const res = await fetch(`${API_BASE}/api/extract-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Extraction failed" }));
    throw new Error(err.detail || "Extraction failed");
  }
  return res.json();
}

export async function exportProject(params: {
  frames: FrameItem[];
  aspect_ratio: AspectRatioPreset;
  fit_mode: FitMode;
  bg_color: string;
  loop_mode: LoopMode;
  loop_count: number;
  speed_multiplier?: number;
  end_hold_ms?: number;
  crossfade_loop_ms?: number;
  global_motion: MotionConfig;
  global_filters: FilterConfig;
  global_text: TextOverlayConfig;
  border: BorderConfig;
  export: ExportConfig;
}): Promise<ExportResponse> {
  const payload = {
    frames: params.frames.map((f) => ({
      media_id: f.media.id,
      duration_ms: f.duration_ms,
      motion: f.motion,
      filters: f.filters,
      transition_in: f.transition_in,
      transition_ms: f.transition_ms,
      text_overlay: f.text_overlay,
      crop: f.crop,
      rotate: f.rotate,
      straighten: f.straighten ?? 0,
      flip_h: f.flip_h,
      flip_v: f.flip_v,
    })),
    aspect_ratio: params.aspect_ratio,
    fit_mode: params.fit_mode,
    bg_color: params.bg_color,
    loop_mode: params.loop_mode,
    loop_count: params.loop_count,
    speed_multiplier: params.speed_multiplier ?? 1.0,
    end_hold_ms: params.end_hold_ms ?? 0,
    crossfade_loop_ms: params.crossfade_loop_ms ?? 350,
    global_motion: params.global_motion,
    global_filters: params.global_filters,
    global_text: params.global_text,
    border: params.border,
    export: params.export,
  };

  const res = await fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(err.detail || "Export failed");
  }
  return res.json();
}
