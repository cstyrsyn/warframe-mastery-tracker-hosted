// extract-relics.js
// Fetches Module:Void/data from the Warframe wiki and extracts relic drop data
// into a PrimeData-style JSON (item → parts → relics with rarity + vaulted status).
//
// Usage:
//   node dev/extract-relics.js
//
// Output:
//   dev/relics.json — { "Ash Prime": { IsVaulted, Parts: { "Blueprint": { Drops: { "Lith A1": { Rarity, Vaulted } } } } } }

'use strict';

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const luaparse = require('luaparse');

const WIKI_URL = 'https://wiki.warframe.com/w/Module:Void/data?action=raw';
const OUT_JSON = path.join(__dirname, 'relics.json');

// ── Fetch with redirect support ──────────────────────────────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ── Lua AST → JS value (same as extract-blueprints.js) ───────────────────────
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
      const hasNamedKeys = node.fields.some(
        f => f.type === 'TableKeyString' || f.type === 'TableKey'
      );
      if (!hasNamedKeys) return node.fields.map(f => nodeToJs(f.value));
      const obj = {};
      let arrayIdx = 1;
      for (const field of node.fields) {
        if (field.type === 'TableKeyString') {
          obj[field.key.name] = nodeToJs(field.value);
        } else if (field.type === 'TableKey') {
          obj[nodeToJs(field.key)] = nodeToJs(field.value);
        } else {
          obj[arrayIdx++] = nodeToJs(field.value);
        }
      }
      return obj;
    }
    default: return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching relic data from wiki…');
  const lua = await fetch(WIKI_URL);
  console.log(`Received ${(lua.length / 1024).toFixed(1)} KB of Lua`);

  console.log('Parsing Lua AST…');
  let ast;
  try {
    ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  } catch (e) {
    throw new Error('Lua parse failed: ' + e.message);
  }

  // Find the RelicData = { ... } assignment statement
  // (The module uses a local variable reassigned to the full table)
  let relicDataNode = null;
  for (const stmt of ast.body) {
    if (
      stmt.type === 'AssignmentStatement' &&
      stmt.variables.length === 1 &&
      stmt.variables[0].type === 'Identifier' &&
      stmt.variables[0].name === 'RelicData'
    ) {
      relicDataNode = stmt.init[0];
      break;
    }
  }
  if (!relicDataNode) throw new Error('RelicData assignment not found in Lua module');

  console.log('Converting RelicData table…');
  const relicData = nodeToJs(relicDataNode);
  const relicNames = Object.keys(relicData);
  console.log(`Found ${relicNames.length} relics`);

  // Build PrimeData: item → { IsVaulted, Parts: { partName → { Drops: { relicName → { Rarity, Vaulted } } } } }
  // IsVaulted = true only if every relic for every part of this item is vaulted.
  const primeData = {};

  for (const [relicName, relicEntry] of Object.entries(relicData)) {
    const relicIsVaulted = !!relicEntry.Vaulted;

    for (const drop of (relicEntry.Drops || [])) {
      const { Item: itemName, Part: partName, Rarity: rarity } = drop;
      if (!itemName || !partName || !rarity) continue;

      if (!primeData[itemName]) primeData[itemName] = { IsVaulted: true, Parts: {} };
      if (!primeData[itemName].Parts[partName]) primeData[itemName].Parts[partName] = { Drops: {} };

      primeData[itemName].Parts[partName].Drops[relicName] = {
        Rarity:  rarity,
        Vaulted: relicIsVaulted,
      };

      // If any relic for any part is not vaulted, the whole item is not vaulted
      if (!relicIsVaulted) primeData[itemName].IsVaulted = false;
    }
  }

  const itemCount = Object.keys(primeData).length;
  console.log(`Built drop data for ${itemCount} prime items`);

  fs.writeFileSync(OUT_JSON, JSON.stringify(primeData, null, 2), 'utf-8');
  console.log(`Saved → ${OUT_JSON}`);
  console.log('Done.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
