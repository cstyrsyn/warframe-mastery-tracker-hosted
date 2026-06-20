// update-blueprints.js
// Detects items in data-items.js missing from the BLUEPRINTS map in data-blueprints.js.
// Uses WFCD as the primary source and the wiki Module:Blueprints/data as a fallback.
//
// Without --apply : read-only; prints gap report and stubs.
// With --apply    : backs up data-blueprints.js then inserts auto-generated stubs.
// With --revert   : restores data-blueprints.js from the latest backup.
//
// Usage:
//   node dev/update-blueprints.js
//   node dev/update-blueprints.js --apply
//   node dev/update-blueprints.js --revert
//   node dev/update-blueprints.js --wfcd-only  # skip wiki fallback
//   node dev/update-blueprints.js --wiki-only  # skip WFCD, use wiki for everything
//   node dev/update-blueprints.js --all        # always fetch wiki even if WFCD resolved all items

'use strict';

const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const luaparse     = require('luaparse');
const { execSync } = require('child_process');

const DATA_ITEMS      = path.join(__dirname, '..', 'data-items.js');
const DATA_BLUEPRINTS = path.join(__dirname, '..', 'data-blueprints.js');
const WFCD_DIR        = path.join(__dirname, 'node_modules/@wfcd/items/data/json');
const WIKI_BP_URL     = 'https://wiki.warframe.com/w/Module:Blueprints/data?action=raw';
const BACKUP_DIR      = path.join(__dirname, 'backups', 'blueprints');
const KEEP_BACKUPS    = 5;

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

// ── Tab → WFCD files ──────────────────────────────────────────────────────────
const TABS_CONFIG = [
  { varName: 'WARFRAMES',    wfcdFiles: ['Warframes.json'] },
  { varName: 'PRIMARY',      wfcdFiles: ['Primary.json'] },
  { varName: 'SECONDARY',    wfcdFiles: ['Secondary.json'] },
  { varName: 'MELEE',        wfcdFiles: ['Melee.json'] },
  { varName: 'ARCH_WEAPONS', wfcdFiles: ['Arch-Gun.json', 'Arch-Melee.json'] },
  { varName: 'COMP_WEAPONS', wfcdFiles: ['SentinelWeapons.json'] },
];

// ── Known no-blueprint categories ─────────────────────────────────────────────
// Items in these categories have no traditional Foundry blueprint.
const NO_BP_RULES = [
  { test: n => n.startsWith('Kuva '),
    note: 'Kuva Lich weapon — no blueprint' },
  { test: n => n.startsWith('Tenet '),
    note: 'Sister of Parvos weapon — no blueprint' },
  { test: n => n.startsWith('Dex '),
    note: 'login reward — no blueprint' },
  { test: n => n.startsWith('Prisma '),
    note: "Baro Ki'Teer item — no blueprint" },
  { test: n => n.startsWith('Coda ') || n.startsWith('Dual Coda '),
    note: 'currency purchase — see CURRENCIES map' },
  { test: n => /^(Rakta|Synoid|Vaykor|Telos|Sancti|Secura) /.test(n),
    note: 'syndicate rank reward — no blueprint' },
  { test: n => new Set([
      'Balla','Cyath','Dehtat','Dokrahm','Kronsh','Mewan','Ooltha',
      'Plague Keewar','Plague Kripath','Rabvee','Sepfahn',
    ]).has(n),
    note: 'Zaw component — purchased from Hok' },
  { test: n => new Set([
      'Catchmoon','Gaze','Rattleguts','Sporelacer','Tombfinger','Vermisplicer',
    ]).has(n),
    note: 'Kitgun chamber — purchased from Zuud' },
  { test: n => new Set([
      'Akaten','Artax','Batoten','Burst Laser','Burst Laser Prime','Deconstructor','Deconstructor Prime',
      'Deth Machine Rifle','Deth Machine Rifle Prime','Lacerten','Laser Rifle','Multron',
      'Prime Laser Rifle','Stinger','Sweeper','Sweeper Prime','Verglas','Verglas Prime','Vulklok',
    ]).has(n),
    note: 'sentinel/Moa weapon — packaged with companion, no standalone blueprint' },
  { test: n => new Set([
      'Mausolon','Nataruk','Rumblejack','Thornbak','Skiajati',
    ]).has(n),
    note: 'special acquisition — no traditional blueprint' },
  { test: n => n.startsWith('Mk1-'),
    note: 'starter weapon — market purchase, no blueprint' },
  { test: n => new Set([
      'Glaxion Vandal','Opticor Vandal','Quanta Vandal','Supra Vandal','Prova Vandal',
    ]).has(n),
    note: 'Vandal weapon — event/alert reward, no blueprint' },
  { test: n => new Set([
      'Vulkar Wraith','Viper Wraith','Machete Wraith','Halikar Wraith',
    ]).has(n),
    note: 'Wraith weapon — event/alert reward, no blueprint' },
  { test: n => new Set([
      'Braton','Strun','Gotva Prime','Mara Detron','Zylok','Vastilok','Vericres','War Prime',
    ]).has(n),
    note: 'market or special acquisition — no blueprint' },
];

