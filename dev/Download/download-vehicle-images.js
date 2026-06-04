#!/usr/bin/env node
// Downloads vehicle images from the wiki into Images/vehicles/
// Run once: node download-vehicle-images.js
// Safe to re-run — already-downloaded files are skipped.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const OUT_DIR = path.join(__dirname, '..', '..', 'Images', 'vehicles');
fs.mkdirSync(OUT_DIR, { recursive: true });

const dataJs       = fs.readFileSync(path.join(__dirname, '..', '..', 'data.js'), 'utf8');
const vehicleBlock = dataJs.match(/const VEHICLES\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
const names        = [...new Set([...vehicleBlock.matchAll(/\["([^"]+)"/g)].map(m => m[1]))];

if (names.length === 0) {
  console.error('No vehicle names found in data.js — check the regex.');
  process.exit(1);
}
console.log(`Found ${names.length} vehicles.\n`);

// Local filename → wiki filename when they differ
const FILENAME_OVERRIDES = {
  'Plexus.png': 'RailjackMarket.png',
};

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
    const filename     = name.replace(/ /g, '') + '.png';
    const wikiFilename = FILENAME_OVERRIDES[filename] ?? filename;
    const dest         = path.join(OUT_DIR, filename);
    const url          = 'https://wiki.warframe.com/w/Special:Redirect/file/' + encodeURIComponent(wikiFilename);

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
  if (failures.length > 0) console.log('Failed:', failures.join(', '));
})();
