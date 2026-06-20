// update-weapons.js
// Detects new weapons in WFCD + wiki not yet in data-items.js.
// Without --apply: read-only, prints stub lines for review.
// With --apply: backs up data-items.js then inserts stubs (obtain method left as TODO).
//
// Usage:
//   node dev/update-weapons.js              # WFCD first; wiki fallback if WFCD has nothing new
//   node dev/update-weapons.js --wfcd-only  # skip wiki
//   node dev/update-weapons.js --wiki-only  # skip WFCD
//   node dev/update-weapons.js --all        # check both WFCD and wiki regardless
//   node dev/update-weapons.js --apply      # write stubs into data-items.js (backs up first)
//   node dev/update-weapons.js --images     # download images for detected new weapons (independent of --apply)
//   node dev/update-weapons.js --revert     # restore data-items.js from latest backup

'use strict';

const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const luaparse     = require('luaparse');
const { execSync } = require('child_process');

const DATA_ITEMS   = path.join(__dirname, '..', 'data-items.js');
const WFCD_DIR     = path.join(__dirname, 'node_modules/@wfcd/items/data/json');
const WIKI_BASE    = 'https://wiki.warframe.com/w/Module:Weapons/data';
const BACKUP_DIR   = path.join(__dirname, 'backups', 'weapons');
const KEEP_BACKUPS = 5;

// ── WFCD refresh ─────────────────────────────────────────────────────────────

function refreshWfcd() {
  console.log('Updating @wfcd/items…');
  try {
    execSync('npm update @wfcd/items', {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });
    console.log('  @wfcd/items up to date.');
  } catch (e) {
    console.warn(`  WFCD update failed — ${e.message.split('\n')[0]}`);
    console.warn('  Continuing with installed version.');
  }
}

// Founders weapons — permanently unobtainable, like Excalibur Prime
const ALWAYS_EXCLUDE = new Set(['Lato Prime', 'Skana Prime']);

// ── Per-array configuration ───────────────────────────────────────────────────

const CONFIGS = [
  {
    varName:     'PRIMARY',
    wfcdFiles:   ['Primary.json'],
    // Sirocco has productCategory=OperatorAmps — it's tracked in AMPS, not PRIMARY
    excludeWfcd: w => w.productCategory === 'OperatorAmps' || hasFounderTag(w),
    wikiSubpage: 'primary',
    wikiSlots:   new Set(['Primary']),
    imageDir:    'Images/primary',
  },
  {
    varName:     'SECONDARY',
    wfcdFiles:   ['Secondary.json'],
    excludeWfcd: w => hasFounderTag(w),
    wikiSubpage: 'secondary',
    wikiSlots:   new Set(['Secondary']),
    imageDir:    'Images/secondary',
  },
  {
    varName:     'MELEE',
    wfcdFiles:   ['Melee.json'],
    // Zaw Component = individual pieces, not standalone weapons
    excludeWfcd: w => w.type === 'Zaw Component' || hasFounderTag(w),
    wikiSubpage: 'melee',
    wikiSlots:   new Set(['Melee']),
    imageDir:    'Images/melee',
  },
  {
    varName:     'ARCH_WEAPONS',
    wfcdFiles:   ['Arch-Gun.json', 'Arch-Melee.json'],
    excludeWfcd: () => false,
    wikiSubpage: 'archwing',
    // 'Archgun (Atmosphere)' entries are the same weapons in a different context — skip duplicates
    wikiSlots:   new Set(['Archgun', 'Archmelee']),
    imageDir:    'Images/arch-weapons',
  },
  {
    varName:     'COMP_WEAPONS',
    wfcdFiles:   ['SentinelWeapons.json'],
    excludeWfcd: () => false,
    wikiSubpage: 'companion',
    wikiSlots:   null, // accept all slots in companion subpage
    imageDir:    'Images/comp-weapons',
  },
];