// Verified no-blueprint items — suppressed from report output.
// Anything caught by NO_BP_RULES but NOT listed here will appear in the report,
// flagging items newly added to data-items.js that need review.
const KNOWN_NO_BP = new Set([
  // login reward
  'Dex Sybaris','Dex Furis','Dex Nikana','Dex Dakra',
  // Baro Ki'Teer
  'Prisma Gorgon','Prisma Grakata','Prisma Grinlok','Prisma Tetra','Prisma Lenz',
  'Prisma Angstrum','Prisma Twin Gremlins','Prisma Skana','Prisma Dual Cleavers',
  'Prisma Machete','Prisma Obex','Prisma Ohma','Prisma Veritux','Prisma Burst Laser',
  // syndicate
  'Telos Boltor','Sancti Tigris','Rakta Cernos','Synoid Simulor','Rakta Ballistica',
  'Synoid Gammacor','Secura Dual Cestra','Telos Akbolto','Sancti Castanas',
  'Rakta Dark Dagger','Vaykor Sydon','Secura Lecta','Telos Boltace','Sancti Magistar',
  'Synoid Heliocor',
  // special acquisition
  'Thornbak','Nataruk','Skiajati','Rumblejack','Mausolon',
  // currency purchase
  'Coda Bassocyst','Coda Bubonico','Coda Hema','Coda Sporothrix','Coda Synapse',
  'Coda Catabolyst','Dual Coda Torxica','Coda Pox','Coda Tysis','Coda Caustacyst',
  'Coda Hirudo','Coda Mire','Coda Motovore','Coda Pathocyst',
  // Kuva Lich
  'Kuva Bramma','Kuva Chakkhurr','Kuva Drakgoon','Kuva Hek','Kuva Hind','Kuva Karak',
  'Kuva Kohm','Kuva Ogris','Kuva Quartakk','Kuva Sobek','Kuva Tonkor','Kuva Zarr',
  'Kuva Brakk','Kuva Kraken','Kuva Nukor','Kuva Seer','Kuva Twin Stubbas',
  'Kuva Ghoulsaw','Kuva Shildeg','Kuva Ayanga','Kuva Grattler',
  // Sister of Parvos
  'Tenet Arca Plasmor','Tenet Envoy','Tenet Ferrox','Tenet Flux Rifle','Tenet Glaxion',
  'Tenet Quanta','Tenet Tetra','Tenet Cycron','Tenet Detron','Tenet Diplos',
  'Tenet Plinx','Tenet Spirex','Tenet Agendus','Tenet Exec','Tenet Grigori','Tenet Livia',
  // Kitgun chambers
  'Catchmoon','Gaze','Rattleguts','Sporelacer','Tombfinger','Vermisplicer',
  // Zaw components
  'Balla','Cyath','Dehtat','Dokrahm','Kronsh','Mewan','Ooltha',
  'Plague Keewar','Plague Kripath','Rabvee','Sepfahn',
  // sentinel/Moa weapons
  'Akaten','Artax','Batoten','Burst Laser','Deconstructor','Deth Machine Rifle',
  'Lacerten','Laser Rifle','Multron','Stinger','Sweeper','Verglas','Vulklok',
  'Burst Laser Prime','Deconstructor Prime','Deth Machine Rifle Prime',
  'Prime Laser Rifle','Sweeper Prime','Verglas Prime',
  // starter weapons — market purchase
  'Braton','Strun',
  // Mk1 starter weapons
  'Mk1-Braton','Mk1-Paris','Mk1-Strun','Mk1-Furis','Mk1-Kunai','Mk1-Bo','Mk1-Furax',
  // Vandal weapons
  'Glaxion Vandal','Opticor Vandal','Quanta Vandal','Supra Vandal','Prova Vandal',
  // Wraith weapons
  'Vulkar Wraith','Viper Wraith','Machete Wraith','Halikar Wraith',
  // market or special acquisition
  'Gotva Prime','Mara Detron','Zylok','Vastilok','Vericres','War Prime',
]);

