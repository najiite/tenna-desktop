# Tenna IPTV Player for desktop

## Download

- **Windows (64-bit):** [Tenna-IPTV-Player-Setup.exe](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-Setup.exe) (about 130 MB)
- **Mac, Apple Silicon (M1 and later):** [Tenna-IPTV-Player-mac-arm64.dmg](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-mac-arm64.dmg) (about 145 MB)
- **Mac, Intel:** [Tenna-IPTV-Player-mac-x64.dmg](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-mac-x64.dmg) (about 155 MB)
- **Android TV and Fire TV (early release):** [Tenna-IPTV-Player-AndroidTV.apk](https://github.com/najiite/tenna-desktop/releases/download/android-tv-v1.0.0/Tenna-IPTV-Player-AndroidTV.apk) (about 154 MB). Installed from the file (for example with the Downloader app), used with the TV remote; Android 8 or later.

Not sure which Mac you have? Apple menu, then About This Mac: "Chip: Apple M…" is Apple Silicon, "Processor: Intel…" is Intel. The Intel
file on an Apple Silicon Mac works but is several times slower. All versions are on the [Releases page](https://github.com/najiite/tenna-desktop/releases).

The Mac builds are signed and notarized by Apple. The Windows installer is not code-signed yet, so SmartScreen may warn: choose
"More info", then "Run anyway". The Android TV file is installed from outside a store: allow "Install unknown apps" when asked.

## What it does

Tenna is a player only: it ships with no channels or content, you bring your own Xtream Codes account or M3U playlist.

**Library**
- Xtream Codes and M3U playlists, several saved at once, one active at a time. The library is saved on the computer and appears at once
  on the next launch, then refreshes in the background (Settings → Playlist Settings).
- Profiles with their own favourites and history, including a Kids profile with a PIN; hide, reorder and merge categories.
- One search across live TV (with what is on now), movies and series.

**Live TV**
- Grid or list, sorting, favourites, quality badges and Now/Next on every channel.
- A TV guide: Now/Next in the player and a full guide. *Manage EPG* shifts a provider's times and reloads the guide.
- A frozen or stopped stream reconnects by itself (a nudge, then a fresh start, with waits between tries) and waits for the network if
  you are offline.
- **Multi-view:** 2 to 4 channels at once, one with sound. **Cross-playlist view:** one channel from each of 2 to 4 playlists, each on its
  own account. Every view reconnects by itself; tap one for previous channel, pause and next channel.

**Movies and series**
- Details pages, Continue Watching, *auto-play next episode*, and *Skip intro* that learns from your own skips.
- A seek bar that shows what is buffered, playback speed, and a list of the film's **audio languages and subtitles**, read from the file.
- Films with Dolby Digital or DTS sound play with sound (re-encoded on the fly, see below).

**Home and sports**
- A hero banner of trending titles, Continue Watching, and rows of new movies, series and live entertainment.
- Sports: live scores and fixtures by league (from ESPN's unofficial public scoreboard); tap a match to open the best channel for it.

**On the desktop**
- Keyboard: **Space** or **K** pause, **← / →** skip, **↑ / ↓** volume, **M** mute, **F** or double-click full screen, **PageUp / PageDown**
  change channel, **Esc** back. A click shows or hides the controls; the mouse wheel changes the volume.
- A dark title bar in the app's colours (Mac traffic lights; Windows buttons), a remembered window size and position, a Mac menu bar,
  Picture-in-Picture, and sheets you can drag down, press Esc on, or click outside to close.

**Not on desktop (phones and tablets only):** Live Rewind, recordings, offline downloads, the home-screen widget and Live Activity,
AirPlay, kick-off notifications for favourite teams, and the full TV guide for a category (with a guide address of your own). The phone app has all of these; see the
[features page](https://tennaplayer.com/features/).

## Building from source

The Expo web build of tenna-iptv-player (a private project, expected next to this folder) in an Electron
window, packaged as installers for Windows and Mac.

```bash
npm install
npm run web        # exports the web build into ./app (run again after every app change)
npm start          # run it locally
npm run dist:win   # release/Tenna IPTV Player Setup <version>.exe
npm run dist:mac   # release/*.dmg for Apple Silicon and Intel
```

- The window serves `./app` from `tenna://app/`, so the app's absolute paths and router paths work.
- `webSecurity` is off so the app can read providers' plain-http streams and playlists, which send no CORS headers. The window only
  loads the app's own files.
- The Windows icon and version info are stamped into the `.exe` by `build/after-pack.js`, so the installer can be built on a Mac
  without Wine. An unsigned installer still shows SmartScreen warnings.
- VS Code's terminal sets `ELECTRON_RUN_AS_NODE`; `npm start` clears it.

## Updates

Packaged builds check this repo's latest GitHub release at launch (`electron-updater`, `checkForUpdates` in `main.js`).

- **Windows** downloads the new version in the background and offers to restart into it (or installs it when the app is closed).
- **Mac** updates the same way, now that the build is signed and notarized (`MAC_SIGNED` in `main.js`; Squirrel.Mac refuses to install an update into an unsigned app).

To ship a version:

```bash
# bump "version" in package.json first: the app only updates to a higher version
export GH_TOKEN=<a GitHub token with repo access>
npm run web          # re-export the web build
npm run release:win  # builds and uploads the .exe, its .blockmap and latest.yml
npm run release:mac  # builds and uploads both .dmg files, the .zip files and latest-mac.yml
```

The release is created as a draft: publish it on GitHub, or the app will not see it.

## Audio and subtitles

The browser engine inside Electron plays AAC, MP3 and Opus, but not Dolby Digital (AC-3 / E-AC-3), DTS or MP2, which many films
and some channels use (the picture plays, silently), and a web page cannot read the subtitle tracks inside a film file. So the app
runs a small server on `127.0.0.1` (random port, secret token, see `main.js`) that converts with a bundled `ffmpeg`:

- **Films** in `.mkv`, `.avi`, `.wmv`, `.m2ts` or `.flv` (and any film whose audio turns out to be silent) are opened through
  `/film`. One connection to the provider feeds two ffmpeg steps: the first copies every stream into a pipe and describes the file;
  the second makes the MP4 the browser plays (picture copied; the chosen audio copied if the browser can play it, else AAC) and writes
  each text subtitle track out as WebVTT. The player lists the tracks (`/info`), reads the one you pick (`/sub`) and shows it with the
  video's own subtitle rendering. Another audio language, or seeking, starts a new conversion at that point. Picture-based
  subtitles (PGS, DVD) cannot be shown. MP4 films play straight from the provider.
- **Live channels** are not touched, unless four seconds of picture play with no decoded audio: then the channel comes back through
  `/audio` as MPEG-TS with AAC audio.

`ffmpeg` is not in git: `npm run dist:win` and `npm run dist:mac` download it (`scripts/fetch-ffmpeg.js`, the static builds of
[ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) into `build/ffmpeg/` and ship it in the installer's resources. These
builds are **GPL-licensed**: the installer includes their LICENSE and README next to the binary, and you need to offer the ffmpeg
source if you distribute the app.

## Look and feel

`preload.js` gives the page its desktop look: a dark title bar of the app's own (macOS traffic lights; Windows draws its buttons
in the app's colours), slim scrollbars, no text selection or link dragging, and an arrow cursor on buttons. The window remembers
its size and position, and on a Mac there is a menu bar with the usual shortcuts.

## Mac

Two files, named for the chip: **`mac-arm64`** is for Apple Silicon Macs (M1 and later), **`mac-x64`** for Intel Macs. Apple menu → About This Mac
shows which you have. The Intel one on an Apple Silicon Mac runs through Rosetta and is several times slower (the app warns about it
once).

`npm run dist:mac` builds `.dmg` files for Apple Silicon and Intel, signed with the Developer ID Application certificate in the
keychain and notarized by Apple. Notarizing needs `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (made at appleid.apple.com) and
`APPLE_TEAM_ID` set in the shell that runs the build; they are never stored in the repository.

