// update-relics.js
// Generates relics.json from @wfcd/items, falling back to the wiki Lua module
// if WFCD has no new items compared to the existing relics.js.
//
// Without --apply : read-only; prints gap report.
// With --apply    : backs up relics.json then writes updated data.
// With --revert   : restores relics.json from the latest backup.
//
// Usage:
//   node dev/update-relics.js              # auto (WFCD + wiki fallback)
//   node dev/update-relics.js --wfcd-only  # skip wiki fallback
//   node dev/update-relics.js --wiki-only  # skip WFCD, use wiki directly
//   node dev/update-relics.js --all        # always merge WFCD + wiki
//   node dev/update-relics.js --apply      # write relics.json (backs up first)
//   node dev/update-relics.js --revert     # restore most recent backup
//
// Then run:  node dev/generate-relics-map.js

'use strict';

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const luaparse = require('luaparse');

const WFCD_RELICS  = path.join(__dirname, 'node_modules/@wfcd/items/data/json/Relics.json');
const OUT_JSON     = path.join(__dirname, 'relics.json');
const RELICS_JS    = path.join(__dirname, '..', 'data', 'data-relics.js');
const BACKUP_DIR   = path.join(__dirname, 'backups', 'relics');
const KEEP_BACKUPS = 5;
const WIKI_URL    = 'https://wiki.warframe.com/w/Module:Void/data?action=raw';

const RARITY_LABELS = { Common: 0, Uncommon: 1, Rare: 2 };

// ── Backup / revert ──────────────────────────────────────────────────────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

function saveBackup() {
  ensureBackupDir();
  const ts = backupTimestamp();
  let saved = [];

  if (fs.existsSync(OUT_JSON)) {
    const dest = path.join(BACKUP_DIR, `relics-${ts}.json`);
    fs.copyFileSync(OUT_JSON, dest);
    saved.push(path.basename(dest));
  }
  if (fs.existsSync(RELICS_JS)) {
    const dest = path.join(BACKUP_DIR, `relics-${ts}.js`);
    fs.copyFileSync(RELICS_JS, dest);
    saved.push(path.basename(dest));
  }

  if (saved.length) console.log(`Backed up: ${saved.join(', ')}`);

  // Trim oldest backups, keeping only KEEP_BACKUPS sets
  const files = fs.readdirSync(BACKUP_DIR).sort();
  const jsons = files.filter(f => f.endsWith('.json'));
  if (jsons.length > KEEP_BACKUPS) {
    const toDelete = jsons.slice(0, jsons.length - KEEP_BACKUPS);
    for (const f of toDelete) {
      fs.rmSync(path.join(BACKUP_DIR, f));
      const jsFile = f.replace('.json', '.js');
      if (fs.existsSync(path.join(BACKUP_DIR, jsFile))) fs.rmSync(path.join(BACKUP_DIR, jsFile));
    }
    console.log(`Trimmed ${toDelete.length} old backup(s)`);
  }
}

function revert() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).sort();
  const jsons = files.filter(f => f.endsWith('.json'));
  if (!jsons.length) { console.error('No backups found.'); process.exit(1); }

  const latest = jsons[jsons.length - 1];
  const ts     = latest.replace('relics-', '').replace('.json', '');

  fs.copyFileSync(path.join(BACKUP_DIR, `relics-${ts}.json`), OUT_JSON);
  console.log(`Restored relics.json from ${latest}`);

  const jsBackup = path.join(BACKUP_DIR, `relics-${ts}.js`);
  if (fs.existsSync(jsBackup)) {
    fs.copyFileSync(jsBackup, RELICS_JS);
    console.log(`Restored relics.js from relics-${ts}.js`);
  }

  console.log('Done. Run node dev/generate-relics-map.js if you only restored relics.json.');
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

// ── WFCD extraction ───────────────────────────────────────────────────────────

const NON_PRIME_ITEMS = ['Forma', '2X Forma', 'Exilus Weapon Adapter'];

function splitRewardName(fullName) {
  const primeIdx = fullName.indexOf(' Prime ');
  if (primeIdx !== -1) {
    return { item: fullName.slice(0, primeIdx + 6), part: fullName.slice(primeIdx + 7) };
  }
  for (const known of NON_PRIME_ITEMS) {
    if (fullName.startsWith(known + ' ')) return { item: known, part: fullName.slice(known.length + 1) };
  }
  return null; // Requiem mods, Kuva, etc. — not tracked
}

function extractFromWfcd() {
  if (!fs.existsSync(WFCD_RELICS)) throw new Error('@wfcd/items not installed — run: npm install @wfcd/items');

  const allRelics    = JSON.parse(fs.readFileSync(WFCD_RELICS, 'utf-8'));
  const intactRelics = allRelics.filter(r => r.name.endsWith(' Intact'));
  const primeData    = {};

  for (const relic of intactRelics) {
    const relicName    = relic.name.replace(' Intact', '');
    const relicVaulted = !!relic.vaulted;

    for (const reward of (relic.rewards || [])) {
      if (!reward.rarity) continue;
      const split = splitRewardName(reward.item.name);
      if (!split) continue;
      const { item, part } = split;
      if (!part) continue;

      if (!primeData[item])             primeData[item] = { IsVaulted: true, Parts: {} };
      if (!primeData[item].Parts[part]) primeData[item].Parts[part] = { Drops: {} };

      primeData[item].Parts[part].Drops[relicName] = { Rarity: reward.rarity, Vaulted: relicVaulted };
      if (!relicVaulted) primeData[item].IsVaulted = false;
    }
  }

  return primeData;
}

