// Generates data-arcanes-enriched.js by merging data-arcanes.js with arcanes-wfcd.json
// Run: node dev/gen-arcanes-enriched.js

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const wfcd = JSON.parse(readFileSync(path.join(root, 'arcanes-wfcd.json'), 'utf8').replace(/^﻿/, ''));

// Build lookup by name
const byName = {};
for (const a of wfcd) {
  byName[a.name] = a;
}

// Build ARCANE_LEVEL_STATS: name -> array of string[] (one per rank)
const levelStats = {};
for (const [name, a] of Object.entries(byName)) {
  if (a.levelStats?.length) {
    levelStats[name] = a.levelStats.map(r => r.stats);
  }
}

// Build ARCANE_DROPS: name -> array of { location, chance, rarity }
const drops = {};
for (const [name, a] of Object.entries(byName)) {
  if (a.drops?.length) {
    drops[name] = a.drops.map(d => ({
      location: d.location,
      chance: d.chance,
      rarity: d.rarity,
    }));
  }
}

function jsObj(obj, indent = 2) {
  const pad = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    lines.push(`${pad}'${k.replace(/'/g, "\\'")}': ${JSON.stringify(v)},`);
  }
  return `{\n${lines.join('\n')}\n}`;
}

const existing = readFileSync(path.join(root, 'data-arcanes.js'), 'utf8').trimEnd();

const out = `${existing}

// ── ARCANE_LEVEL_STATS ───────────────────────────────────────────
// Per-rank stat strings from WFCD. Index = rank. Each entry is an array of
// strings (most arcanes have one string; some add bonus lines at higher ranks).
const ARCANE_LEVEL_STATS = ${jsObj(levelStats)};

// ── ARCANE_DROPS ─────────────────────────────────────────────────
// Drop locations from WFCD. Each entry: { location, chance (%), rarity }
const ARCANE_DROPS = ${jsObj(drops)};
`;

writeFileSync(path.join(root, 'data-arcanes-enriched.js'), out, 'utf8');

const ls = Object.keys(levelStats).length;
const dr = Object.keys(drops).length;
console.log(`Done — ${ls} arcanes with levelStats, ${dr} with drops`);
