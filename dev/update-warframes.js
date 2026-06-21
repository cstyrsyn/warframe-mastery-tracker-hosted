// update-warframes.js
// Checks WFCD and wiki for new warframes not yet in data-items.js.
// With --apply: inserts stubs into WARFRAMES (obtain method left as TODO),
// syncs VAULTED_WF, and adds derivable WARFRAME_ABILITIES entries.
//
// Usage:
//   node dev/update-warframes.js              # detect new warframes + vaulted/ability changes
//   node dev/update-warframes.js --wfcd-only  # skip wiki fallback
//   node dev/update-warframes.js --wiki-only  # skip WFCD, use wiki directly
//   node dev/update-warframes.js --all        # always fetch wiki (ensures ability data when WFCD has new frames)
//   node dev/update-warframes.js --apply      # insert stubs + write VAULTED_WF + ability changes
//   node dev/update-warframes.js --images     # download images for detected new warframes
//   node dev/update-warframes.js --revert     # restore most recent backup

'use strict';

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const luaparse = require('luaparse');

const WFCD_WARFRAMES = path.join(__dirname, 'node_modules/@wfcd/items/data/json/Warframes.json');
const DATA_ITEMS     = path.join(__dirname, '..', 'data', 'data-items.js');
const DATA_ABILITIES = path.join(__dirname, '..', 'data', 'data-abilities.js');
const BACKUP_DIR     = path.join(__dirname, 'backups', 'warframes');
const KEEP_BACKUPS   = 5;
const WIKI_URL       = 'https://wiki.warframe.com/w/Module:Warframes/data?action=raw';

// Names always excluded regardless of source — founder-exclusive, Orion&Sirius and non-game items.
// O&S has been added manually as it is considered by the game to be a Warframe with an Exalted Warframe.
// 'Sirius & Orion' is the combined key used in data-items.js; all three forms must be excluded.
const ALWAYS_EXCLUDE = new Set(['Excalibur Prime', 'Excalibur Umbra Prime', 'Orion', 'Sirius', 'Sirius & Orion', 'Stalker']);

// WFCD puts Necramechs (Bonewidow, Voidrig) and Helminth in the Warframes category.
// Filter by uniqueName prefix to exclude them — our data tracks these in other tabs.
const WFCD_EXCLUDE_UNIQUE_PREFIXES = [
  '/Lotus/Powersuits/EntratiMech/',        // Necramechs → tracked in VEHICLES
  '/Lotus/Powersuits/PowersuitAbilities/', // Helminth → not a playable frame
];
function isWfcdNoise(entry) {
  if (ALWAYS_EXCLUDE.has(entry.name)) return true;
  return WFCD_EXCLUDE_UNIQUE_PREFIXES.some(p => (entry.uniqueName || '').startsWith(p));
}

// Primes whose obtain string indicates permanent accessibility outside the vault.
// These are intentionally kept OUT of VAULTED_WF regardless of their technical vault status.
const OBTAIN_PERMA_ACCESSIBLE_RE = /\(Perma-unvaulted\)|Baro Ki'Teer/i;

// ── Backup / revert ──────────────────────────────────────────────────────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

function saveBackup() {
  ensureBackupDir();
  const ts    = backupTimestamp();
  const saved = [];

  if (fs.existsSync(DATA_ITEMS)) {
    const dest = path.join(BACKUP_DIR, `data-items-${ts}.js`);
    fs.copyFileSync(DATA_ITEMS, dest);
    saved.push(path.basename(dest));
  }
  if (fs.existsSync(DATA_ABILITIES)) {
    const dest = path.join(BACKUP_DIR, `data-abilities-${ts}.js`);
    fs.copyFileSync(DATA_ABILITIES, dest);
    saved.push(path.basename(dest));
  }
  if (saved.length) console.log(`Backed up: ${saved.join(', ')}`);

  const pivot = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-items-')).sort();
  if (pivot.length > KEEP_BACKUPS) {
    const toDelete = pivot.slice(0, pivot.length - KEEP_BACKUPS);
    for (const f of toDelete) {
      fs.rmSync(path.join(BACKUP_DIR, f));
      const pair = f.replace('data-items-', 'data-abilities-');
      if (fs.existsSync(path.join(BACKUP_DIR, pair))) fs.rmSync(path.join(BACKUP_DIR, pair));
    }
    console.log(`Trimmed ${toDelete.length} old backup(s)`);
  }
}

