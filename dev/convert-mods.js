// dev/convert-mods.js — converts api-mods.json → data-mods-new.js
// Usage: node dev/convert-mods.js
// Output: data-mods-new.js (rename to data-mods.js when ready)
'use strict';

const fs   = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, '..', 'api-mods.json');
const OUTPUT = path.join(__dirname, '..', 'data-mods-new.js');

// ── Load ────────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
console.log(`Loaded ${raw.length} mods from api-mods.json`);

// ── Helpers ─────────────────────────────────────────────────────────
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// Strip in-game color tags, e.g. <DT_PUNCTURE_COLOR>
function stripTags(s) {
  return s ? s.replace(/<[^>]+>/g, '') : s;
}

function extractLevelStats(m) {
  if (m.levelStats && m.levelStats.length > 0) {
    return m.levelStats.map(l => (l.stats || []).map(stripTags));
  }
  if (m.description) {
    return [[stripTags(m.description)]];
  }
  return [];
}

function extractDrops(m) {
  if (!m.drops || m.drops.length === 0) return [];
  const seen = new Set();
  return m.drops.reduce((acc, d) => {
    if (d.location && !seen.has(d.location)) {
      seen.add(d.location);
      acc.push(d.location);
    }
    return acc;
  }, []);
}

// ── Filter ───────────────────────────────────────────────────────────
const EXCLUDE_TYPES = new Set([
  'Focus Way',
  'Transmutation Mod',
  'Arch-Gun Riven Mod',
  'Companion Weapon Riven Mod',
  'Kitgun Riven Mod',
  'Melee Riven Mod',
  'Pistol Riven Mod',
  'Rifle Riven Mod',
  'Shotgun Riven Mod',
  'Zaw Riven Mod',
]);

// Step 1: filter by type and exclude junk names
const EXCLUDE_NAMES = new Set(['Unfused Artifact']);
const step1 = raw.filter(m =>
  !EXCLUDE_TYPES.has(m.type) &&
  !EXCLUDE_NAMES.has(m.name) &&
  !/\/(Beginner|Intermediate|Expert|Tau)\//i.test(m.uniqueName || '')
);
console.log(`After type/tier filter: ${step1.length} mods (removed ${raw.length - step1.length})`);

// Step 2: deduplicate by name — keep the entry with the highest maxRank; ties → first occurrence
const seen = new Map(); // name → best entry so far
for (const m of step1) {
  const existing = seen.get(m.name);
  if (!existing || (m.fusionLimit ?? 0) > (existing.fusionLimit ?? 0)) {
    seen.set(m.name, m);
  }
}
const filtered = [...seen.values()];
console.log(`After deduplication: ${filtered.length} mods (removed ${step1.length - filtered.length} duplicates)`);

// ── Weapon exilus overrides ───────────────────────────────────────────
// The API does not mark weapon exilus mods correctly; enforce here.
const WEAPON_EXILUS = new Set([
  // PRIMARY
  'Ammo Drum', 'Shell Compression',
  'Rifle Ammo Mutation', 'Primed Rifle Ammo Mutation',
  'Shotgun Ammo Mutation', 'Primed Shotgun Ammo Mutation',
  'Arrow Mutation', 'Sniper Ammo Mutation', 'Vigilante Supplies',
  'Eagle Eye', 'Broad Eye', 'Overview', 'Aero Periphery', 'Ambush Optics',
  'Agile Aim', 'Snap Shot', 'Aerial Ace',
  'Gun Glide', 'Double-Barrel Drift', 'Stabilizer', 'Vile Precision',
  'Guided Ordnance', 'Narrow Barrel',
  'Hush', 'Silent Battery',
  'Twitch', 'Soft Hands',
  'Lock and Load', 'Tactical Reload',
  'Terminal Velocity', 'Fatal Acceleration', 'Galvanized Acceleration',
  'Mending Shot', 'Bhisaj-Bal', 'Sinister Reach',
  // SECONDARY
  'Trick Mag',
  'Pistol Ammo Mutation', 'Primed Pistol Ammo Mutation',
  'Air Recon', 'Hawk Eye',
  'Spry Sights',
  'Strafing Slide', 'Steady Hands',
  'Targeting Subsystem',
  'Suppress',
  'Reflex Draw',
  'Eject Magazine',
  'Lethal Momentum',
  'Energizing Shot', 'Ruinous Extension',
  'Fass Canticle', 'Jahu Canticle', 'Khra Canticle', 'Lohk Canticle',
  // MELEE
  'Dispatch Overdrive', 'Electromagnetic Shielding', 'Focused Defense',
  'Guardian Derision', 'Parry', 'Whirlwind',
  "Condition's Perfection", "Discipline's Merit", "Dreamer's Wrath",
  "Master's Edge", "Mentor's Legacy", "Opportunity's Reach",
]);

// ── Transform ────────────────────────────────────────────────────────
const mods = filtered.map(m => ({
  name:       m.name,
  category:   m.type || '',         // JSON "type" → app "category"
  drops:      extractDrops(m),      // JSON "drops[].location" → app "acquisition"
  maxRank:    m.fusionLimit ?? 0,   // JSON "fusionLimit" → app "maxRank"
  polarity:   cap(m.polarity || ''),
  rarity:     m.rarity || '',
  isExilus:   m.isExilus || WEAPON_EXILUS.has(m.name) || false,
  tradable:   m.tradable  || false,
  compatName: m.compatName || '',   // specific warframe/weapon this mod is for
  isAugment:  m.isAugment || false,
  baseDrain:  m.baseDrain ?? 0,
  levelStats: extractLevelStats(m), // per-rank stat strings, replacing MOD_DESC
}));

// ── Serialize ─────────────────────────────────────────────────────────
// One mod per line, with inline arrays for compact output
function serializeMod(m) {
  return [
    '  {',
    `    name:       ${JSON.stringify(m.name)},`,
    `    category:   ${JSON.stringify(m.category)},`,
    `    drops:      ${JSON.stringify(m.drops)},`,
    `    maxRank:    ${m.maxRank},`,
    `    polarity:   ${JSON.stringify(m.polarity)},`,
    `    rarity:     ${JSON.stringify(m.rarity)},`,
    `    isExilus:   ${m.isExilus},`,
    `    tradable:   ${m.tradable},`,
    `    compatName: ${JSON.stringify(m.compatName)},`,
    `    isAugment:  ${m.isAugment},`,
    `    baseDrain:  ${m.baseDrain},`,
    `    levelStats: ${JSON.stringify(m.levelStats)},`,
    '  }',
  ].join('\n');
}

const body   = mods.map(serializeMod).join(',\n');
const output = `// Generated by dev/convert-mods.js from api-mods.json — do not edit by hand\nconst MODS = [\n${body}\n];\n`;

fs.writeFileSync(OUTPUT, output, 'utf8');

const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.log(`Written ${mods.length} mods → ${path.basename(OUTPUT)} (${kb} KB)`);

// ── Summary ──────────────────────────────────────────────────────────
const noDrops    = mods.filter(m => m.drops.length === 0).length;
const noStats    = mods.filter(m => m.levelStats.length === 0).length;
const augments   = mods.filter(m => m.isAugment).length;
const exilus     = mods.filter(m => m.isExilus).length;
const tradable   = mods.filter(m => m.tradable).length;
console.log(`  Augments: ${augments}, Exilus: ${exilus}, Tradable: ${tradable}`);
console.log(`  No drop data: ${noDrops}, No stat data: ${noStats}`);
