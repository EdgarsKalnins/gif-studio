const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const isSmokeTest =
  process.argv.includes("--smoke-test") ||
  process.env.GIF_STUDIO_SMOKE_TEST === "1";

if (!isSmokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let backendProc = null;
let activePort = null;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 8001;
      server.close(() => resolve(port));
    });
  });
}

function getResourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "staged");
}

function resolveBinaryPaths() {
  const root = getResourcesRoot();
  const isWin = process.platform === "win32";
  const backendExe = path.join(
    root,
    "backend",
    isWin ? "gif-studio-engine.exe" : "gif-studio-engine"
  );
  const staticDir = path.join(root, "frontend");
  const samplesDir = path.join(root, "samples");
  const ffmpegBin = path.join(root, "bin", isWin ? "ffmpeg.exe" : "ffmpeg");
  const ffprobeBin = path.join(root, "bin", isWin ? "ffprobe.exe" : "ffprobe");
  return {
    root,
    backendExe,
    staticDir,
    samplesDir,
    ffmpegBin,
    ffprobeBin,
  };
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ ok: true, raw: body });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(1500, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function waitForBackend(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    if (backendProc && backendProc.exitCode !== null) {
      throw new Error(`Engine exited unexpectedly (code ${backendProc.exitCode})`);
    }
    try {
      await httpGetJson(healthUrl);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error("Timed out waiting for local GIF Studio engine");
}

function stopBackend() {
  if (!backendProc || backendProc.killed) return;
  const pid = backendProc.pid;
  try {
    if (process.platform === "win32" && pid) {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } else {
      backendProc.kill("SIGTERM");
    }
  } catch {
    try {
      backendProc.kill("SIGKILL");
    } catch {
      // ignore already exited
    }
  }
  backendProc = null;
}

async function startBackend() {
  const port = await findFreePort();
  activePort = port;
  const paths = resolveBinaryPaths();
  const storageDir = path.join(app.getPath("userData"), "storage");
  fs.mkdirSync(storageDir, { recursive: true });

  const env = {
    ...process.env,
    GIF_MAKER_STORAGE: storageDir,
    GIF_STUDIO_STATIC_DIR: fs.existsSync(paths.staticDir) ? paths.staticDir : "",
    GIF_STUDIO_SAMPLES_DIR: fs.existsSync(paths.samplesDir) ? paths.samplesDir : "",
    GIF_MAKER_FFMPEG: fs.existsSync(paths.ffmpegBin) ? paths.ffmpegBin : "",
    GIF_MAKER_FFPROBE: fs.existsSync(paths.ffprobeBin) ? paths.ffprobeBin : "",
  };

  if (fs.existsSync(paths.backendExe)) {
    backendProc = spawn(
      paths.backendExe,
      ["--host", "127.0.0.1", "--port", String(port), "--storage", storageDir],
      { env, stdio: isSmokeTest ? "inherit" : "pipe" }
    );
  } else {
    // Dev fallback running directly from source workspace
    const repoRoot = path.resolve(__dirname, "..");
    const venvPy = path.join(
      repoRoot,
      "backend",
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python"
    );
    const entryPy = path.join(repoRoot, "backend", "desktop_entry.py");
    backendProc = spawn(
      venvPy,
      [entryPy, "--host", "127.0.0.1", "--port", String(port), "--storage", storageDir],
      { cwd: path.join(repoRoot, "backend"), env, stdio: "inherit" }
    );
  }

  let stderrTail = "";
  if (backendProc.stderr) {
    backendProc.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
  }

  try {
    await waitForBackend(port, 30000);
    return port;
  } catch (err) {
    throw new Error(`${err.message}\n${stderrTail}`);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "GIF Studio",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://") ||
      (url.startsWith("http://") && !url.startsWith(`http://127.0.0.1:${activePort}`))
    ) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.loadFile(path.join(__dirname, "splash.html"));
  mainWindow = win;
  return win;
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});

app.whenReady().then(async () => {
  try {
    if (isSmokeTest) {
      const port = await startBackend();
      const health = await httpGetJson(`http://127.0.0.1:${port}/api/health`);
      console.log(JSON.stringify({ smokeTest: "passed", port, health }));
      stopBackend();
      app.exit(0);
      return;
    }

    const win = createWindow();
    const port = await startBackend();
    if (!win.isDestroyed()) {
      await win.loadURL(`http://127.0.0.1:${port}/`);
    }
  } catch (err) {
    console.error("Failed to launch GIF Studio:", err);
    if (!isSmokeTest) {
      dialog.showErrorBox(
        "GIF Studio Failed to Start",
        err instanceof Error ? err.message : String(err)
      );
    }
    stopBackend();
    app.exit(1);
  }
});