// WFCD type → data-items category (PRIMARY / SECONDARY / ARCH / COMP)
const WFCD_TYPE_TO_CAT = {
  Rifle:              'Rifles',
  Shotgun:            'Shotguns',
  Bow:                'Bows',
  Sniper:             'Snipers',
  Launcher:           'Launchers',
  Pistol:             'Pistols',
  'Dual Pistols':     'Dual Pistols',
  Throwing:           'Throwing',
  'Arch-Gun':         'Arch-Gun',
  'Arch-Melee':       'Arch-Melee',
  'Companion Weapon': 'Robotic',
};

// Wiki Class → data-items melee category
const WIKI_CLASS_TO_MELEE_CAT = {
  'Sword':             'Swords/Nikanas',
  'Nikana':            'Swords/Nikanas',
  'Two-Handed Nikana': 'Swords/Nikanas',
  'Dual Swords':       'Dual Swords',
  'Polearm':           'Polearm/Staff',
  'Staff':             'Polearm/Staff',
  'Hammer':            'Hammer',
  'Heavy Blade':       'Heavy Blades',
  'Glaive':            'Glaive',
  'Scythe':            'Scythe',
  'Heavy Scythe':      'Heavy Scythes',
  'Whip':              'Whip',
  'Blade and Whip':    'Whip',
  'Dagger':            'Daggers',
  'Dual Daggers':      'Dual Daggers',
  'Machete':           'Machetes',
  'Tonfa':             'Tonfa',
  'Fist':              'Fist/Sparring',
  'Sparring':          'Fist/Sparring',
  'Claws':             'Claws',
  'Warfan':            'Warfans',
  'Gunblade':          'Gunblade',
  'Rapier':            'Rapier',
  'Sword and Shield':  'Sword-Shield',
  'Assault Saw':       'Assault Saws',
};

// ── Backup / revert ───────────────────────────────────────────────────────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

function saveBackup() {
  ensureBackupDir();
  const ts   = backupTimestamp();
  const dest = path.join(BACKUP_DIR, `data-items-${ts}.js`);
  fs.copyFileSync(DATA_ITEMS, dest);
  console.log(`Backed up: ${path.basename(dest)}`);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-items-') && f.endsWith('.js'))
    .sort();
  while (files.length > KEEP_BACKUPS) {
    const old = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log(`Removed old backup: ${old}`);
  }
}

function revert() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-items-') && f.endsWith('.js'))
    .sort();
  if (!files.length) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
  const latest = files[files.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_ITEMS);
  console.log(`Reverted data-items.js from ${latest}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasFounderTag(w) {
  return Array.isArray(w.tags) && w.tags.includes('Founder');
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetch(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchBinary(url, notFoundOk = false) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBinary(res.headers.location, notFoundOk).then(resolve).catch(reject);
      if (res.statusCode === 404 && notFoundOk) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function downloadWikiImage(wikiFilename, destPath) {
  if (fs.existsSync(destPath)) return 'exists';
  const url  = `https://wiki.warframe.com/w/Special:FilePath/${encodeURIComponent(wikiFilename)}`;
  const data = await fetchBinary(url, true);
  if (data === null) return 'not-found';
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, data);
  return 'downloaded';
}

// ── Lua → JS AST converter (shared with update-relics / update-warframes) ─────

function nodeToJs(node) {
  if (!node) return null;
  switch (node.type) {
    case 'NumericLiteral':  return node.value;
    case 'StringLiteral': {
      const r = node.raw;
      if (r[0] === '"' || r[0] === "'") return r.slice(1, -1);
      if (r.startsWith('[[')) return r.slice(2, -2);
      return r;
    }
    case 'BooleanLiteral':  return node.value;
    case 'NilLiteral':      return null;
    case 'UnaryExpression':
      return node.operator === '-' ? -nodeToJs(node.argument) : nodeToJs(node.argument);
    case 'TableConstructorExpression': {
      const hasNamed = node.fields.some(f => f.type === 'TableKeyString' || f.type === 'TableKey');
      if (!hasNamed) return node.fields.map(f => nodeToJs(f.value));
      const obj = {}; let idx = 1;
      for (const field of node.fields) {
        if (field.type === 'TableKeyString')      obj[field.key.name]        = nodeToJs(field.value);
        else if (field.type === 'TableKey')       obj[nodeToJs(field.key)]   = nodeToJs(field.value);
        else                                      obj[idx++]                 = nodeToJs(field.value);
      }
      return obj;
    }
    default: return null;
  }
}