function isNoBp(name) {
  for (const rule of NO_BP_RULES) {
    if (rule.test(name)) return rule.note;
  }
  return null;
}

// Items tracked in data-items.js under one name but keyed differently in BLUEPRINTS.
// These are already covered — skip them in the gap check.
const BLUEPRINT_ALIASES = new Map([
  ['Dark Split-Sword', 'Dark Split-Sword (Dual Swords)'],
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
  const dest = path.join(BACKUP_DIR, `data-blueprints-${ts}.js`);
  fs.copyFileSync(DATA_BLUEPRINTS, dest);
  console.log(`Backed up: ${path.basename(dest)}`);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-blueprints-') && f.endsWith('.js'))
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
    .filter(f => f.startsWith('data-blueprints-') && f.endsWith('.js'))
    .sort();
  if (!files.length) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
  const latest = files[files.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_BLUEPRINTS);
  console.log(`Reverted data-blueprints.js from ${latest}`);
}

// ── Network / Lua helpers ─────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
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
      for (const f of node.fields) {
        if (f.type === 'TableKeyString')  obj[f.key.name]      = nodeToJs(f.value);
        else if (f.type === 'TableKey')   obj[nodeToJs(f.key)] = nodeToJs(f.value);
        else                              obj[idx++]           = nodeToJs(f.value);
      }
      return obj;
    }
    default: return null;
  }
}

// ── Data readers ──────────────────────────────────────────────────────────────

function getItemNames(varName) {
  const src    = fs.readFileSync(DATA_ITEMS, 'utf-8');
  const marker = `const ${varName} = [`;
  const start  = src.indexOf(marker);
  if (start === -1) return [];
  const rest    = src.slice(start);
  const end     = rest.search(/\n\];/);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\s*\[["']([^"']+)["']/gm)].map(m => m[1]);
}

