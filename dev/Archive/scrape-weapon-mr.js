// scrape-weapon-mr.js
// Fetches weapon Mastery Rank requirements from the Warframe wiki
// Module:Weapons/data sub-pages and writes dev/weapon-mr.js.
//
// Usage:
//   node dev/scrape-weapon-mr.js            # fetch all subpages
//   node dev/scrape-weapon-mr.js --dry-run  # parse but don't write

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const WIKI_API = 'https://wiki.warframe.com/api.php';
const OUT_FILE = path.join(__dirname, '..', 'weapon-mr.js');
const DRY_RUN  = process.argv.includes('--dry-run');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wiki sub-pages that cover weapons tracked in WF_TRACK_V2
const SUBPAGES = ['primary', 'secondary', 'melee', 'archwing', 'companion'];

// ── HTTP ──────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchModuleContent(subpage) {
  const title = `Module:Weapons/data/${subpage}`;
  const url   = `${WIKI_API}?action=query&prop=revisions&rvprop=content&format=json` +
                `&titles=${encodeURIComponent(title)}&rvslots=main`;
  const raw   = JSON.parse(await httpGet(url));
  const page  = Object.values(raw.query.pages)[0];
  if (!page?.revisions) throw new Error(`No content for ${title}`);
  return page.revisions[0].slots.main['*'];
}

// ── Lua parser ────────────────────────────────────────────────────────────────
// Walks the Lua table character-by-character, tracking brace depth so it only
// treats top-level entries (depth 1) as weapon records and reads the Mastery
// field directly inside each record (depth 2).
function parseLuaMR(content) {
  const result = {};
  const len    = content.length;
  let i = 0, depth = 0;

  // Advance to the opening { of the return table
  while (i < len && content[i] !== '{') i++;
  if (i >= len) return result;
  depth = 1; i++;

  while (i < len) {
    // Skip whitespace
    while (i < len && content[i] <= ' ') i++;
    if (i >= len) break;

    // Skip Lua line comments
    if (content[i] === '-' && content[i + 1] === '-') {
      while (i < len && content[i] !== '\n') i++;
      continue;
    }

    if (depth !== 1) {
      // Shouldn't happen in normal flow — advance safely
      if      (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
      continue;
    }

    // ── At depth 1: read the next top-level key ──────────────────────────────
    let name = null;

    if (content[i] === '}') {
      break; // end of outer table
    } else if (content[i] === '[' && content[i + 1] === '"') {
      // ["Weapon Name"] key
      i += 2;
      const closeQuote = content.indexOf('"', i);
      if (closeQuote === -1) break;
      name = content.slice(i, closeQuote);
      i = closeQuote + 2; // skip past "]"
    } else if (/[A-Za-z_]/.test(content[i])) {
      // Unquoted identifier key (single word, no spaces)
      const start = i;
      while (i < len && /[A-Za-z0-9_]/.test(content[i])) i++;
      name = content.slice(start, i);
    } else {
      i++;
      continue;
    }

    // Skip to "="
    while (i < len && content[i] !== '=' && content[i] !== '\n') i++;
    if (i >= len || content[i] !== '=') continue;
    i++;

    // Skip to "{"
    while (i < len && content[i] !== '{' && content[i] !== '\n') i++;
    if (i >= len || content[i] !== '{') continue;
    depth++; i++; // enter weapon entry (depth 2)

    // ── Scan the weapon entry body for Mastery ───────────────────────────────
    let mastery = 0;
    while (i < len && depth > 1) {
      const ch = content[i];

      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }

      // Skip Lua string literals to avoid matching braces inside strings
      if (ch === '"') {
        i++;
        while (i < len && content[i] !== '"') {
          if (content[i] === '\\') i++;
          i++;
        }
        i++; continue;
      }

      // At depth 2, look for "Mastery = <number>"
      if (depth === 2 && ch === 'M' && content.slice(i, i + 7) === 'Mastery') {
        const m = content.slice(i).match(/^Mastery\s*=\s*(\d+)/);
        if (m) { mastery = parseInt(m[1], 10); }
      }

      i++;
    }

    if (name) result[name] = mastery;
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const allMR = {};

  for (const subpage of SUBPAGES) {
    process.stdout.write(`Fetching ${subpage}... `);
    try {
      const content = await fetchModuleContent(subpage);
      const parsed  = parseLuaMR(content);
      const count   = Object.keys(parsed).length;
      console.log(`${count} entries`);
      Object.assign(allMR, parsed);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    await sleep(500);
  }

  const total   = Object.keys(allMR).length;
  const entries = Object.entries(allMR).sort((a, b) => a[0].localeCompare(b[0]));

  const lines = entries.map(([name, mr]) => `  [${JSON.stringify(name)}, ${mr}],`);
  const out = `// weapon-mr.js — generated by scrape-weapon-mr.js
// Maps weapon name → minimum Mastery Rank required to equip/build.
// Re-run: node dev/scrape-weapon-mr.js
const WEAPON_MR = new Map([
${lines.join('\n')}
]);
`;

  if (DRY_RUN) {
    console.log(`\nDry run — ${total} entries parsed, file not written.`);
    // Print a sample
    console.log('Sample (first 10):');
    entries.slice(0, 10).forEach(([n, mr]) => console.log(`  ${n}: MR ${mr}`));
  } else {
    fs.writeFileSync(OUT_FILE, out, 'utf8');
    console.log(`\nWrote ${total} entries → ${OUT_FILE}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