// ── data-items.js readers ─────────────────────────────────────────────────────

const _dataItemsCache = fs.readFileSync(DATA_ITEMS, 'utf-8');

// Returns Map<name, lowercasedName> for an array in data-items.js
function getExistingNames(varName) {
  const marker = `const ${varName} = [`;
  const start  = _dataItemsCache.indexOf(marker);
  if (start === -1) return new Map();
  const rest    = _dataItemsCache.slice(start);
  const end     = rest.search(/\n\];/);
  const section = end === -1 ? rest : rest.slice(0, end);
  const names   = new Map();
  for (const m of section.matchAll(/^\s*\[["']([^"']+)["']/gm)) names.set(m[1], m[1].toLowerCase());
  return names;
}

// Returns Set of categories for items in a given array (used to flag unknown cats)
function getExistingCategories(varName) {
  const marker = `const ${varName} = [`;
  const start  = _dataItemsCache.indexOf(marker);
  if (start === -1) return new Set();
  const rest    = _dataItemsCache.slice(start);
  const end     = rest.search(/\n\];/);
  const section = end === -1 ? rest : rest.slice(0, end);
  const cats = new Set();
  for (const m of section.matchAll(/^\s*\[["'][^"']+["'],["']([^"']+)["']/gm)) cats.add(m[1]);
  return cats;
}

// ── Category / maxRank suggestion ─────────────────────────────────────────────

function suggestCat(name, varName, wfcdType, wikiClass, isPrime) {
  // Modular weapon lines from WFCD/wiki — handled in data-items as Kitgun/Zaw categories
  if (varName === 'SECONDARY' && isPrime) return 'Pistols';  // prime secondaries keep their type

  if (varName === 'MELEE') {
    if (name.startsWith('Kuva '))  return 'Kuva';
    if (name.startsWith('Tenet ')) return 'Tenet';
    if (name.startsWith('Coda '))  return 'Coda';
    if (isPrime)                   return 'Prime';
    return (wikiClass && WIKI_CLASS_TO_MELEE_CAT[wikiClass])
      ? WIKI_CLASS_TO_MELEE_CAT[wikiClass]
      : (wfcdType === 'Melee' ? '???' : WFCD_TYPE_TO_CAT[wfcdType] || '???');
  }

  if (varName === 'ARCH_WEAPONS') {
    if (isPrime) return wfcdType === 'Arch-Melee' ? 'Prime Arch-Melee' : 'Prime Arch-Gun';
    return WFCD_TYPE_TO_CAT[wfcdType] || wikiClass || '???';
  }

  if (varName === 'COMP_WEAPONS') {
    return isPrime ? 'Prime Robotic' : 'Robotic';
  }

  // PRIMARY / SECONDARY — use WFCD type (works for primes too, e.g. "Rifles")
  return WFCD_TYPE_TO_CAT[wfcdType] || wikiClass || '???';
}

function suggestMaxRank(name, wikiMaxRank) {
  if (wikiMaxRank && wikiMaxRank !== 30) return wikiMaxRank;
  if (/^(Kuva|Tenet|Coda) /i.test(name)) return 40;
  return 30;
}

// ── WFCD extraction ───────────────────────────────────────────────────────────

function extractFromWfcd(cfg) {
  const wfcdFile = path.join(WFCD_DIR, 'Primary.json'); // used only to check installation
  if (!fs.existsSync(wfcdFile)) throw new Error('@wfcd/items not installed — run: npm install @wfcd/items');

  // Map<lowerName, { name, type, isPrime, tradable }>
  const items = new Map();
  const existing = getExistingNames(cfg.varName);
  const existLower = new Set(existing.values());

  for (const file of cfg.wfcdFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(WFCD_DIR, file), 'utf-8'));
    for (const w of data) {
      if (ALWAYS_EXCLUDE.has(w.name)) continue;
      if (cfg.excludeWfcd(w)) continue;
      const lc = w.name.toLowerCase();
      if (items.has(lc)) continue; // deduplicate (e.g. Grimoire has two WFCD entries)
      items.set(lc, { name: w.name, type: w.type || '', isPrime: !!w.isPrime, tradable: !!w.tradable });
    }
  }

  const newItems = [...items.values()].filter(w => !existLower.has(w.name.toLowerCase()));
  return { all: items, newItems };
}

