// update-mods.js
// Detects new mods in WFCD + wiki not yet in data-mods.js.
// Also patches existing stubs whose WFCD-only fields (drops, compatName, levelStats) are null.
// Without --apply: read-only, prints stubs/patches for review.
// With --apply: backs up data-mods.js then inserts stubs and fills null fields.
//
// Usage:
//   node dev/update-mods.js              # WFCD first; wiki fallback if nothing new
//   node dev/update-mods.js --wfcd-only  # skip wiki
//   node dev/update-mods.js --wiki-only  # skip WFCD
//   node dev/update-mods.js --all        # check both regardless
//   node dev/update-mods.js --apply      # write stubs into data-mods.js (backs up first)
//   node dev/update-mods.js --revert     # restore data-mods.js from latest backup

'use strict';

const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const luaparse     = require('luaparse');
const { execSync } = require('child_process');

const DATA_MODS    = path.join(__dirname, '..', 'data-mods.js');
const WFCD_DIR     = path.join(__dirname, 'node_modules/@wfcd/items/data/json');
const WIKI_URL     = 'https://wiki.warframe.com/w/Module:Mods/data?action=raw';
const BACKUP_DIR   = path.join(__dirname, 'backups', 'mods');
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

// ── Types / names to exclude ──────────────────────────────────────────────────

const WFCD_EXCLUDE_TYPES = new Set([
  'Arch-Gun Riven Mod', 'Companion Weapon Riven Mod', 'Kitgun Riven Mod',
  'Melee Riven Mod', 'Pistol Riven Mod', 'Rifle Riven Mod',
  'Shotgun Riven Mod', 'Zaw Riven Mod',
  'Focus Way', 'Transmutation Mod',
  'Mod Set Mod',
]);

const WFCD_EXCLUDE_NAMES = new Set(['Unfused Artifact', 'Sampleantiqueupgrade', 'Helminth Ferocity']);

