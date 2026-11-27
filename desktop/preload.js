const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("gifStudioDesktop", {
  platform: process.platform,
  arch: process.arch,
  isDesktopApp: true,
});
