# Tenna IPTV Player for desktop

## Download

**[Download Tenna IPTV Player for Windows (1.0.0)](https://github.com/najiite/tenna-desktop/raw/main/release/Tenna%20IPTV%20Player%20Setup%201.0.0.exe)** (about 115 MB, 64-bit Windows)

Run the installer. The installer is not code-signed yet, so Windows SmartScreen may warn: choose "More info", then "Run anyway".

The Expo web build of `../tenna-iptv-player` in an Electron window, packaged as a Windows installer.

```bash
npm install
npm run web        # exports the web build into ./app (run again after every app change)
npm start          # run it locally
npm run dist:win   # release/Tenna IPTV Player Setup <version>.exe (NSIS installer)
```

- The window serves `./app` from `tenna://app/`, so the app's absolute paths and router paths work.
- `webSecurity` is off so the app can read providers' plain-http streams and playlists, which send no CORS headers.
  The window only loads the app's own files.
- Building the `.exe` from macOS skips stamping the icon and version into `Tenna.exe` (needs Wine). Build on Windows
  with `signAndEditExecutable: true` for the final release, and sign it (an unsigned installer shows SmartScreen warnings).
- VS Code's terminal sets `ELECTRON_RUN_AS_NODE`; `npm start` clears it.
