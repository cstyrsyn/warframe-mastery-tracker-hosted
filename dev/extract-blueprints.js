// extract-blueprints.js
// Fetches Module:Blueprints/data from the Warframe wiki and extracts
// resource requirements for every blueprint into JSON and CSV.
//
// Usage:
//   npm install luaparse          (one-time, inside the dev/ folder)
//   node dev/extract-blueprints.js
//
// Output:
//   dev/blueprints.json           — full parsed blueprint data
//   dev/blueprints-resources.csv  — flat table: blueprint, resource, amount

'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const luaparse = require('luaparse');

const WIKI_URL = 'https://wiki.warframe.com/w/Module:Blueprints/data?action=raw';
const OUT_JSON = path.join(__dirname, 'blueprints.json');
const OUT_CSV  = path.join(__dirname, 'blueprints-resources.csv');

// ── Fetch with redirect support ──────────────────────────────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ── Lua AST → JS value ───────────────────────────────────────────────────────
function nodeToJs(node) {
  if (!node) return null;
  switch (node.type) {
    case 'NumericLiteral':  return node.value;
    case 'StringLiteral': {
      // luaparse sets .value = null; the actual string is in .raw with surrounding quotes
      const r = node.raw;
      if (r[0] === '"' || r[0] === "'") return r.slice(1, -1);
      if (r.startsWith('[[')) return r.slice(2, -2); // long string
      return r;
    }
    case 'BooleanLiteral':  return node.value;
    case 'NilLiteral':      return null;
    case 'UnaryExpression':
      return node.operator === '-' ? -nodeToJs(node.argument) : nodeToJs(node.argument);
    case 'TableConstructorExpression': {
      const hasNamedKeys = node.fields.some(
        f => f.type === 'TableKeyString' || f.type === 'TableKey'
      );
      if (!hasNamedKeys) {
        // Pure array
        return node.fields.map(f => nodeToJs(f.value));
      }
      // Object (may have a mix of named keys and positional values)
      const obj = {};
      let arrayIdx = 1;
      for (const field of node.fields) {
        if (field.type === 'TableKeyString') {
          obj[field.key.name] = nodeToJs(field.value);
        } else if (field.type === 'TableKey') {
          obj[nodeToJs(field.key)] = nodeToJs(field.value);
        } else {
          // TableValue — positional entry inside an otherwise-named table
          obj[arrayIdx++] = nodeToJs(field.value);
        }
      }
      return obj;
    }
    default:
      return null;
  }
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}
function csvRow(...cells) { return cells.map(csvCell).join(','); }

// ── Flatten parts (handles nested component costs) ───────────────────────────
function flattenParts(parts, prefix) {
  const rows = [];
  for (const part of (parts || [])) {
    rows.push({ component: prefix, resource: part.Name, count: part.Count || 1, type: part.Type || '' });
    // Nested sub-component crafting cost
    if (part.Cost && part.Cost.Parts) {
      rows.push(...flattenParts(part.Cost.Parts, prefix + ' > ' + part.Name));
    }
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching blueprint data from wiki…');
  const lua = await fetch(WIKI_URL);
  console.log(`Received ${(lua.length / 1024).toFixed(1)} KB of Lua`);

  console.log('Parsing Lua AST…');
  let ast;
  try {
    ast = luaparse.parse(lua, { scope: false, luaVersion: '5.1' });
  } catch (e) {
    throw new Error('Lua parse failed: ' + e.message);
  }

  const returnStmt = ast.body.find(s => s.type === 'ReturnStatement');
  if (!returnStmt || !returnStmt.arguments[0]) throw new Error('No return statement found in module');

  const moduleData = nodeToJs(returnStmt.arguments[0]);
  // Module has two top-level tables: Blueprints (weapons) and Suits (warframes + components)
  const blueprints = Object.assign({}, moduleData.Blueprints || {}, moduleData.Suits || {});
  const names = Object.keys(blueprints);
  console.log(`Parsed ${names.length} blueprints (${Object.keys(moduleData.Blueprints||{}).length} weapons + ${Object.keys(moduleData.Suits||{}).length} suits)`);

  // Save full JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify(blueprints, null, 2), 'utf-8');
  console.log(`Saved → ${OUT_JSON}`);

  // Build flat CSV
  const csvLines = [csvRow('Blueprint', 'Result', 'Credits', 'Time_s', 'Component', 'Resource', 'Amount', 'ResourceType')];

  for (const bpName of names) {
    const bp = blueprints[bpName];
    const baseResult  = bp.Result   || bpName;
    const baseCredits = bp.Credits  || 0;
    const baseTime    = bp.Time     || 0;

    const parts = flattenParts(bp.Parts || [], bpName);

    if (parts.length === 0) {
      csvLines.push(csvRow(bpName, baseResult, baseCredits, baseTime, '', '', '', ''));
    } else {
      for (const p of parts) {
        csvLines.push(csvRow(bpName, baseResult, baseCredits, baseTime, p.component, p.resource, p.count, p.type));
      }
    }
  }

  fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf-8');
  console.log(`Saved → ${OUT_CSV}`);
  console.log('Done.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
