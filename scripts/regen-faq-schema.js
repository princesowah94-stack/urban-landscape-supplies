#!/usr/bin/env node
/**
 * Re-extracts FAQ Q&A from faq.html accordion HTML and rebuilds the FAQPage
 * JSON-LD block in <head>. Idempotent — wraps the LD in BEGIN/END:faq-schema
 * comments so re-runs are clean.
 *
 * Run after editing any FAQ answer text in faq.html:
 *   node scripts/regen-faq-schema.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'faq.html');

const html = fs.readFileSync(FILE, 'utf8');
const re = /<button class="accordion-trigger">([^<]+?)\s*<svg[\s\S]*?<div class="accordion-body">([\s\S]*?)<\/div><\/div>/g;
const items = [];
let m;
while ((m = re.exec(html)) !== null) {
  const q = m[1].trim();
  const a = m[2]
    .replace(/<a[^>]*>/g, '')
    .replace(/<\/a>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .trim();
  items.push({ q, a });
}

const ld = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(it => ({
    '@type': 'Question',
    name: it.q,
    acceptedAnswer: { '@type': 'Answer', text: it.a }
  }))
};

const block = `\n  <!-- BEGIN:faq-schema -->\n  <script type="application/ld+json">${JSON.stringify(ld)}</script>\n  <!-- END:faq-schema -->\n`;

let out = html.replace(/\n\s*<!-- BEGIN:faq-schema -->[\s\S]*?<!-- END:faq-schema -->\n/, '\n');
// Use callback replace so $-sequences in the JSON-LD ($150, $500 etc.) aren't
// interpreted as String.replace back-references like $1, $2.
out = out.replace(/(\s*)<\/head>/, (_, ws) => block + ws + '</head>');
fs.writeFileSync(FILE, out, 'utf8');

console.log(`Re-baked FAQPage schema with ${items.length} questions.`);
