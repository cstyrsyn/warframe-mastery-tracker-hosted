#!/usr/bin/env node
// Downloads primary weapon images from the wiki into Images/primary/
// Run once: node download-primary-images.js
// Safe to re-run — already-downloaded files are skipped.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const OUT_DIR = path.join(__dirname, '..', '..', 'Images', 'primary');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Parse primary weapon names from data.js
const dataJs       = fs.readFileSync(path.join(__dirname, '..', '..', 'data.js'), 'utf8');
const primaryBlock = dataJs.match(/const PRIMARY\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
const names        = [...new Set([...primaryBlock.matchAll(/\["([^"]+)"/g)].map(m => m[1]))];

if (names.length === 0) {
  console.error('No primary weapon names found in data.js — check the regex.');
  process.exit(1);
}
console.log(`Found ${names.length} primary weapons.\n`);

// Rename any previously downloaded underscore files to no-space format
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.includes('_')) {
    const fixed = f.replace(/_/g, '');
    fs.renameSync(path.join(OUT_DIR, f), path.join(OUT_DIR, fixed));
    console.log(`renamed  ${f} → ${fixed}`);
  }
}

function get(urlStr, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) { reject(new Error('Too many redirects')); return; }
    const mod = urlStr.startsWith('https') ? https : http;
    const req = mod.get(urlStr, { headers: { 'User-Agent': 'WFTracker-ImageFetch/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(get(new URL(res.headers.location, urlStr).href, dest, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ok = 0, skipped = 0, failed = 0;
  const failures = [];

  for (const name of names) {
    const filename = name.replace(/ /g, '') + '.png';
    const dest     = path.join(OUT_DIR, filename);
    const url      = 'https://wiki.warframe.com/w/Special:Redirect/file/' + encodeURIComponent(filename);

    if (fs.existsSync(dest)) {
      console.log(`skip    ${filename}`);
      skipped++;
      continue;
    }

    try {
      await get(url, dest);
      console.log(`ok      ${filename}`);
      ok++;
    } catch (e) {
      console.error(`FAIL    ${filename}: ${e.message}`);
      try { fs.unlinkSync(dest); } catch {}
      failures.push(name);
      failed++;
    }

    await sleep(250);
  }

  console.log(`\nDone: ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
  if (failures.length > 0) {
    console.log('Failed weapons:', failures.join(', '));
  }
})();
