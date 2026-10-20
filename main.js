// Tenna for desktop: the Expo web build (./app) in an Electron window.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_DIR = process.env.TENNA_APP_DIR || path.join(__dirname, 'app'); // the override is for testing a different build
const ICON = path.join(__dirname, 'build', 'icon.png'); // the window and taskbar icon (the .exe's own icon is stamped at build time)
const SCHEME = 'tenna';
const HIDDEN = process.env.TENNA_HIDDEN === '1'; // automated checks: no visible window
if (process.env.TENNA_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.TENNA_DEBUG_PORT);

// Live channels start without a click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// The app is served from tenna://app/ so its absolute asset paths and its router's paths (/player, /settings…) work
// the same as on a web server
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function serveApp(request) {
  const { pathname } = new URL(request.url);
  let file = path.join(APP_DIR, decodeURIComponent(pathname));
  if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
  // Anything that is not a file is a route of the single-page app
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(APP_DIR, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 420,
    minHeight: 600,
    show: !HIDDEN,
    title: 'Tenna IPTV Player',
    icon: ICON,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Providers serve plain http:// streams and playlists without CORS headers, which a web page may not read. The
      // window only ever loads this app's own files, so the browser's cross-origin rules are lifted for it.
      webSecurity: false,
    },
  });

  // Links leave the app: they open in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  // F11 toggles full screen, Esc leaves it
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    else if (input.key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); event.preventDefault(); }
  });

  win.loadURL(`${SCHEME}://app/`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveApp);
    if (process.platform === 'darwin') app.dock?.setIcon(ICON);
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null); // macOS keeps its menu (copy/paste, quit)
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
