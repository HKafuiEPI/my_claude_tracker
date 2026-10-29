'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig, configDir, cacheFile, loadEntries, readLimits, snapshot, describe } = require('./usage');

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let tray;
let snap = null;
let quitting = false;
const cfg = loadConfig();

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 160,
    useContentSize: true,
    frame: false,
    resizable: false,
    show: false,
    transparent: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(workArea.x + workArea.width - 400 - 16, workArea.y + 16);
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  if (!cfg.startHidden || process.env.CLAUDE_TRACKER_SHOT) win.once('ready-to-show', () => win.show());
}

const toggle = () => (win.isVisible() ? win.hide() : win.show());

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 22, height: 22 }));
  tray.on('click', toggle);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Afficher / masquer', click: toggle },
      { label: 'Rafraîchir', click: () => refresh() },
      { label: 'Ouvrir la config', click: () => shell.openPath(path.join(configDir(), 'config.json')) },
      { type: 'separator' },
      { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

async function refresh() {
  try {
    snap = snapshot(await loadEntries(), loadConfig(), Date.now(), readLimits());
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(snap)); // read by the Claude Code hooks
    tray.setToolTip(describe(snap));
    win.webContents.send('usage', snap);
  } catch (e) {
    console.error('claude-tracker: refresh failed', e);
  }
}

ipcMain.on('refresh', refresh);
ipcMain.handle('toggle-pin', () => {
  win.setAlwaysOnTop(!win.isAlwaysOnTop());
  return win.isAlwaysOnTop();
});
ipcMain.on('hide', () => win.hide());
ipcMain.on('open-config', () => shell.openPath(path.join(configDir(), 'config.json')));

app.whenReady().then(async () => {
  createWindow();
  createTray();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await refresh();
  setInterval(refresh, Math.max(10, cfg.refreshSec) * 1000);
  if (process.env.CLAUDE_TRACKER_SHOT) {
    // Test hook: capture the rendered widget to a PNG and exit.
    setTimeout(async () => {
      fs.writeFileSync(process.env.CLAUDE_TRACKER_SHOT, (await win.webContents.capturePage()).toPNG());
      quitting = true;
      app.quit();
    }, 1500);
  }
});

// Stay alive in the tray when the window is closed.
app.on('window-all-closed', (e) => e.preventDefault());
app.on('second-instance', () => win && win.show());
