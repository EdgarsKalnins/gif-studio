const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gifStudioDesktop", {
  platform: process.platform,
  arch: process.arch,
  isDesktopApp: true,
  setCloseConfirmReady: (ready) =>
    ipcRenderer.send("studio:close-confirm-ready", Boolean(ready)),
  onCloseRequest: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("studio:request-close-confirm", listener);
    return () => ipcRenderer.removeListener("studio:request-close-confirm", listener);
  },
  ackCloseRequest: () => ipcRenderer.send("studio:close-confirm-ack"),
  requestClose: () => ipcRenderer.send("studio:request-app-close"),
  respondCloseRequest: (confirmed) =>
    ipcRenderer.send("studio:close-confirm-response", Boolean(confirmed)),
});