// ── Weapon exilus overrides (WFCD isExilus field is unreliable for weapons) ──

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
  const dest = path.join(BACKUP_DIR, `data-mods-${ts}.js`);
  fs.copyFileSync(DATA_MODS, dest);
  console.log(`Backed up: ${path.basename(dest)}`);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-mods-') && f.endsWith('.js'))
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
    .filter(f => f.startsWith('data-mods-') && f.endsWith('.js'))
    .sort();
  if (!files.length) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
  const latest = files[files.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_MODS);
  console.log(`Reverted data-mods.js from ${latest}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        if (field.type === 'TableKeyString')  obj[field.key.name]       = nodeToJs(field.value);
        else if (field.type === 'TableKey')   obj[nodeToJs(field.key)]  = nodeToJs(field.value);
        else                                  obj[idx++]                 = nodeToJs(field.value);
      }
      return obj;
    }
    default: return null;
  }
}

// ── data-mods.js reader ───────────────────────────────────────────────────────

function getExistingModNames() {
  const src = fs.readFileSync(DATA_MODS, 'utf-8');
  const names = new Set();
  for (const m of src.matchAll(/^\s+name:\s+"((?:[^"\\]|\\.)*)"/gm))
    names.add(m[1].toLowerCase());
  return names;
}

// ── WFCD extraction ───────────────────────────────────────────────────────────

function extractFromWfcd(existingLower) {
  const wfcdFile = path.join(WFCD_DIR, 'Mods.json');
  if (!fs.existsSync(wfcdFile)) throw new Error('@wfcd/items not installed — run: npm install @wfcd/items');

  const raw  = JSON.parse(fs.readFileSync(wfcdFile, 'utf-8'));
  const seen = new Map();

  for (const m of raw) {
    if (WFCD_EXCLUDE_TYPES.has(m.type))   continue;
    if (WFCD_EXCLUDE_NAMES.has(m.name))   continue;
    if (!m.name || /^[a-z]/.test(m.name)) continue;
    if (m.excludeFromCodex)               continue;
    const existing = seen.get(m.name);
    if (!existing || (m.fusionLimit ?? 0) > (existing.fusionLimit ?? 0)) seen.set(m.name, m);
  }

  const allMods = [...seen.values()];
  const newMods = allMods.filter(m => !existingLower.has(m.name.toLowerCase()));
  const allMap  = new Map(allMods.map(m => [m.name.toLowerCase(), m]));
  return { total: allMods.length, newMods, allMap };
}

// ── Wiki extraction ───────────────────────────────────────────────────────────

async function extractFromWiki(existingLower) {
  console.log('  Fetching wiki Module:Mods/data…');
  const lua = await fetch(WIKI_URL);
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });

  let tableNode = null;
  for (const stmt of ast.body) {
    if (stmt.type === 'LocalStatement' && stmt.init?.[0]?.type === 'TableConstructorExpression') {
      tableNode = stmt.init[0]; break;
    }
    if (stmt.type === 'ReturnStatement' && stmt.arguments[0]?.type === 'TableConstructorExpression') {
      tableNode = stmt.arguments[0]; break;
    }
  }
  if (!tableNode) throw new Error('Could not find table data in Module:Mods/data');

  const root      = nodeToJs(tableNode);
  const modsTable = root.Mods;
  if (!modsTable) throw new Error('"Mods" key not found in wiki module');

  const WIKI_EXCLUDE_TYPES = new Set([
    'Blade Storm', 'Desert Wind', 'Diwata', 'Exalted Blade', 'Iron Staff',
    'Landslide Fists', 'Shadow Claws', 'Shadow Clones', 'Shattered Lash',
    'Valkyr Talons', 'Whipclaw',
    'Core', 'Mod',
    'Madurai', 'Naramon', 'Vazarin', 'Unairu', 'Zenurik',
  ]);

  const newMods = [];
  const ignored = [];

  for (const [, entry] of Object.entries(modsTable)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = entry.Name || entry.Link;
    if (!name) continue;
    if (entry._IgnoreEntry) { ignored.push(name); continue; }
    if (WIKI_EXCLUDE_TYPES.has(entry.Type || '')) continue;
    if (/ Riven Mod$/.test(name)) continue;
    if (/\(Pinnacle Pack\)/i.test(name)) continue;
    if (/^Ancient Fusion Core/.test(name)) continue;
    if (existingLower.has(name.toLowerCase())) continue;

    newMods.push({
      name,
      wikiType:         entry.Type            || '',
      wikiMaxRank:      entry.MaxRank          ?? 0,
      wikiPolarity:     entry.Polarity         || '',
      wikiRarity:       entry.Rarity           || '',
      wikiTradable:     entry.Tradable         === true,
      wikiBaseDrain:    entry.BaseDrain        ?? 0,
      isAbilityAugment: entry.IsAbilityAugment === true,
      isWeaponAugment:  entry.IsWeaponAugment  === true,
    });
  }

  return { newMods, ignored };
}

// ── Category derivation for wiki stubs (approximate WFCD type string) ─────────

function wikiToWfcdCat(entry) {
  if (entry.isAbilityAugment || entry.isWeaponAugment) return 'Warframe Mod';
  const MAP = {
    'Warframe':   'Warframe Mod',
    'Aura':       'Warframe Mod',
    'Rifle':      'Primary Mod',
    'Shotgun':    'Shotgun Mod',
    'Bow':        'Primary Mod',
    'Pistol':     'Secondary Mod',
    'Melee':      'Melee Mod',
    'Stance':     'Stance Mod',
    'Companion':  'Companion Mod',
    'Archgun':    'Arch-Gun Mod',
    'Arch-Gun':   'Arch-Gun Mod',
    'Archmelee':  'Arch-Melee Mod',
    'Arch-Melee': 'Arch-Melee Mod',
    'Archwing':   'Archwing Mod',
    'K-Drive':    'K-Drive Mod',
    'Necramech':  'Necramech Mod',
    'Parazon':    'Parazon Mod',
    'Railjack':   'Plexus Mod',
  };
  return MAP[entry.wikiType] || '???';
}

// ── Stub builders ─────────────────────────────────────────────────────────────

function dq(s) { return JSON.stringify(String(s)); }

function buildStubFromWfcd(m) {
  const cat        = m.type || '???';
  const acq        = [...new Set((m.drops || []).map(d => d.location))];
  const maxRank    = m.fusionLimit ?? 0;
  const polarity   = m.polarity ? m.polarity[0].toUpperCase() + m.polarity.slice(1) : '';
  const isExilus   = !!(m.isExilus || WEAPON_EXILUS.has(m.name));
  const levelStats = m.levelStats ? JSON.stringify(m.levelStats.map(l => Array.isArray(l) ? l : (l.stats ?? []))) : 'null';
  const catWarn    = cat === '???' ? ' // ← check category' : '';

  return [
    `  {`,
    `    name:       ${dq(m.name)},`,
    `    category:   ${dq(cat)},${catWarn}`,
    `    drops:      ${JSON.stringify(acq)},`,
    `    maxRank:    ${maxRank},`,
    `    polarity:   ${dq(polarity)},`,
    `    rarity:     ${dq(m.rarity || '')},`,
    `    isExilus:   ${isExilus},`,
    `    tradable:   ${!!m.tradable},`,
    `    compatName: ${dq(m.compatName || '')},`,
    `    isAugment:  ${!!m.isAugment},`,
    `    baseDrain:  ${m.baseDrain ?? 0},`,
    `    levelStats: ${levelStats},`,
    `  },`,
  ].join('\n');
}

function buildStubFromWiki(entry) {
  const cat     = wikiToWfcdCat(entry);
  const catWarn = cat === '???' ? ' // ← check category' : ' // TODO: verify';

  return [
    `  {`,
    `    name:       ${dq(entry.name)},`,
    `    category:   ${dq(cat)},${catWarn}`,
    `    drops:      null, // TODO: fill when WFCD has this mod`,
    `    maxRank:    ${entry.wikiMaxRank},`,
    `    polarity:   ${dq(entry.wikiPolarity)},`,
    `    rarity:     ${dq(entry.wikiRarity)},`,
    `    isExilus:   false,`,
    `    tradable:   ${entry.wikiTradable},`,
    `    compatName: null, // TODO: fill when WFCD has this mod`,
    `    isAugment:  ${entry.isAbilityAugment || entry.isWeaponAugment},`,
    `    baseDrain:  ${entry.wikiBaseDrain},`,
    `    levelStats: null, // TODO: fill when WFCD has this mod`,
    `  },`,
  ].join('\n');
}

