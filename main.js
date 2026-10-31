// Tenna IPTV Player for desktop: the Expo web build (./app) in an Electron window.
const { app, BrowserWindow, dialog, Menu, ipcMain, net, protocol, screen, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'Tenna IPTV Player';
const APP_DIR = process.env.TENNA_APP_DIR || path.join(__dirname, 'app'); // the override is for testing a different build
const ICON = path.join(__dirname, 'build', 'icon.png'); // the window and taskbar icon (the .exe's own icon is stamped at build time)
const SCHEME = 'tenna';
const HIDDEN = process.env.TENNA_HIDDEN === '1'; // automated checks: no visible window
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
// The page sits under a thin bar of our own that carries the window buttons and drags the window
const TITLEBAR_HEIGHT = IS_MAC ? 28 : 32;

app.setName(APP_NAME);
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

// --- Window size and position are remembered -------------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  const fallback = { width: 1280, height: 780 };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return fallback;
    // Only where a screen still is (a monitor may have been unplugged since)
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea;
      const visible = s.x < area.x + area.width - 80 && s.x + s.width > area.x + 80 && s.y >= area.y - 10 && s.y < area.y + area.height - 80;
      if (visible) return s;
    }
    return { width: s.width, height: s.height, maximized: s.maximized };
  } catch {
    return fallback;
  }
}
function saveWindowState(win) {
  try {
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized }));
  } catch {}
}

// --- Re-encoding audio the browser engine cannot play ------------------------------------------------------------
// Chromium decodes AAC, MP3 and Opus but not Dolby Digital (AC-3 / E-AC-3), DTS or MP2, which many films and some channels
// use: the picture plays and there is no sound. The player then asks this local server for the same stream with its audio
// re-encoded to AAC (the video is copied, so it costs little). It only listens on this computer and needs a secret token.
const PROXY_TOKEN = crypto.randomBytes(16).toString('hex');
let proxyPort = 0;

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const packaged = path.join(process.resourcesPath || '', 'ffmpeg', exe);
  if (app.isPackaged) return fs.existsSync(packaged) ? packaged : null;
  const dev = path.join(__dirname, 'build', 'ffmpeg', `${process.platform}-${process.arch}`, exe);
  return fs.existsSync(dev) ? dev : null;
}

// Audio and subtitle streams of a film, read from ffmpeg's description of the file
const TEXT_SUBTITLES = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'subviewer', 'microdvd', 'eia_608']);
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']); // what Chromium decodes: these are copied, the rest re-encoded

