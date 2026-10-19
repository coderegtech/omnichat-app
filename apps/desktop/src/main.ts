import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { rendererUrl, isTrustedFrame, savePayload, notificationPayload, externalUrl, contentSecurityPolicy } from './security';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastNotification = 0;
const address = rendererUrl(process.env.OMNICHAT_DESKTOP_URL, app.isPackaged);
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function trusted(event: IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedFrame(event.senderFrame.url, address.origin)) throw new Error('Untrusted IPC sender');
}

async function createWindow() {
  let state: { width: number; height: number; x?: number; y?: number; maximized?: boolean } = { width: 1240, height: 820 };
  try {
    const data = JSON.parse(await readFile(stateFile(), 'utf8'));
    if (Number.isFinite(data.width) && Number.isFinite(data.height)) {
      state.width = Math.max(760, Math.min(3840, data.width));
      state.height = Math.max(540, Math.min(2160, data.height));
      state.maximized = data.maximized === true;
      if (Number.isFinite(data.x) && Number.isFinite(data.y) && screen.getAllDisplays().some(d => data.x >= d.workArea.x && data.x < d.workArea.x + d.workArea.width - 80 && data.y >= d.workArea.y && data.y < d.workArea.y + d.workArea.height - 80)) { state.x = data.x; state.y = data.y; }
    }
  } catch { /* First launch or invalid state: use visible defaults. */ }
  const win = new BrowserWindow({ ...state, minWidth: 760, minHeight: 540, backgroundColor: '#101214', title: 'OmniChat', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, partition: 'persist:omnichat' } });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!isTrustedFrame(url, address.origin)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!isTrustedFrame(url, address.origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('close', event => {
    const bounds = win.getNormalBounds();
    void writeFile(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }), { mode: 0o600 }).catch(() => undefined);
    if (!quitting && tray) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { mainWindow = null; });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      win.show();
      void dialog.showMessageBox(win, { type: 'error', title: 'OmniChat connection', message: 'The OmniChat web service could not be reached.', detail: `${description}\n${url}\nStart the web service or check OMNICHAT_DESKTOP_URL.`, buttons: ['Retry', 'Close'] }).then(result => result.response === 0 ? win.loadURL(address.href) : win.close());
    }
  });
  await win.loadURL(address.href).catch(() => undefined);
}

function showWindow() { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }
function newChat() { showWindow(); mainWindow?.webContents.send('omnichat:new-chat'); }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', () => { if (mainWindow) showWindow(); else void createWindow(); });
  app.on('window-all-closed', () => { if (!tray && process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });

  app.whenReady().then(async () => {
    app.setAppUserModelId('app.omnichat.desktop');
    await mkdir(app.getPath('userData'), { recursive: true });
    const browserSession = session.fromPartition('persist:omnichat');
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', (event, item, contents) => {
      // Browser file inputs and drag/drop need no Node bridge. Downloads are saved only
      // after a native user-selected path, and redirects cannot leave the app origin.
      const urlAllowed = (value: string) => isTrustedFrame(value.replace(/^blob:/, ''), address.origin);
      if (!mainWindow || contents !== mainWindow.webContents || !urlAllowed(contents.getURL()) || !item.getURLChain().every(urlAllowed)) { event.preventDefault(); return; }
      item.pause();
      const safeName = item.getFilename().replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').slice(0, 180) || 'download';
      void dialog.showSaveDialog(mainWindow, { title: 'Save file', defaultPath: safeName }).then(result => {
        if (result.canceled || !result.filePath) item.cancel();
        else { item.setSavePath(result.filePath); item.resume(); }
      }).catch(() => item.cancel());
    });
    browserSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy(address.origin, !app.isPackaged)] } }));

    ipcMain.handle('omnichat:save-text', async (event, input: unknown) => {
      trusted(event); const value = savePayload(input);
      const result = await dialog.showSaveDialog(mainWindow!, { title: 'Export conversation', defaultPath: `${value.name}.${value.format === 'json' ? 'json' : 'md'}`, filters: [{ name: value.format === 'json' ? 'JSON' : 'Markdown', extensions: [value.format === 'json' ? 'json' : 'md'] }] });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, value.content, { encoding: 'utf8', mode: 0o600 });
      return true;
    });
    ipcMain.handle('omnichat:notify', (event, input: unknown) => {
      trusted(event); const value = notificationPayload(input);
      if (!Notification.isSupported() || Date.now() - lastNotification < 3000) return false;
      lastNotification = Date.now();
      const notice = new Notification(value); notice.on('click', showWindow); notice.show(); return true;
    });
    ipcMain.handle('omnichat:launch-on-startup', (event, enabled: unknown) => {
      trusted(event); if (typeof enabled !== 'boolean') throw new Error('Expected a boolean.');
      if (process.platform === 'linux' || !app.isPackaged) return false;
      app.setLoginItemSettings({ openAtLogin: enabled }); return true;
    });
    ipcMain.handle('omnichat:open-external', async (event, value: unknown) => {
      trusted(event); const url = externalUrl(value);
      const result = await dialog.showMessageBox(mainWindow!, { type: 'question', title: 'Open external link', message: 'Open this link in your browser?', detail: url, buttons: ['Cancel', 'Open link'], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return false;
      await shell.openExternal(url); return true;
    });

    // Generate a small native tray mark without network assets or runtime image libraries.
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5); const i = (y * 16 + x) * 4;
      if (r > 3 && r < 7) { pixels[i] = 178; pixels[i + 1] = 220; pixels[i + 2] = 100; pixels[i + 3] = 255; }
    }
    try { tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 })); tray.setToolTip('OmniChat'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open OmniChat', click: showWindow }, { label: 'New chat', click: newChat }, { type: 'separator' }, { label: 'Quit OmniChat', click: () => app.quit() }])); tray.on('click', showWindow); } catch { tray = null; }
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'OmniChat', submenu: [{ label: 'New chat', accelerator: 'CmdOrCtrl+N', click: newChat }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
    await createWindow();
    globalShortcut.register('CommandOrControl+Shift+Space', showWindow);
  }).catch(error => { dialog.showErrorBox('OmniChat startup failed', error instanceof Error ? error.message : 'Unknown error'); app.quit(); });
}
