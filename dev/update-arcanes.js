// update-arcanes.js
// Detects new arcanes in WFCD + wiki not yet in data-arcanes.js.
// Without --apply: read-only, prints stub lines for review.
// With --apply: backs up data-arcanes.js then inserts stubs.
//
// Usage:
//   node dev/update-arcanes.js              # WFCD first; wiki fallback if nothing new
//   node dev/update-arcanes.js --wfcd-only  # skip wiki
//   node dev/update-arcanes.js --wiki-only  # skip WFCD
//   node dev/update-arcanes.js --all        # check both regardless
//   node dev/update-arcanes.js --apply      # write stubs into data-arcanes.js (backs up first)
//   node dev/update-arcanes.js --revert     # restore data-arcanes.js from latest backup

'use strict';

const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const luaparse     = require('luaparse');
const { execSync } = require('child_process');

const DATA_ARCANES = path.join(__dirname, '..', 'data-arcanes.js');
const WFCD_DIR     = path.join(__dirname, 'node_modules/@wfcd/items/data/json');
const WIKI_URL     = 'https://wiki.warframe.com/w/Module:Arcane/data?action=raw';
const BACKUP_DIR   = path.join(__dirname, 'backups', 'arcanes');
const KEEP_BACKUPS = 5;

const ALWAYS_EXCLUDE = new Set(['Arcane Defense', 'Arcane Detoxifier', 'Arcane Liquid','Arcane Protection','Arcane Shield','Arcane Survival','Arcane Temperance']);

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
  const dest = path.join(BACKUP_DIR, `data-arcanes-${ts}.js`);
  fs.copyFileSync(DATA_ARCANES, dest);
  console.log(`Backed up: ${path.basename(dest)}`);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-arcanes-') && f.endsWith('.js'))
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
    .filter(f => f.startsWith('data-arcanes-') && f.endsWith('.js'))
    .sort();
  if (!files.length) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
  const latest = files[files.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_ARCANES);
  console.log(`Reverted data-arcanes.js from ${latest}`);
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

// ── data-arcanes.js reader ────────────────────────────────────────────────────

