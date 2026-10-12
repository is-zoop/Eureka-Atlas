import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

test('Windows compass ICO has six crisp sizes, a dark circular badge, bold white glyph and transparent corners', async () => {
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('../installer/icons.mjs', import.meta.url))], { windowsHide: true, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const ico = await readFile(new URL('../public/images/atlas.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 6);
  for (let i = 0; i < 6; i++) {
    const at = 6 + 16 * i, size = ico[at] || 256;
    const length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    const { data, info } = await sharp(ico.subarray(offset, offset + length)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size); assert.equal(info.height, size);
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) assert.equal(data[(y * size + x) * 4 + 3], 0);
    let dark = 0, white = 0;
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      const [r, g, b, a] = data.subarray(pixel, pixel + 4);
      if (a > 200 && r < 60 && g < 60 && b < 90) dark++;
      if (a > 200 && r > 210 && g > 210 && b > 210) white++;
    }
    assert.ok(dark >= size * size * 0.3, `dark circular base at ${size}px`);
    assert.ok(white >= size * size * 0.07, `bold readable glyph at ${size}px`);
    assert.ok(white < size * size * 0.35, `no white background tile at ${size}px`);
  }
});