function parseFileInfo(stderr) {
  const info = { duration: 0, video: null, audio: [], subtitles: [] };
  let current = null;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^Output #0/.test(line)) break; // the lines after this describe what ffmpeg writes, not the file
    const d = line.match(/^\s*Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (d && !info.duration) info.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    const m = line.match(/^\s*Stream #0:\d+(?:\[0x[0-9a-fA-F]+\])?(?:\(([^)]*)\))?[^:]*:\s*(Video|Audio|Subtitle):\s*([\w-]+)(.*)$/);
    if (m) {
      const [, lang, kind, codec, rest] = m;
      const stream = { lang: lang && lang !== 'und' ? lang : '', title: '', codec: codec.toLowerCase(), channels: (rest.match(/(mono|stereo|\d\.\d(?:\([a-z]+\))?|\d+ channels)/) || [''])[0] };
      if (kind === 'Video') { if (!info.video) info.video = stream; current = null; continue; }
      const list = kind === 'Audio' ? info.audio : info.subtitles;
      stream.index = list.length;
      list.push(stream);
      current = stream;
      continue;
    }
    const t = line.match(/^\s+title\s*:\s*(.+)$/);
    if (t && current && !current.title) current.title = t[1].trim();
  }
  for (const s of info.subtitles) s.text = TEXT_SUBTITLES.has(s.codec);
  return info;
}

// Films being converted: one provider connection feeds two ffmpeg steps (see the /film route below)
const filmSessions = new Map(); // session id -> { dir, info, procs }
const SAFE_ID = /^[A-Za-z0-9]{6,40}$/;

function endFilmSession(id) {
  const session = filmSessions.get(id);
  if (!session || session.ended) return;
  session.ended = true;
  for (const proc of session.procs) if (proc.exitCode === null) proc.kill('SIGKILL');
  // The subtitle files are small; the player may read them once more, so they go a little later
  setTimeout(() => { try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch {} filmSessions.delete(id); }, 15000);
}

function startFilm(ffmpeg, url, res) {
  const source = url.searchParams.get('u') || '';
  const id = url.searchParams.get('sid') || '';
  const start = Math.max(0, Number(url.searchParams.get('ss')) || 0);
  const wantedAudio = Math.max(0, Number(url.searchParams.get('a')) || 0);
  if (!SAFE_ID.test(id) || filmSessions.has(id)) { res.writeHead(400).end(); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenna-film-'));
  const session = { dir, info: null, procs: [], ended: false };
  filmSessions.set(id, session);
  const fail = () => { if (!res.headersSent) res.writeHead(502); res.end(); endFilmSession(id); };
  res.on('close', () => endFilmSession(id)); // the player left (another film, seeking, window closed): stop converting

  // Step 1 copies every stream of the file, unchanged, into a pipe (the only connection to the provider) and describes the file
  // on stderr. MP4 files are read without subtitles: their tx3g text cannot be copied into this container.
  const noSubtitles = /\.(mp4|m4v|mov)(\?|$)/i.test(source);
  const reader = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'info', '-nostdin',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', source,
    '-map', '0:v:0', '-map', '0:a?', ...(noSubtitles ? [] : ['-map', '0:s?']),
    '-c', 'copy', '-f', 'matroska', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  session.procs.push(reader);
  reader.on('error', fail);

  let described = '';
  let converter = null;
  reader.stderr.on('data', (chunk) => {
    if (converter) return;
    described += chunk;
    if (!described.includes('Stream mapping:')) return; // the whole description has been printed by then
    const info = parseFileInfo(described);
    const audioIndex = Math.min(wantedAudio, Math.max(0, info.audio.length - 1));
    const audio = info.audio[audioIndex];
    session.info = { ready: true, duration: info.duration, audio: info.audio, subtitles: info.subtitles, audioIndex };

    // Step 2 turns that into what the browser can play: the picture as it is, the chosen audio (copied when the browser can
    // play it, otherwise AAC), and every text subtitle track written out as WebVTT while the film is read
    const subtitleOutputs = info.subtitles.filter((s) => s.text).flatMap((s) =>
      ['-map', `0:s:${s.index}`, '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', path.join(dir, `sub${s.index}.vtt`)]);
    converter = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', 'pipe:0',
      '-map', '0:v:0', '-map', `0:a:${audioIndex}?`, '-c:v', 'copy',
      ...(audio && PLAYABLE_AUDIO.has(audio.codec) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']),
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
      ...subtitleOutputs,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    session.procs.push(converter);
    converter.on('error', fail);
    converter.stdin.on('error', () => {});
    reader.stdout.pipe(converter.stdin);
    let started = false;
    converter.stdout.on('data', (data) => {
      if (!started) { started = true; res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }); }
      if (!res.write(data)) { converter.stdout.pause(); res.once('drain', () => converter.stdout.resume()); }
    });
    converter.on('close', () => { if (!started && !res.headersSent) res.writeHead(502); res.end(); });
    if (process.env.TENNA_DEBUG_PORT) {
      let log = '';
      converter.stderr.on('data', (d) => { log = (log + d).slice(-500); });
      converter.on('close', (code) => console.log('[film] converter exited', code, log.trim()));
    }
  });
  reader.on('close', () => { if (!converter) fail(); });
}

function startAudioProxy() {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) return Promise.resolve();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const authorized = url.searchParams.get('t') === PROXY_TOKEN;
    const source = url.searchParams.get('u') || '';
    const id = url.searchParams.get('sid') || '';
    if (!authorized) { res.writeHead(403).end(); return; }

    // A film: described and converted in one go (picture copied, audio fixed, subtitles extracted); the player then asks for
    // what the file contains (/info) and reads the subtitle track it is showing (/sub)
    if (url.pathname === '/film' && /^https?:\/\//i.test(source)) { startFilm(ffmpeg, url, res); return; }
    if (url.pathname === '/info' && SAFE_ID.test(id)) {
      const session = filmSessions.get(id);
      res.writeHead(session ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(session?.info ?? { ready: false }));
      return;
    }
    if (url.pathname === '/sub' && SAFE_ID.test(id) && /^\d{1,3}$/.test(url.searchParams.get('i') || '')) {
      const session = filmSessions.get(id);
      let body = 'WEBVTT\n\n';
      try { if (session) body = fs.readFileSync(path.join(session.dir, `sub${url.searchParams.get('i')}.vtt`), 'utf8'); } catch {}
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }

    // A live channel: its audio re-encoded, as MPEG-TS
    if (url.pathname !== '/audio' || !/^https?:\/\//i.test(source)) { res.writeHead(403).end(); return; }
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-fflags', '+discardcorrupt+nobuffer',
      '-i', source,
      '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-f', 'mpegts', '-muxdelay', '0', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    let log = '';
    child.stderr.on('data', (d) => { log = (log + d).slice(-600); });
    child.stdout.once('data', () => { started = true; res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' }); });
    child.stdout.on('data', (chunk) => { if (!res.write(chunk)) { child.stdout.pause(); res.once('drain', () => child.stdout.resume()); } });
    child.on('close', () => { if (!started && !res.headersSent) res.writeHead(502); res.end(); });
    child.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    // The player went away (channel changed, window closed): stop converting
    res.on('close', () => { if (child.exitCode === null) child.kill('SIGKILL'); });
    if (process.env.TENNA_DEBUG_PORT) child.on('close', (code) => console.log('[audio proxy] ffmpeg exited', code, log.trim()));
  });
  return new Promise((resolve) => {
    server.on('error', () => resolve());
    server.listen(0, '127.0.0.1', () => { proxyPort = server.address().port; resolve(); });
  });
}

// The player's full-screen key and double-click: the window's own full screen, so a Mac shows its menu bar and window buttons when
// the mouse reaches the top edge (the page's own full screen hides them for good)
ipcMain.on('tenna:toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

// What the preload script needs to dress the page and reach the converter
ipcMain.on('tenna:config', (event) => {
  event.returnValue = { appName: APP_NAME, appVersion: app.getVersion(), titlebarHeight: TITLEBAR_HEIGHT, isMac: IS_MAC, isWin: IS_WIN, proxyPort, proxyToken: PROXY_TOKEN };
});

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 420,
    minHeight: 600,
    show: false, // shown once the first frame is ready, so there is no white flash
    title: APP_NAME,
    icon: ICON,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    // macOS keeps its traffic lights, Windows gets its own buttons drawn in the app's colours
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 8 } } : {}),
    ...(IS_WIN ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: TITLEBAR_HEIGHT } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Providers serve plain http:// streams and playlists without CORS headers, which a web page may not read. The
      // window only ever loads this app's own files, so the browser's cross-origin rules are lifted for it.
      webSecurity: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!HIDDEN) win.show(); });

  const wc = win.webContents;
  wc.setVisualZoomLevelLimits(1, 1); // no pinch or ctrl+wheel zoom
  // Full screen (the F key in the player, F11, the green button): the bar steps aside
  const setFullscreenClass = (on) => { if (!wc.isDestroyed()) wc.send('tenna:fullscreen', on); };
  win.on('enter-full-screen', () => setFullscreenClass(true));
  win.on('leave-full-screen', () => setFullscreenClass(false));
  wc.on('enter-html-full-screen', () => setFullscreenClass(true));
  wc.on('leave-html-full-screen', () => setFullscreenClass(false));

  // Links leave the app: they open in the user's browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  // Right-click in a text field or on selected text: the usual cut / copy / paste menu
  wc.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup({ window: win });
  });

  // F11 toggles full screen, Esc leaves it
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    else if (input.key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); event.preventDefault(); }
  });

  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(win), 400); };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('close', () => saveWindowState(win));

  win.loadURL(`${SCHEME}://app/`);
  return win;
}

