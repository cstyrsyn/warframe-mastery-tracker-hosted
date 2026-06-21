// dev/update-mod-drains.js
// Fetches baseDrain for each mod from the Warframe Stats API and writes it as
// the 12th field (index 11) of every entry in the MODS array in data-mods.js.
//
// Usage:
//   node dev/update-mod-drains.js            # update file
//   node dev/update-mod-drains.js --dry-run  # report only, don't write

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_FILE = path.resolve(__dirname, '..', 'data', 'data-mods.js');
const API_URL   = 'https://api.warframestat.us/mods';
const DRY_RUN   = process.argv.includes('--dry-run');

// ── HTTP ──────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Serialiser ────────────────────────────────────────────────────────────────
// Converts a JS value back to a single-quoted JS literal, matching the style
// already used in data-mods.js.
function toJs(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number')  return String(v);
  if (typeof v === 'string')  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(v))       return `[${v.map(toJs).join(',')}]`;
  return String(v);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Fetch API
  console.log(`Fetching ${API_URL} …`);
  const apiMods = await httpGet(API_URL);
  if (!Array.isArray(apiMods)) throw new Error('Unexpected API response shape');

  const drainMap = new Map();
  for (const m of apiMods) {
    if (m.name && typeof m.baseDrain === 'number') {
      drainMap.set(m.name, m.baseDrain);
    }
  }
  console.log(`API returned ${apiMods.length} mods, ${drainMap.size} with baseDrain`);

  // 2. Process data-mods.js line by line
  const src   = fs.readFileSync(DATA_FILE, 'utf8');
  const lines = src.split('\n');

  let updated = 0, already = 0, notFound = 0;
  const notFoundNames = [];

  const outLines = lines.map(line => {
    const trimmed = line.trim();

    // MODS entries start with ['  — MOD_DESC entries start with '  (plain string key)
    if (!trimmed.startsWith('[\'') && !trimmed.startsWith('["')) return line;

    const trailingComma = trimmed.endsWith(',');
    const code = trailingComma ? trimmed.slice(0, -1) : trimmed;

    let entry;
    try { entry = eval(code); } catch { return line; } // not a parseable array — skip

    // Must be an array with at least 11 fields and a string name (filters out nested arrays)
    if (!Array.isArray(entry) || entry.length < 11 || typeof entry[0] !== 'string') return line;

    const name  = entry[0];
    const drain = drainMap.get(name);

    if (drain === undefined) {
      notFound++;
      notFoundNames.push(name);
      return line; // leave unchanged; will be 0 by default in app.js
    }

    // Already up to date
    if (entry.length >= 12 && entry[11] === drain) {
      already++;
      return line;
    }

    entry[11] = drain;
    updated++;
    return '  ' + toJs(entry) + (trailingComma ? ',' : '');
  });

  // 3. Update the header comment
  let newSrc = outLines.join('\n').replace(
    '// [name, category, acquisition, maxRank, polarity, rarity, exilus, tradable, type, subType, use]',
    '// [name, category, acquisition, maxRank, polarity, rarity, exilus, tradable, type, subType, use, baseDrain]'
  );

  // 4. Write (or report)
  console.log(`\nResults:`);
  console.log(`  Updated:          ${updated}`);
  console.log(`  Already correct:  ${already}`);
  console.log(`  Not found in API: ${notFound}`);

  if (notFoundNames.length) {
    console.log(`\nMods not found in API (baseDrain will remain unset):`);
    notFoundNames.forEach(n => console.log(`  - ${n}`));
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No file written.');
    return;
  }

  fs.writeFileSync(DATA_FILE, newSrc, 'utf8');
  console.log(`\nWrote ${DATA_FILE}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