// ── Wiki extraction ───────────────────────────────────────────────────────────

async function extractFromWiki(cfg) {
  const url = `${WIKI_BASE}/${cfg.wikiSubpage}?action=raw`;
  console.log(`  Fetching wiki Module:Weapons/data/${cfg.wikiSubpage}…`);
  const lua = await fetch(url);
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  let tableNode = null;
  for (const stmt of ast.body) {
    if (stmt.type === 'ReturnStatement') { tableNode = stmt.arguments[0]; break; }
  }
  if (!tableNode) throw new Error(`No return statement found in Module:Weapons/data/${cfg.wikiSubpage}`);

  const weaponsTable = nodeToJs(tableNode);

  const existing   = getExistingNames(cfg.varName);
  const existLower = new Set(existing.values());
  const newItems      = []; // regular new weapons to add
  const modeVariants  = []; // multi-mode wiki entries (base weapon already tracked)
  const ignored       = []; // _IgnoreEntry=true (unreleased)

  for (const [key, entry] of Object.entries(weaponsTable)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = entry.Name || key;

    // Filter by slot if configured (e.g. skip 'Archgun (Atmosphere)' duplicates)
    if (cfg.wikiSlots) {
      const slotNorm  = entry.Slot || '';
      const slotMatch = [...cfg.wikiSlots].some(s => s.toLowerCase() === slotNorm.toLowerCase());
      if (!slotMatch) continue;
    }

    if (ALWAYS_EXCLUDE.has(name)) continue;

    // _IgnoreEntry=true: not yet released
    if (entry._IgnoreEntry === true) { ignored.push(name); continue; }

    // _IgnoreInMasteryCount=true: exalted ability-weapons, kubrow/kavat claws, etc.
    // These don't give mastery XP and should not be tracked.
    if (entry._IgnoreInMasteryCount === true) continue;

    if (existLower.has(name.toLowerCase())) continue;

    const wikiClass = entry.Class || '';

    // Mode-variant names like "Vinquibus (Primary)" or "Dark Split-Sword (Dual Swords)":
    // if the base name (without the parenthetical) is already in data-items, skip.
    const baseName = name.replace(/\s*\([^)]+\)$/, '');
    if (baseName !== name && existLower.has(baseName.toLowerCase())) {
      modeVariants.push(name);
      continue;
    }

    newItems.push({
      name,
      wikiClass,
      wikiSlot: entry.Slot   || '',
      maxRank:  entry.MaxRank || null,
      isPrime:  name.includes(' Prime'),
    });
  }

  return { newItems, modeVariants, ignored };
}

// ── Stub line builder ─────────────────────────────────────────────────────────

function buildStub(name, varName, wfcdType, wikiClass, isPrime, tradable, maxRankHint) {
  const cat     = suggestCat(name, varName, wfcdType, wikiClass, isPrime);
  const maxRank = suggestMaxRank(name, maxRankHint);
  const parts   = [`"${name}"`, `"${cat}"`, `"TODO: obtain method"`, maxRank];
  if (tradable) parts.push(1);
  const catWarning = cat === '???' ? '  // ← check category' : '';
  return `  [${parts.join(',')}],${catWarning}`;
}

// ── Apply stubs to data-items.js ──────────────────────────────────────────────

