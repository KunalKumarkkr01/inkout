// Builds the zip to upload to the Chrome Web Store: dist/inkout-<version>.zip, with manifest.json
// at the root. Written with Node's own zlib, so no zip tool or library is needed.
//   npm run package
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = 'manifest.json';
const PACKAGED_FOLDERS = ['src', 'icons'];
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20; // 2.0: deflate
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
// A fixed date (1 January 2026) so the same files always give the same zip.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * Summary: the files that go into the store package.
 * Parameters: root — the repository folder.
 * Returns: paths with forward slashes, manifest.json first, then the rest sorted.
 * Usage: listPackageFiles(ROOT) → ['manifest.json', 'icons/icon-128.png', …, 'src/welcome.js'].
 */
function listPackageFiles(root) {
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const relative = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else files.push(relative);
    }
  };
  PACKAGED_FOLDERS.forEach(walk);
  return [MANIFEST, ...files.sort()];
}

/**
 * Summary: writes a zip of the store package.
 * Parameters: root — the repository folder; outFile — where to write the zip.
 * Usage: writePackage(ROOT, 'dist/inkout-1.0.0.zip').
 */
function writePackage(root, outFile) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const name of listPackageFiles(root)) {
    const data = fs.readFileSync(path.join(root, name));
    const compressed = zlib.deflateRawSync(data, { level: zlib.constants.Z_BEST_COMPRESSION });
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_DIRECTORY, 0);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...localParts, ...centralParts, end]));
}

if (require.main === module) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8'));
  const outFile = path.join(ROOT, 'dist', `inkout-${version}.zip`);
  writePackage(ROOT, outFile);
  console.log(`Wrote ${path.relative(ROOT, outFile)} (${fs.statSync(outFile).size} bytes)`);
}

module.exports = { listPackageFiles, writePackage };