// ── Apply stubs ───────────────────────────────────────────────────────────────

function applyStubs(stubs) {
  let content = fs.readFileSync(DATA_MODS, 'utf-8');
  const marker = 'const MODS = [';
  const start  = content.indexOf(marker);
  if (start === -1) { console.error('MODS array not found in data-mods.js'); process.exit(1); }
  const rest   = content.slice(start);
  const endRel = rest.lastIndexOf('\n];');
  if (endRel === -1) { console.error('End of MODS array not found'); process.exit(1); }
  const insertAt = start + endRel;

  // Last entry may lack a trailing comma — add one before inserting
  const before     = content.slice(0, insertAt);
  const needsComma = before.trimEnd().endsWith('}');
  const separator  = needsComma ? ',\n' : '\n';

  content = before + separator + stubs.join('\n') + content.slice(insertAt);
  fs.writeFileSync(DATA_MODS, content, 'utf-8');
  console.log(`  Inserted ${stubs.length} stub(s) into MODS`);
}

// ── Patch incomplete entries (null WFCD fields) ───────────────────────────────

// Returns entries that have any null WFCD fields, annotated with whether WFCD now has data.
function getIncompleteEntries(wfcdAllMap) {
  const src     = fs.readFileSync(DATA_MODS, 'utf-8');
  const results = [];
  for (const m of src.matchAll(/  \{([^{}]*)\}/g)) {
    const inner     = m[1];
    const nameMatch = inner.match(/name:\s+"((?:[^"\\]|\\.)*)"/);
    if (!nameMatch) continue;
    const name          = nameMatch[1];
    const hasNullDrops  = /drops:\s+null/.test(inner);
    const hasNullStats  = /levelStats:\s+null/.test(inner);
    const hasNullCompat = /compatName:\s+null/.test(inner);
    if (!hasNullDrops && !hasNullStats && !hasNullCompat) continue;
    const wfcdMod = wfcdAllMap?.get(name.toLowerCase()) || null;
    results.push({ name, wfcdMod, hasNullDrops, hasNullStats, hasNullCompat });
  }
  return results;
}

