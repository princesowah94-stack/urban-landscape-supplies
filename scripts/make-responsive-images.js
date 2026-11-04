#!/usr/bin/env node
/**
 * Generate smaller width variants of product + hero images so phones don't
 * download 1400–2000px originals for 300px slots.
 *
 *   images/products/foo.avif  →  foo-640.{avif,webp,jpg}, foo-1024.{avif,webp,jpg}
 *
 * Variants never upscale (an original narrower than 640px is just re-encoded
 * at its own width), so markup can always reference -640/-1024 safely.
 * Re-runnable: skips variants newer than their source.
 *
 * Run:  node scripts/make-responsive-images.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIRS = ['images/products', 'images/hero'];
const WIDTHS = [640, 1024];
const VARIANT_RE = /-(640|1024)$/;

// Pick the best source per base name: jpg > webp > avif (decode quality)
function sources(dir) {
  const byBase = new Map();
  for (const f of fs.readdirSync(dir)) {
    const ext = path.extname(f).toLowerCase();
    if (!['.jpg', '.jpeg', '.webp', '.avif', '.png'].includes(ext)) continue;
    const base = f.slice(0, -ext.length);
    if (VARIANT_RE.test(base)) continue;
    const rank = { '.jpg': 0, '.jpeg': 0, '.png': 1, '.webp': 2, '.avif': 3 }[ext];
    const cur = byBase.get(base);
    if (!cur || rank < cur.rank) byBase.set(base, { file: path.join(dir, f), rank });
  }
  return byBase;
}

let made = 0;
for (const rel of DIRS) {
  const dir = path.join(ROOT, rel);
  for (const [base, { file }] of sources(dir)) {
    const srcTime = fs.statSync(file).mtimeMs;
    for (const w of WIDTHS) {
      const outs = {
        avif: path.join(dir, `${base}-${w}.avif`),
        webp: path.join(dir, `${base}-${w}.webp`),
        jpg:  path.join(dir, `${base}-${w}.jpg`),
      };
      if (Object.values(outs).every((o) => fs.existsSync(o) && fs.statSync(o).mtimeMs >= srcTime)) continue;
      const img = sharp(file).rotate().resize({ width: w, withoutEnlargement: true });
      await img.clone().avif({ quality: 50, effort: 4 }).toFile(outs.avif);
      await img.clone().webp({ quality: 72 }).toFile(outs.webp);
      await img.clone().jpeg({ quality: 76, mozjpeg: true }).toFile(outs.jpg);
      made++;
    }
  }
}
console.log(`Generated ${made} variant sets.`);
