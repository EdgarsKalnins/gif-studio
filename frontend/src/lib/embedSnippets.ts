import type { ExportFormat, ExportResponse } from "@/types/studio";

export interface EmbedSnippets {
  html: string;
  css: string;
  react: string;
  tailwind: string;
  atlasJson?: string;
  note: string;
}

export const FORMAT_META: Record<
  ExportFormat,
  { short: string; label: string; group: "image" | "video" | "dev"; badge?: string }
> = {
  gif: { short: "GIF", label: "GIF", group: "image" },
  webp: { short: "WEBP", label: "WebP", group: "image", badge: "Alpha" },
  avif: { short: "AVIF", label: "AVIF", group: "image", badge: "Smallest" },
  apng: { short: "APNG", label: "APNG", group: "image", badge: "Lossless" },
  mp4: { short: "MP4", label: "MP4", group: "video", badge: "H.264" },
  webm: { short: "WEBM", label: "WebM", group: "video", badge: "VP9" },
  mov_alpha: { short: "MOV α", label: "MOV α", group: "video", badge: "Safari" },
  spritesheet: { short: "SPRITE", label: "Sprite", group: "dev", badge: "CSS/Atlas" },
  dotlottie: { short: "DOTLOTTIE", label: "dotLottie", group: "dev", badge: ".lottie" },
  lottie: { short: "LOTTIE", label: "Lottie", group: "dev", badge: "JSON" },
  svg: { short: "SVG", label: "SVG", group: "dev", badge: "Zero-JS" },
  bundle_zip: { short: "BUNDLE", label: "Web ZIP", group: "dev", badge: "Multi" },
};

function buildSpriteAtlasJson(result: ExportResponse): string {
  const cols = Math.max(1, result.sprite_cols ?? result.frame_count);
  const rows = Math.max(1, result.sprite_rows ?? 1);
  const fw = result.frame_width ?? Math.round(result.width / cols);
  const fh = result.frame_height ?? Math.round(result.height / rows);
  const pad = Math.max(0, result.sprite_padding ?? 0);
  const count = Math.max(1, result.frame_count);

  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } }> = {};
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const key = `frame_${String(i).padStart(3, "0")}.png`;
    frames[key] = {
      frame: { x: col * (fw + pad), y: row * (fh + pad), w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
    };
  }

  return JSON.stringify(
    {
      frames,
      meta: {
        app: "GIF Studio",
        image: result.filename,
        format: "RGBA8888",
        size: { w: result.width, h: result.height },
        scale: "1",
        frameDurationMs: result.avg_frame_ms ?? Math.round(result.total_duration_ms / count),
      },
    },
    null,
    2
  );
}

function buildSpriteKeyframesCss(result: ExportResponse): {
  css: string;
  frameW: number;
  frameH: number;
} {
  const cols = Math.max(1, result.sprite_cols ?? result.frame_count);
  const rows = Math.max(1, result.sprite_rows ?? 1);
  const frameW = result.frame_width ?? Math.round(result.width / cols);
  const frameH = result.frame_height ?? Math.round(result.height / rows);
  const pad = Math.max(0, result.sprite_padding ?? 0);
  const count = Math.max(1, result.frame_count);
  const durMs = Math.max(100, result.total_duration_ms);

  if (rows === 1 && pad === 0) {
    const endX = cols > 1 ? `-${cols * 100}%` : "0%";
    const css = `.sprite-anim {
  width: ${frameW}px;
  height: ${frameH}px;
  max-width: 100%;
  aspect-ratio: ${frameW} / ${frameH};
  background-image: url("./${result.filename}");
  background-repeat: no-repeat;
  background-size: ${cols * 100}% 100%;
  animation: sprite-play ${durMs}ms steps(${count}) infinite;
}

@keyframes sprite-play {
  from { background-position: 0% 0%; }
  to { background-position: ${endX} 0%; }
}`;
    return { css, frameW, frameH };
  }

  const maxX = Math.max(1, result.width - frameW);
  const maxY = Math.max(1, result.height - frameH);
  const stops: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const pct = ((i / count) * 100).toFixed(2);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = col * (frameW + pad);
    const py = row * (frameH + pad);
    const xPct = cols > 1 ? (px / maxX) * 100 : 0;
    const yPct = rows > 1 ? (py / maxY) * 100 : 0;
    stops.push(`  ${pct}% { background-position: ${xPct.toFixed(2)}% ${yPct.toFixed(2)}%; }`);
  }
  const css = `.sprite-anim {
  width: ${frameW}px;
  height: ${frameH}px;
  max-width: 100%;
  aspect-ratio: ${frameW} / ${frameH};
  background-image: url("./${result.filename}");
  background-repeat: no-repeat;
  background-size: ${((result.width / frameW) * 100).toFixed(2)}% ${((result.height / frameH) * 100).toFixed(2)}%;
  animation: sprite-play ${durMs}ms steps(1, end) infinite;
}

@keyframes sprite-play {
${stops.join("\n")}
}`;
  return { css, frameW, frameH };
}

