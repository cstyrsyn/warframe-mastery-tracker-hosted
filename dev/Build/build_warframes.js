// build_warframes.js — generates WARFRAMES, CIRCUIT_WF, VAULTED_WF from Import/warframe_update.csv
'use strict';
const fs   = require('fs');
const path = require('path');
const { parseCSVLine } = require('../lib/csv.js');

const raw = fs.readFileSync(path.join(__dirname, '..', 'Import', 'warframe_update.csv'), 'utf8');

const lines = raw.split(/\r?\n/).filter(l => l.trim());
const warframes = [], circuitWF = [], vaultedWF = [];

for (let i = 1; i < lines.length; i++) {
  const [name, cat, obtain, circuit, tradableRaw, vaultedRaw] = parseCSVLine(lines[i]).map(s => (s || '').trim());
  if (!name) continue;
  const tradable = tradableRaw && tradableRaw.toUpperCase() === 'TRUE' ? 1 : 0;
  const vaulted  = vaultedRaw  && vaultedRaw.toUpperCase()  === 'TRUE';
  const inCircuit = cat === 'Base' && circuit && circuit.toUpperCase() === 'YES';
  const cleanObtain = obtain.replace(/\s+$/, '').replace(/'/g, "\\'");
  let entry = `  ['${name.replace(/'/g, "\\'")}','${cat}','${cleanObtain}',30,200`;
  if (tradable) entry += `,1`;
  entry += `]`;
  warframes.push(entry);
  if (inCircuit) circuitWF.push(`'${name}'`);
  if (vaulted)   vaultedWF.push(`'${name}'`);
}

let out = '// ── WARFRAMES ────────────────────────────────────────────────────\n';
out += '// All warframes: maxRank 30, xpPerLevel 200 (6,000 XP max each)\n';
out += 'const WARFRAMES = [\n' + warframes.join(',\n') + '\n];\n\n';

out += '// Warframes available in The Circuit (Duviri), base variants only\n';
out += 'const CIRCUIT_WF = new Set([\n  ' + circuitWF.join(',') + '\n]);\n\n';

out += '// Prime warframes currently in the vault\n';
out += 'const VAULTED_WF = new Set([\n  ' + vaultedWF.join(',') + '\n]);\n';

fs.writeFileSync(path.join(__dirname, '..', 'warframes_data_output.js'), out);
console.log('Written warframes_data_output.js');
console.log('Warframes:', warframes.length, '| Circuit:', circuitWF.length, '| Vaulted:', vaultedWF.length);
