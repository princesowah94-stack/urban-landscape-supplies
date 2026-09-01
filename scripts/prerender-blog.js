#!/usr/bin/env node
/**
 * Generate one static HTML file per blog post under blog/{slug}.html.
 *
 * Post metadata lives in data/blog.json; the article body lives in
 * content/blog/{slug}.html (plain HTML fragment — h2/p/table/ul). The shell
 * comes from blog-post.html (site chrome + {{PLACEHOLDER}} slots + a
 * BEGIN/END:prerender marker pair in <head> for OG + JSON-LD).
 *
 * Re-runnable. Overwrites all blog/{slug}.html files.
 *
 * Run:  node scripts/prerender-blog.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://urbanlandscapesupplies.com.au';
const OUT_DIR = path.join(ROOT, 'blog');

const { posts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/blog.json'), 'utf8'));
const template = fs.readFileSync(path.join(ROOT, 'blog-post.html'), 'utf8');

fs.mkdirSync(OUT_DIR, { recursive: true });

// Same rule as prerender-products.js: relative href/src get ../ so the page
// works one level deep under /blog/.
function rewritePathsForSubdir(html) {
  return html.replace(/(href|src)="(?!\/|https?:\/\/|#|mailto:|tel:|data:|javascript:)([^"]+)"/g,
    (_, attr, val) => `${attr}="../${val}"`);
}

function humanDate(iso) {
  return new Date(`${iso}T00:00:00+10:00`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney',
  });
}

function buildPrerenderBlock(post, canonical) {
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: `${SITE_URL}${post.heroImage}.jpg`,
    datePublished: post.date,
    author: { '@type': 'Organization', name: 'Urban Landscape Supplies', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'Urban Landscape Supplies', url: SITE_URL },
    mainEntityOfPage: canonical,
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
    ],
  };
  return [
    '  <!-- BEGIN:prerender -->',
    `  <meta property="og:type" content="article" />`,
    `  <meta property="og:title" content="${post.title.replace(/"/g, '&quot;')}" />`,
    `  <meta property="og:description" content="${post.description.replace(/"/g, '&quot;')}" />`,
    `  <meta property="og:url" content="${canonical}" />`,
    `  <meta property="og:image" content="${SITE_URL}${post.heroImage}.jpg" />`,
    `  <meta property="og:locale" content="en_AU" />`,
    `  <script type="application/ld+json">${JSON.stringify(articleLd)}</script>`,
    `  <script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>`,
    '  <!-- END:prerender -->',
  ].join('\n');
}

let count = 0;
for (const post of posts) {
  const body = fs.readFileSync(path.join(ROOT, 'content/blog', `${post.slug}.html`), 'utf8').trimEnd();
  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const titleShort = post.title.split(/[:?—]/)[0].trim();

  let html = template;
  html = rewritePathsForSubdir(html);
  html = html.replace(
    /  <!-- BEGIN:prerender -->\n  <!-- END:prerender -->/,
    buildPrerenderBlock(post, canonical),
  );
  html = html
    .replaceAll('{{TITLE}}', post.title)
    .replaceAll('{{TITLE_SHORT}}', titleShort)
    .replaceAll('{{DESCRIPTION}}', post.description)
    .replaceAll('{{CANONICAL}}', canonical)
    .replaceAll('{{TAG}}', post.tag || 'Guides')
    .replaceAll('{{DATE}}', post.date)
    .replaceAll('{{DATE_HUMAN}}', humanDate(post.date))
    .replaceAll('{{HERO}}', post.heroImage)
    .replaceAll('{{HERO_ALT}}', post.heroAlt)
    .replace('{{BODY}}', body);

  fs.writeFileSync(path.join(OUT_DIR, `${post.slug}.html`), html, 'utf8');
  count++;
}

console.log(`Baked ${count} blog post pages → blog/`);