// The Intel build on an Apple Silicon Mac runs through translation (Rosetta) and is several times slower. It is an easy mistake
// with two downloads, so the app says so, once.
function warnIfWrongMacBuild() {
  if (!IS_MAC || process.arch !== 'x64' || !app.runningUnderARM64Translation) return;
  const flag = path.join(app.getPath('userData'), 'wrong-build-warned');
  if (fs.existsSync(flag)) return;
  try { fs.writeFileSync(flag, '1'); } catch {}
  dialog.showMessageBox({
    type: 'warning',
    message: 'This is the Intel version of Tenna',
    detail: 'Your Mac has an Apple chip, so this version runs through translation and feels slow. Download the Apple Silicon version (the file ending in mac-arm64.dmg) from the releases page.',
    buttons: ['Open the downloads page', 'Not now'],
    defaultId: 0,
  }).then(({ response }) => { if (response === 0) shell.openExternal('https://github.com/najiite/tenna-desktop/releases/latest'); }).catch(() => {});
}

// --- Updates ------------------------------------------------------------------------------------------------------
// Windows downloads a new version in the background and offers to restart into it. A Mac can only install an update by itself
// when the app is signed, so MAC_SIGNED must stay true only while the Mac build is signed and notarized (electron-builder.yml);
// otherwise a Mac offers the downloads page instead.
const MAC_SIGNED = true;
const RELEASES_URL = 'https://github.com/najiite/tenna-desktop/releases/latest';

