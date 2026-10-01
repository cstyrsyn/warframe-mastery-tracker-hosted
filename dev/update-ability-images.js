// update-ability-images.js
// Downloads the white ability icon for every Helminth ability in HELMINTH_OF_IDS
// (data/data-abilities.js) into Images/abilities/.
//
// Icon filenames come from the wiki's Module:Ability/data `Icon` field rather than a naming rule,
// because punctuation isn't consistent (e.g. "Xata's Whisper" → "Xata'sWhisperIcon(xWhite).png").
// Files are fetched through Special:FilePath, which redirects to the full-size original — the
// /images/thumb/…/50px-… URLs in page HTML are just resized copies, and the ?xxxxx suffix is a
// cache-buster.
//
// When it fetches the wiki, also reports abilities flagged Subsumable that HELMINTH_OF_IDS doesn't list.
// (update-warframes.js is what actually adds new subsume abilities — from each frame's Subsumed field —
// and calls downloadAbilityIcons() for them.)
//
// Usage:
//   node dev/update-ability-images.js           # download missing icons
//   node dev/update-ability-images.js --force   # re-download all icons
//
// Output: Images/abilities/<name with non-alphanumerics removed>.png  (see helminthIconPath() in app.js)

'use strict';

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const vm       = require('vm');
const luaparse = require('luaparse');

const DATA_ABILITIES = path.join(__dirname, '..', 'data', 'data-abilities.js');
const OUT_DIR        = path.join(__dirname, '..', 'Images', 'abilities');
const WIKI_URL       = 'https://wiki.warframe.com/w/Module:Ability/data?action=raw';
const TIMEOUT_MS     = 20000;
const CONCURRENCY    = 2;     // the wiki returns HTTP 429 above a handful of parallel requests
const RETRIES_429    = 4;     // per file, with increasing back-off

// Must match helminthIconPath() in app.js
const iconFilename = name => name.replace(/[^A-Za-z0-9]/g, '') + '.png';

// ── HTTP ──────────────────────────────────────────────────────────────────────

function get(url, binary = false) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(new URL(res.headers.location, url).href, binary).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode}`);
        err.status = res.statusCode;
        return reject(err);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(binary ? buf : buf.toString('utf-8'));
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWithRetry(url, binary) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await get(url, binary);
    } catch (e) {
      if (e.status !== 429 || attempt >= RETRIES_429) throw e;
      await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s, 16s
    }
  }
}

// Some Icon values in the module are already URL-encoded (e.g. "Master%27sSummonsIcon(xWhite).png") —
// decode first so encodeURIComponent doesn't double-encode the "%".
function fileUrl(icon) {
  let name = icon;
  try { name = decodeURIComponent(icon); } catch { /* not encoded */ }
  return `https://wiki.warframe.com/w/Special:FilePath/${encodeURIComponent(name)}`;
}

// ── Lua → JS AST converter (same as update-weapons / update-warframes) ────────

function nodeToJs(node) {
  if (!node) return null;
  switch (node.type) {
    case 'NumericLiteral':  return node.value;
    case 'StringLiteral': {
      const r = node.raw;
      if (r[0] === '"' || r[0] === "'") return r.slice(1, -1).replace(/\\(["'\\])/g, '$1');
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
        if (field.type === 'TableKeyString')      obj[field.key.name]      = nodeToJs(field.value);
        else if (field.type === 'TableKey')       obj[nodeToJs(field.key)] = nodeToJs(field.value);
        else                                      obj[idx++]               = nodeToJs(field.value);
      }
      return obj;
    }
    default: return null;
  }
}

// ── Sources ───────────────────────────────────────────────────────────────────

function loadHelminthAbilities() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DATA_ABILITIES, 'utf-8') + ';this.H = HELMINTH_OF_IDS;', ctx);
  return ctx.H;
}

