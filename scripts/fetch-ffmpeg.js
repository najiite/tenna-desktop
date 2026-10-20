// Downloads the ffmpeg binaries that ship inside the app (build/ffmpeg/<platform>-<arch>/), from the same release the
// ffmpeg-static package uses. The app uses ffmpeg only to re-encode audio the built-in player cannot decode (Dolby Digital,
// DTS, MP2…) to AAC. These binaries are GPL-licensed: the LICENSE and README next to each one are included in the installer.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const TAG = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}`;
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function main() {
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : TARGETS;
  for (const target of wanted) {
    const dir = path.join(__dirname, '..', 'build', 'ffmpeg', target);
    const exe = path.join(dir, target.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(exe)) { console.log(`${target}: already there`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    console.log(`${target}: downloading…`);
    const res = await get(`${BASE}/ffmpeg-${target}.gz`);
    await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(exe));
    fs.chmodSync(exe, 0o755);
    for (const name of ['README', 'LICENSE']) {
      try { fs.writeFileSync(path.join(dir, `ffmpeg-${name}.txt`), Buffer.from(await (await get(`${BASE}/${target}.${name}`)).arrayBuffer())); } catch (e) { console.warn(`  ${name}: ${e.message}`); }
    }
    console.log(`${target}: ${(fs.statSync(exe).size / 1048576).toFixed(0)} MB`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