export function buildEmbedSnippets(result: ExportResponse): EmbedSnippets {
  const w = result.frame_width ?? result.width;
  const h = result.frame_height ?? result.height;
  const stem = result.filename.replace(/(_sheet)?\.[^.]+$/, "");

  if (result.format === "webm" || result.format === "mov_alpha") {
    const isMov = result.format === "mov_alpha";
    return {
      note:
        "Dual-source transparent HTML5 video: Safari plays HEVC hvc1 (.mov), while Chrome, Edge & Firefox play WebM VP9.",
      html: `<video width="${w}" height="${h}" autoplay loop muted playsinline>
  <source src="./${isMov ? result.filename : `${stem}.mov`}" type='video/quicktime; codecs="hvc1"' />
  <source src="./${isMov ? `${stem}.webm` : result.filename}" type="video/webm" />
</video>`,
      css: `.motion-alpha-video {
  width: 100%;
  max-width: ${w}px;
  aspect-ratio: ${w} / ${h};
  object-fit: cover;
  display: block;
}`,
      react: `export function TransparentVideoLoop() {
  return (
    <video
      width={${w}}
      height={${h}}
      autoPlay
      loop
      muted
      playsInline
      className="w-full max-w-[${w}px] aspect-[${w}/${h}] object-cover"
    >
      <source src="/${isMov ? result.filename : `${stem}.mov`}" type='video/quicktime; codecs="hvc1"' />
      <source src="/${isMov ? `${stem}.webm` : result.filename}" type="video/webm" />
    </video>
  );
}`,
      tailwind: `<video
  autoPlay
  loop
  muted
  playsInline
  className="block w-full max-w-[${w}px] aspect-[${w}/${h}] rounded-xl object-cover"
>
  <source src="/${isMov ? result.filename : `${stem}.mov`}" type='video/quicktime; codecs="hvc1"' />
  <source src="/${isMov ? `${stem}.webm` : result.filename}" type="video/webm" />
</video>`,
    };
  }

  if (result.format === "mp4") {
    return {
      note: "Hardware-accelerated HTML5 <video> loop with progressive MP4 playback.",
      html: `<video width="${w}" height="${h}" autoplay loop muted playsinline>
  <source src="./${result.filename}" type="video/mp4" />
</video>`,
      css: `.motion-loop {
  width: 100%;
  max-width: ${w}px;
  aspect-ratio: ${w} / ${h};
  object-fit: cover;
  display: block;
}`,
      react: `export function MotionLoop() {
  return (
    <video
      width={${w}}
      height={${h}}
      autoPlay
      loop
      muted
      playsInline
      className="motion-loop"
    >
      <source src="/${result.filename}" type="video/mp4" />
    </video>
  );
}`,
      tailwind: `<video
  autoPlay
  loop
  muted
  playsInline
  className="block w-full max-w-[${w}px] aspect-[${w}/${h}] rounded-xl object-cover"
>
  <source src="/${result.filename}" type="video/mp4" />
</video>`,
    };
  }

  if (result.format === "spritesheet") {
    const { css, frameW, frameH } = buildSpriteKeyframesCss(result);
    const atlasJson = buildSpriteAtlasJson(result);
    const count = Math.max(1, result.frame_count);
    const durMs = Math.max(100, result.total_duration_ms);
    return {
      note: `Sprite atlas (${result.sprite_cols ?? count}×${result.sprite_rows ?? 1} cells, ${frameW}×${frameH}px) — ready for CSS steps() or PixiJS / Phaser.`,
      html: `<div
  class="sprite-anim"
  role="img"
  aria-label="Animated sprite sequence"
></div>`,
      css,
      react: `export function SpriteLoop() {
  return (
    <div
      className="sprite-anim"
      role="img"
      aria-label="Animated sprite sequence"
    />
  );
}`,
      tailwind: `/* tailwind.config.ts -> theme.extend.keyframes */\n// spritePlay: { from: { backgroundPosition: "0% 0%" }, to: { backgroundPosition: "-${(result.sprite_cols ?? count) * 100}% 0%" } }\n// animation: { sprite: "spritePlay ${durMs}ms steps(${count}) infinite" }\n\n<div\n  className="w-[${frameW}px] h-[${frameH}px] bg-no-repeat animate-[spritePlay_${durMs}ms_steps(${count})_infinite]"\n  style={{ backgroundImage: "url('/${result.filename}')", backgroundSize: "${((result.width / frameW) * 100).toFixed(0)}% ${((result.height / frameH) * 100).toFixed(0)}%" }}\n/>`,
      atlasJson,
    };
  }

  if (result.format === "dotlottie") {
    return {
      note: "Compressed dotLottie (.lottie) ZIP container compatible with @lottiefiles/dotlottie-react & <dotlottie-wc>.",
      html: `<script type="module" src="https://unpkg.com/@lottiefiles/dotlottie-wc/dist/dotlottie-wc.js"></script>
<dotlottie-wc
  src="./${result.filename}"
  autoplay
  loop
  style="width:${w}px;height:${h}px"
></dotlottie-wc>`,
      css: `.dotlottie-stage {
  width: 100%;
  max-width: ${w}px;
  aspect-ratio: ${w} / ${h};
}`,
      react: `import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export function DotLottieMotion() {
  return (
    <DotLottieReact
      src="/${result.filename}"
      loop
      autoplay
      className="dotlottie-stage"
    />
  );
}`,
      tailwind: `<DotLottieReact
  src="/${result.filename}"
  loop
  autoplay
  className="w-full max-w-[${w}px] aspect-[${w}/${h}]"
/>`,
    };
  }

  if (result.format === "lottie") {
    return {
      note: "Bodymovin v5.9.0 JSON with embedded frames for lottie-web or lottie-react.",
      html: `<div id="lottie-container" style="width:${w}px;height:${h}px"></div>
<script type="module">
  import lottie from "https://esm.sh/lottie-web";
  lottie.loadAnimation({
    container: document.getElementById("lottie-container"),
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "./${result.filename}",
  });
</script>`,
      css: `.lottie-stage {
  width: 100%;
  max-width: ${w}px;
  aspect-ratio: ${w} / ${h};
}`,
      react: `import Lottie from "lottie-react";
import animationData from "./${result.filename}";

export function LottieMotion() {
  return (
    <Lottie
      animationData={animationData}
      loop
      autoplay
      className="lottie-stage"
    />
  );
}`,
      tailwind: `<Lottie
  animationData={animationData}
  loop
  autoplay
  className="w-full max-w-[${w}px] aspect-[${w}/${h}]"
/>`,
    };
  }

  if (result.format === "svg") {
    return {
      note: "Self-contained animated SVG using native CSS steps() keyframes — zero JavaScript required.",
      html: `<img
  src="./${result.filename}"
  width="${w}"
  height="${h}"
  alt="Animated vector sequence"
  loading="eager"
/>`,
      css: `.animated-svg {
  width: 100%;
  max-width: ${w}px;
  height: auto;
  display: block;
}`,
      react: `export function AnimatedSvgAsset() {
  return (
    <img
      src="/${result.filename}"
      width={${w}}
      height={${h}}
      alt="Animated vector sequence"
      className="animated-svg"
    />
  );
}`,
      tailwind: `<img
  src="/${result.filename}"
  width={${w}}
  height={${h}}
  alt="Animated vector sequence"
  className="block w-full max-w-[${w}px] h-auto"
/>`,
    };
  }

  if (result.format === "bundle_zip") {
    const hasMov = (result.bundle_files ?? []).includes("animation.mov");
    const vidMarkup = hasMov
      ? `<video width="${w}" height="${h}" autoplay loop muted playsinline>
  <source src="./animation.mov" type='video/quicktime; codecs="hvc1"' />
  <source src="./animation.webm" type="video/webm" />
</video>`
      : `<video width="${w}" height="${h}" autoplay loop muted playsinline>
  <source src="./animation.webm" type="video/webm" />
  <source src="./animation.mp4" type="video/mp4" />
</video>`;
    return {
      note: `All-in-one Web Dev ZIP bundle (${(result.bundle_files ?? []).join(", ")}) for Safari, Chrome, and universal GIF/WebP fallbacks.`,
      html: `${vidMarkup}\n\n<picture>\n  <source srcset="./animation.webp" type="image/webp" />\n  <img src="./animation.gif" width="${w}" height="${h}" alt="Animated asset" loading="lazy" />\n</picture>`,
      css: `.gs-bundle-media {\n  display: block;\n  width: 100%;\n  max-width: ${w}px;\n  aspect-ratio: ${w} / ${h};\n  height: auto;\n}`,
      react: `export function BundledMotionAsset() {\n  return (\n    <video width={${w}} height={${h}} autoPlay loop muted playsInline className="w-full max-w-[${w}px] aspect-[${w}/${h}]">\n      ${hasMov ? `<source src="/animation.mov" type='video/quicktime; codecs="hvc1"' />\n      <source src="/animation.webm" type="video/webm" />` : `<source src="/animation.webm" type="video/webm" />\n      <source src="/animation.mp4" type="video/mp4" />`}\n    </video>\n  );\n}`,
      tailwind: `<video autoPlay loop muted playsInline className="block w-full max-w-[${w}px] aspect-[${w}/${h}] rounded-xl object-cover">\n  <source src="/${hasMov ? "animation.mov" : "animation.webm"}" type='${hasMov ? 'video/quicktime; codecs="hvc1"' : "video/webm"}' />\n</video>`,
    };
  }

  const mimeMap: Record<string, string> = {
    avif: "image/avif",
    webp: "image/webp",
    apng: "image/apng",
    gif: "image/gif",
  };
  const mime = mimeMap[result.format] ?? "image/png";
  const fallbackSnippet =
    result.format === "avif"
      ? `<picture>
  <source srcSet="./${result.filename}" type="image/avif" />
  <source srcSet="./${stem}.webp" type="image/webp" />
  <img src="./${stem}.gif" width="${w}" height="${h}" alt="Animated asset" />
</picture>`
      : `<picture>
  <source srcSet="./${result.filename}" type="${mime}" />
  <img src="./${result.filename}" width="${w}" height="${h}" alt="Animated asset" />
</picture>`;

  return {
    note:
      result.format === "avif"
        ? "Progressive <picture> stack serves ultra-compact AVIF first with automatic WebP/GIF fallback."
        : `Animated ${result.format.toUpperCase()} drops cleanly into standard <img> or <picture> tags.`,
    html: fallbackSnippet.replaceAll("srcSet", "srcset"),
    css: `.motion-asset {
  width: 100%;
  max-width: ${w}px;
  height: auto;
  display: block;
}`,
    react: `export function AnimatedAsset() {
  return (
    ${fallbackSnippet
      .replaceAll('src="./', 'src="/')
      .replaceAll('srcSet="./', 'srcSet="/')
      .replaceAll("\n", "\n    ")}
  );
}`,
    tailwind: `${fallbackSnippet
      .replaceAll('src="./', 'src="/')
      .replaceAll('srcSet="./', 'srcSet="/')
      .replace("<img ", '<img className="block w-full max-w-[' + w + 'px] h-auto" ')}`,
  };
}
