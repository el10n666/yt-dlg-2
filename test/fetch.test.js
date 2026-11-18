const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifySha256 } = require('../scripts/fetch-binaries');

const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-fetch-'));
  const file = path.join(dir, 'f.bin');
  fs.writeFileSync(file, 'hello');
  return file;
}

test('verifySha256 returns true for the correct hash', async () => {
  assert.strictEqual(await verifySha256(tmpFile(), HELLO_SHA), true);
});

test('verifySha256 is case-insensitive', async () => {
  assert.strictEqual(await verifySha256(tmpFile(), HELLO_SHA.toUpperCase()), true);
});

test('verifySha256 returns false for a wrong hash', async () => {
  assert.strictEqual(await verifySha256(tmpFile(), '0'.repeat(64)), false);
});