function revert() {
  ensureBackupDir();
  const pivot = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-items-')).sort();
  if (!pivot.length) { console.error('No backups found.'); process.exit(1); }
  const latest = pivot[pivot.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_ITEMS);
  console.log(`Restored data-items.js from ${latest}`);

  const ts   = latest.replace('data-items-', '').replace('.js', '');
  const pair = path.join(BACKUP_DIR, `data-abilities-${ts}.js`);
  if (fs.existsSync(pair)) {
    fs.copyFileSync(pair, DATA_ABILITIES);
    console.log(`Restored data-abilities.js from data-abilities-${ts}.js`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function nodeToJs(node) {
  if (!node) return null;
  switch (node.type) {
    case 'NumericLiteral': return node.value;
    case 'StringLiteral': {
      const r = node.raw;
      if (r[0] === '"' || r[0] === "'") return r.slice(1, -1);
      if (r.startsWith('[[')) return r.slice(2, -2);
      return r;
    }
    case 'BooleanLiteral': return node.value;
    case 'NilLiteral':     return null;
    case 'UnaryExpression':
      return node.operator === '-' ? -nodeToJs(node.argument) : nodeToJs(node.argument);
    case 'TableConstructorExpression': {
      const hasNamed = node.fields.some(f => f.type === 'TableKeyString' || f.type === 'TableKey');
      if (!hasNamed) return node.fields.map(f => nodeToJs(f.value));
      const obj = {};
      let idx = 1;
      for (const field of node.fields) {
        if (field.type === 'TableKeyString')    obj[field.key.name]     = nodeToJs(field.value);
        else if (field.type === 'TableKey')     obj[nodeToJs(field.key)] = nodeToJs(field.value);
        else                                    obj[idx++]              = nodeToJs(field.value);
      }
      return obj;
    }
    default: return null;
  }
}

// ── Category derivation ───────────────────────────────────────────────────────

function deriveCategory(name) {
  if (name.includes('Prime')) return 'Prime';
  if (name.includes('Umbra')) return 'Umbra';
  return 'Base';
}

// Build a stub data-items.js line — user must fill in the obtain string.
function makeStubLine(name) {
  const cat      = deriveCategory(name);
  const tradable = cat === 'Prime' ? ',1' : '';
  return `  ['${name}','${cat}','TODO: obtain method',30${tradable}],`;
}

// ── WFCD extraction ───────────────────────────────────────────────────────────

function extractFromWfcd() {
  if (!fs.existsSync(WFCD_WARFRAMES))
    throw new Error('@wfcd/items not installed — run: npm install @wfcd/items');
  const raw = JSON.parse(fs.readFileSync(WFCD_WARFRAMES, 'utf-8'));
  const wf  = raw.filter(w => w.category === 'Warframes' && !isWfcdNoise(w));
  return new Map(wf.map(w => [w.name, w]));
}

// ── Wiki extraction ───────────────────────────────────────────────────────────

// Returns:
//   standard : Map<name, { vaulted, abilities: string[]|null }>  — regular warframes
//   paired   : [{ combinedName, members, vaulted, memberAbilities }]  — duo frames sharing one slot
//   special  : [{ name, entry }]  — solo _IgnoreEntry frames needing manual review
async function extractFromWiki() {
  console.log('  Fetching wiki Module:Warframes/data…');
  const lua = await fetch(WIKI_URL);
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast     = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  const retStmt = ast.body.find(s => s.type === 'ReturnStatement');
  if (!retStmt) throw new Error('No return statement found in wiki Lua module');

  const root      = nodeToJs(retStmt.arguments[0]);
  const wfSection = root.Warframes;
  if (!wfSection) throw new Error('Warframes key not found in wiki module');

  const standard = new Map();
  const ignored  = new Map(); // name → entry, for _IgnoreEntry ones

  for (const [name, entry] of Object.entries(wfSection)) {
    if (ALWAYS_EXCLUDE.has(name)) continue;
    if (entry._IgnoreEntry) {
      ignored.set(name, entry);
    } else {
      const abilities = Array.isArray(entry.Abilities)
        ? entry.Abilities.filter(a => typeof a === 'string')
        : null;
      standard.set(name, { vaulted: entry.Vaulted === true, abilities });
    }
  }

  // Group ignored entries by their Link value.
  // Multiple entries sharing a Link → paired duo (one shared slot).
  // A solo entry → special case requiring manual review.
  const byLink = new Map();
  for (const [name, entry] of ignored) {
    const link = entry.Link || name;
    if (!byLink.has(link)) byLink.set(link, []);
    byLink.get(link).push({ name, entry });
  }

  const paired  = [];
  const special = [];
  for (const [link, group] of byLink) {
    // A link containing "/" is a subpage (e.g. "Sevagoth/Abilities") — this means
    // the entries are ability sub-forms of an existing warframe, not a new standalone frame.
    if (link.includes('/')) continue;

    if (group.length > 1) {
      const vaulted = group.every(g => g.entry.Vaulted === true);
      const memberAbilities = group.map(g => ({
        name:      g.name,
        abilities: Array.isArray(g.entry.Abilities)
          ? g.entry.Abilities.filter(a => typeof a === 'string')
          : null,
      }));
      paired.push({ combinedName: link, members: group.map(g => g.name), vaulted, memberAbilities });
    } else {
      special.push({ name: group[0].name, entry: group[0].entry });
    }
  }

  return { standard, paired, special };
}

// ── relics.js corroboration ───────────────────────────────────────────────────

// Returns a Set of prime item names that have active (non-vaulted) relic drops.
// Used to corroborate wiki-only new primes as genuinely released.
function getActiveRelicItems() {
  const relicsJs = path.join(__dirname, '..', 'data', 'data-relics.js');
  if (!fs.existsSync(relicsJs)) return new Set();
  const js  = fs.readFileSync(relicsJs, 'utf-8');
  const out = new Set();
  // RELIC_DROPS lines: ["Item Name",[0,[{...}]]] — second element is array starting with isVaulted
  for (const m of js.matchAll(/\["([^"]+)",\[0,/g)) out.add(m[1]);
  return out;
}

// ── data-items.js readers ─────────────────────────────────────────────────────

// Returns Map<name, obtainString> for all warframes in data-items.js.
function getExistingWarframes() {
  if (!fs.existsSync(DATA_ITEMS)) return new Map();
  const js  = fs.readFileSync(DATA_ITEMS, 'utf-8');
  const out = new Map();
  for (const m of js.matchAll(/^\s*\['([^']+)','(?:Base|Prime|Umbra)','([^']*)'/gm))
    out.set(m[1], m[2]);
  return out;
}

function getVaultedWF() {
  if (!fs.existsSync(DATA_ITEMS)) return new Set();
  const js    = fs.readFileSync(DATA_ITEMS, 'utf-8');
  const match = js.match(/const VAULTED_WF = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) return new Set();
  const out = new Set();
  for (const m of match[1].matchAll(/'([^']+)'/g)) out.add(m[1]);
  return out;
}

// ── data-abilities.js reader / writer ────────────────────────────────────────

function getExistingAbilities() {
  if (!fs.existsSync(DATA_ABILITIES)) return new Map();
  const js  = fs.readFileSync(DATA_ABILITIES, 'utf-8');
  const out = new Map();
  for (const m of js.matchAll(/^\s+"([^"]+)":\s*\[([^\]]+)\]/gm)) {
    const abilities = [...m[2].matchAll(/"([^"]+)"/g)].map(a => a[1]);
    out.set(m[1], abilities);
  }
  return out;
}

// newEntries: [{ name, abilities: string[] }]
function applyAbilityChanges(newEntries) {
  let js = fs.readFileSync(DATA_ABILITIES, 'utf-8');

  for (const { name, abilities } of newEntries) {
    const line = `  "${name}": [${abilities.map(a => `"${a}"`).join(', ')}],\n`;

    // For primes: insert right after the base variant's line
    if (name.endsWith(' Prime')) {
      const base      = name.slice(0, -6);
      const baseStart = js.indexOf(`  "${base}": [`);
      if (baseStart !== -1) {
        const baseEnd = js.indexOf('\n', baseStart) + 1;
        js = js.slice(0, baseEnd) + line + js.slice(baseEnd);
        continue;
      }
    }

    // Fallback: insert alphabetically before the first entry whose name sorts after this one
    const allEntries = [...js.matchAll(/^  "([^"]+)":/gm)];
    let insertPos = -1;
    for (const m of allEntries) {
      if (m[1].toLowerCase() > name.toLowerCase()) { insertPos = m.index; break; }
    }
    if (insertPos !== -1) {
      js = js.slice(0, insertPos) + line + js.slice(insertPos);
    } else {
      // Append before the closing }; of WARFRAME_ABILITIES
      const closePos = js.lastIndexOf('\n};');
      if (closePos !== -1) js = js.slice(0, closePos + 1) + line + js.slice(closePos + 1);
    }
  }

  fs.writeFileSync(DATA_ABILITIES, js, 'utf-8');
}

// ── WARFRAMES inserter ────────────────────────────────────────────────────────

function applyWarframeStubs(stubs) {
  let src = fs.readFileSync(DATA_ITEMS, 'utf-8');
  const marker = 'const WARFRAMES = [';
  const start  = src.indexOf(marker);
  if (start === -1) { console.error('WARFRAMES array not found in data-items.js'); process.exit(1); }
  const rest   = src.slice(start);
  const endRel = rest.search(/\n\];/);
  if (endRel === -1) { console.error('End of WARFRAMES array not found'); process.exit(1); }
  const insertAt = start + endRel;
  src = src.slice(0, insertAt) + '\n' + stubs.join('\n') + src.slice(insertAt);
  fs.writeFileSync(DATA_ITEMS, src, 'utf-8');
  console.log(`  Inserted ${stubs.length} stub(s) into data-items.js (WARFRAMES)`);
}

// ── VAULTED_WF writer ─────────────────────────────────────────────────────────

function applyVaultedChanges(toAdd, toRemove) {
  const js      = fs.readFileSync(DATA_ITEMS, 'utf-8');
  const MARKER  = 'const VAULTED_WF = new Set([';
  const start   = js.indexOf(MARKER);
  if (start === -1) throw new Error('VAULTED_WF not found in data-items.js');
  const rest    = js.slice(start);
  const endM    = rest.match(/\n\]\);/);
  if (!endM) throw new Error('End of VAULTED_WF not found');
  const blockEnd = start + endM.index + endM[0].length;

  const block = js.slice(start, blockEnd);
  const names = new Set();
  for (const m of block.matchAll(/'([^']+)'/g)) names.add(m[1]);

  for (const n of toAdd)    names.add(n);
  for (const n of toRemove) names.delete(n);

  const sorted   = [...names].sort();
  const PER_LINE = 5;
  let newBlock   = MARKER + '\n';
  for (let i = 0; i < sorted.length; i += PER_LINE)
    newBlock += '  ' + sorted.slice(i, i + PER_LINE).map(n => `'${n}'`).join(',') + ',\n';
  newBlock += ']);';

  const updated = js.slice(0, start) + newBlock + js.slice(blockEnd);
  fs.writeFileSync(DATA_ITEMS, updated, 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const wfcdOnly = args.includes('--wfcd-only');
  const wikiOnly = args.includes('--wiki-only');
  const showAll  = args.includes('--all');
  const apply    = args.includes('--apply');
  const doImages = args.includes('--images');

  if (args.includes('--revert')) { revert(); return; }

  const existing       = getExistingWarframes(); // Map<name, obtainStr>
  const existingNames  = new Set(existing.keys());
  const currentVaulted = getVaultedWF();

  // ── Source selection ──────────────────────────────────────────────
  let wfNames;                   // Map<name, { vaulted: bool, abilities: string[]|null }>
  let wfNamesSource = 'wiki';    // 'wiki' or 'WFCD' — used to tag ability gap sources
  let wfcdNames = new Set();     // names confirmed by WFCD (used to flag wiki-only entries)
  let wikiPaired  = [];          // [{ combinedName, members, vaulted }]
  let wikiSpecial = [];          // [{ name, entry }]

  const wfcdAbilities = v =>
    Array.isArray(v.abilities) ? v.abilities.map(a => a.name).filter(Boolean) : null;

  if (wikiOnly) {
    console.log('Wiki-only mode');
    const wiki  = await extractFromWiki();
    wfNames     = wiki.standard;
    wikiPaired  = wiki.paired;
    wikiSpecial = wiki.special;
  } else {
    console.log('Checking WFCD…');
    const wfcdMap = extractFromWfcd();
    wfcdNames     = new Set(wfcdMap.keys());
    const wfcdNew = [...wfcdMap.keys()].filter(n => !existingNames.has(n));
    console.log(`  WFCD: ${wfcdMap.size} warframes, ${wfcdNew.length} new vs data-items.js`);
    wfcdNew.forEach(n => console.log(`    + ${n}`));

    if (!wfcdOnly && (wfcdNew.length === 0 || showAll)) {
      if (wfcdNew.length === 0) console.log('  No new warframes in WFCD — checking wiki for updates…');
      else                      console.log('  Fetching wiki data…');
      try {
        const wiki  = await extractFromWiki();
        wikiPaired  = wiki.paired;
        wikiSpecial = wiki.special;
        const wikiNew = [...wiki.standard.keys()].filter(n => !existingNames.has(n));
        console.log(`  Wiki: ${wiki.standard.size} warframes, ${wikiNew.length} new vs data-items.js`);
        wikiNew.forEach(n => console.log(`    + ${n}`));
        wfNames = wiki.standard;
      } catch (e) {
        console.warn(`  Wiki fetch failed (${e.message}) — using WFCD only`);
        wfNames = new Map([...wfcdMap.entries()].map(([n, v]) => [n, {
          vaulted: false, abilities: wfcdAbilities(v),
        }]));
        wfNamesSource = 'WFCD';
      }
    } else {
      wfNames = new Map([...wfcdMap.entries()].map(([n, v]) => [n, {
        vaulted: !!v.vaulted, abilities: wfcdAbilities(v),
      }]));
      wfNamesSource = 'WFCD';
    }
  }

  // ── New warframe detection ────────────────────────────────────────
  const newWarframes = [...wfNames.keys()].filter(n => !existingNames.has(n)).sort();

  const activeRelicItems = getActiveRelicItems();
  const confirmedNew     = newWarframes.filter(n => wfcdNames.has(n) || wikiOnly);
  const relicsCorroborated = newWarframes.filter(n => !wfcdNames.has(n) && !wikiOnly && activeRelicItems.has(n));
  const unverifiedNew      = newWarframes.filter(n => !wfcdNames.has(n) && !wikiOnly && !activeRelicItems.has(n));
  const readyToAdd         = [...confirmedNew, ...relicsCorroborated].sort();

  // Paired duo entries new to data-items.js (neither combined name nor any member present)
  const newPaired = wikiPaired.filter(p =>
    !existingNames.has(p.combinedName) && p.members.every(m => !existingNames.has(m))
  );
  // Solo _IgnoreEntry entries not yet in data-items.js
  const newSpecial = wikiSpecial.filter(p => !existingNames.has(p.name));

  const totalNew = newWarframes.length + newPaired.length + newSpecial.length;

  console.log('\n' + '─'.repeat(60));
  console.log(`\nNew warframes (${totalNew}):`);
  if (totalNew === 0) {
    console.log('  None — data-items.js is up to date.');
  } else {
    if (readyToAdd.length) {
      const src = n => wfcdNames.has(n) ? 'WFCD' : 'wiki+relics';
      console.log('  Confirmed new (will be inserted by --apply):');
      console.log();
      for (const name of readyToAdd) console.log(`  ${makeStubLine(name)}  // ${src(name)}`);
      console.log();
    }
    if (newPaired.length) {
      console.log('  Dual-form warframes — inserted as a single combined entry by --apply:');
      console.log();
      for (const p of newPaired) {
        console.log(`  ${makeStubLine(p.combinedName)}  // forms: ${p.members.join(', ')}`);
      }
      console.log();
    }
    if (newSpecial.length) {
      console.log('  Special wiki entries (non-standard acquisition) — verify before adding manually:');
      console.log();
      for (const s of newSpecial) console.log(`  # ${makeStubLine(s.name)}`);
      console.log();
    }
    if (unverifiedNew.length) {
      console.log('  Wiki-only, not in WFCD or relics.js — may be unreleased, verify before adding:');
      console.log();
      for (const name of unverifiedNew) console.log(`  # ${makeStubLine(name)}`);
      console.log();
    }
    if (readyToAdd.length || newPaired.length)
      console.log('  NOTE: After inserting, fill in TODO obtain methods. For new active primes also update CIRCUIT_WF_SCHEDULE and OVERFRAME_MAP.');
  }

  // ── VAULTED_WF sync ───────────────────────────────────────────────
  // A prime belongs in VAULTED_WF only if:
  //   - the source says it's vaulted
  //   - it's already in data-items.js
  //   - its obtain string is plain 'Relics' (no perma-unvaulted / Baro note)
  const primes = [...wfNames.keys()].filter(n => n.includes('Prime'));
  const shouldBeVaulted = new Set(
    primes.filter(n => {
      if (!wfNames.get(n).vaulted) return false;
      const obtain = existing.get(n) ?? '';
      return !OBTAIN_PERMA_ACCESSIBLE_RE.test(obtain);
    })
  );
  const toAdd    = [...shouldBeVaulted].filter(n => !currentVaulted.has(n) && existingNames.has(n)).sort();
  const toRemove = [...currentVaulted].filter(n => !shouldBeVaulted.has(n)).sort();

  console.log('\n' + '─'.repeat(60));
  console.log(`\nVAULTED_WF changes (${toAdd.length + toRemove.length}):`);
  if (!toAdd.length && !toRemove.length) {
    console.log('  None — VAULTED_WF is already in sync.');
  } else {
    toAdd.forEach(n    => console.log(`  + add:    ${n}`));
    toRemove.forEach(n => console.log(`  - remove: ${n}`));
  }

  // ── WARFRAME_ABILITIES sync ───────────────────────────────────────
  const existingAbilities = getExistingAbilities();
  const abilityGaps = [];

  for (const name of [...existingNames].sort()) {
    if (existingAbilities.has(name)) continue;
    if (ALWAYS_EXCLUDE.has(name)) continue;

    // For primes: copy abilities from the base variant
    if (name.endsWith(' Prime')) {
      const base      = name.slice(0, -6);
      const baseAbils = existingAbilities.get(base) ?? (wfNames.get(base)?.abilities ?? null);
      if (baseAbils) {
        abilityGaps.push({ name, abilities: baseAbils, source: `from ${base}` });
        continue;
      }
    }

    // Use abilities from wfNames (WFCD or wiki depending on which source was loaded)
    const knownAbils = wfNames.get(name)?.abilities ?? null;
    if (knownAbils && knownAbils.length) {
      abilityGaps.push({ name, abilities: knownAbils, source: wfNamesSource });
      continue;
    }

    // Paired duo warframe — abilities live under member names, not the combined name.
    // If all members are already in WARFRAME_ABILITIES (or can be derived), skip the combined entry.
    const pairedEntry = wikiPaired.find(p => p.combinedName === name);
    if (pairedEntry) {
      for (const ma of (pairedEntry.memberAbilities ?? [])) {
        if (existingAbilities.has(ma.name)) continue;
        if (ma.abilities?.length) {
          abilityGaps.push({ name: ma.name, abilities: ma.abilities, source: `wiki (form of ${name})` });
        } else {
          abilityGaps.push({ name: ma.name, abilities: ['TODO', 'TODO', 'TODO', 'TODO'], source: `unknown — check wiki (form of ${name})` });
        }
      }
      continue; // never report the combined name itself
    }

    // For items that look like "A & B" and both members are already present, skip silently
    if (name.includes(' & ')) {
      const members = name.split(' & ');
      if (members.every(m => existingAbilities.has(m))) continue;
    }

    abilityGaps.push({ name, abilities: ['TODO', 'TODO', 'TODO', 'TODO'], source: 'unknown — check wiki' });
  }

  const autoApplicable = abilityGaps.filter(g => !g.abilities.includes('TODO'));

  console.log('\n' + '─'.repeat(60));
  console.log(`\nWARFRAME_ABILITIES gaps (${abilityGaps.length}):`);
  if (!abilityGaps.length) {
    console.log('  None — data-abilities.js is up to date.');
  } else {
    console.log('  Add to WARFRAME_ABILITIES in data-abilities.js:');
    console.log();
    for (const { name, abilities, source } of abilityGaps) {
      const line = `  "${name}": [${abilities.map(a => `"${a}"`).join(', ')}],`;
      console.log(`  ${line}  // ${source}`);
    }
    console.log();
  }

  // ── Apply ─────────────────────────────────────────────────────────
  const newStubs           = [
    ...readyToAdd.map(n => makeStubLine(n)),
    ...newPaired.map(p => makeStubLine(p.combinedName)),
  ];
  const hasNewWarframes    = newStubs.length > 0;
  const hasVaultedChanges  = toAdd.length + toRemove.length > 0;
  const hasAbilityChanges  = autoApplicable.length > 0;
  const hasManualAbilities = abilityGaps.length > autoApplicable.length;
  const hasAnyChanges      = hasNewWarframes || hasVaultedChanges || hasAbilityChanges;

  console.log('\n' + '─'.repeat(60));
  console.log(`${totalNew} new warframes | ${toAdd.length + toRemove.length} vaulted changes | ${abilityGaps.length} ability gaps`);

  if (!hasAnyChanges && !hasManualAbilities) {
    console.log('Nothing to update.');
  } else if (apply) {
    if (hasAnyChanges) {
      console.log('\nApplying changes…');
      saveBackup();
      if (hasNewWarframes) {
        applyWarframeStubs(newStubs);
      }
      if (hasVaultedChanges) {
        applyVaultedChanges(toAdd, toRemove);
        console.log('  data-items.js updated (VAULTED_WF)');
      }
      if (hasAbilityChanges) {
        applyAbilityChanges(autoApplicable);
        console.log(`  data-abilities.js updated (+${autoApplicable.length} entries)`);
      }
      if (hasManualAbilities) {
        const n = abilityGaps.length - autoApplicable.length;
        console.log(`  ${n} ability entry/entries still need manual input (TODO placeholders above).`);
      }
    } else if (hasManualAbilities) {
      console.log('\nNo auto-derivable changes — fill in the TODO abilities above, then re-run --apply.');
    }
  } else {
    const parts = [];
    if (hasNewWarframes)   parts.push(`${newStubs.length} new warframe stub(s)`);
    if (hasVaultedChanges) parts.push(`${toAdd.length + toRemove.length} VAULTED_WF change(s)`);
    if (hasAbilityChanges) parts.push(`${autoApplicable.length} abilities`);
    if (hasManualAbilities && !hasAnyChanges)
      console.log('\nNo auto-derivable changes — fill in the TODO abilities above, then re-run --apply.');
    else if (parts.length)
      console.log(`Run with --apply to write: ${parts.join(', ')}.`);
  }

  // ── Image download ────────────────────────────────────────────────
  // Scans all tracked warframes for missing image files — not just newly-detected ones.
  // Also runs automatically during --apply so new stubs get their images in the same pass.
  if (doImages || apply) {
    const IMAGES_DIR = path.join(__dirname, '..', 'Images', 'warframes');
    const missing = [...existing.keys()].filter(name => {
      const dest = path.join(IMAGES_DIR, name.replace(/ /g, '') + 'Helmet.png');
      return !fs.existsSync(dest);
    });
    if (!missing.length) {
      console.log('\nAll warframe images already present.');
    } else {
      let downloaded = 0, notFound = 0;
      console.log(`\n── Downloading warframe images (${missing.length} missing) ────────────────────`);
      for (const name of missing) {
        const filename = name.replace(/ /g, '') + 'Helmet.png';
        const destPath = path.join(IMAGES_DIR, filename);
        try {
          const result = await downloadWikiImage(filename, destPath);
          const icon = result === 'downloaded' ? '✓' : result === 'exists' ? '=' : '?';
          console.log(`  ${icon} ${name}: ${result}`);
          if (result === 'downloaded') downloaded++;
          else if (result === 'not-found') notFound++;
        } catch (e) {
          console.error(`  ✗ ${name}: FAILED — ${e.message}`);
          notFound++;
        }
      }
      console.log(`\n  Downloaded: ${downloaded}  Not found on wiki: ${notFound}`);
      if (apply && notFound > 0)
        console.log(`  ${notFound} image(s) not yet on wiki — re-run with --images once available.`);
    }
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('ERROR:', err.message); process.exit(1); });
