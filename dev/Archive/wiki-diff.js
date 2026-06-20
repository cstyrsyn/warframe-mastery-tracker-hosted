// wiki-diff.js — compare wiki module data against data.js and output pre-filled CSVs
// for any new items. CSVs match the template format consumed by update.js.
//
// Usage:
//   node dev/wiki-diff.js                      # check all sections
//   node dev/wiki-diff.js --section primary    # check one section
//   node dev/wiki-diff.js --no-cache           # force re-fetch from wiki
//
// Output: dev/wiki-diff/<section>.csv  (pre-filled where wiki data is available;
//         blank where manual entry is required e.g. "Method to Obtain")
//
// Sections: warframes, companions, vehicles, primary, secondary, melee,
//           archWeapons, compWeapons, amps, mods, arcanes
'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ── CLI ────────────────────────────────────────────────────────────────────────
const NO_CACHE  = process.argv.includes('--no-cache');
const secArgI   = process.argv.indexOf('--section');
const ONLY_SECS = secArgI !== -1
  ? process.argv.slice(secArgI + 1).filter(a => !a.startsWith('--'))
  : [];

// ── PATHS ──────────────────────────────────────────────────────────────────────
const ROOT      = path.join(__dirname, '..');
const DATA_JS   = path.join(ROOT, 'data.js');
const BP_JSON   = path.join(__dirname, 'blueprints.json');
const CACHE_DIR = path.join(__dirname, 'wiki-cache');
const OUT_DIR   = path.join(__dirname, 'wiki-diff');

// ── OUTPUT ─────────────────────────────────────────────────────────────────────
const TTY = process.stdout.isTTY;
const C = { reset:'\x1b[0m', red:'\x1b[31m', yellow:'\x1b[33m', green:'\x1b[32m', cyan:'\x1b[36m', bold:'\x1b[1m', dim:'\x1b[2m' };
const col  = (k, s) => (TTY ? C[k] : '') + s + (TTY ? C.reset : '');
const OK   = s => col('green',  '  ✓  ') + s;
const WARN = s => col('yellow', '  ⚠  ') + s;
const INFO = s => col('dim',    '  ·  ') + s;
const HDR  = s => '\n' + col('bold', col('cyan', '── ' + s + ' '));

// ── HTTP ───────────────────────────────────────────────────────────────────────
function fetchRaw(urlStr) {
  return new Promise((resolve, reject) => {
    function doGet(u, remaining) {
      if (remaining < 0) { reject(new Error('Too many redirects')); return; }
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try { doGet(new URL(res.headers.location, u).href, remaining - 1); } catch(e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    }
    doGet(urlStr, 10);
  });
}

async function cachedFetch(cacheKey, urlStr) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheKey + '.lua');
  if (!NO_CACHE && fs.existsSync(cachePath)) {
    console.log(INFO(`  cache hit: ${cacheKey}`));
    return fs.readFileSync(cachePath, 'utf-8');
  }
  console.log(INFO(`  fetching: ${urlStr}`));
  const data = await fetchRaw(urlStr);
  fs.writeFileSync(cachePath, data, 'utf-8');
  return data;
}

// ── LUA PARSING ────────────────────────────────────────────────────────────────
// Extract the content between the outermost braces starting at fromIdx (the '{').
function extractBlock(src, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i < src.length; i++) {
    // Skip Lua string literals so braces inside them don't count
    if (src[i] === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (src[i] === "'") {
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(fromIdx + 1, i);
    }
  }
  return src.slice(fromIdx + 1);
}

