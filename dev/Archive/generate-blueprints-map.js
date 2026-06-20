// generate-blueprints-map.js
// Reads blueprints.json (from extract-blueprints.js) and supplementary-blueprints.json
// (from scrape-wiki-blueprints.js), merges them, and regenerates both
// dev/blueprints-map.js and the BLUEPRINTS const inside data.js.
//
// Usage:
//   node dev/generate-blueprints-map.js             # update data.js
//   node dev/generate-blueprints-map.js --map-only  # write blueprints-map.js only
//   node dev/generate-blueprints-map.js --dry-run   # print stats, no writes

'use strict';

const fs   = require('fs');
const path = require('path');

const BLUEPRINTS_JSON = path.join(__dirname, 'blueprints.json');
const SUPP_JSON       = path.join(__dirname, 'supplementary-blueprints.json');
const MAP_JS          = path.join(__dirname, 'blueprints-map.js');
const DATA_JS         = path.join(__dirname, '..', 'data.js');

// ── Convert blueprints.json entry to compact map tuple ────────────────────────
// Output: [credits, time_s, [[name, count, type, subCost?], ...]]
// SubCost: [credits, time_s, [[name, count], ...]]
function entryToTuple(entry) {
  const credits = entry.Credits || 0;
  const time    = entry.Time    || 0;
  const parts   = (entry.Parts || []).map(p => {
    const base = [p.Name, p.Count, p.Type || 'Resource'];
    if (p.Cost) {
      const subCredits = p.Cost.Credits || 0;
      const subTime    = p.Cost.Time    || 0;
      const subParts   = (p.Cost.Parts || []).map(sp => [sp.Name, sp.Count]);
      base.push([subCredits, subTime, subParts]);
    }
    return base;
  });
  return [credits, time, parts];
}

// ── Compact serialiser ────────────────────────────────────────────────────────
// Produces a single-line JS representation of the tuple, e.g.:
//   ["Carrier",[15000,86400,[["Alloy Plate",1000,"Resource"],...]]]
function serializeTuple(name, tuple) {
  return `  ${JSON.stringify([name, tuple])},`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args     = process.argv.slice(2);
  const mapOnly  = args.includes('--map-only');
  const dryRun   = args.includes('--dry-run');

  // Load and merge data sources
  const main_   = JSON.parse(fs.readFileSync(BLUEPRINTS_JSON, 'utf-8'));
  let supp = {};
  if (fs.existsSync(SUPP_JSON)) {
    const raw = JSON.parse(fs.readFileSync(SUPP_JSON, 'utf-8'));
    // Only include entries with actual data (not null = "checked, no blueprint")
    supp = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
  }

  const combined = Object.assign({}, main_, supp);
  const names    = Object.keys(combined).sort();

  console.log(`Main: ${Object.keys(main_).length}, Supplementary: ${Object.keys(supp).length}, Total: ${names.length}`);

  if (dryRun) {
    console.log('Dry run — no files written.');
    console.log('Items from supplementary that would be added:');
    Object.keys(supp).forEach(n => console.log(' ', n));
    return;
  }

  // Build map lines
  const lines = names.map(n => serializeTuple(n, entryToTuple(combined[n])));
  const mapContent = `const BLUEPRINTS = new Map([\n${lines.join('\n')}\n]);\n`;

  // Write blueprints-map.js
  fs.writeFileSync(MAP_JS, mapContent, 'utf-8');
  console.log(`Saved → ${MAP_JS} (${names.length} entries)`);

  if (mapOnly) return;

  // Update BLUEPRINTS block in data.js
  const src = fs.readFileSync(DATA_JS, 'utf-8');

  const startMarker = 'const BLUEPRINTS = new Map([';
  const endMarker   = ']);';

  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Could not find "const BLUEPRINTS = new Map([" in data.js');
  }

  // Find the matching closing ]); by tracking bracket depth
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx + startMarker.length - 1; i < src.length; i++) {
    if (src[i] === '[') depth++;
    if (src[i] === ']') {
      depth--;
      if (depth === 0) {
        // Check that this is followed by );
        const after = src.slice(i, i + 3);
        if (after === ']);') {
          endIdx = i + 3; // include ]);
          break;
        }
      }
    }
  }

  if (endIdx === -1) {
    throw new Error('Could not find closing ]); for BLUEPRINTS in data.js');
  }

  const updated = src.slice(0, startIdx) + mapContent.trimEnd() + src.slice(endIdx);
  fs.writeFileSync(DATA_JS, updated, 'utf-8');
  console.log(`Updated → ${DATA_JS}`);
}

main();
