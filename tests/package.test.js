const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { listPackageFiles, writePackage } = require('../scripts/package.js');

const ROOT = path.join(__dirname, '..');
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const DEFLATE = 8;

/**
 * Summary: reads a zip file's entries through its central directory.
 * Parameters: buffer — the zip file.
 * Returns: array of { name, data } with each entry's bytes unpacked.
 */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buffer.readUInt32LE(end), END_OF_DIRECTORY);
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), CENTRAL_HEADER);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(localOffset), LOCAL_HEADER);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === DEFLATE ? zlib.inflateRawSync(stored) : stored;
    assert.equal(zlib.crc32(data), crc, `${name} checksum`);
    entries.push({ name, data, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('the package holds the manifest, the extension code and the icons only', () => {
  const files = listPackageFiles(ROOT);
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.includes('src/content.js'));
  assert.ok(files.includes('src/fonts/Manrope.ttf'));
  assert.ok(files.includes('icons/icon-128.png'));
  for (const file of files) {
    assert.match(file, /^(manifest\.json|src\/|icons\/)/, `${file} should not be packaged`);
  }
  assert.equal(files[0], 'manifest.json');
  assert.deepEqual(files.slice(1), [...files.slice(1)].sort());
});

test('every file the manifest names is in the package', () => {
  const files = new Set(listPackageFiles(ROOT));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const named = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
  ];
  for (const file of named) assert.ok(files.has(file), `${file} is missing`);
});

test('the zip has manifest.json first, at the root, and every file unpacks intact', () => {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inkout-package-')), 'inkout.zip');
  writePackage(ROOT, outFile);
  const entries = readZip(fs.readFileSync(outFile));
  assert.deepEqual(entries.map((entry) => entry.name), listPackageFiles(ROOT));
  assert.equal(entries[0].name, 'manifest.json');
  assert.equal(entries[0].localOffset, 0);
  for (const { name, data } of entries) {
    assert.ok(data.equals(fs.readFileSync(path.join(ROOT, name))), `${name} differs`);
  }
  fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
});