// Navigate into a named sub-table within the Lua source.
// tableKey can be a bare identifier or a quoted string key.
function navigateToSubTable(src, tableKey) {
  const escaped = tableKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:\\[["']${escaped}["']\\]|\\b${escaped}\\b)\\s*=\\s*\\{`, ''
  );
  const m = re.exec(src);
  if (!m) return null;
  const openBrace = m.index + m[0].length - 1;
  return extractBlock(src, openBrace);
}

// Extract all top-level named entries from a Lua table block.
// Uses linear scanning with depth tracking so nested key = { ... } patterns
// inside an entry's block are never mistaken for top-level entries.
// Returns Map<name, blockContent> where blockContent is everything inside that entry's {}.
function extractEntries(tableBlock) {
  const entries = new Map();
  const src = tableBlock;
  const n   = src.length;
  let i = 0;

  function skipWS()    { while (i < n && /\s/.test(src[i])) i++; }
  function skipLine()  { while (i < n && src[i] !== '\n') i++; }
  function skipStr(q)  { i++; while (i < n) { if (src[i] === '\\') i++; if (src[i] === q) { i++; return; } i++; } }
  // Skip [[...]] or [==[...]==] style long strings
  function skipLong()  {
    i++; let eq = 0;
    while (i < n && src[i] === '=') { eq++; i++; }
    if (src[i] !== '[') return;
    i++;
    const close = ']' + '='.repeat(eq) + ']';
    const end = src.indexOf(close, i);
    i = end !== -1 ? end + close.length : n;
  }

  while (i < n) {
    skipWS();
    if (i >= n) break;

    // Line comment
    if (src[i] === '-' && src[i+1] === '-') { i += 2; skipLine(); continue; }
    // Commas / semicolons between entries
    if (src[i] === ',' || src[i] === ';')   { i++; continue; }
    // End of outer table
    if (src[i] === '}')                      { break; }

    // Extract key
    let key = null;
    const start = i;

    if (src[i] === '[' && (src[i+1] === '"' || src[i+1] === "'")) {
      // ["quoted key"]
      const q = src[i+1];
      i += 2;
      const ks = i;
      while (i < n && !(src[i] === q && src[i+1] === ']')) i++;
      key = src.slice(ks, i);
      i += 2;
    } else if (/[A-Za-z_]/.test(src[i])) {
      // Bare Lua identifier (letters, digits, underscores only — no spaces)
      const ks = i;
      while (i < n && /\w/.test(src[i])) i++;
      key = src.slice(ks, i);
    } else {
      // Unknown token — skip strings/long-strings/other so we don't desync
      if (src[i] === '"') skipStr('"');
      else if (src[i] === "'") skipStr("'");
      else if (src[i] === '[' && (src[i+1] === '[' || src[i+1] === '=')) skipLong();
      else i++;
      continue;
    }

    // Expect whitespace then '='
    while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
    if (i >= n || src[i] !== '=') { i = start + 1; continue; }
    i++; // skip '='

    // Expect whitespace then value
    while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
    if (i >= n) break;

    if (src[i] === '{') {
      const block = extractBlock(src, i);
      entries.set(key, block);
      i = i + 1 + block.length + 1; // past closing '}'
    } else {
      // Scalar value — skip to end of statement so we stay in sync
      while (i < n && src[i] !== '\n' && src[i] !== ',') {
        if (src[i] === '"')  { skipStr('"');  continue; }
        if (src[i] === "'")  { skipStr("'");  continue; }
        if (src[i] === '[' && (src[i+1] === '[' || src[i+1] === '=')) { skipLong(); continue; }
        i++;
      }
    }
  }

  return entries;
}

// ── FIELD EXTRACTION ───────────────────────────────────────────────────────────
function getStr(block, field) {
  const re = new RegExp(`\\b${field}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(block);
  return m ? m[1] : null;
}

function getNum(block, field) {
  const re = new RegExp(`\\b${field}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = re.exec(block);
  return m ? m[1] : null;
}

function getBool(block, field) {
  const re = new RegExp(`\\b${field}\\s*=\\s*(true|false)`);
  const m = re.exec(block);
  return m ? m[1] === 'true' : false;
}

// Returns array of strings from a Lua array value e.g. Traits = { "Prime", "Vaulted" }
function getArray(block, field) {
  const re = new RegExp(`\\b${field}\\s*=\\s*\\{([^}]*?)\\}`);
  const m = re.exec(block);
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]);
}