function getExistingArcaneNames() {
  const src    = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANES = [';
  const start  = src.indexOf(marker);
  if (start === -1) return new Set();
  const rest    = src.slice(start);
  const end     = rest.search(/\n\];/);
  const section = end === -1 ? rest : rest.slice(0, end);
  const names   = new Set();
  for (const m of section.matchAll(/^\s+\['([^']+)'/gm)) names.add(m[1].toLowerCase());
  return names;
}

function getExistingDescNames() {
  const src    = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANE_DESC = {';
  const start  = src.indexOf(marker);
  if (start === -1) return new Set();
  const rest    = src.slice(start);
  const end     = rest.search(/\n\};/);
  const section = end === -1 ? rest : rest.slice(0, end);
  const names   = new Set();
  for (const m of section.matchAll(/^\s+'([^']+)':/gm)) names.add(m[1].toLowerCase());
  return names;
}

// ── WFCD arcane type → our type field ────────────────────────────────────────

function wfcdArcaneType(wfcdType) {
  const MAP = {
    'Amp Arcane':       'Amp',
    'Arcane':           'Warframe', // legacy arcanes without a specific slot type
    'Bow Arcane':       'Primary',
    'Kitgun Arcane':    'Kitgun',
    'Melee Arcane':     'Melee',
    'Operator Arcane':  'Operator',
    'Primary Arcane':   'Primary',
    'Secondary Arcane': 'Secondary',
    'Shotgun Arcane':   'Primary',
    'Warframe Arcane':  'Warframe',
    'Zaw Arcane':       'Zaw',
  };
  return MAP[wfcdType] || '???';
}

// ── Wiki arcane type → our type field ────────────────────────────────────────

function wikiArcaneType(wikiType) {
  const MAP = {
    'Amp':                 'Amp',
    'Bow':                 'Primary',
    'Kitgun':              'Kitgun',
    'Melee':               'Melee',
    'Operator':            'Operator',
    'Primary':             'Primary',
    'Secondary':           'Secondary',
    'Shotgun':             'Primary',
    'Tektolyst Artifacts': 'Tektolyst',
    'Warframe':            'Warframe',
    'Zaw':                 'Zaw',
  };
  return MAP[wikiType] || wikiType || '???';
}

// ── WFCD extraction ───────────────────────────────────────────────────────────

function extractFromWfcd(existingLower) {
  const wfcdFile = path.join(WFCD_DIR, 'Arcanes.json');
  if (!fs.existsSync(wfcdFile)) throw new Error('@wfcd/items not installed — run: npm install @wfcd/items');

  const raw     = JSON.parse(fs.readFileSync(wfcdFile, 'utf-8'));
  const allMap  = new Map(raw.filter(a => a.name && !ALWAYS_EXCLUDE.has(a.name)).map(a => [a.name.toLowerCase(), a]));
  const newOnes = raw.filter(a => a.name && !existingLower.has(a.name.toLowerCase()) && !ALWAYS_EXCLUDE.has(a.name));
  return { total: raw.length, newArcanes: newOnes, allMap };
}

// ── Wiki extraction ───────────────────────────────────────────────────────────

async function extractFromWiki(existingLower) {
  console.log('  Fetching wiki Module:Arcane/data…');
  const lua = await fetch(WIKI_URL);
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });

  // Module:Arcane/data uses: return { Arcanes = { ... } }
  // Also handle the local-variable pattern used by Module:Mods/data just in case.
  let tableNode = null;
  for (const stmt of ast.body) {
    if (stmt.type === 'ReturnStatement' && stmt.arguments[0]?.type === 'TableConstructorExpression') {
      tableNode = stmt.arguments[0];
      break;
    }
    if (stmt.type === 'LocalStatement' && stmt.init?.[0]?.type === 'TableConstructorExpression') {
      tableNode = stmt.init[0];
      break;
    }
  }
  if (!tableNode) throw new Error('Could not find table data in Module:Arcane/data');

  const root         = nodeToJs(tableNode);
  const arcaneTable  = root.Arcanes;
  if (!arcaneTable) throw new Error('"Arcanes" key not found in wiki module');

  const newArcanes = [];
  const wikiAllMap = new Map();

  for (const [, entry] of Object.entries(arcaneTable)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = entry.Name || entry.Link;
    if (!name) continue;
    if (ALWAYS_EXCLUDE.has(name)) continue;
    if (entry._IgnoreEntry) continue;

    const wikiDesc = entry.Description || entry.Effect || '';
    wikiAllMap.set(name.toLowerCase(), { name, wikiDesc });

    if (existingLower.has(name.toLowerCase())) continue;

    newArcanes.push({
      name,
      wikiType:    entry.Type    || '',
      wikiMaxRank: entry.MaxRank ?? 5,
      wikiRarity:  entry.Rarity  || '',
      wikiDesc,
    });
  }

  return { newArcanes, wikiAllMap };
}

// ── Stub builders ─────────────────────────────────────────────────────────────

