#!/usr/bin/env node
/**
 * Unified GIF Studio standalone desktop builder for macOS, Windows, and Linux.
 *
 * Usage:
 *   node scripts/build-desktop.mjs --target current
 *   node scripts/build-desktop.mjs --target current --dir
 *   node scripts/build-desktop.mjs --target mac|win|linux|all --ci
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const DESKTOP_DIR = path.join(ROOT, "desktop");
const STAGED_DIR = path.join(DESKTOP_DIR, "staged");

function parseArgs(argv) {
  const opts = {
    target: "current",
    ci: false,
    dirOnly: false,
    skipTests: false,
    skipInstall: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--target" && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (a.startsWith("--target=")) {
      opts.target = a.split("=")[1];
    } else if (a === "--ci") {
      opts.ci = true;
    } else if (a === "--dir") {
      opts.dirOnly = true;
    } else if (a === "--skip-tests") {
      opts.skipTests = true;
    } else if (a === "--skip-install") {
      opts.skipInstall = true;
    } else if (a === "-h" || a === "--help") {
      console.log(`GIF Studio Desktop Builder

Options:
  --target <current|mac|win|linux|all>  Target platform (default: current)
  --dir                                 Build unpacked .app/folder only (fast local check)
  --ci                                  Dispatch GitHub Actions cross-OS workflow via gh CLI
  --skip-tests                          Skip backend pytest & frontend lint checks
  --skip-install                        Skip pip/npm dependency install steps
`);
      process.exit(0);
    }
  }
  return opts;
}

function run(cmd, args, cwd, extraEnv = {}) {
  console.log(`\n> [${path.basename(cwd)}] ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}

function hostTargetName() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "linux";
}

function resolveVenvPython() {
  const isWin = process.platform === "win32";
  const venvPy = path.join(
    BACKEND_DIR,
    ".venv",
    isWin ? "Scripts" : "bin",
    isWin ? "python.exe" : "python"
  );
  if (fs.existsSync(venvPy)) return venvPy;
  return isWin ? "python" : "python3";
}

function ensureDesktopDependencies(opts, pyBin) {
  if (!opts.skipInstall) {
    const hasPyInstaller = spawnSync(pyBin, ["-m", "PyInstaller", "--version"], {
      cwd: BACKEND_DIR,
      stdio: "ignore",
    });
    if (hasPyInstaller.status !== 0) {
      const hasPip = spawnSync(pyBin, ["-m", "pip", "--version"], {
        cwd: BACKEND_DIR,
        stdio: "ignore",
      });
      if (hasPip.status === 0) {
        run(pyBin, ["-m", "pip", "install", "pyinstaller>=6.10.0"], BACKEND_DIR);
      } else {
        const hasUv = spawnSync("uv", ["--version"], { stdio: "ignore" });
        if (hasUv.status === 0) {
          run("uv", ["pip", "install", "--python", pyBin, "pyinstaller>=6.10.0"], BACKEND_DIR);
        } else {
          run(pyBin, ["-m", "ensurepip", "--upgrade"], BACKEND_DIR);
          run(pyBin, ["-m", "pip", "install", "pyinstaller>=6.10.0"], BACKEND_DIR);
        }
      }
    }
    if (!fs.existsSync(path.join(DESKTOP_DIR, "node_modules"))) {
      run("npm", ["install"], DESKTOP_DIR);
    }
    if (!fs.existsSync(path.join(FRONTEND_DIR, "node_modules"))) {
      run("npm", ["install"], FRONTEND_DIR);
    }
  }
}

function triggerCiBuild(target) {
  const workflow = "build-desktop.yml";
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    throw new Error("GitHub CLI (gh) is required for --ci cross-OS builds.");
  }
  run("gh", ["workflow", "run", workflow, "-f", `target=${target}`], ROOT);
  console.log(
    `\nDispatched GitHub Actions workflow "${workflow}" for target="${target}". Watch status with: gh run watch`
  );
}

function copyDirClean(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const host = hostTargetName();
  const target = opts.target === "current" ? host : opts.target;

  if (!["mac", "win", "linux", "all"].includes(target)) {
    throw new Error(`Unsupported --target "${opts.target}". Use current, mac, win, linux, or all.`);
  }

  if (opts.ci) {
    triggerCiBuild(target);
    return;
  }

  if (target !== host) {
    console.error(
      `\nPyInstaller and native FFmpeg binaries cannot cross-compile "${target}" directly from "${host}".\n` +
        `Run on a "${target}" host OR trigger the cross-OS GitHub Actions matrix:\n` +
        `  node scripts/build-desktop.mjs --target ${target} --ci\n`
    );
    process.exit(2);
  }

  const pyBin = resolveVenvPython();
  ensureDesktopDependencies(opts, pyBin);

  if (!opts.skipTests) {
    run(pyBin, ["-m", "pytest", "-v"], BACKEND_DIR);
    run("npm", ["run", "lint"], FRONTEND_DIR);
  }

  // 1. Icons
  run(pyBin, [path.join(ROOT, "scripts", "generate_desktop_icons.py")], ROOT);

  // 2. Freeze Python FastAPI backend with PyInstaller (--onedir for instant startup)
  const sep = process.platform === "win32" ? ";" : ":";
  const pyWork = path.join(BACKEND_DIR, "build", "pyinstaller-work");
  const pyDist = path.join(BACKEND_DIR, "build", "pyinstaller-dist");
  fs.rmSync(pyWork, { recursive: true, force: true });
  fs.rmSync(pyDist, { recursive: true, force: true });

  run(
    pyBin,
    [
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--clean",
      "--onedir",
      "--name",
      "gif-studio-engine",
      "--workpath",
      pyWork,
      "--distpath",
      pyDist,
      "--specpath",
      path.join(BACKEND_DIR, "build"),
      "--add-data",
      `${path.join(BACKEND_DIR, "samples")}${sep}samples`,
      "--collect-all",
      "pillow_heif",
      "--collect-all",
      "uvicorn",
      "--hidden-import",
      "app.main",
      path.join(BACKEND_DIR, "desktop_entry.py"),
    ],
    BACKEND_DIR
  );

  // 3. Static Next.js export
  run("npm", ["run", "build"], FRONTEND_DIR, {
    NEXT_PUBLIC_STATIC_EXPORT: "1",
    NEXT_PUBLIC_API_URL: "",
  });

  // 4. Assemble desktop/staged payload
  fs.rmSync(STAGED_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGED_DIR, { recursive: true });

  copyDirClean(
    path.join(pyDist, "gif-studio-engine"),
    path.join(STAGED_DIR, "backend")
  );
  copyDirClean(
    path.join(FRONTEND_DIR, "out"),
    path.join(STAGED_DIR, "frontend")
  );
  copyDirClean(
    path.join(BACKEND_DIR, "samples"),
    path.join(STAGED_DIR, "samples")
  );

  // 5. Stage static ffmpeg & ffprobe binaries for target OS
  const desktopRequire = createRequire(path.join(DESKTOP_DIR, "package.json"));
  const ffmpegStaticPath = desktopRequire("ffmpeg-static");
  const ffprobeStatic = desktopRequire("ffprobe-static");
  const ffprobeStaticPath = ffprobeStatic?.path || ffprobeStatic;

  const stagedBinDir = path.join(STAGED_DIR, "bin");
  fs.mkdirSync(stagedBinDir, { recursive: true });

  const isWin = process.platform === "win32";
  const ffmpegDest = path.join(stagedBinDir, isWin ? "ffmpeg.exe" : "ffmpeg");
  const ffprobeDest = path.join(stagedBinDir, isWin ? "ffprobe.exe" : "ffprobe");

  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    throw new Error("ffmpeg-static binary missing inside desktop/node_modules");
  }
  if (!ffprobeStaticPath || !fs.existsSync(ffprobeStaticPath)) {
    throw new Error("ffprobe-static binary missing inside desktop/node_modules");
  }

  fs.copyFileSync(ffmpegStaticPath, ffmpegDest);
  fs.copyFileSync(ffprobeStaticPath, ffprobeDest);
  if (!isWin) {
    fs.chmodSync(ffmpegDest, 0o755);
    fs.chmodSync(ffprobeDest, 0o755);
  }

  // 6. Run electron-builder
  const distDir = path.join(DESKTOP_DIR, "dist");
  fs.rmSync(distDir, { recursive: true, force: true });

  if (opts.dirOnly) {
    run("npx", ["electron-builder", "--dir", "--publish", "never"], DESKTOP_DIR);
  } else if (target === "mac") {
    const archFlag = process.arch === "arm64" ? "--arm64" : "--x64";
    run("npx", ["electron-builder", "--mac", archFlag, "--publish", "never"], DESKTOP_DIR);
  } else if (target === "win") {
    run("npx", ["electron-builder", "--win", "--x64", "--publish", "never"], DESKTOP_DIR);
  } else {
    run("npx", ["electron-builder", "--linux", "--publish", "never"], DESKTOP_DIR);
  }

  console.log(`\nStandalone GIF Studio desktop artifacts built in: ${distDir}`);
  for (const entry of fs.readdirSync(distDir)) {
    console.log(`  - ${entry}`);
  }
}

main();