// ── DATA.JS HELPERS ────────────────────────────────────────────────────────────
function getExistingNames(dataJS, varName) {
  const re = new RegExp(`const ${varName}\\s*=\\s*[\\[{]`);
  const m  = re.exec(dataJS);
  if (!m) return new Set();
  const rest    = dataJS.slice(m.index);
  const endIdx  = rest.search(/\n[}\]];/);
  const section = endIdx === -1 ? rest : rest.slice(0, endIdx);
  const names   = new Set();
  // Double-quoted entries
  for (const x of section.matchAll(/^\s*\["([^"]+)"/gm))  names.add(x[1]);
  // Single-quoted entries — unescape \' so "Amar\'s Anguish" → "Amar's Anguish"
  for (const x of section.matchAll(/^\s*\['((?:[^'\\]|\\.)*)'/gm))
    names.add(x[1].replace(/\\'/g, "'"));
  return names;
}

// ── COMPFOR MAP ────────────────────────────────────────────────────────────────
function buildCompForMap() {
  if (!fs.existsSync(BP_JSON)) return new Map();
  const bp = JSON.parse(fs.readFileSync(BP_JSON, 'utf-8'));
  const map = new Map(); // ingredient → [parent, ...]
  for (const [parent, entry] of Object.entries(bp)) {
    for (const part of (entry.Parts || [])) {
      if (part.Type === 'Weapon') {
        const ing = part.Name;
        if (!map.has(ing)) map.set(ing, []);
        const parents = map.get(ing);
        if (!parents.includes(parent)) parents.push(parent);
      }
    }
  }
  return map;
}

// ── CATEGORY DERIVATION ────────────────────────────────────────────────────────
const CLASS_TO_PRIMARY = {
  'Rifle': 'Rifles', 'Shotgun': 'Shotguns', 'Sniper Rifle': 'Snipers',
  'Bow': 'Bows', 'Crossbow': 'Bows', 'Launcher': 'Launchers',
  'Speargun': 'Spearguns', 'Arm-Cannon': 'Rifles',
};
const CLASS_TO_SECONDARY = {
  'Pistol': 'Single', 'Dual Pistols': 'Dual',
  'Shotgun Sidearm': 'Single', 'Dual Shotguns': 'Dual',
  'Thrown': 'Thrown', 'Tome': 'Single', 'Crossbow': 'Single',
};
const CLASS_TO_MELEE = {
  'Sword': 'Swords/Nikanas', 'Nikana': 'Swords/Nikanas',
  'Dual Nikanas': 'Swords/Nikanas', 'Two-Handed Nikana': 'Swords/Nikanas',
  'Dagger': 'Daggers', 'Dual Daggers': 'Dual Daggers',
  'Dual Swords': 'Dual Swords', 'Heavy Blade': 'Heavy Blades',
  'Polearm': 'Polearm/Staff', 'Staff': 'Polearm/Staff',
  'Hammer': 'Hammer', 'Fist': 'Fist/Sparring', 'Sparring': 'Fist/Sparring',
  'Glaive': 'Glaive', 'Gunblade': 'Gunblade',
  'Whip': 'Whip/B. Whip', 'Blade and Whip': 'Whip/B. Whip',
  'Machete': 'Machetes', 'Rapier': 'Rapier',
  'Scythe': 'Scythe', 'Heavy Scythe': 'Heavy Scythes',
  'Claws': 'Claws', 'Tonfa': 'Tonfa/Nunchaku', 'Nunchaku': 'Tonfa/Nunchaku',
  'Warfan': 'Warfans', 'Assault Saw': 'Assault Saws',
  'Sword and Shield': 'Sword-Shield', 'Bayonet': 'Swords/Nikanas',
};
const CLASS_TO_ARCHWING = {
  'Archgun': 'Arch-Guns', 'Rifle': 'Arch-Guns', 'Shotgun': 'Arch-Guns',
  'Launcher': 'Arch-Guns', 'Dual Pistols': 'Arch-Guns',
  'Archmelee': 'Arch-Melee',
};
const TYPE_TO_COMPANION = {
  'Kavat': 'Kavats', 'Kubrow': 'Kubrows', 'Sentinel': 'Sentinels',
  'Hound': 'Hound', 'MOA': 'Moas', 'Predasite': 'Predasites',
  'Vulpaphyla': 'Vulpaphyla',
};

function weaponNamePrefix(name) {
  if (/^Kuva /.test(name))   return 'Kuva';
  if (/^Tenet /.test(name))  return 'Tenet';
  if (/^Coda /.test(name))   return 'Coda';
  if (/ Prime$/.test(name))  return 'Prime';
  if (/^Mk1-/i.test(name))   return 'MK1';
  return null;
}

function inferWeaponCategory(name, wikiClass, classMap) {
  const prefix = weaponNamePrefix(name);
  if (prefix) return prefix;
  return classMap[wikiClass] || '';
}

function inferWarframeCategory(name) {
  if (/ Prime$/.test(name)) return 'Prime';
  if (/ Umbra$/.test(name)) return 'Umbra';
  return 'Base';
}

function inferModCategory(block) {
  const type       = getStr(block, 'Type') || '';
  const isAugment  = getBool(block, 'IsAbilityAugment') || getBool(block, 'IsWeaponAugment');
  const isFlawed   = getBool(block, 'IsFlawed');
  const cls        = getStr(block, 'Class') || '';

  if (cls === 'Requiem')   return 'Requiem';
  if (isFlawed)            return 'Flawed';
  if (isAugment) {
    // Generic types → "X Augment"; specific warframe/weapon names → "Warframe Augment"
    const genericTypes = new Set([
      'Warframe','Rifle','Shotgun','Pistol','Melee','Archgun','Archmelee','Companion',
      'Primary','Secondary','Aura','Archwing','Plexus','Necramech',
    ]);
    if (genericTypes.has(type)) return `${type} Augment`;
    return 'Warframe Augment';
  }
  // Default: use wiki Type as category
  return type;
}

// ── CSV ────────────────────────────────────────────────────────────────────────
function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function writeCSV(outPath, headers, rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => csvEscape(r[h] ?? '')).join(',')),
  ];
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
}