function checkForUpdates() {
  if (!app.isPackaged || process.env.TENNA_HIDDEN === '1') return; // a development run has no release to compare with
  const selfInstall = !IS_MAC || MAC_SIGNED;
  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall; // an update that was downloaded is applied when the app is closed
  autoUpdater.on('error', () => {}); // offline or rate limited: try again next launch
  if (selfInstall) {
    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox({
        type: 'info',
        message: `Tenna ${info.version} is ready`,
        detail: 'Restart to finish updating. It will also install the next time you close the app.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
    });
  } else {
    autoUpdater.on('update-available', (info) => {
      dialog.showMessageBox({
        type: 'info',
        message: `Tenna ${info.version} is available`,
        detail: 'Download the new version from the releases page and open it to replace this one.',
        buttons: ['Open the downloads page', 'Later'],
        defaultId: 0,
      }).then(({ response }) => { if (response === 0) shell.openExternal(RELEASES_URL); }).catch(() => {});
    });
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

// The menu bar on a Mac (copy and paste and the usual window shortcuts live here); Windows has none
function buildMacMenu() {
  return Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Developer Tools (for bug reports)' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }] },
    {
      label: 'Help',
      submenu: [{ label: 'Releases', click: () => shell.openExternal('https://github.com/najiite/tenna-desktop/releases') }],
    },
  ]);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    protocol.handle(SCHEME, serveApp);
    app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), copyright: 'Tenna does not provide any content.' });
    if (IS_MAC) { app.dock?.setIcon(ICON); Menu.setApplicationMenu(buildMacMenu()); }
    else Menu.setApplicationMenu(null);
    await startAudioProxy(); // the window's preload asks for its port
    createWindow();
    warnIfWrongMacBuild();
    checkForUpdates();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
  app.on('before-quit', () => { for (const id of [...filmSessions.keys()]) endFilmSession(id); });
}
