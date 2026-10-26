#!/usr/bin/env node
// Zero-dependency checks for a static site: markup, styles, data shape and JS syntax.
// Run with `npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PAGES = ['index.html', 'repos.html', '404.html'];
const CONTENT_PAGES = ['index.html', 'repos.html'];
const VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Minimal tag scanner: enough to check structure without pulling in a parser. */
function parseTags(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');

  const tags = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g;
  let match;

  while ((match = tagPattern.exec(stripped)) !== null) {
    const [, closing, rawName, rawAttrs, selfClose] = match;
    const attrs = {};
    for (const attr of rawAttrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? '';
    }
    tags.push({
      name: rawName.toLowerCase(),
      closing: Boolean(closing),
      selfClose: selfClose === '/',
      attrs,
    });
  }

  return tags;
}

function checkHtml(file) {
  const html = read(file);
  const tags = parseTags(html);
  const withName = (name) => tags.filter((tag) => !tag.closing && tag.name === name);

  if (!/^<!doctype html>/i.test(html.trim())) fail(file, 'missing doctype');

  const htmlTag = withName('html')[0];
  if (!htmlTag?.attrs.lang) fail(file, '<html> needs a lang attribute');

  if (!withName('meta').some((tag) => tag.attrs.name === 'viewport')) {
    fail(file, 'missing viewport meta');
  }

  const description = withName('meta').find((tag) => tag.attrs.name === 'description');
  if (!description || (description.attrs.content || '').trim().length < 20) {
    fail(file, 'missing a useful meta description');
  }

  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!title || !title[1].trim()) fail(file, 'missing or empty <title>');

  const h1Count = withName('h1').length;
  if (h1Count !== 1) fail(file, `expected exactly one <h1>, found ${h1Count}`);

  if (!withName('main').some((tag) => tag.attrs.id === 'main')) {
    fail(file, 'missing <main id="main">');
  }

  if (
    !withName('a').some(
      (tag) => (tag.attrs.class || '').includes('skip-link') && tag.attrs.href === '#main',
    )
  ) {
    fail(file, 'missing skip link to #main');
  }

  for (const tag of tags) {
    if (!tag.closing && 'style' in tag.attrs) {
      fail(file, `inline style attribute on <${tag.name}>`);
    }
  }

  const ids = tags.filter((tag) => !tag.closing && tag.attrs.id).map((tag) => tag.attrs.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(file, `duplicate id(s): ${duplicates.join(', ')}`);

  for (const img of withName('img')) {
    if (!('alt' in img.attrs)) fail(file, 'img without alt');
  }

  for (const link of withName('a')) {
    if (link.attrs.target === '_blank' && !/(noreferrer|noopener)/.test(link.attrs.rel || '')) {
      fail(file, `target="_blank" without rel="noreferrer": ${link.attrs.href}`);
    }
  }

  const assetPattern = /\.(?:css|js|mjs|svg|jpe?g|png|webp|avif|json|html)$/i;
  for (const tag of tags) {
    if (tag.closing) continue;
    for (const value of [tag.attrs.src, tag.attrs.href]) {
      if (!value || /^(?:https?:|mailto:|#|data:)/.test(value) || !assetPattern.test(value)) {
        continue;
      }
      if (!fs.existsSync(path.join(ROOT, value))) fail(file, `missing asset: ${value}`);
    }
  }

  const stack = [];
  for (const tag of tags) {
    if (tag.name === '!doctype' || VOID.has(tag.name) || tag.selfClose) continue;
    if (!tag.closing) {
      stack.push(tag.name);
    } else if (stack.at(-1) === tag.name) {
      stack.pop();
    } else {
      fail(file, `unexpected closing </${tag.name}>`);
      break;
    }
  }
  if (stack.length) fail(file, `unclosed tags: ${stack.join(', ')}`);
}

function checkStructuredData(file) {
  const html = read(file);
  const blocks = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  if (!blocks.length) return fail(file, 'missing JSON-LD structured data');

  blocks.forEach((block, index) => {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch (error) {
      fail(file, `JSON-LD block ${index + 1} is not valid JSON: ${error.message}`);
      return;
    }
    if (!String(data['@context'] || '').includes('schema.org')) {
      fail(file, `JSON-LD block ${index + 1} is missing a schema.org @context`);
    }
    if (!data['@type']) fail(file, `JSON-LD block ${index + 1} is missing @type`);
  });
}

function checkSitemap(file) {
  const xml = read(file);
  if (!xml.trimStart().startsWith('<?xml')) fail(file, 'missing XML declaration');

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!locs.length) fail(file, 'no <loc> entries');

  for (const loc of locs) {
    let url;
    try {
      url = new URL(loc);
    } catch {
      fail(file, `invalid <loc>: ${loc}`);
      continue;
    }
    if (url.protocol !== 'https:') fail(file, `<loc> is not https: ${loc}`);
    const target = url.pathname.replace(/^\//, '') || 'index.html';
    if (!fs.existsSync(path.join(ROOT, target))) fail(file, `<loc> has no file on disk: ${loc}`);
  }
}

function checkRobots(file) {
  const txt = read(file);
  if (!/^Sitemap: https:\/\/\S+$/m.test(txt)) fail(file, 'missing an absolute Sitemap directive');
  if (/^Disallow: \/$/m.test(txt)) fail(file, 'disallows the whole site');
}

function checkCss(file) {
  const css = read(file);

  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  if (open !== close) fail(file, `unbalanced braces (${open} { vs ${close} })`);
  if (/@import/.test(css)) fail(file, '@import is not allowed; link stylesheets instead');
  if (!/@font-face/.test(css)) fail(file, 'expected a self-hosted @font-face');

  for (const match of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const target = match[2];
    if (/^(data:|https?:)/.test(target)) {
      fail(file, `remote url() reference: ${target}`);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, target))) fail(file, `missing file for url(${target})`);
  }
}

