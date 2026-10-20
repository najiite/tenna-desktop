// Stamps the Tenna icon and version info into Tenna.exe. electron-builder does this with rcedit, which needs Wine when
// building on macOS/Linux, so it is switched off (signAndEditExecutable: false) and done here with a pure-JS editor.
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename, version } = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  // Replace the icons of the existing icon group (the one Windows shows for the file, the taskbar and shortcuts)
  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico'))).icons.map((i) => i.data);
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group ? group.id : 1, group ? group.lang : 1033, icons);

  // Name and version shown in Explorer's properties and in Task Manager
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (info) {
    const lang = info.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
    info.setStringValues(lang, {
      ProductName: 'Tenna IPTV Player',
      FileDescription: 'Tenna IPTV Player',
      CompanyName: 'Tenna IPTV Player',
      LegalCopyright: 'Tenna IPTV Player',
      OriginalFilename: `${productFilename}.exe`,
      InternalName: productFilename,
    });
    const [major = 1, minor = 0, patch = 0] = version.split('.').map(Number);
    info.setFileVersion(major, minor, patch, 0, lang.lang);
    info.setProductVersion(major, minor, patch, 0, lang.lang);
    info.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
