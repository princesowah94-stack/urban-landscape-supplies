#!/usr/bin/env node
/**
 * Pull the client's pebble photos from Google Drive and turn them into
 * square 1600×1600 product masters, in display order (material first,
 * packaged bags last).
 *
 *   images/_drive-src/<fileId>.jpg          (downloaded original, gitignored)
 *   images/products/pebbles-<slug>-<n>.jpg  (square master)
 *
 * Then run `node scripts/make-responsive-images.js` for -640/-1024 variants.
 *
 * Run:  node scripts/import-drive-photos.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'images/_drive-src');
const OUT_DIR = path.join(ROOT, 'images/products');
const SIZE = 1600;

// Drive file ids, in gallery order. `position` overrides the crop anchor
// when sharp's 'attention' crop cuts the pebbles or the tape measure.
const PHOTOS = {
  'snow-white': [
    { id: '14EAUDzzp-9Om7jgZsVKWXMz8qGaM6Gdh' },  // 1C9A0047
    { id: '1dDvNUP1RKDXVu-Rz0G1NgymYm0T-NoWh' },  // 1C9A0054
    { id: '1NmeGcNZRZA68tU0yUfnaA26V_BfdcjSj' },  // 1C9A0107
    { id: '11s5PucwMVnS96Qy7sUQt2otSk-j_qRL0' },  // 1C9A0108
    { id: '1aUyaSpbwiD1H-xvvwwQz6MKGFU5HWeY4', position: 'centre' },  // bag 20-30mm
    { id: '1zsqJlr8DZ7kPmFmGTRwjnMoxMdyYE13j', position: 'centre' },  // bag 30-50mm
    { id: '1YHZF0LRjaDs6ltaMio6onT25Hndz_8Cn', position: 'centre' },  // bag 50-80mm
  ],
  'charcoal-lava': [
    { id: '14CRC3Vf4u-ymdS3VC2QrifXAvlBWbvvW' },  // close-up texture
    { id: '18GREp0uPiUrmPeSyUUgirUe6DxEDV83V' },  // 1C9A0088, in hand
    { id: '1B3WzdtueCh-0GAzULl91Z7Ame2x0foTp', position: 'centre' },  // 20-30mm
    { id: '1ht24_mhyz-wR-Ips5lcEkGcgbAZNRnWu', position: 'centre' },  // 30-50mm
    { id: '1D8Ut5PXSNFIcG1McHxicbpdkYZCEoOt2', position: 'centre' },  // 50-80mm
    { id: '1DWFqA65Vl7FkxLOq7UHKp3sioSksUhOY' },  // bag 1C9A0081
  ],
  'crushed-snow-white': [
    { id: '1mfLx-2iZyEt1IbpvoF5JbonPzyvBYvIM' },  // 1C9A0065
  ],
  'charcoal-grey': [
    { id: '1JgcP48c3J5IRQs-ZQtMjFWmRdwVYNg_X' },  // 1C9A0101
  ],
  'red-lava': [
    { id: '1MgxrOWjFZ22JEVIyNBhM4kSnkwYS71CT' },  // 1C9A0097
  ],
};

async function download(id) {
  const file = path.join(SRC_DIR, `${id}.jpg`);
  if (fs.existsSync(file)) return file;
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`Drive download failed for ${id} (${res.status})`);
  fs.writeFileSync(file, buf);
  return file;
}

fs.mkdirSync(SRC_DIR, { recursive: true });
for (const [slug, photos] of Object.entries(PHOTOS)) {
  for (const [i, { id, position = 'attention' }] of photos.entries()) {
    const src = await download(id);
    const base = path.join(OUT_DIR, `pebbles-${slug}-${i + 1}`);
    const img = sharp(src).rotate().resize(SIZE, SIZE, { fit: 'cover', position });
    // Full-size .avif/.webp siblings are referenced too (see avifFor in js/products.js)
    await img.clone().jpeg({ quality: 82, mozjpeg: true }).toFile(`${base}.jpg`);
    await img.clone().webp({ quality: 75 }).toFile(`${base}.webp`);
    await img.clone().avif({ quality: 50, effort: 4 }).toFile(`${base}.avif`);
    console.log(path.relative(ROOT, base));
  }
}
