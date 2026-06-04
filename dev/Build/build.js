// build.js
// Reads Source/*.csv files and appends any new items to data.js.
// Usage:  node build.js
//         node build.js --dry-run   (preview only, no file changes)
//
// Workflow:
//   1. Add new items to the relevant CSV in Source/
//   2. Run: node build.js
//   3. Refresh warframe-mastery-tracker.html in the browser

'use strict';
const fs   = require('fs');
const path = require('path');
const { parseCSVLine, jsD } = require('../lib/csv.js');

const DATA_JS    = path.join(__dirname, '..', '..', 'data.js');
const SOURCE_DIR = path.join(__dirname, '..', 'Source');
const DRY_RUN    = process.argv.includes('--dry-run');

// ── FILE CONFIG ────────────────────────────────────────────────────
// cols: column index for each field (0-based, after the header row)
// Fields not present in a CSV are omitted from cols (defaults apply).
const FILE_CONFIG = [
  {
    file: 'warframes.csv',
    varName: 'WARFRAMES',
    xpPL: 200,
    defaultMaxRank: 30,
    // CSV cols: Name, Category, Method to Obtain, Circuit Available
    cols: { name: 0, cat: 1, obtain: 2 },
  },
  {
    file: 'companions.csv',
    varName: 'COMPANIONS',
    xpPL: 200,
    defaultMaxRank: 30,
    // CSV cols: Name, Category, Method to Obtain, Tradable, Max Rank
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, maxRank: 4 },
  },
  {
    file: 'vehicles.csv',
    varName: 'VEHICLES',
    xpPL: 200,
    defaultMaxRank: 30,
    // CSV cols: Name, Category, Method to Obtain, Tradable, Max Rank
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, maxRank: 4 },
  },
  {
    file: 'weapons_primary.csv',
    varName: 'PRIMARY',
    xpPL: 100,
    defaultMaxRank: 30,
    // CSV cols: Name, Category, Method to Obtain, Tradable, Component for, Max Rank
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, compFor: 4, maxRank: 5 },
  },
  {
    file: 'weapons_secondary.csv',
    varName: 'SECONDARY',
    xpPL: 100,
    defaultMaxRank: 30,
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, compFor: 4, maxRank: 5 },
  },
  {
    file: 'weapons_melee.csv',
    varName: 'MELEE',
    xpPL: 100,
    defaultMaxRank: 30,
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, compFor: 4, maxRank: 5 },
  },
  {
    file: 'weapons_vehicles.csv',
    varName: 'ARCH_WEAPONS',
    xpPL: 100,
    defaultMaxRank: 30,
    // CSV cols: Name, Category, Method to Obtain, Tradable, Max Rank
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, maxRank: 4 },
    catMap: { 'Arch-Guns': 'Arch-Gun', 'Prime': 'Prime Arch-Gun' },
  },
  {
    file: 'weapons_companions.csv',
    varName: 'COMP_WEAPONS',
    xpPL: 100,
    defaultMaxRank: 30,
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, maxRank: 4 },
    catMap: { 'Robotic Weapons': 'Robotic', 'Prime Robotic Weapons': 'Prime Robotic' },
  },
  {
    file: 'weapons_amps.csv',
    varName: 'AMPS',
    xpPL: 100,
    defaultMaxRank: 30,
    cols: { name: 0, cat: 1, obtain: 2, tradable: 3, maxRank: 4 },
  },
  {
    file: 'intrinsics.csv',
    varName: 'INTRINSICS',
    xpPL: 1500,
    defaultMaxRank: 10,
    // CSV cols: Name, Category, Method to Obtain, Max Rank
    cols: { name: 0, cat: 1, obtain: 2, maxRank: 3 },
  },
];

// ── CSV PARSING ────────────────────────────────────────────────────
function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).slice(1); // drop header
  const rows = [];
  for (const line of lines) {
    if (!line.trim() || /^,+$/.test(line)) continue; // skip blank / all-comma rows
    const fields = parseCSVLine(line);
    if (!fields[0] || !fields[0].trim()) continue;
    rows.push(fields);
  }
  return rows;
}

