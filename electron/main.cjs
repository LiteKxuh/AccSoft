// HotelOps · Electron main process
// =================================================================
// Loads the Vite-built dist in production, the dev server in development.
// Wires up electron-updater so installed apps pull future releases from
// the LiteKxuh/AccSoft GitHub repo automatically.
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#1c1917",
    title: "HotelOps",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Electron treats every file:// path as its own opaque origin under
      // default webSecurity. The packaged renderer is fully bundled local
      // code (no remote script loads), so disabling same-origin enforcement
      // here is safe and unblocks asset/module loading from the asar.
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  // Hide the default menu bar (Alt still toggles); replace with a minimal app menu.
  Menu.setApplicationMenu(buildAppMenu());

  // Load Vite dev server in dev, file:// dist in prod.
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173").catch((err) => {
      console.error("Failed to load dev URL:", err);
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html")).catch((err) => {
      console.error("Failed to load production bundle:", err);
    });
  }

  // Surface renderer load failures (script 404s, syntax errors at parse time)
  // so a blank screen never goes unexplained.
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} → ${url}`);
    dialog.showErrorBox("Renderer failed to load", `${code} ${desc}\n\n${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[render-process-gone]", details);
    dialog.showErrorBox("Renderer crashed", JSON.stringify(details, null, 2));
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in the user's default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => triggerManualUpdateCheck(),
        },
        {
          label: "About HotelOps",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About HotelOps",
              message: `HotelOps v${app.getVersion()}`,
              detail: "Premium hotel accounting, daily flash, payroll & operations.\n\nAuto-updates from LiteKxuh/AccSoft.",
              buttons: ["OK"],
            });
          },
        },
        {
          label: "View Release Notes",
          click: () => shell.openExternal("https://github.com/LiteKxuh/AccSoft/releases"),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// =================================================================
// Auto-updater wiring
// =================================================================
function configureAutoUpdater() {
  // Don't auto-update in dev — would just spam errors.
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendToRenderer("update:status", { state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    sendToRenderer("update:status", { state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    sendToRenderer("update:status", { state: "current" });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update:status", {
      state: "downloading",
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("update:status", { state: "ready", version: info.version });
    // Prompt the user to restart now or wait until quit.
    dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `HotelOps ${info.version} is ready.`,
      detail: "Restart now to apply the update.",
    }).then((res) => {
      if (res.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on("error", (err) => {
    console.error("[auto-update]", err);
    sendToRenderer("update:status", { state: "error", message: err?.message || String(err) });
  });

  // Initial check on launch + every 30 minutes.
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5_000);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 30 * 60_000);
}

function triggerManualUpdateCheck() {
  if (isDev) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Updates disabled in dev",
      message: "Auto-updates only run in packaged builds.",
    });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    dialog.showErrorBox("Update check failed", err?.message || String(err));
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// =================================================================
// IPC handlers callable from the renderer via window.hotelops.*
// =================================================================
ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("update:check", () => {
  if (isDev) return { ok: false, dev: true };
  return autoUpdater.checkForUpdates().then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e?.message }));
});
ipcMain.handle("update:install-now", () => {
  autoUpdater.quitAndInstall();
});

// =================================================================
// Lifecycle
// =================================================================
app.whenReady().then(() => {
  createMainWindow();
  configureAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
