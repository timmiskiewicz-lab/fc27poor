const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

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
      const body = await fs.readFile(file);
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
}

app.whenReady().then(() => {
  if (!devUrl) serveDist();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