function patchIncompleteEntries(incomplete) {
  let content = fs.readFileSync(DATA_MODS, 'utf-8');
  let count   = 0;

  for (const { name, wfcdMod, hasNullDrops, hasNullStats, hasNullCompat } of incomplete) {
    if (!wfcdMod) continue;

    // Anchor to this entry's name line, then find its block extent
    const escapedName = JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRe      = new RegExp(`name:\\s+${escapedName},`);
    const nameMatch   = nameRe.exec(content);
    if (!nameMatch) continue;

    const nameIdx  = nameMatch.index;
    const nextEntry = content.indexOf('\n  {', nameIdx);
    const blockEnd  = nextEntry === -1 ? content.length : nextEntry;
    let   block     = content.slice(nameIdx, blockEnd);

    if (hasNullDrops) {
      const acq = [...new Set((wfcdMod.drops || []).map(d => d.location))];
      block = block.replace(/drops:\s+null,.*/, `drops:      ${JSON.stringify(acq)},`);
    }
    if (hasNullStats && wfcdMod.levelStats) {
      const ls = wfcdMod.levelStats.map(l => Array.isArray(l) ? l : (l.stats ?? []));
      block = block.replace(/levelStats:\s+null,.*/, `levelStats: ${JSON.stringify(ls)},`);
    }
    if (hasNullCompat && wfcdMod.compatName != null) {
      block = block.replace(/compatName:\s+null,.*/, `compatName: ${JSON.stringify(wfcdMod.compatName)},`);
    }

    content = content.slice(0, nameIdx) + block + content.slice(blockEnd);
    count++;
  }

  if (count > 0) {
    fs.writeFileSync(DATA_MODS, content, 'utf-8');
    console.log(`  Patched ${count} incomplete entry(ies) with WFCD data`);
  }
  return count;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args       = process.argv.slice(2);
  const wfcdOnly   = args.includes('--wfcd-only');
  const wikiOnly   = args.includes('--wiki-only');
  const showAll    = args.includes('--all');
  const doApply    = args.includes('--apply');
  const doRevert   = args.includes('--revert');
  const skipUpdate = args.includes('--skip-update');

  if (doRevert) { revert(); process.exit(0); }

  if (!wikiOnly && !skipUpdate) refreshWfcd();

  if (!fs.existsSync(DATA_MODS)) {
    console.error('data-mods.js not found at ' + DATA_MODS);
    process.exit(1);
  }

  const existingLower = getExistingModNames();

  let wfcdResult = null;
  let wikiResult = null;

  // ── WFCD pass ──────────────────────────────────────────────────────────────
  if (!wikiOnly) {
    console.log('Checking WFCD…');
    try {
      wfcdResult = extractFromWfcd(existingLower);
      console.log(`  WFCD: ${wfcdResult.total} mods, ${wfcdResult.newMods.length} new vs data-mods.js`);
    } catch (e) {
      console.warn(`  WFCD error — ${e.message}`);
    }
  }

  // ── Find existing stubs patchable from WFCD ────────────────────────────────
  const incompleteEntries = !wikiOnly ? getIncompleteEntries(wfcdResult?.allMap) : [];
  const patchable         = incompleteEntries.filter(e => e.wfcdMod);
  const stillWaiting      = incompleteEntries.filter(e => !e.wfcdMod);

  // ── Wiki pass ──────────────────────────────────────────────────────────────
  const wfcdHasNew = wfcdResult?.newMods.length > 0;
  if (!wfcdOnly && (!wfcdHasNew || wikiOnly || showAll)) {
    if (!wfcdHasNew && !wikiOnly) console.log('No new mods in WFCD — checking wiki for updates…');
    else console.log('Fetching wiki data…');
    try {
      wikiResult = await extractFromWiki(existingLower);
    } catch (e) {
      console.warn(`  Wiki fetch failed — ${e.message}`);
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const wfcdNew     = wfcdResult?.newMods || [];
  const wikiNew     = wikiResult?.newMods || [];
  const wikiIgnored = wikiResult?.ignored || [];
  const wfcdNames   = new Set(wfcdNew.map(m => m.name.toLowerCase()));
  const wikiOnlyNew = wikiNew.filter(m => !wfcdNames.has(m.name.toLowerCase()));
  const totalNew    = wfcdNew.length + wikiOnlyNew.length;

  console.log('\n' + '─'.repeat(60));

  if (wfcdNew.length) {
    console.log(`\nNew mods confirmed by WFCD (${wfcdNew.length}):`);
    for (const m of wfcdNew) console.log(buildStubFromWfcd(m));
  }

  if (wikiOnlyNew.length) {
    console.log(`\nWiki-only — verify released before adding (${wikiOnlyNew.length}):`);
    for (const m of wikiOnlyNew) console.log(buildStubFromWiki(m));
  }

  if (wikiIgnored.length) {
    console.log(`\nUnreleased (_IgnoreEntry=true) — do not add (${wikiIgnored.length}):`);
    wikiIgnored.forEach(n => console.log(`  # ${n}`));
  }

  if (patchable.length) {
    console.log(`\nIncomplete entries now patchable from WFCD (${patchable.length}):`);
    for (const e of patchable) {
      const fields = [e.hasNullDrops && 'drops', e.hasNullStats && 'levelStats', e.hasNullCompat && 'compatName']
        .filter(Boolean).join(', ');
      console.log(`  ${e.name}  [${fields}]`);
    }
  }

  if (stillWaiting.length) {
    console.log(`\nIncomplete entries still waiting for WFCD data (${stillWaiting.length}):`);
    for (const e of stillWaiting) console.log(`  ${e.name}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`${totalNew} new | ${patchable.length} patchable | ${stillWaiting.length} waiting`);

  if (totalNew === 0 && patchable.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  if (!doApply) {
    if (totalNew > 0)
      console.log(`${totalNew} new mod(s) found. Review stubs above, then run with --apply to insert.`);
    if (patchable.length > 0)
      console.log(`${patchable.length} incomplete entry(ies) can be patched. Run with --apply to patch.`);
    return;
  }

  console.log('\nApplying changes…');
  saveBackup();
  if (totalNew > 0) {
    applyStubs([
      ...wfcdNew.map(buildStubFromWfcd),
      ...wikiOnlyNew.map(buildStubFromWiki),
    ]);
  }
  if (patchable.length > 0) {
    patchIncompleteEntries(patchable);
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
