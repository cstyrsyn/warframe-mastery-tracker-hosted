// build_mods.js — generates MODS and MOD_DESC arrays from warframe_mods_v3.csv
'use strict';
const fs   = require('fs');
const path = require('path');
const { parseCSVLine, cleanStr, jsEsc } = require('../lib/csv.js');

const csv = fs.readFileSync(path.join(__dirname, '..', 'warframe_mods_v3.csv'), 'utf8');
const lines = csv.split(/\r?\n/).filter(l => l.trim());

const headers = parseCSVLine(lines[0]);
const mods = [];
for (let i = 1; i < lines.length; i++) {
  const fields = parseCSVLine(lines[i]);
  const obj = {};
  headers.forEach((h, j) => obj[h.trim()] = cleanStr(fields[j] || ''));
  if (!obj['Name'] || obj['Category'] === 'Unobtainable') continue;
  mods.push(obj);
}

function normAcq(s) {
  return s.split(/[;]/).map(p => cleanStr(p)).filter(Boolean);
}

let modsArr = '// ── MODS ─────────────────────────────────────────────────────────\n';
modsArr += '// [name, category, acquisition, maxRank, polarity, rarity, exilus, tradable, type, subType, use]\n';
modsArr += '// acquisition/subType/use: arrays. exilus: 1 if fits Exilus slot. tradable: 1 if player-tradable.\n';
modsArr += 'const MODS = [\n';

let descObj = '// Mod descriptions — used as tooltips on mod cards\n';
descObj += 'const MOD_DESC = {\n';

for (const m of mods) {
  const name    = cleanStr(m['Name']);
  const cat     = cleanStr(m['Category']);
  const acqArr  = normAcq(m['Acquisition'] || '');
  const maxRank = parseInt(m['Max Rank']) || 0;
  const polarity = cleanStr(m['Polarity'] || '');
  const rarity   = cleanStr(m['Rarity'] || '');
  const exilus   = (m['IsExilus'] || '').toLowerCase() === 'true' ? 1 : 0;
  const tradable = (m['Tradable'] || '').toLowerCase() === 'true' ? 1 : 0;
  const type     = cleanStr(m['Type'] || '');
  const subType  = normAcq(m['Sub-Type'] || '');
  const use      = normAcq(m['Use'] || '');
  const desc     = cleanStr(m['Description'] || '');

  const exilusStr   = exilus   ? `,1` : `,0`;
  const tradableStr = tradable ? `,1` : `,0`;
  const acqStr      = '[' + acqArr.map(s => `'${jsEsc(s)}'`).join(',') + ']';
  const subTypeStr  = '[' + subType.map(s => `'${jsEsc(s)}'`).join(',') + ']';
  const useStr      = '[' + use.map(s => `'${jsEsc(s)}'`).join(',') + ']';

  modsArr += `  ['${jsEsc(name)}','${jsEsc(cat)}',${acqStr},${maxRank},'${jsEsc(polarity)}','${jsEsc(rarity)}'${exilusStr}${tradableStr},'${jsEsc(type)}',${subTypeStr},${useStr}],\n`;
  if (desc) {
    descObj += `  '${jsEsc(name)}':'${jsEsc(desc)}',\n`;
  }
}

modsArr += '];\n';
descObj += '};\n';

const outPath = path.join(__dirname, '..', 'mods_data_output.js');
fs.writeFileSync(outPath, modsArr + '\n' + descObj);
console.log('Written mods_data_output.js');
console.log('Total mods:', mods.length);
console.log('File size:', fs.statSync(outPath).size, 'bytes (~' + Math.round(fs.statSync(outPath).size / 1024) + ' KB)');

// Category summary
const cats = {};
mods.forEach(m => { cats[m['Category']] = (cats[m['Category']] || 0) + 1; });
console.log('\nCategory counts (sorted by count):');
Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${n}\t${c}`));
