const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { collectUsage, readConfig } = require('./usage-reader');

let mainWindow;
let hoverTimer = null;
let lastHoverState = null;

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
  startHoverTracking();

  mainWindow.on('closed', () => {
    if (hoverTimer) clearInterval(hoverTimer);
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

ipcMain.handle('usage:get', () => collectUsage(readConfig()));
ipcMain.handle('window:close', () => app.quit());
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