function checkJs(file) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  } catch (error) {
    const detail =
      error.stderr
        ?.toString()
        .split('\n')
        .find((line) => line.trim()) || '';
    fail(file, `syntax error: ${detail.trim() || error.message}`);
  }
}

const isIso = (value) =>
  typeof value === 'string' && value.endsWith('Z') && !Number.isNaN(Date.parse(value));

function checkData(file, collection, fields) {
  let data;
  try {
    data = JSON.parse(read(file));
  } catch (error) {
    return fail(file, `invalid JSON: ${error.message}`);
  }

  if (typeof data.user !== 'string' || !data.user) fail(file, 'missing "user"');
  if (!isIso(data.generatedAt)) fail(file, '"generatedAt" must be an ISO UTC timestamp');
  if (!Array.isArray(data[collection])) return fail(file, `missing "${collection}" array`);

  data[collection].forEach((row, index) => {
    for (const [field, type] of Object.entries(fields)) {
      const value = row[field];
      const ok =
        type === 'array'
          ? Array.isArray(value)
          : type === 'string|null'
            ? value === null || typeof value === 'string'
            : typeof value === type;
      if (!ok) fail(file, `${collection}[${index}].${field} should be ${type}`);
    }

    if (typeof row.url === 'string' && !row.url.startsWith('https://github.com/')) {
      fail(file, `${collection}[${index}].url is not an https GitHub URL`);
    }
  });

  if (data[collection].some((row) => row.fork || row.isFork)) {
    fail(file, `${collection} must not contain forks`);
  }
}

// --- run ---

for (const page of PAGES) checkHtml(page);
for (const page of CONTENT_PAGES) checkStructuredData(page);
checkCss('styles.css');
checkSitemap('sitemap.xml');
checkRobots('robots.txt');

const jsFiles = [
  ...fs
    .readdirSync(path.join(ROOT, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join('assets', name)),
  ...fs
    .readdirSync(path.join(ROOT, 'scripts'))
    .filter((name) => /\.m?js$/.test(name))
    .map((name) => path.join('scripts', name)),
];
for (const file of jsFiles) checkJs(file);

checkData('data/pinned.json', 'pinned', {
  owner: 'string',
  name: 'string',
  url: 'string',
  description: 'string',
  language: 'string',
  stars: 'number',
  forks: 'number',
  pushedAt: 'string|null',
  archived: 'boolean',
});

checkData('data/repos.json', 'repos', {
  name: 'string',
  url: 'string',
  description: 'string',
  language: 'string',
  stars: 'number',
  forks: 'number',
  pushedAt: 'string|null',
  createdAt: 'string|null',
  archived: 'boolean',
  topics: 'array',
  license: 'string',
  homepage: 'string',
});

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) found:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `✓ ${PAGES.length} pages, styles.css, sitemap/robots, ${jsFiles.length} scripts and 2 data files look good`,
);