// Returns Map<abilityName, { icon, powersuit, subsumable }> from the wiki's live "Ability" table.
// The module is `local AbilityData = { Archived = {...}, Ability = {...}, ... }` then `return AbilityData`.
async function fetchWikiAbilities() {
  console.log('Fetching wiki Module:Ability/data…');
  const lua = await get(WIKI_URL);
  if (!lua) throw new Error('Module:Ability/data not found');
  console.log(`  Received ${(lua.length / 1024).toFixed(1)} KB`);

  const ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  const decl = ast.body.find(s =>
    s.type === 'LocalStatement' && s.variables[0]?.name === 'AbilityData');
  if (!decl) throw new Error('local AbilityData = {…} not found in Module:Ability/data');
  const data = nodeToJs(decl.init[0]);

  const out = new Map();
  for (const [key, a] of Object.entries(data.Ability || {})) {
    if (!a || typeof a !== 'object') continue;
    out.set(a.Name || key, { icon: a.Icon || null, powersuit: a.Powersuit || null, subsumable: a.Subsumable === true });
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Downloads icons for every HELMINTH_OF_IDS ability (only missing ones unless force).
// Exported so update-warframes.js can fetch icons for abilities it adds in the same run.
// Skips the wiki fetch entirely when nothing is missing.
async function downloadAbilityIcons({ force = false } = {}) {
  const helminth = loadHelminthAbilities();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const wanted = Object.keys(helminth).sort()
    .map(name => ({ name, dest: path.join(OUT_DIR, iconFilename(name)) }));
  const missing = force ? wanted : wanted.filter(w => !fs.existsSync(w.dest));
  const present = wanted.length - missing.length;
  if (!missing.length) {
    console.log(`\nAll ${wanted.length} ability icons already present.`);
    return;
  }

  const wiki = await fetchWikiAbilities();

  // Case-insensitive lookup — tracker keys don't always match wiki casing ("Well Of Life" vs "Well of Life"),
  // and renaming the key would break saved builds that reference the ability by name.
  const wikiLower = new Map([...wiki].map(([n, a]) => [n.toLowerCase(), a]));

  const queue = [], noIcon = [];
  for (const { name, dest } of missing) {
    const icon = wikiLower.get(name.toLowerCase())?.icon;
    if (!icon) { noIcon.push(name); continue; }
    queue.push({ name, icon, dest });
  }

  console.log(`\n── Ability icons (${queue.length} to download, ${present} already present) ──`);
  let downloaded = 0;
  const failed = [];
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    await Promise.all(queue.slice(i, i + CONCURRENCY).map(async ({ name, icon, dest }) => {
      try {
        const buf = await getWithRetry(fileUrl(icon), true);
        if (!buf) { failed.push(`${name} (${icon}: not found)`); return; }
        fs.writeFileSync(dest, buf);
        downloaded++;
        console.log(`  ✓ ${name}`);
      } catch (e) {
        failed.push(`${name} (${icon}: ${e.message})`);
      }
    }));
  }

  // Abilities the wiki marks Subsumable that the tracker doesn't know about yet
  const known = new Set(Object.keys(helminth).map(n => n.toLowerCase()));
  const newSubsumable = [...wiki].filter(([n, a]) => a.subsumable && !known.has(n.toLowerCase()));

  console.log(`\n  Downloaded: ${downloaded}  Failed: ${failed.length}  No icon on wiki: ${noIcon.length}`);
  failed.forEach(f => console.log(`  ✗ ${f}`));
  if (noIcon.length) {
    console.log('\n  Not in Module:Ability/data (check the ability name matches the wiki):');
    noIcon.forEach(n => console.log(`  ? ${n}`));
  }
  if (newSubsumable.length) {
    console.log('\n  Subsumable on the wiki but missing from HELMINTH_OF_IDS:');
    newSubsumable.forEach(([n, a]) => console.log(`  + "${n}": { id: ?, source: "${a.powersuit}" },`));
  }
}

module.exports = { downloadAbilityIcons };

if (require.main === module) {
  downloadAbilityIcons({ force: process.argv.includes('--force') })
    .then(() => process.exit(0))
    .catch(err => { console.error('ERROR:', err.message); process.exit(1); });
}