function q(s)   { return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
function arr(a) { return `[${a.map(q).join(',')}]`; }

function buildStubFromWfcd(a) {
  const type     = wfcdArcaneType(a.type);
  const acq      = [...new Set((a.drops || []).map(d => d.location))];
  const maxRank  = (a.levelStats?.length ?? 6) - 1;
  const rarity   = a.rarity || '';
  const tradable = a.tradable ? 1 : 0;
  const warn     = type === '???' ? '  // ← check type' : '';

  return `  [${q(a.name)},${q(type)},${arr(acq)},${maxRank},${q(rarity)},${tradable},'TODO'],${warn}`;
}

function buildStubFromWiki(entry) {
  const type = wikiArcaneType(entry.wikiType);
  const warn = type === '???' ? '  // ← check type' : '';

  return `  [${q(entry.name)},${q(type)},['TODO'],${entry.wikiMaxRank},${q(entry.wikiRarity)},1,'TODO'],${warn}`;
}

function buildLevelStatsStubFromWfcd(a) {
  if (!a.levelStats?.length)
    return `  ${q(a.name)}: [/* TODO: add per-rank stats */],`;
  const levels = a.levelStats.map(lvl => JSON.stringify(lvl.stats || []));
  return `  ${q(a.name)}: [${levels.join(',')}],`;
}

function buildLevelStatsStubFromWiki(entry) {
  return `  ${q(entry.name)}: [/* TODO: add per-rank stats */],`;
}

function buildDropsStubFromWfcd(a) {
  if (!a.drops?.length) return `  ${q(a.name)}: [],`;
  const drops = a.drops.map(d => JSON.stringify({ location: d.location, chance: d.chance, rarity: d.rarity }));
  return `  ${q(a.name)}: [${drops.join(',')}],`;
}

function buildDropsStubFromWiki(entry) {
  return `  ${q(entry.name)}: [],`;
}

function buildDescLineFromWfcd(a) {
  const maxStats = a.levelStats?.[a.levelStats.length - 1]?.stats;
  if (!maxStats?.length) return null;
  // levelStats strings use \n to separate clauses; ARCANE_DESC holds only the primary effect line
  const desc = maxStats[0].split('\n')[0].trim();
  return desc ? `  ${q(a.name)}:${q(desc)},` : null;
}

function buildDescLineFromWiki(entry) {
  return entry.wikiDesc ? `  ${q(entry.name)}:${q(entry.wikiDesc)},` : null;
}

// ── Apply stubs ───────────────────────────────────────────────────────────────

function applyStubs(stubs) {
  let content  = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANES = [';
  const start  = content.indexOf(marker);
  if (start === -1) { console.error('ARCANES array not found in data-arcanes.js'); process.exit(1); }
  const rest   = content.slice(start);
  const endRel = rest.search(/\n\];/);
  if (endRel === -1) { console.error('End of ARCANES array not found'); process.exit(1); }
  const insertAt = start + endRel;
  content = content.slice(0, insertAt) + '\n' + stubs.join('\n') + content.slice(insertAt);
  fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
  console.log(`  Inserted ${stubs.length} stub(s) into ARCANES`);
}

function applyLevelStats(entries) {
  let content  = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANE_LEVEL_STATS = {';
  const start  = content.indexOf(marker);
  if (start === -1) { console.warn('  ARCANE_LEVEL_STATS not found — skipping level stats insert'); return; }
  const rest   = content.slice(start);
  const endRel = rest.search(/\n\};/);
  if (endRel === -1) { console.warn('  End of ARCANE_LEVEL_STATS not found — skipping'); return; }
  const insertAt = start + endRel;
  content = content.slice(0, insertAt) + '\n' + entries.join('\n') + content.slice(insertAt);
  fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
  console.log(`  Inserted ${entries.length} stub(s) into ARCANE_LEVEL_STATS`);
}

function applyDropEntries(entries) {
  let content  = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANE_DROPS = {';
  const start  = content.indexOf(marker);
  if (start === -1) { console.warn('  ARCANE_DROPS not found — skipping drops insert'); return; }
  const rest   = content.slice(start);
  const endRel = rest.search(/\n\};/);
  if (endRel === -1) { console.warn('  End of ARCANE_DROPS not found — skipping'); return; }
  const insertAt = start + endRel;
  content = content.slice(0, insertAt) + '\n' + entries.join('\n') + content.slice(insertAt);
  fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
  console.log(`  Inserted ${entries.length} stub(s) into ARCANE_DROPS`);
}

function applyArcaneDesc(descLines) {
  if (!descLines.length) return;
  let content  = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const marker = 'const ARCANE_DESC = {';
  const start  = content.indexOf(marker);
  if (start === -1) { console.warn('  ARCANE_DESC not found — skipping desc insert'); return; }
  const rest   = content.slice(start);
  const endRel = rest.search(/\n\};/);
  if (endRel === -1) { console.warn('  End of ARCANE_DESC not found — skipping'); return; }
  const insertAt = start + endRel;
  content = content.slice(0, insertAt) + '\n' + descLines.join('\n') + content.slice(insertAt);
  fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
  console.log(`  Inserted ${descLines.length} description(s) into ARCANE_DESC`);
}

// ── Patch incomplete enriched entries ────────────────────────────────────────

function hasMissingDescs() {
  const arcaneNames = getExistingArcaneNames();
  const descNames   = getExistingDescNames();
  for (const name of arcaneNames) {
    if (!descNames.has(name)) return true;
  }
  return false;
}