// ── SECTION DEFINITIONS ────────────────────────────────────────────────────────
const WIKI_BASE = 'https://wiki.warframe.com/w/Module:';

const SECTIONS = [
  // ── WARFRAMES ──────────────────────────────────────────────────────────────
  {
    id: 'warframes',
    varName: 'WARFRAMES',
    wikiUrl: WIKI_BASE + 'Warframes/data?action=raw',
    cacheKey: 'warframes',
    tablePath: ['Warframes'],
    headers: ['Name','Category','Method to Obtain','Tradable','Vaulted','Circuit Available'],
    outFile: 'warframes.csv',
    filterEntry: () => true,
    mapEntry: (name, block) => ({
      Name: name,
      Category: inferWarframeCategory(name),
      'Method to Obtain': '',
      Tradable: '',
      Vaulted: getBool(block, 'Vaulted') ? 'Yes' : '',
      'Circuit Available': '',
    }),
  },

  // ── PRIMARY ────────────────────────────────────────────────────────────────
  {
    id: 'primary',
    varName: 'PRIMARY',
    wikiUrl: WIKI_BASE + 'Weapons/data/primary?action=raw',
    cacheKey: 'weapons-primary',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Component for','Max Rank'],
    outFile: 'weapons_primary.csv',
    filterEntry: (name, block) => getStr(block, 'Class') !== 'Exalted Weapon',
    mapEntry: (name, block, ctx) => {
      const wikiClass = getStr(block, 'Class') || '';
      const tradableNum = parseInt(getNum(block, 'Tradable') ?? '0');
      const compFor = (ctx.compForMap.get(name) || []).join('; ');
      const maxRank = getNum(block, 'MaxRank') || '30';
      return {
        Name: name,
        Category: inferWeaponCategory(name, wikiClass, CLASS_TO_PRIMARY),
        'Method to Obtain': '',
        Tradable: tradableNum > 0 ? 'Yes' : 'No',
        'Component for': compFor,
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── SECONDARY ──────────────────────────────────────────────────────────────
  {
    id: 'secondary',
    varName: 'SECONDARY',
    wikiUrl: WIKI_BASE + 'Weapons/data/secondary?action=raw',
    cacheKey: 'weapons-secondary',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Component for','Max Rank'],
    outFile: 'weapons_secondary.csv',
    filterEntry: (name, block) => getStr(block, 'Class') !== 'Exalted Weapon',
    mapEntry: (name, block, ctx) => {
      const wikiClass = getStr(block, 'Class') || '';
      const tradableNum = parseInt(getNum(block, 'Tradable') ?? '0');
      const compFor = (ctx.compForMap.get(name) || []).join('; ');
      const maxRank = getNum(block, 'MaxRank') || '30';
      return {
        Name: name,
        Category: inferWeaponCategory(name, wikiClass, CLASS_TO_SECONDARY),
        'Method to Obtain': '',
        Tradable: tradableNum > 0 ? 'Yes' : 'No',
        'Component for': compFor,
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── MELEE ──────────────────────────────────────────────────────────────────
  {
    id: 'melee',
    varName: 'MELEE',
    wikiUrl: WIKI_BASE + 'Weapons/data/melee?action=raw',
    cacheKey: 'weapons-melee',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Component for','Max Rank'],
    outFile: 'weapons_melee.csv',
    filterEntry: (name, block) => getStr(block, 'Class') !== 'Exalted Weapon',
    mapEntry: (name, block, ctx) => {
      const wikiClass = getStr(block, 'Class') || '';
      const tradableNum = parseInt(getNum(block, 'Tradable') ?? '0');
      const compFor = (ctx.compForMap.get(name) || []).join('; ');
      const maxRank = getNum(block, 'MaxRank') || '30';
      return {
        Name: name,
        Category: inferWeaponCategory(name, wikiClass, CLASS_TO_MELEE),
        'Method to Obtain': '',
        Tradable: tradableNum > 0 ? 'Yes' : 'No',
        'Component for': compFor,
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── ARCH WEAPONS ───────────────────────────────────────────────────────────
  {
    id: 'archWeapons',
    varName: 'ARCH_WEAPONS',
    wikiUrl: WIKI_BASE + 'Weapons/data/archwing?action=raw',
    cacheKey: 'weapons-archwing',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Max Rank'],
    outFile: 'weapons_vehicles.csv',
    filterEntry: (name, block) => {
      const cls = getStr(block, 'Class') || '';
      return cls !== 'Exalted Weapon';
    },
    mapEntry: (name, block) => {
      const wikiClass = getStr(block, 'Class') || '';
      const tradableNum = parseInt(getNum(block, 'Tradable') ?? '0');
      const maxRank = getNum(block, 'MaxRank') || '30';
      return {
        Name: name,
        Category: CLASS_TO_ARCHWING[wikiClass] || '',
        'Method to Obtain': '',
        Tradable: tradableNum > 0 ? 'Yes' : 'No',
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── COMPANION WEAPONS ──────────────────────────────────────────────────────
  {
    id: 'compWeapons',
    varName: 'COMP_WEAPONS',
    wikiUrl: WIKI_BASE + 'Weapons/data/companion?action=raw',
    cacheKey: 'weapons-companion',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Max Rank'],
    outFile: 'weapons_companions.csv',
    filterEntry: (name, block) => getStr(block, 'Class') !== 'Exalted Weapon',
    mapEntry: (name, block) => {
      const tradableNum = parseInt(getNum(block, 'Tradable') ?? '0');
      const maxRank = getNum(block, 'MaxRank') || '30';
      const category = / Prime$/.test(name) ? 'Prime Robotic Weapons' : 'Robotic Weapons';
      return {
        Name: name,
        Category: category,
        'Method to Obtain': '',
        Tradable: tradableNum > 0 ? 'Yes' : 'No',
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── AMPS ───────────────────────────────────────────────────────────────────
  {
    id: 'amps',
    varName: 'AMPS',
    wikiUrl: WIKI_BASE + 'Weapons/data/modular?action=raw',
    cacheKey: 'weapons-modular',
    tablePath: [],
    headers: ['Name','Category','Method to Obtain','Tradable','Max Rank'],
    outFile: 'weapons_amps.csv',
    filterEntry: (name, block) => getStr(block, 'Class') === 'Amp',
    mapEntry: (name, block) => {
      const maxRank = getNum(block, 'MaxRank') || '30';
      return {
        Name: name,
        Category: 'Amps',
        'Method to Obtain': '',
        Tradable: 'No',
        'Max Rank': maxRank === '30' ? '' : maxRank,
      };
    },
  },

  // ── COMPANIONS ─────────────────────────────────────────────────────────────
  {
    id: 'companions',
    varName: 'COMPANIONS',
    wikiUrl: WIKI_BASE + 'Companions/data?action=raw',
    cacheKey: 'companions',
    tablePath: ['Companions'],
    headers: ['Name','Category','Method to Obtain','Tradable','Max Rank'],
    outFile: 'companions.csv',
    filterEntry: () => true,
    mapEntry: (name, block) => {
      const wikiType = getStr(block, 'Type') || '';
      const tradable = getBool(block, 'Tradable');
      return {
        Name: name,
        Category: TYPE_TO_COMPANION[wikiType] || wikiType,
        'Method to Obtain': '',
        Tradable: tradable ? 'Yes' : 'No',
        'Max Rank': '',
      };
    },
  },

  // ── VEHICLES ───────────────────────────────────────────────────────────────
  {
    id: 'vehicles',
    varName: 'VEHICLES',
    wikiUrl: WIKI_BASE + 'Vehicles/data?action=raw',
    cacheKey: 'vehicles',
    tablePath: ['Vehicles'],
    headers: ['Name','Category','Method to Obtain','Tradable','Max Rank'],
    outFile: 'vehicles.csv',
    filterEntry: () => true,
    mapEntry: (name) => ({
      Name: name,
      Category: '',
      'Method to Obtain': '',
      Tradable: 'No',
      'Max Rank': '',
    }),
  },

  // ── MODS ───────────────────────────────────────────────────────────────────
  {
    id: 'mods',
    varName: 'MODS',
    wikiUrl: WIKI_BASE + 'Mods/data?action=raw',
    cacheKey: 'mods',
    tablePath: ['Mods'],
    headers: ['Name','Description','BaseDrain','Max Rank','Polarity','IsExilus','Rarity','Type','Category','Sub-Type','Use','Acquisition','Tradable'],
    outFile: 'warframe_mods_new.csv',
    filterEntry: (name, block) => !getBool(block, '_IgnoreEntry'),
    mapEntry: (name, block) => ({
      Name: name,
      Description: (getStr(block, 'Description') || '').replace(/\\r\\n/g, ' ').replace(/\\n/g, ' ').replace(/\\r/g, '').replace(/<[A-Z_]+>/g, ''),
      BaseDrain: getNum(block, 'BaseDrain') || '',
      'Max Rank': getNum(block, 'MaxRank') || '0',
      Polarity: getStr(block, 'Polarity') || '',
      IsExilus: getBool(block, 'IsExilus') ? 'TRUE' : '',
      Rarity: getStr(block, 'Rarity') || '',
      Type: getStr(block, 'Type') || '',
      Category: inferModCategory(block),
      'Sub-Type': '',
      Use: '',
      Acquisition: '',
      Tradable: getBool(block, 'Tradable') ? 'TRUE' : 'FALSE',
    }),
  },

  // ── ARCANES ────────────────────────────────────────────────────────────────
  {
    id: 'arcanes',
    varName: 'ARCANES',
    wikiUrl: WIKI_BASE + 'Arcane/data?action=raw',
    cacheKey: 'arcanes',
    tablePath: ['Arcanes'],
    headers: ['Name','Description','Max Rank','Rarity','Type','Acquisition','Tradable'],
    outFile: 'arcanes_new.csv',
    filterEntry: () => true,
    mapEntry: (name, block) => ({
      Name: name,
      Description: (getStr(block, 'Description') || '').replace(/\\r\\n/g, ' ').replace(/\\n/g, ' ').replace(/\\r/g, '').replace(/<[A-Z_]+>/g, ''),
      'Max Rank': getNum(block, 'MaxRank') || '0',
      Rarity: getStr(block, 'Rarity') || '',
      Type: getStr(block, 'Type') || '',
      Acquisition: '',
      Tradable: '',
    }),
  },
];

// ── PROCESS SECTION ────────────────────────────────────────────────────────────
async function processSection(cfg, dataJS, compForMap) {
  console.log(HDR(`${cfg.id} → ${cfg.varName}`));

  // Fetch and parse wiki module
  let luaSrc;
  try {
    luaSrc = await cachedFetch(cfg.cacheKey, cfg.wikiUrl);
  } catch(e) {
    console.log(WARN(`Failed to fetch ${cfg.wikiUrl}: ${e.message}`));
    return;
  }

  // Navigate to the relevant sub-table (or use root if tablePath is empty)
  let tableBlock = luaSrc;
  for (const key of cfg.tablePath) {
    tableBlock = navigateToSubTable(tableBlock, key);
    if (!tableBlock) {
      console.log(WARN(`Sub-table "${key}" not found in ${cfg.cacheKey}`));
      return;
    }
  }

  // Extract all entries from the wiki
  const wikiEntries = extractEntries(tableBlock);

  // Filter out entries we don't want (Exalted Weapons, _IgnoreEntry, etc.)
  const filtered = new Map();
  for (const [name, block] of wikiEntries) {
    if (cfg.filterEntry(name, block)) filtered.set(name, block);
  }

  // Get existing names from data.js
  const existing = getExistingNames(dataJS, cfg.varName);

  // Diff
  const newItems    = [...filtered.keys()].filter(n => !existing.has(n));
  const removedItems = [...existing].filter(n => !filtered.has(n));

  console.log(INFO(`  wiki: ${filtered.size} entries | data.js: ${existing.size} | new: ${newItems.length} | not in wiki: ${removedItems.length}`));

  if (removedItems.length > 0) {
    console.log(WARN(`  Items in data.js but not in wiki (renamed/removed?):`));
    for (const n of removedItems) console.log(col('dim', `       ${n}`));
  }

  if (newItems.length === 0) {
    console.log(OK(`  Nothing new — ${cfg.varName} is up to date`));
    return;
  }

  // Build output rows for new items
  const ctx = { compForMap };
  const rows = [];
  for (const name of newItems) {
    const block = filtered.get(name);
    rows.push(cfg.mapEntry(name, block, ctx));
    console.log(OK(`  ${name}`));
  }

  // Write CSV
  const outPath = path.join(OUT_DIR, cfg.outFile);
  writeCSV(outPath, cfg.headers, rows);
  console.log(col('cyan', `\n  ·  Written → ${outPath}  (${rows.length} item${rows.length === 1 ? '' : 's'})`));
  console.log(col('dim',  `  ·  Fill in blank fields (Method to Obtain / Acquisition), then run update.js`));
}

// ── MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(col('bold', 'WF Mastery Tracker — Wiki Diff'));
  console.log(col('dim',  NO_CACHE ? 'Cache: disabled' : 'Cache: enabled (use --no-cache to force re-fetch)'));
  if (ONLY_SECS.length) console.log(col('dim', `Section filter: ${ONLY_SECS.join(', ')}`));

  if (!fs.existsSync(DATA_JS)) {
    console.error(`data.js not found at ${DATA_JS}`);
    process.exit(1);
  }

  const validIds = SECTIONS.map(s => s.id);
  const unknown  = ONLY_SECS.filter(s => !validIds.includes(s));
  if (unknown.length) {
    console.error(`Unknown section(s): ${unknown.join(', ')}. Valid: ${validIds.join(', ')}`);
    process.exit(1);
  }

  const dataJS     = fs.readFileSync(DATA_JS, 'utf-8');
  const compForMap = buildCompForMap();
  const toRun      = ONLY_SECS.length ? SECTIONS.filter(s => ONLY_SECS.includes(s.id)) : SECTIONS;

  let totalNew = 0;
  for (const cfg of toRun) {
    const existingBefore = getExistingNames(dataJS, cfg.varName).size;
    await processSection(cfg, dataJS, compForMap);
    const newCount = getExistingNames(dataJS, cfg.varName).size - existingBefore;
    totalNew += Math.max(0, newCount);
  }

  console.log('\n' + col('bold', '── Summary ──────────────────────────────────────'));
  console.log(col('dim', `  Output directory: ${OUT_DIR}`));
  console.log(col('dim', `  Cached modules:   ${CACHE_DIR}`));
  console.log(col('dim', `  Next step: fill in "Method to Obtain" / "Acquisition" columns,`));
  console.log(col('dim', `             then run: node dev/update.js --apply`));
}

main().catch(e => { console.error('Fatal: ' + e.message); process.exit(1); });
