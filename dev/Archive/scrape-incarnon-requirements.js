// scrape-incarnon-requirements.js
// Fetches each unique Incarnon Genesis wiki page and extracts installation resource
// requirements from the "Installing the X requires ..." line.
//
// Usage:
//   node dev/scrape-incarnon-requirements.js            # scrape + write data.js
//   node dev/scrape-incarnon-requirements.js --dry-run  # print only, no writes
//   node dev/scrape-incarnon-requirements.js --item "Braton Incarnon Genesis"
//
// Output:
//   dev/incarnon-requirements.json
//   Inserts/replaces const INCARNON_REQUIREMENTS in data.js

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_JS = path.join(__dirname, '..', 'data.js');
const OUT_JSON = path.join(__dirname, 'incarnon-requirements.json');

// ── Helpers ───────────────────────────────────────────────────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Extract unique Incarnon Genesis names from data.js ────────────────────────
function extractIncarnons(src) {
  const mapMatch = src.match(/const INCARNON_WEAPONS = new Map\(\[([\s\S]*?)\]\);/);
  if (!mapMatch) throw new Error('INCARNON_WEAPONS not found in data.js');
  const names = new Set();
  const re = /'([^']+Incarnon Genesis)'/g;
  let m;
  while ((m = re.exec(mapMatch[1])) !== null) names.add(m[1]);
  return [...names].sort();
}

// ── Fetch wiki wikitext via API ───────────────────────────────────────────────
async function fetchWikitext(name) {
  const title = name.replace(/ /g, '_').replace(/&/g, '%26');
  const url = `https://wiki.warframe.com/api.php?action=query&prop=revisions&titles=${title}&rvprop=content&rvslots=main&format=json`;
  const json = await fetch(url);
  const data = JSON.parse(json);
  const page = Object.values(data.query.pages)[0];
  if (page.missing !== undefined) return null;
  return page.revisions[0].slots.main['*'];
}

// ── Parse the "Installing the X requires ..." line ───────────────────────────
// Returns [[resourceName, count], ...] or null.
// Handles variations:
//   20 {{Resource|Pathos Clamp|Pathos Clamps}}
//   '''20''' {{Resource|Pathos Clamp}}
//   70{{Resource|Yao Shrub|Yao Shrubs}}
function parseRequirements(wikitext) {
  for (const line of wikitext.split('\n')) {
    if (!/Installing the .* requires/i.test(line)) continue;
    // Strip bold markers then match count + resource template
    const clean = line.replace(/'''/g, '');
    const re = /(\d+)\s*\{\{Resource\|([^|}]+)(?:\|[^}]*)?\}\}/g;
    const resources = [];
    let m;
    while ((m = re.exec(clean)) !== null) {
      resources.push([m[2].trim(), parseInt(m[1], 10)]);
    }
    if (resources.length > 0) return resources;
  }
  return null;
}

// ── Serialise INCARNON_REQUIREMENTS map block ─────────────────────────────────
function buildMapContent(results) {
  const entries = Object.entries(results)
    .filter(([, v]) => Array.isArray(v))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, reqs]) => `  [${JSON.stringify(name)},${JSON.stringify(reqs)}]`);
  return `const INCARNON_REQUIREMENTS = new Map([\n${entries.join(',\n')},\n]);\n`;
}

// ── Replace or insert INCARNON_REQUIREMENTS in data.js ────────────────────────
function updateDataJs(src, mapContent) {
  const startMarker = 'const INCARNON_REQUIREMENTS = new Map([';
  const startIdx = src.indexOf(startMarker);

  if (startIdx !== -1) {
    // Replace existing block (bracket-depth matching)
    let depth = 0, endIdx = -1;
    for (let i = startIdx + startMarker.length - 1; i < src.length; i++) {
      if (src[i] === '[') depth++;
      if (src[i] === ']') {
        depth--;
        if (depth === 0) {
          const after = src.slice(i, i + 3);
          if (after === ']);') { endIdx = i + 3; break; }
        }
      }
    }
    if (endIdx === -1) throw new Error('Could not find closing ]); for INCARNON_REQUIREMENTS');
    return src.slice(0, startIdx) + mapContent.trimEnd() + src.slice(endIdx);
  }

  // Insert before BLUEPRINTS block
  const insertBefore = 'const BLUEPRINTS = new Map([';
  const insertIdx = src.indexOf(insertBefore);
  if (insertIdx === -1) throw new Error('Could not find insertion point (const BLUEPRINTS) in data.js');
  return src.slice(0, insertIdx) + mapContent + '\n' + src.slice(insertIdx);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const single  = args.includes('--item') ? args[args.indexOf('--item') + 1] : null;

  const src = fs.readFileSync(DATA_JS, 'utf-8');
  const allIncarnons = extractIncarnons(src);
  const targets = single ? [single] : allIncarnons;
  console.log(`Processing ${targets.length} Incarnon Genesis item${targets.length === 1 ? '' : 's'}`);

  // Load existing JSON if present (to preserve previously scraped data)
  let existing = {};
  if (!single && fs.existsSync(OUT_JSON)) {
    existing = JSON.parse(fs.readFileSync(OUT_JSON, 'utf-8'));
  }

  let ok = 0, missing = 0, errors = 0;

  for (const name of targets) {
    process.stdout.write(`  ${name}... `);
    try {
      const wikitext = await fetchWikitext(name);
      if (!wikitext) {
        console.log('page not found');
        existing[name] = null;
        missing++;
      } else {
        const reqs = parseRequirements(wikitext);
        if (reqs) {
          const summary = reqs.map(([r, n]) => `${n}× ${r}`).join(', ');
          console.log(summary);
          existing[name] = reqs;
          ok++;
        } else {
          console.log('requirements line not found');
          existing[name] = null;
          missing++;
        }
      }
    } catch (e) {
      console.log('ERROR: ' + e.message);
      errors++;
    }
    if (targets.length > 1) await sleep(500);
  }

  console.log(`\nResults: ${ok} ok · ${missing} missing · ${errors} errors`);

  if (dryRun) { console.log('Dry run — no files written.'); return; }

  fs.writeFileSync(OUT_JSON, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`Saved → ${OUT_JSON}`);

  const mapContent = buildMapContent(existing);
  const updated = updateDataJs(src, mapContent);
  fs.writeFileSync(DATA_JS, updated, 'utf-8');
  console.log(`Updated → ${DATA_JS}`);
  console.log('Done.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
