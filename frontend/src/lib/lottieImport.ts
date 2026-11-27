"use client";

function hasEmbeddedRasterAssets(doc: Record<string, unknown>): boolean {
  const assets = doc.assets;
  if (!Array.isArray(assets)) return false;
  return assets.some(
    (a) =>
      a &&
      typeof a === "object" &&
      typeof (a as { p?: unknown }).p === "string" &&
      ((a as { p: string }).p.startsWith("data:image/") ||
        typeof (a as { u?: unknown }).u === "string")
  );
}

async function rasterizeVectorLottieFile(file: File): Promise<File[] | null> {
  let rawText = "";
  try {
    rawText = await file.text();
  } catch {
    return null;
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    !doc ||
    typeof doc !== "object" ||
    !Array.isArray(doc.layers) ||
    typeof doc.fr !== "number"
  ) {
    return null;
  }
  if (hasEmbeddedRasterAssets(doc)) {
    // Raster-backed Lottie JSON can be unpacked faster on the Python backend
    return null;
  }

  const lottieModule = await import("lottie-web");
  const lottie = lottieModule.default;

  const w = Math.min(720, Math.max(120, Math.round(Number(doc.w) || 512)));
  const h = Math.min(720, Math.max(120, Math.round(Number(doc.h) || 512)));
  const ip = Number(doc.ip) || 0;
  const op = Math.max(ip + 1, Number(doc.op) || ip + 30);
  const fr = Math.max(1, Number(doc.fr) || 30);
  const durationSec = Math.max(0.2, (op - ip) / fr);
  const targetSampleCount = Math.min(40, Math.max(6, Math.round(durationSec * 12)));

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${w}px;height:${h}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(host);

  try {
    const anim = lottie.loadAnimation({
      container: host,
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: doc,
      rendererSettings: {
        clearCanvas: true,
        preserveAspectRatio: "xMidYMid meet",
      },
    });

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      anim.addEventListener("DOMLoaded", done);
      window.setTimeout(done, 450);
    });

    const canvas = host.querySelector("canvas");
    if (!canvas) {
      anim.destroy();
      return null;
    }

    const stem = file.name.replace(/\.json$/i, "") || "lottie";
    const outFiles: File[] = [];
    for (let i = 0; i < targetSampleCount; i += 1) {
      const lottieFrame =
        ip + ((op - ip) * i) / Math.max(1, targetSampleCount - 1);
      anim.goToAndStop(lottieFrame, true);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (blob) {
        outFiles.push(
          new File([blob], `${stem}_v${String(i + 1).padStart(3, "0")}.png`, {
            type: "image/png",
          })
        );
      }
    }

    anim.destroy();
    return outFiles.length > 0 ? outFiles : null;
  } finally {
    host.remove();
  }
}

export async function prepareUploadFiles(files: File[]): Promise<File[]> {
  const prepared: File[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".json")) {
      const rasterized = await rasterizeVectorLottieFile(file);
      if (rasterized && rasterized.length > 0) {
        prepared.push(...rasterized);
        continue;
      }
    }
    prepared.push(file);
  }
  return prepared;
}
