const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { API, PAGE_PREFIX, isNewer, pickAsset } = require("./update.cjs");

const TITLE = "FC 27 Poor Edition";
const SCHEME = "fc27";
const DIST = path.join(__dirname, "..", "client", "dist");
const devUrl = process.env.FC27_URL || (process.argv.includes("--dev") ? "http://localhost:5173" : "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

// A privileged standard scheme behaves like https: fetch() works for the models and WebRTC sees a secure context.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

app.setName(TITLE);
if (process.platform === "win32") app.setAppUserModelId("pl.tymek.fc27pe");

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response("forbidden", { status: 403 });
    try {
      const body = await fsp.readFile(file);
      return new Response(body, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: TITLE,
    icon: path.join(DIST, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#071422",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  win.loadURL(devUrl || `${SCHEME}://game/index.html`);
  return win;
}

let updateOffer = null;
let updateBusy = false;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    request.setHeader("User-Agent", "FC27PoorEdition");
    request.setHeader("Accept", "application/vnd.github+json");
    request.on("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) {
          reject(new Error(`status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    request.setHeader("User-Agent", "FC27PoorEdition");
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        response.on("data", () => {});
        reject(new Error(`status ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(dest);
      const fail = (error) => {
        file.destroy();
        fs.rm(dest, { force: true }, () => reject(error));
      };
      response.on("data", (chunk) => {
        received += chunk.length;
        if (!file.write(chunk)) response.pause();
        onProgress(received, total);
      });
      file.on("drain", () => response.resume());
      response.on("end", () => file.end(() => resolve(dest)));
      response.on("error", fail);
      file.on("error", fail);
    });
    request.on("error", reject);
    request.end();
  });
}

function launchInstaller(exe) {
  const quoted = exe.replace(/'/g, "''");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Start-Sleep -Seconds 2; Start-Process -LiteralPath '${quoted}'`],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}

async function checkForUpdate(win) {
  try {
    const release = await fetchJson(API);
    const asset = pickAsset(release);
    if (!asset || !isNewer(asset.version, app.getVersion())) return;
    updateOffer = { current: app.getVersion(), version: asset.version, notes: asset.notes, page: asset.page, url: asset.url, name: asset.name };
    if (!win.isDestroyed()) win.webContents.send("update-available", publicOffer());
  } catch (error) {
    console.error("update check failed", error);
  }
}

function publicOffer() {
  if (!updateOffer) return null;
  return { current: updateOffer.current, version: updateOffer.version, notes: updateOffer.notes, page: updateOffer.page };
}

function attachUpdate(win) {
  win.webContents.on("did-finish-load", () => {
    void checkForUpdate(win);
  });
}

ipcMain.handle("update-ready", () => publicOffer());

ipcMain.handle("update-open", (_event, page) => {
  if (typeof page === "string" && page.startsWith(PAGE_PREFIX)) void shell.openExternal(page);
});

ipcMain.handle("update-install", async (event) => {
  if (!updateOffer) return { ok: false, error: "Nie ma nowszej wersji." };
  if (updateBusy) return { ok: false, error: "Pobieranie już trwa." };
  updateBusy = true;
  const dest = path.join(app.getPath("temp"), updateOffer.name);
  try {
    await downloadFile(updateOffer.url, dest, (received, total) => {
      if (!event.sender.isDestroyed()) event.sender.send("update-progress", { received, total });
    });
    launchInstaller(dest);
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (error) {
    updateBusy = false;
    console.error("update download failed", error);
    return { ok: false, error: "Nie udało się pobrać instalatora. Możesz otworzyć stronę wydania." };
  }
});

app.whenReady().then(() => {
  if (!devUrl) serveDist();
  const win = createWindow();
  attachUpdate(win);
});

app.on("window-all-closed", () => {
  app.quit();
});
