const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { collectUsage, readConfig } = require('./usage-reader');

let mainWindow;
let hoverTimer = null;
let lastHoverState = null;
let reloadWatchers = [];
let reloadTimer = null;

function createWindow() {
  const config = readConfig();
  const display = screen.getPrimaryDisplay().workArea;
  const width = Number(config.window.width || 520);
  const height = Number(config.window.height || 560);
  const x = config.window.x == null ? display.x + display.width - width - 28 : Number(config.window.x);
  const y = config.window.y == null ? display.y + 72 : Number(config.window.y);

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    movable: true,
    minWidth: Number(config.window.minWidth || 420),
    minHeight: Number(config.window.minHeight || 520),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  installReloadShortcuts(mainWindow);
  startDevReloadWatcher();
  startHoverTracking();

  mainWindow.on('closed', () => {
    if (hoverTimer) clearInterval(hoverTimer);
    stopDevReloadWatcher();
    hoverTimer = null;
    lastHoverState = null;
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

function startHoverTracking() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const inside = (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
    if (inside === lastHoverState) return;
    lastHoverState = inside;
    mainWindow.webContents.send('window:hover-state', inside);
  }, 120);
}

function reloadWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.reloadIgnoringCache();
  return true;
}

function installReloadShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const isModifierReload = (input.meta || input.control) && key === 'r';
    const isFunctionReload = key === 'f5';
    if (!isModifierReload && !isFunctionReload) return;
    event.preventDefault();
    reloadWindow();
  });
}

function startDevReloadWatcher() {
  if (process.env.CODEX_USAGE_PET_WATCH !== '1') return;
  stopDevReloadWatcher();
  const watchTargets = [
    path.join(__dirname, 'renderer.html'),
    path.join(__dirname, 'renderer.js'),
    path.join(__dirname, 'styles.css'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '..', 'assets', 'rift-hud', 'frame.png')
  ];

  for (const target of watchTargets) {
    if (!fs.existsSync(target)) continue;
    const watcher = fs.watch(target, { persistent: false }, () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reloadWindow, 120);
    });
    reloadWatchers.push(watcher);
  }
}

function stopDevReloadWatcher() {
  for (const watcher of reloadWatchers) watcher.close();
  reloadWatchers = [];
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
}

ipcMain.handle('usage:get', () => collectUsage(readConfig()));
ipcMain.handle('window:close', () => app.quit());
ipcMain.handle('window:reload', () => reloadWindow());
ipcMain.handle('window:toggle-top', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, 'floating');
  return next;
});

ipcMain.handle('window:move-by', (_event, delta) => {
  if (!mainWindow) return null;
  const bounds = mainWindow.getBounds();
  const x = Math.round(bounds.x + Number(delta?.x || 0));
  const y = Math.round(bounds.y + Number(delta?.y || 0));
  mainWindow.setBounds({ ...bounds, x, y });
  return { x, y };
});

ipcMain.handle('window:resize-by', (_event, delta) => {
  if (!mainWindow) return null;
  const bounds = mainWindow.getBounds();
  const min = mainWindow.getMinimumSize();
  const dx = Number(delta?.x || 0);
  const dy = Number(delta?.y || 0);
  const aspect = bounds.width / Math.max(1, bounds.height);
  const dominantDelta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  const widthDelta = Math.abs(dx) >= Math.abs(dy) ? dominantDelta : dominantDelta * aspect;
  const heightDelta = Math.abs(dx) >= Math.abs(dy) ? dominantDelta / aspect : dominantDelta;
  const width = Math.max(min[0], Math.round(bounds.width + widthDelta));
  const height = Math.max(min[1], Math.round(bounds.height + heightDelta));
  mainWindow.setBounds({ ...bounds, width, height });
  return { width, height };
});

ipcMain.handle('window:resize-to', (_event, size) => {
  if (!mainWindow) return null;
  const bounds = mainWindow.getBounds();
  const config = readConfig();
  const width = Math.max(320, Math.round(Number(size?.width || bounds.width)));
  const height = Math.max(160, Math.round(Number(size?.height || bounds.height)));
  const minWidth = Math.max(240, Math.round(Number(size?.minWidth || config.window.minWidth || 320)));
  const minHeight = Math.max(140, Math.round(Number(size?.minHeight || config.window.minHeight || 160)));
  mainWindow.setMinimumSize(Math.min(minWidth, width), Math.min(minHeight, height));
  mainWindow.setBounds({ ...bounds, width, height });
  return { width, height };
});