function findMissingDescs(wikiAllMap) {
  const arcaneNames = getExistingArcaneNames();
  const descNames   = getExistingDescNames();
  const missing = [];
  for (const nameLower of arcaneNames) {
    if (descNames.has(nameLower)) continue;
    const entry = wikiAllMap.get(nameLower);
    if (!entry) continue; // not in wiki — can't auto-fill, skip silently
    const line = buildDescLineFromWiki(entry);
    if (line) missing.push({ arcane: entry, line });
  }
  return missing;
}

function patchArcaneDesc(missingDescs) {
  const descLines = missingDescs.map(m => m.line);
  applyArcaneDesc(descLines);
}

function findPatchable(allMap) {
  const content         = fs.readFileSync(DATA_ARCANES, 'utf-8');
  const levelStatsTodos = [];
  const dropEmpties     = [];
  for (const arcane of allMap.values()) {
    if (!arcane.name) continue;
    if (arcane.levelStats?.length && content.includes(`  ${q(arcane.name)}: [/* TODO: add per-rank stats */],`))
      levelStatsTodos.push(arcane);
    if (arcane.drops?.length && content.includes(`  ${q(arcane.name)}: [],`))
      dropEmpties.push(arcane);
  }
  return { levelStatsTodos, dropEmpties };
}

function patchLevelStats(allMap) {
  let content = fs.readFileSync(DATA_ARCANES, 'utf-8');
  let patched = 0;
  for (const arcane of allMap.values()) {
    if (!arcane.levelStats?.length) continue;
    const placeholder = `  ${q(arcane.name)}: [/* TODO: add per-rank stats */],`;
    if (!content.includes(placeholder)) continue;
    content = content.replace(placeholder, buildLevelStatsStubFromWfcd(arcane));
    patched++;
    console.log(`  Patched level stats: ${arcane.name}`);
  }
  if (patched > 0) {
    fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
    console.log(`  Updated ${patched} entry(ies) in ARCANE_LEVEL_STATS`);
  }
  return patched;
}