// ── DATA.JS HELPERS ────────────────────────────────────────────────
// Returns the Set of item names already present in a given const array.
function getExistingNames(dataJS, varName) {
  const marker = `const ${varName} = [`;
  const start = dataJS.indexOf(marker);
  if (start === -1) return new Set();
  // Grab everything up to the closing ]; of this section
  const rest = dataJS.slice(start);
  const endIdx = rest.search(/\n\];/);
  const section = endIdx === -1 ? rest : rest.slice(0, endIdx);
  const names = new Set();
  const re = /^\s*\["([^"]+)"/gm;
  let m;
  while ((m = re.exec(section)) !== null) names.add(m[1]);
  return names;
}

// Inserts new lines just before the closing ]; of the target array section.
function insertIntoSection(dataJS, varName, newLines) {
  const marker = `const ${varName} = [`;
  const start = dataJS.indexOf(marker);
  if (start === -1) throw new Error(`Section "${varName}" not found in data.js`);
  const rest = dataJS.slice(start);
  const endMatch = rest.match(/\n\];/);
  if (!endMatch) throw new Error(`Could not find end of "${varName}" section`);
  const insertPos = start + endMatch.index + 1; // just before "];"
  return dataJS.slice(0, insertPos) + newLines.join('\n') + '\n' + dataJS.slice(insertPos);
}

// ── JS LINE GENERATION ─────────────────────────────────────────────
function makeItemLine(row, config) {
  const { cols, defaultMaxRank, catMap } = config;
  const name     = (row[cols.name]    || '').trim();
  const rawCat   = (row[cols.cat]     || '').trim();
  const cat      = catMap?.[rawCat] ?? rawCat;
  const obtain   = (row[cols.obtain]  || '').trim();
  const maxRank  = cols.maxRank  !== undefined ? (parseInt(row[cols.maxRank])  || defaultMaxRank) : defaultMaxRank;
  const tradable = cols.tradable !== undefined ? (row[cols.tradable]?.toLowerCase() === 'yes' ? 1 : 0) : 0;
  const compFor  = cols.compFor  !== undefined ? (row[cols.compFor]  || '').trim() : '';

  const parts = [jsD(name), jsD(cat), jsD(obtain), maxRank];
  if (tradable || compFor) parts.push(tradable);
  if (compFor)             parts.push(jsD(compFor));

  return `  [${parts.join(',')}],`;
}

// ── MAIN ───────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(DATA_JS)) {
    console.error('ERROR: data.js not found at', DATA_JS);
    process.exit(1);
  }

  let dataJS = fs.readFileSync(DATA_JS, 'utf-8');
  let totalAdded = 0;

  for (const config of FILE_CONFIG) {
    const csvPath = path.join(SOURCE_DIR, config.file);
    if (!fs.existsSync(csvPath)) {
      console.log(`SKIP  ${config.file} (not found)`);
      continue;
    }

    const rows     = parseCSV(csvPath);
    const existing = getExistingNames(dataJS, config.varName);
    const newLines = [];

    for (const row of rows) {
      const name = (row[config.cols.name] || '').trim();
      if (!name) continue;
      if (existing.has(name)) continue; // already in data.js
      newLines.push(makeItemLine(row, config));
      console.log(`  ADD  [${config.varName}]  ${name}`);
      totalAdded++;
    }

    if (newLines.length > 0 && !DRY_RUN) {
      dataJS = insertIntoSection(dataJS, config.varName, newLines);
    }
  }

  if (totalAdded === 0) {
    console.log('No new items found — data.js is up to date.');
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run: ${totalAdded} item(s) would be added. Run without --dry-run to apply.`);
  } else {
    fs.writeFileSync(DATA_JS, dataJS, 'utf-8');
    console.log(`\nDone — added ${totalAdded} item(s) to data.js.`);
  }
}

main();
