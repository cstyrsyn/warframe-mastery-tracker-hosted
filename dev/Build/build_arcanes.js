// build_arcanes.js — generates ARCANES, ARCANE_DESC, ARCANE_RANK_COPIES from Source/arcanes.csv and Source/rank_arcane.csv
'use strict';
const fs   = require('fs');
const path = require('path');
const { parseCSVLine, cleanStr, jsEsc } = require('../lib/csv.js');

const csv     = fs.readFileSync(path.join(__dirname, '..', 'Source', 'arcanes - Copy.csv'), 'utf8');
const rankCsv = fs.readFileSync(path.join(__dirname, '..', 'Source', 'rank_arcane.csv'), 'utf8');

function normAcq(s) {
  return s.split(/[;]/).map(p => cleanStr(p)).filter(Boolean);
}

// Parse rank copies table
const rankLines = rankCsv.split(/\r?\n/).filter(l => l.trim());
const rankCopies = [];
for (let i = 1; i < rankLines.length; i++) {
  const [, copies] = rankLines[i].split(',');
  if (copies) rankCopies.push(parseInt(copies.trim()));
}

// Parse arcanes
const lines = csv.split(/\r?\n/).filter(l => l.trim());
const headers = parseCSVLine(lines[0]);
const arcanes = [];
for (let i = 1; i < lines.length; i++) {
  const fields = parseCSVLine(lines[i]);
  const obj = {};
  headers.forEach((h, j) => obj[h.trim()] = cleanStr(fields[j] || ''));
  if (!obj['Name']) continue;
  arcanes.push(obj);
}

// Build output
let out = '// ── ARCANE_RANK_COPIES ───────────────────────────────────────────\n';
out += '// Copies of an arcane required to reach each rank (index = rank)\n';
out += `const ARCANE_RANK_COPIES = [${rankCopies.join(',')}];\n\n`;

out += '// ── ARCANES ──────────────────────────────────────────────────────\n';
out += '// [name, type, acquisition, maxRank, rarity, tradable, category]\n';
out += '// acquisition: array of sources. tradable: 1 if player-tradable.\n';
out += 'const ARCANES = [\n';

let descObj = '// Arcane descriptions — used as tooltips on arcane cards\n';
descObj += 'const ARCANE_DESC = {\n';

for (const a of arcanes) {
  const name     = cleanStr(a['Name']);
  const type     = cleanStr(a['Type'] || '');
  const acqArr   = normAcq(a['Acquisition'] || '');
  const maxRank  = parseInt(a['Max Rank']) || 0;
  const rarity   = cleanStr(a['Rarity'] || '');
  const tradable = (a['Tradable'] || '').toLowerCase() === 'true' ? 1 : 0;
  const category = cleanStr(a['Category'] || '');
  const desc     = cleanStr(a['Description'] || '');

  const acqStr = '[' + acqArr.map(s => `'${jsEsc(s)}'`).join(',') + ']';
  out += `  ['${jsEsc(name)}','${jsEsc(type)}',${acqStr},${maxRank},'${jsEsc(rarity)}',${tradable},'${jsEsc(category)}'],\n`;
  if (desc) descObj += `  '${jsEsc(name)}':'${jsEsc(desc)}',\n`;
}

out += '];\n';
descObj += '};\n';

fs.writeFileSync(path.join(__dirname, '..', 'arcanes_data_output.js'), out + '\n' + descObj);
console.log('Written arcanes_data_output.js');
console.log('Total arcanes:', arcanes.length);
console.log('Rank copies:', rankCopies);

const types = {};
arcanes.forEach(a => { types[a['Type']] = (types[a['Type']] || 0) + 1; });
console.log('\nType counts:');
Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${n}\t${t}`));