function patchDropEntries(allMap) {
  let content = fs.readFileSync(DATA_ARCANES, 'utf-8');
  let patched = 0;
  for (const arcane of allMap.values()) {
    if (!arcane.drops?.length) continue;
    const placeholder = `  ${q(arcane.name)}: [],`;
    if (!content.includes(placeholder)) continue;
    content = content.replace(placeholder, buildDropsStubFromWfcd(arcane));
    patched++;
    console.log(`  Patched drops: ${arcane.name}`);
  }
  if (patched > 0) {
    fs.writeFileSync(DATA_ARCANES, content, 'utf-8');
    console.log(`  Updated ${patched} entry(ies) in ARCANE_DROPS`);
  }
  return patched;
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

  if (!fs.existsSync(DATA_ARCANES)) {
    console.error('data-arcanes.js not found at ' + DATA_ARCANES);
    process.exit(1);
  }

  const existingLower = getExistingArcaneNames();

  let wfcdResult = null;
  let wikiResult = null;

  // ── WFCD pass ──────────────────────────────────────────────────────────────
  if (!wikiOnly) {
    console.log('Checking WFCD…');
    try {
      wfcdResult = extractFromWfcd(existingLower);
      console.log(`  WFCD: ${wfcdResult.total} arcanes, ${wfcdResult.newArcanes.length} new vs data-arcanes.js`);
    } catch (e) {
      console.warn(`  WFCD error — ${e.message}`);
    }
  }

  // ── Wiki pass ──────────────────────────────────────────────────────────────
  const wfcdHasNew       = wfcdResult?.newArcanes.length > 0;
  const needsWikiForDesc = !wfcdOnly && hasMissingDescs();
  if (!wfcdOnly && (!wfcdHasNew || wikiOnly || showAll || needsWikiForDesc)) {
    if (needsWikiForDesc && !wfcdHasNew && !wikiOnly) console.log('Missing ARCANE_DESC entries — fetching wiki…');
    else if (!wfcdHasNew && !wikiOnly) console.log('No new arcanes in WFCD — checking wiki for updates…');
    else console.log('Fetching wiki data…');
    try {
      wikiResult = await extractFromWiki(existingLower);
    } catch (e) {
      console.warn(`  Wiki fetch failed — ${e.message}`);
    }
  }

  // ── Detect incomplete enriched entries ────────────────────────────────────
  const patchable      = wfcdResult?.allMap      ? findPatchable(wfcdResult.allMap)          : { levelStatsTodos: [], dropEmpties: [] };
  const missingDescs   = wikiResult?.wikiAllMap  ? findMissingDescs(wikiResult.wikiAllMap)   : [];
  const totalPatchable = patchable.levelStatsTodos.length + patchable.dropEmpties.length + missingDescs.length;

  // ── Report ─────────────────────────────────────────────────────────────────
  const wfcdNew     = wfcdResult?.newArcanes || [];
  const wikiNew     = wikiResult?.newArcanes || [];

  const wfcdNames   = new Set(wfcdNew.map(a => a.name.toLowerCase()));
  const wikiOnlyNew = wikiNew.filter(a => !wfcdNames.has(a.name.toLowerCase()));

  const totalNew = wfcdNew.length + wikiOnlyNew.length;

  console.log('\n' + '─'.repeat(60));

  if (wfcdNew.length) {
    console.log(`\nNew arcanes confirmed by WFCD (${wfcdNew.length}):`);
    for (const a of wfcdNew) console.log(buildStubFromWfcd(a));
  }

  if (wikiOnlyNew.length) {
    console.log(`\nWiki-only — verify released before adding (${wikiOnlyNew.length}):`);
    for (const a of wikiOnlyNew) console.log(buildStubFromWiki(a));
  }

  if (totalPatchable > 0) {
    console.log(`\nIncomplete entries with WFCD/Wiki data now available (${totalPatchable}):`);
    for (const a of patchable.levelStatsTodos) console.log(`  ARCANE_LEVEL_STATS: ${a.name}`);
    for (const a of patchable.dropEmpties)     console.log(`  ARCANE_DROPS:       ${a.name}`);
    for (const m of missingDescs)              console.log(`  ARCANE_DESC:        ${m.arcane.name}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`${totalNew} new | ${totalPatchable} patchable`);

  if (totalNew === 0 && totalPatchable === 0) {
    console.log('Nothing to update.');
    return;
  }

  if (!doApply) {
    if (totalNew > 0) {
      console.log(`${totalNew} new arcane(s) found. Review stubs above, then run with --apply to insert.`);
      console.log('Note: --apply will also populate ARCANE_LEVEL_STATS and ARCANE_DROPS (WFCD data only).');
      console.log('Fill in acquisition sources, category, and wiki-only level stats (\'TODO\') before committing.');
    }
    if (totalPatchable > 0)
      console.log(`${totalPatchable} incomplete entry(ies) can be filled from WFCD. Run with --apply to patch.`);
    return;
  }

  console.log('\nApplying changes…');
  saveBackup();
  if (totalNew > 0) {
    const existingDescLower = getExistingDescNames();
    applyStubs([
      ...wfcdNew.map(buildStubFromWfcd),
      ...wikiOnlyNew.map(buildStubFromWiki),
    ]);
    applyLevelStats([
      ...wfcdNew.map(buildLevelStatsStubFromWfcd),
      ...wikiOnlyNew.map(buildLevelStatsStubFromWiki),
    ]);
    applyDropEntries([
      ...wfcdNew.map(buildDropsStubFromWfcd),
      ...wikiOnlyNew.map(buildDropsStubFromWiki),
    ]);
    const descLines = [
      ...wfcdNew.map(buildDescLineFromWfcd),
      ...wikiOnlyNew.map(buildDescLineFromWiki),
    ].filter(line => line && !existingDescLower.has(line.match(/^\s+'([^']+)':/)?.[1]?.toLowerCase()));
    applyArcaneDesc(descLines);
  }
  if (totalPatchable > 0) {
    patchLevelStats(wfcdResult.allMap);
    patchDropEntries(wfcdResult.allMap);
    if (missingDescs.length > 0) patchArcaneDesc(missingDescs);
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