function getBlueprintKeys() {
  const src   = fs.readFileSync(DATA_BLUEPRINTS, 'utf-8');
  const start = src.indexOf('const BLUEPRINTS = new Map([');
  if (start === -1) return new Set();
  return new Set([...src.slice(start).matchAll(/^\s+\["([^"]+)",/gm)].map(m => m[1]));
}

function loadWfcd(cfg) {
  const map = new Map();
  for (const file of cfg.wfcdFiles) {
    const p = path.join(WFCD_DIR, file);
    if (!fs.existsSync(p)) continue;
    for (const item of JSON.parse(fs.readFileSync(p, 'utf-8'))) {
      if (!map.has(item.name)) map.set(item.name, item);
    }
  }
  return map;
}

// ── Wiki blueprint fetch ───────────────────────────────────────────────────────

async function fetchWikiBlueprints() {
  console.log('\nFetching wiki Module:Blueprints/data…');
  const lua = await fetchUrl(WIKI_BP_URL);
  console.log(`Received ${(lua.length / 1024).toFixed(1)} KB`);
  const ast  = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  const stmt = ast.body.find(s => s.type === 'ReturnStatement');
  if (!stmt) throw new Error('No return statement in Module:Blueprints/data');
  const mod = nodeToJs(stmt.arguments[0]);
  console.log(`  Module sections: ${Object.keys(mod || {}).join(', ')}`);
  const combined = Object.assign({},
    mod.Blueprints  || {},
    mod.Suits       || {},
    mod.Warframes   || {},
    mod.warframes   || {},
  );
  console.log(`  Combined entries: ${Object.keys(combined).length}`);
  const map = new Map();
  for (const [key, entry] of Object.entries(combined)) {
    if (!entry || typeof entry !== 'object') continue;
    // Index by both the key and the Result field (item name can differ from blueprint name)
    map.set(key, entry);
    if (entry.Result && entry.Result !== key) map.set(entry.Result, entry);
  }
  return map;
}

// ── Stub builders ─────────────────────────────────────────────────────────────

function formatEntry(name, credits, time, parts) {
  if (!parts.length) return null;
  const ps = parts.map(p => JSON.stringify(p)).join(',');
  return `  ["${name}",[${credits},${time},[${ps}]]],`;
}

function stubFromWfcd(name, item, isWarframe) {
  const { buildPrice, buildTime, components } = item;
  if (!buildPrice || !buildTime || !Array.isArray(components)) return null;
  const isPrime = name.includes(' Prime');
  const parts   = [];
  for (const comp of components) {
    if (comp.name === 'Blueprint') continue;
    const tradable = comp.tradable ?? false;
    let type, partName;
    if (!tradable) {
      type     = 'Resource';
      partName = comp.name;
    } else if (isWarframe) {
      // Warframe prime components use "Prime Chassis" etc.; non-prime use "Chassis"
      type     = 'Item';
      partName = isPrime ? ('Prime ' + comp.name) : comp.name;
    } else {
      // Weapon: prime parts are PrimePart, non-prime tradable parts are Item
      type     = isPrime ? 'PrimePart' : 'Item';
      partName = comp.name;
    }
    parts.push([partName, comp.itemCount, type]);
  }
  return formatEntry(name, buildPrice, buildTime, parts);
}

function stubFromWiki(name, entry, isWarframe) {
  const credits = entry.Credits || 0;
  const time    = entry.Time    || 0;
  // Warframe components are Items (relic drops), not Resources — default accordingly when wiki omits Type
  const parts   = (entry.Parts || []).map(p => [p.Name, p.Count || 1, p.Type || (isWarframe ? 'Item' : 'Resource')]);
  return formatEntry(name, credits, time, parts);
}

// Generate sub-component stubs (Neuroptics/Chassis/Systems) from WFCD nested data.
function subCompsFromWfcd(warframeName, item, bpKeys) {
  const results = [];
  for (const comp of (item.components || [])) {
    if (comp.name === 'Blueprint' || !comp.tradable) continue;
    if (!Array.isArray(comp.components) || !comp.buildPrice || !comp.buildTime) continue;
    const compName = `${warframeName} ${comp.name}`;
    if (bpKeys.has(compName)) continue;
    const parts = comp.components
      .filter(c => c.name !== 'Blueprint')
      .map(c => [c.name, c.itemCount, 'Resource']);
    const stub = formatEntry(compName, comp.buildPrice, comp.buildTime, parts);
    if (stub) results.push({ name: compName, stub });
  }
  return results;
}

// Generate sub-component stubs from wiki data using the main entry's Item-type parts.
function subCompsFromWiki(warframeName, entry, wikiData, bpKeys) {
  const results = [];
  for (const part of (entry.Parts || [])) {
    if (part.Type === 'Resource') continue;
    // Strip "Prime " prefix so "Prime Neuroptics" → "Neuroptics", then prefix warframe name
    const shortType = (part.Name || '').replace(/^Prime /, '');
    if (!shortType) continue;
    const compName = `${warframeName} ${shortType}`;
    if (bpKeys.has(compName)) continue;
    const compEntry = wikiData.get(compName) || wikiData.get(`${compName} Blueprint`);
    if (!compEntry) continue;
    const stub = stubFromWiki(compName, compEntry, false);
    if (stub) results.push({ name: compName, stub });
  }
  return results;
}

// ── Apply stubs to data-blueprints.js ─────────────────────────────────────────

function applyNewBlueprints(stubs) {
  // stubs: [{name, stub}] already sorted alphabetically
  let content = fs.readFileSync(DATA_BLUEPRINTS, 'utf-8');
  const marker = 'const BLUEPRINTS = new Map([';
  const bpStart = content.indexOf(marker);
  if (bpStart === -1) throw new Error('BLUEPRINTS not found in data-blueprints.js');

  // Find closing ] by bracket depth
  const scanFrom = bpStart + marker.length - 1;
  let depth = 0, bpEnd = -1;
  for (let i = scanFrom; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') {
      if (--depth === 0) { bpEnd = i; break; }
    }
  }
  if (bpEnd === -1) throw new Error('BLUEPRINTS closing bracket not found');

  let changed = false;
  for (const { name, stub } of stubs) {
    const nameLower = name.toLowerCase();
    // Find alphabetical insertion point within bpStart..bpEnd
    const entryRx = /^\s+\["([^"]+)",/gm;
    entryRx.lastIndex = bpStart;
    let insertAt = bpEnd; // default: at the very end before ]);
    let m;
    while ((m = entryRx.exec(content)) !== null) {
      if (m.index >= bpEnd) break;
      if (m[1].toLowerCase() > nameLower) { insertAt = m.index; break; }
    }
    const insert = stub + '\n';
    content = content.slice(0, insertAt) + insert + content.slice(insertAt);
    bpEnd  += insert.length;
    changed = true;
    console.log(`  Inserted: ${name}`);
  }

  if (changed) fs.writeFileSync(DATA_BLUEPRINTS, content, 'utf-8');
  return changed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args       = process.argv.slice(2);
  const doApply    = args.includes('--apply');
  const doRevert   = args.includes('--revert');
  const wfcdOnly   = args.includes('--wfcd-only');
  const wikiOnly   = args.includes('--wiki-only');
  const showAll    = args.includes('--all');
  const skipUpdate = args.includes('--skip-update');

  if (doRevert) { revert(); process.exit(0); }

  if (!wikiOnly && !skipUpdate) refreshWfcd();

  if (!fs.existsSync(DATA_ITEMS)) { console.error('data-items.js not found'); process.exit(1); }
  if (!fs.existsSync(DATA_BLUEPRINTS)) { console.error('data-blueprints.js not found'); process.exit(1); }

  const bpKeys = getBlueprintKeys();
  console.log(`Current BLUEPRINTS entries: ${bpKeys.size}`);

  // ── WFCD pass ──────────────────────────────────────────────────────────────
  const wfcdMap = new Map(); // name → { item, varName }
  if (!wikiOnly) {
    for (const cfg of TABS_CONFIG) {
      const m = loadWfcd(cfg);
      for (const [name, item] of m) {
        if (!wfcdMap.has(name)) wfcdMap.set(name, { item, varName: cfg.varName });
      }
    }
    console.log(`Loaded ${wfcdMap.size} WFCD items`);
  }

  // ── Classify all missing items ─────────────────────────────────────────────
  const autoStubs  = []; // { name, varName, stub, source }
  const needsWiki  = []; // { name, varName }
  const noBpItems  = []; // { name, varName, note }

  for (const cfg of TABS_CONFIG) {
    const isWarframe = cfg.varName === 'WARFRAMES';
    for (const name of getItemNames(cfg.varName)) {
      if (bpKeys.has(name) || bpKeys.has(BLUEPRINT_ALIASES.get(name))) continue;

      const noBpNote = isNoBp(name);
      if (noBpNote) { noBpItems.push({ name, varName: cfg.varName, note: noBpNote }); continue; }

      if (!wikiOnly) {
        const wfcd = wfcdMap.get(name);
        if (wfcd) {
          const stub = stubFromWfcd(name, wfcd.item, isWarframe);
          if (stub) {
            autoStubs.push({ name, varName: cfg.varName, stub, source: 'WFCD' });
            if (isWarframe) {
              for (const sub of subCompsFromWfcd(name, wfcd.item, bpKeys)) {
                autoStubs.push({ name: sub.name, varName: cfg.varName, stub: sub.stub, source: 'WFCD' });
              }
            }
            continue;
          }
        }
      }

      needsWiki.push({ name, varName: cfg.varName });
    }
  }

  // ── Wiki fallback ──────────────────────────────────────────────────────────
  const unknown = [];
  if (!wfcdOnly && (needsWiki.length > 0 || showAll)) {
    if (needsWiki.length > 0) console.log(`${needsWiki.length} items need wiki lookup…`);
    else                      console.log('Fetching wiki data…');
    try {
      const wikiData = await fetchWikiBlueprints();
      for (const item of needsWiki) {
        const isWarframe = item.varName === 'WARFRAMES';
        const entry = wikiData.get(item.name);
        if (entry) {
          const stub = stubFromWiki(item.name, entry, isWarframe);
          if (stub) {
            autoStubs.push({ name: item.name, varName: item.varName, stub, source: 'wiki' });
            if (isWarframe) {
              for (const sub of subCompsFromWiki(item.name, entry, wikiData, bpKeys)) {
                autoStubs.push({ name: sub.name, varName: item.varName, stub: sub.stub, source: 'wiki' });
              }
            }
            continue;
          }
          console.warn(`  [wiki] entry found for "${item.name}" but stub failed — Credits=${entry.Credits}, Parts=${(entry.Parts||[]).length}`);
        } else {
          const first = item.name.split(' ')[0].toLowerCase();
          const near  = [...wikiData.keys()].filter(k => k.toLowerCase().startsWith(first)).slice(0, 6);
          if (near.length) console.warn(`  [wiki] "${item.name}" not found; wiki has: ${near.join(' | ')}`);
        }
        unknown.push(item);
      }
    } catch (e) {
      console.warn('Wiki fetch failed:', e.message);
      unknown.push(...needsWiki);
    }
  } else if (wfcdOnly) {
    unknown.push(...needsWiki);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));

  if (autoStubs.length > 0) {
    // Group by varName for readability
    const byTab = new Map();
    for (const s of autoStubs) {
      if (!byTab.has(s.varName)) byTab.set(s.varName, []);
      byTab.get(s.varName).push(s);
    }
    console.log(`\nAuto-stubs (${autoStubs.length}) — ready to insert:`);
    for (const [varName, stubs] of byTab) {
      console.log(`\n  ── ${varName} ──`);
      for (const { name, stub, source } of stubs) {
        console.log(`  [${source}] ${stub}`);
      }
    }
  }

  if (unknown.length > 0) {
    const unexpectedUnknown = unknown.filter(({ name }) => !KNOWN_NO_BP.has(name));
    if (unexpectedUnknown.length > 0) {
      console.log(`\nNeeds manual research (${unexpectedUnknown.length}) — no blueprint data found:`);
      const byTab = {};
      for (const { name, varName } of unexpectedUnknown) {
        (byTab[varName] = byTab[varName] || []).push(name);
      }
      for (const [varName, names] of Object.entries(byTab)) {
        console.log(`  ${varName}: ${names.join(', ')}`);
      }
    }
  }

  if (noBpItems.length > 0) {
    const unexpected = noBpItems.filter(({ name }) => !KNOWN_NO_BP.has(name));
    if (unexpected.length > 0) {
      const byNote = new Map();
      for (const { name, note } of unexpected) {
        if (!byNote.has(note)) byNote.set(note, []);
        byNote.get(note).push(name);
      }
      console.log(`\nNo traditional blueprint (${unexpected.length} unexpected):`);
      for (const [note, names] of byNote) {
        console.log(`  ${note}:`);
        names.forEach(n => console.log(`    ${n}`));
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`${autoStubs.length} auto-stubs | ${unknown.length} unknown | ${noBpItems.length} no-blueprint`);

  if (autoStubs.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  if (!doApply) {
    console.log('Run with --apply to insert auto-stubs into data-blueprints.js (backs up first).');
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  console.log('\nApplying changes…');
  saveBackup();
  const sorted = [...autoStubs].sort((a, b) => a.name.localeCompare(b.name));
  applyNewBlueprints(sorted);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
