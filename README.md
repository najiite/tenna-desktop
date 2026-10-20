# Tenna IPTV Player for desktop

## Download

- **Windows (64-bit):** [Tenna-IPTV-Player-Setup.exe](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-Setup.exe) (about 130 MB)
- **Mac, Apple Silicon (M1 and later):** [Tenna-IPTV-Player-mac-arm64.dmg](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-mac-arm64.dmg) (about 145 MB)
- **Mac, Intel:** [Tenna-IPTV-Player-mac-x64.dmg](https://github.com/najiite/tenna-desktop/releases/latest/download/Tenna-IPTV-Player-mac-x64.dmg) (about 155 MB)

Not sure which Mac you have? Apple menu, then About This Mac: "Chip: Apple M…" is Apple Silicon, "Processor: Intel…" is Intel. The Intel
file on an Apple Silicon Mac works but is several times slower. All versions are on the [Releases page](https://github.com/najiite/tenna-desktop/releases).

The installers are not code-signed yet. Windows SmartScreen may warn: choose "More info", then "Run anyway". On a Mac, right-click the
app and choose Open the first time (or run `xattr -cr "/Applications/Tenna IPTV Player.app"`).

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

`npm run dist:mac` builds `.dmg` files for Apple Silicon and Intel. They are not signed or notarized: macOS will say the app
cannot be checked (right-click it and choose Open, or run `xattr -cr "/Applications/Tenna IPTV Player.app"`). Signing needs an
Apple Developer ID.

