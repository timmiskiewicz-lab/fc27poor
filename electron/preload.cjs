const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fc27", {
  ready() {
    return ipcRenderer.invoke("update-ready");
  },
  onUpdate(callback) {
    ipcRenderer.on("update-available", (_event, info) => callback(info));
  },
  onProgress(callback) {
    ipcRenderer.on("update-progress", (_event, progress) => callback(progress));
  },
  installUpdate() {
    return ipcRenderer.invoke("update-install");
  },
  openUpdate(page) {
    return ipcRenderer.invoke("update-open", page);
  },
});
