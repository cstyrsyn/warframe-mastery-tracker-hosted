#!/usr/bin/env node
// Downloads warframe helmet images from the wiki into Images/warframes/
// Run once: node download-wf-images.js
// Safe to re-run — already-downloaded files are skipped.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const OUT_DIR = path.join(__dirname, '..', '..', 'Images', 'warframes');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Parse warframe names from data.js
const dataJs  = fs.readFileSync(path.join(__dirname, '..', '..', 'data.js'), 'utf8');
const wfBlock = dataJs.match(/const WARFRAMES\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
const names   = [...new Set([...wfBlock.matchAll(/\['([^']+)'/g)].map(m => m[1]))];

if (names.length === 0) {
  console.error('No warframe names found in data.js — check the regex.');
  process.exit(1);
}
console.log(`Found ${names.length} warframes.\n`);

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

  for (const name of names) {
    const filename = name.replace(/ /g, '') + 'Helmet.png';
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
      failed++;
    }

    await sleep(250); // be polite to the wiki
  }

  console.log(`\nDone: ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) console.log('Re-run to retry failed images.');
})();
