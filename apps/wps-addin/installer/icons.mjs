import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const directory = new URL('../public/images/', import.meta.url);
for (const name of ['atlas', 'info', 'refresh-cw']) {
  const svg = await readFile(new URL(`${name}.svg`, directory));
  await sharp(svg).resize(32, 32).png().toFile(fileURLToPath(new URL(`${name}.png`, directory)));
}
const source = await readFile(new URL('atlas.svg', directory), 'utf8');
// Use a bold white compass on a dark circular badge for legibility at 16px.
// Keep the actual Lucide geometry; leave the canvas outside the circle clear.
const glyph = source.replace(/^<svg[^>]*>/, '').replace('</svg>', '').replace(/<style>.*?<\/style>/s, '').replace('<path ', '<path fill="#ffffff" stroke-width="1.2" ');
const desktop = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11.5" fill="#0f172a"/><g transform="translate(2.16 2.16) scale(0.82)" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map(size => sharp(Buffer.from(desktop)).resize(size, size).png().toBuffer()));
await writeFile(new URL('atlas-desktop.png', directory), pngs.at(-1));
const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const at = 6 + 16 * i; header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
});
await writeFile(new URL('atlas.ico', directory), Buffer.concat([header, ...pngs]));