function applyNewWeapons(stubsByVar) {
  let content = fs.readFileSync(DATA_ITEMS, 'utf-8');
  let changed  = false;

  for (const [varName, lines] of stubsByVar) {
    if (!lines.length) continue;
    const marker = `const ${varName} = [`;
    const start  = content.indexOf(marker);
    if (start === -1) { console.warn(`  ${varName}: array not found in data-items.js — skipped`); continue; }
    const rest   = content.slice(start);
    const endRel = rest.search(/\n\];/);
    if (endRel === -1) { console.warn(`  ${varName}: closing ]; not found — skipped`); continue; }
    const insertAt = start + endRel; // just before the '\n];'
    content = content.slice(0, insertAt) + '\n' + lines.join('\n') + content.slice(insertAt);
    console.log(`  ${varName}: inserted ${lines.length} stub(s)`);
    changed = true;
  }

  if (changed) fs.writeFileSync(DATA_ITEMS, content, 'utf-8');
  return changed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args       = process.argv.slice(2);
  const wfcdOnly   = args.includes('--wfcd-only');
  const wikiOnly   = args.includes('--wiki-only');
  const showAll    = args.includes('--all');
  const doApply    = args.includes('--apply');
  const doImages   = args.includes('--images');
  const doRevert   = args.includes('--revert');
  const skipUpdate = args.includes('--skip-update');

  if (doRevert) { revert(); process.exit(0); }

  if (!wikiOnly && !skipUpdate) refreshWfcd();

  if (!fs.existsSync(DATA_ITEMS)) {
    console.error('data-items.js not found at ' + DATA_ITEMS);
    process.exit(1);
  }

  let anyNewInWfcd = false;
  const wfcdResults = new Map(); // varName → { all, newItems }
  const wikiResults = new Map(); // varName → { newItems, ignored }

  // ── WFCD pass ──────────────────────────────────────────────────────────────
  if (!wikiOnly) {
    console.log('Checking WFCD…');
    for (const cfg of CONFIGS) {
      try {
        const result = extractFromWfcd(cfg);
        wfcdResults.set(cfg.varName, result);
        if (result.newItems.length > 0) anyNewInWfcd = true;
        const existing = getExistingNames(cfg.varName);
        console.log(`  ${cfg.varName}: WFCD ${result.all.size}, data-items ${existing.size}, new ${result.newItems.length}`);
      } catch (e) {
        console.warn(`  ${cfg.varName}: WFCD error — ${e.message}`);
      }
    }
  }

  // ── Wiki pass ──────────────────────────────────────────────────────────────
  // Fetch wiki if: forced, wiki-only mode, or WFCD had nothing new (fallback)
  if (!wfcdOnly && (!anyNewInWfcd || wikiOnly || showAll)) {
    if (!anyNewInWfcd && !wikiOnly) console.log('\nNo new weapons in WFCD — checking wiki for updates…');
    else console.log('\nFetching wiki data…');

    for (const cfg of CONFIGS) {
      try {
        const result = await extractFromWiki(cfg);
        wikiResults.set(cfg.varName, result);
      } catch (e) {
        console.warn(`  ${cfg.varName}: wiki fetch failed — ${e.message}`);
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  let totalNew = 0;

  for (const cfg of CONFIGS) {
    const wfcd = wfcdResults.get(cfg.varName);
    const wiki = wikiResults.get(cfg.varName);

    const wfcdNew      = wfcd?.newItems     || [];
    const wikiNew      = wiki?.newItems     || [];
    const wikiVariants = wiki?.modeVariants || [];
    const wikiIgnored  = wiki?.ignored      || [];

    // Wiki items WFCD also flagged → confirmed released
    // Wiki items WFCD didn't flag → wiki-only (may be very recent or unreleased)
    const wfcdNames   = new Set(wfcdNew.map(w => w.name.toLowerCase()));
    const wikiOnlyNew = wikiNew.filter(w => !wfcdNames.has(w.name.toLowerCase()));

    const sectionNew = wfcdNew.length + wikiOnlyNew.length;
    const hasNotes   = wikiVariants.length || wikiIgnored.length;
    if (sectionNew === 0 && !hasNotes) continue;

    totalNew += sectionNew;
    console.log(`\n── ${cfg.varName} ──────────────────────────────────────────`);

    if (wfcdNew.length) {
      console.log(`  New weapons confirmed by WFCD (${wfcdNew.length}):`);
      for (const w of wfcdNew) {
        console.log(`    ${buildStub(w.name, cfg.varName, w.type, '', w.isPrime, w.tradable, null)}`);
      }
    }

    if (wikiOnlyNew.length) {
      console.log(`  Wiki-only — verify released before adding (${wikiOnlyNew.length}):`);
      for (const w of wikiOnlyNew) {
        console.log(`    ${buildStub(w.name, cfg.varName, '', w.wikiClass, w.isPrime, false, w.maxRank)}`);
      }
    }

    if (wikiVariants.length) {
      console.log(`  Multi-mode wiki entries (base weapon already tracked) (${wikiVariants.length}):`);
      wikiVariants.forEach(n => console.log(`    # ${n}`));
    }

    if (wikiIgnored.length) {
      console.log(`  Unreleased (_IgnoreEntry=true) — do not add (${wikiIgnored.length}):`);
      wikiIgnored.forEach(n => console.log(`    # ${n}`));
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`${totalNew} new weapons`);

  if (totalNew === 0) {
    console.log('Nothing to update.');
    if (!doImages) return;
  } else if (!doApply) {
    console.log('Run with --apply to insert stubs automatically (obtain method will be set to TODO).');
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  if (doApply && totalNew > 0) {
    console.log('\nApplying changes…');
    saveBackup();

    const stubsByVar = new Map();
    for (const cfg of CONFIGS) {
      const wfcd = wfcdResults.get(cfg.varName);
      const wiki = wikiResults.get(cfg.varName);

      const wfcdNew     = wfcd?.newItems || [];
      const wikiNew     = wiki?.newItems || [];
      const wfcdNames   = new Set(wfcdNew.map(w => w.name.toLowerCase()));
      const wikiOnlyNew = wikiNew.filter(w => !wfcdNames.has(w.name.toLowerCase()));

      const lines = [];
      for (const w of wfcdNew) {
        lines.push(buildStub(w.name, cfg.varName, w.type, '', w.isPrime, w.tradable, null));
      }
      for (const w of wikiOnlyNew) {
        lines.push(buildStub(w.name, cfg.varName, '', w.wikiClass, w.isPrime, false, w.maxRank));
      }
      if (lines.length) stubsByVar.set(cfg.varName, lines);
    }

    const wrote = applyNewWeapons(stubsByVar);
    if (wrote) {
      console.log('\ndata-items.js updated. Search for "TODO: obtain method" to fill in the missing fields.');
    }
  }

  // ── Image download ──────────────────────────────────────────────────────────
  // Scans all tracked items for missing image files — not just newly-detected ones.
  // This means --images works correctly even after --apply has already inserted the stubs.
  if (doImages) {
    let downloaded = 0, notFound = 0;
    console.log('\n── Downloading weapon images ────────────────────────────────────────');
    for (const cfg of CONFIGS) {
      const allNames = [...getExistingNames(cfg.varName).keys()];
      const missing  = allNames.filter(name => {
        const dest = path.join(__dirname, '..', cfg.imageDir, name.replace(/ /g, '') + '.png');
        return !fs.existsSync(dest);
      });
      if (!missing.length) continue;
      console.log(`  ${cfg.varName} (${missing.length} missing):`);
      for (const name of missing) {
        const filename = name.replace(/ /g, '') + '.png';
        const destPath = path.join(__dirname, '..', cfg.imageDir, filename);
        try {
          const result = await downloadWikiImage(filename, destPath);
          const icon = result === 'downloaded' ? '✓' : result === 'exists' ? '=' : '?';
          console.log(`    ${icon} ${name}: ${result}`);
          if (result === 'downloaded') downloaded++;
          else if (result === 'not-found') notFound++;
        } catch (e) {
          console.error(`    ✗ ${name}: FAILED — ${e.message}`);
          notFound++;
        }
      }
    }
    if (downloaded === 0 && notFound === 0) console.log('  All weapon images already present.');
    else console.log(`\n  Downloaded: ${downloaded}  Not found on wiki: ${notFound}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('ERROR:', err.message); process.exit(1); });
