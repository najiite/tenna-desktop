// Runs in the window before the app: gives the page its desktop look (title bar, scrollbars, no text selection) and a
// small bridge for the one thing a web page cannot do here, re-encoding audio the browser engine cannot decode.
const { contextBridge, ipcRenderer } = require('electron');

const cfg = ipcRenderer.sendSync('tenna:config');

const CSS = `
  html, body { background: #000; }
  /* The app sits below our title bar */
  #root { position: fixed !important; top: ${cfg.titlebarHeight}px; left: 0; right: 0; bottom: 0; height: auto !important; }
  #tenna-titlebar {
    position: fixed; top: 0; left: 0; right: 0; height: ${cfg.titlebarHeight}px; z-index: 2147483647;
    background: #000; -webkit-app-region: drag; user-select: none; -webkit-user-select: none;
    display: flex; align-items: center; ${cfg.isWin ? 'padding-left: 12px;' : 'justify-content: center;'}
    color: rgba(255, 255, 255, 0.5); font: 600 12px system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  ${cfg.isMac ? '#tenna-titlebar span { display: none; }' : ''}
  html.tenna-fs #tenna-titlebar { display: none; }
  html.tenna-fs #root { top: 0; }
  /* An app, not a page: nothing to select or drag, a plain arrow over buttons, no focus rings from the mouse */
  * { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
  img, a { -webkit-user-drag: none; }
  [role="button"], [role="link"], button, a, [tabindex] { cursor: default !important; }
  :focus:not(:focus-visible) { outline: none; }
  html { -webkit-font-smoothing: antialiased; }
  /* Slim dark scrollbars instead of the system's bright ones */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 10px; border: 3px solid transparent; background-clip: content-box; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); border: 3px solid transparent; background-clip: content-box; }
  ::-webkit-scrollbar-corner { background: transparent; }
  /* Subtitles */
  video::cue { color: #fff; background-color: rgba(0, 0, 0, 0.55); text-shadow: 0 0 3px #000, 0 1px 4px #000; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 2.1vw; line-height: 1.3; }
`;

function install() {
  if (document.getElementById('tenna-titlebar')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'tenna-titlebar';
  const label = document.createElement('span');
  label.textContent = cfg.appName;
  bar.appendChild(label);
  document.body.appendChild(bar);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
else install();

// Full screen (the F key in the player, F11, the green button): the bar steps aside
ipcRenderer.on('tenna:fullscreen', (_event, on) => document.documentElement.classList.toggle('tenna-fs', !!on));

const base = `http://127.0.0.1:${cfg.proxyPort}`;
const query = (params) => new URLSearchParams({ t: cfg.proxyToken, ...params }).toString();

contextBridge.exposeInMainWorld('tennaDesktop', {
  /** The desktop app's own version (the page's build config only knows the phone version) */
  version: cfg.appVersion,
  /** Full screen on and off for the window */
  toggleFullscreen: () => ipcRenderer.send('tenna:toggle-fullscreen'),
  /** True when the app can convert streams (ffmpeg is bundled) */
  canReencodeAudio: !!cfg.proxyPort,
  /** A live channel with its audio re-encoded to AAC, as MPEG-TS */
  reencodedUrl: (url, startSeconds, live) => `${base}/audio?${query({ live: live ? '1' : '0', ss: String(Math.max(0, Math.floor(startSeconds || 0))), u: url })}`,
  /**
   * A film as MP4 the browser can play (picture copied, chosen audio fixed), starting at `startSeconds`. `sessionId` names the
   * conversion so `infoUrl` and `subtitleUrl` can ask about the same one.
   */
  filmUrl: (url, startSeconds, sessionId, audioIndex) => `${base}/film?${query({ u: url, ss: String(Math.max(0, Math.floor(startSeconds || 0))), a: String(audioIndex || 0), sid: sessionId })}`,
  /** What the film contains: { ready, duration, audio: [...], subtitles: [...] } */
  infoUrl: (sessionId) => `${base}/info?${query({ sid: sessionId })}`,
  /** One subtitle track as WebVTT, growing while the film is read */
  subtitleUrl: (sessionId, index) => `${base}/sub?${query({ sid: sessionId, i: String(index) })}`,
});