// ── Wiki (Lua) extraction ─────────────────────────────────────────────────────

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
        if (field.type === 'TableKeyString')    obj[field.key.name]    = nodeToJs(field.value);
        else if (field.type === 'TableKey')     obj[nodeToJs(field.key)] = nodeToJs(field.value);
        else                                    obj[idx++]              = nodeToJs(field.value);
      }
      return obj;
    }
    default: return null;
  }
}

async function extractFromWiki() {
  console.log('  Fetching wiki Lua module…');
  const lua = await fetch(WIKI_URL);
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  let relicDataNode = null;
  for (const stmt of ast.body) {
    if (
      stmt.type === 'AssignmentStatement' &&
      stmt.variables[0]?.type === 'Identifier' &&
      stmt.variables[0].name === 'RelicData'
    ) { relicDataNode = stmt.init[0]; break; }
  }
  if (!relicDataNode) throw new Error('RelicData not found in Lua module');

  const relicData  = nodeToJs(relicDataNode);
  const primeData  = {};

  for (const [relicName, relicEntry] of Object.entries(relicData)) {
    const relicVaulted = !!relicEntry.Vaulted;
    for (const drop of (relicEntry.Drops || [])) {
      const { Item: item, Part: part, Rarity: rarity } = drop;
      if (!item || !part || !rarity) continue;

      if (!primeData[item])             primeData[item] = { IsVaulted: true, Parts: {} };
      if (!primeData[item].Parts[part]) primeData[item].Parts[part] = { Drops: {} };

      primeData[item].Parts[part].Drops[relicName] = { Rarity: rarity, Vaulted: relicVaulted };
      if (!relicVaulted) primeData[item].IsVaulted = false;
    }
  }

  return primeData;
}

// ── Comparison against existing relics.js ────────────────────────────────────

function getExistingItems() {
  if (!fs.existsSync(RELICS_JS)) return new Set();
  const js  = fs.readFileSync(RELICS_JS, 'utf-8');
  const out = new Set();
  for (const m of js.matchAll(/\["([^"]+)",\[/g)) out.add(m[1]);
  return out;
}

function activeItems(primeData) {
  return new Set(Object.entries(primeData).filter(([, v]) => !v.IsVaulted).map(([k]) => k));
}

// ── Merge: add wiki items that WFCD is missing ────────────────────────────────

function merge(wfcd, wiki) {
  const merged = { ...wfcd };
  let added = 0;
  for (const [item, data] of Object.entries(wiki)) {
    if (!merged[item]) { merged[item] = data; added++; }
  }
  if (added) console.log(`  Merged ${added} item(s) from wiki not present in WFCD`);
  return merged;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const wfcdOnly = args.includes('--wfcd-only');
  const wikiOnly = args.includes('--wiki-only');
  const showAll  = args.includes('--all');
  const doApply  = args.includes('--apply');

  if (args.includes('--revert')) { revert(); return; }

  const existActive = getExistingItems();
  let primeData;

  if (wikiOnly) {
    console.log('Wiki-only mode');
    primeData = await extractFromWiki();
  } else {
    console.log('Extracting from WFCD…');
    const wfcdData   = extractFromWfcd();
    const wfcdActive = activeItems(wfcdData);

    // Count active items that are new vs existing relics.js
    const newInWfcd = [...wfcdActive].filter(k => !existActive.has(k));
    console.log(`  WFCD: ${Object.keys(wfcdData).length} items, ${wfcdActive.size} active`);
    console.log(`  New vs existing relics.js: ${newInWfcd.length} item(s)`);
    newInWfcd.forEach(i => console.log(`    + ${i}`));

    if (!wfcdOnly && (newInWfcd.length === 0 || showAll)) {
      if (newInWfcd.length === 0) console.log('  No new items in WFCD — checking wiki for updates…');
      else                        console.log('  Fetching wiki data…');
      try {
        const wikiData   = await extractFromWiki();
        const wikiActive = activeItems(wikiData);
        const newInWiki  = [...wikiActive].filter(k => !existActive.has(k));
        console.log(`  Wiki: ${Object.keys(wikiData).length} items, ${wikiActive.size} active, ${newInWiki.length} new`);
        newInWiki.forEach(i => console.log(`    + ${i}`));
        primeData = merge(wfcdData, wikiData);
      } catch (e) {
        console.warn(`  Wiki fetch failed (${e.message}) — using WFCD only`);
        primeData = wfcdData;
      }
    } else {
      primeData = wfcdData;
    }
  }

  const total    = Object.keys(primeData).length;
  const vaulted  = Object.values(primeData).filter(v => v.IsVaulted).length;
  const newCount = [...activeItems(primeData)].filter(k => !existActive.has(k)).length;

  console.log('\n' + '─'.repeat(60));
  console.log(`Result: ${total} items (${total - vaulted} active, ${vaulted} vaulted)`);
  console.log(`${newCount} new item(s) vs existing relics.js`);

  if (newCount === 0) {
    console.log('Nothing to update.');
  } else {
    console.log(`New items found (${newCount}).`);
  }

  if (!doApply) {
    console.log('Run with --apply to write relics.json (backs up first).');
    return;
  }

  saveBackup();
  fs.writeFileSync(OUT_JSON, JSON.stringify(primeData, null, 2), 'utf-8');
  console.log(`Saved → ${OUT_JSON}`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
