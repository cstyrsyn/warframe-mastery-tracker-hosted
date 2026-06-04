// extract.js — reads sections of the XLSX and writes intermediate CSV files
// Run: node extract.js

const xlsx = require('./node_modules/xlsx');
const fs   = require('fs');
const path = require('path');

const XLSX_FILE = './Copy of Warframe Mastery Checklist Update 42.xlsx';
const CSV_DIR   = './csv';

if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR);

const wb = xlsx.readFile(XLSX_FILE);

function getSheet(name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found`);
  return ws;
}

function readRange(ws, range) {
  return xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', range });
}

// Splits a block of rows into sections separated by blank first-column cells.
// The first row of each section is treated as a header and is sliced off.
function readSections(ws, range) {
  const allRows = readRange(ws, range);
  const sections = [];
  let current = null;
  for (const row of allRows) {
    if (String(row[0] ?? '').trim() === '') {
      if (current) { sections.push(current); current = null; }
    } else {
      if (!current) current = [];
      current.push(row);
    }
  }
  if (current) sections.push(current);
  // Each section's first row is its header — return only the data rows.
  return sections.map(s => s.slice(1));
}

// Reads a standard section: skips header, stops at first blank name (col index 0).
function stdSection(ws, range) {
  const rows = readRange(ws, range);
  const result = [];
  for (const row of rows.slice(1)) {
    if (String(row[0] ?? '').trim() === '') break;
    result.push(row);
  }
  return result;
}

// Reads a dual-row section (maxRank 40): weapons occupy 2 rows each.
// Row n  → name, acquired, mastered_30
// Row n+1 → (blank name), (blank), mastered_40
// hasHeader: set false when the data starts immediately (no header row to skip).
function dualSection(ws, range, hasHeader = true) {
  const rows = readRange(ws, range);
  const result = [];
  let i = hasHeader ? 1 : 0; // optionally skip header
  while (i < rows.length) {
    const name = String(rows[i]?.[0] ?? '').trim();
    if (!name) break;
    result.push([
      name,
      rows[i][1] ?? '',       // acquired
      rows[i][2] ?? '',       // mastered_30
      rows[i + 1]?.[2] ?? '', // mastered_40
    ]);
    i += 2;
  }
  return result;
}

function writeCsv(filename, rows) {
  const lines = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  fs.writeFileSync(path.join(CSV_DIR, filename), lines.join('\n') + '\n', 'utf8');
  console.log(`  wrote ${filename} (${rows.length - 1} data rows)`);
}

// ── Main + Info: Star Chart ──────────────────────────────────────────────────

console.log('Extracting Main + Info...');
const mainSheet = getSheet('Main + Info');

// Planets B16:E36 — col B=name, C=missions(ignored), D=regular, E=steelpath
const planetRows = readRange(mainSheet, 'B16:E36');
const planets = [['name', 'regular', 'steelpath']];
for (const [name, , regular, steelpath] of planetRows.slice(1)) {
  if (String(name).trim()) planets.push([name, regular, steelpath]);
}
writeCsv('sc_planets.csv', planets);

// Junctions G16:I29 — col G=name, H=regular, I=steelpath
const junctionRows = readRange(mainSheet, 'G16:I29');
const junctions = [['name', 'regular', 'steelpath']];
for (const [name, regular, steelpath] of junctionRows.slice(1)) {
  if (String(name).trim()) junctions.push([name, regular, steelpath]);
}
writeCsv('sc_junctions.csv', junctions);

// Overrides G32:J33 — header row + one data row; col H=regular override, J=sp override
const overrideRows = readRange(mainSheet, 'G32:J33');
const dataRow = overrideRows[1] || [];
writeCsv('sc_overrides.csv', [
  ['regular_override', 'sp_override'],
  [dataRow[1] ?? '', dataRow[3] ?? ''],
]);

// ── Warframe: Warframes ──────────────────────────────────────────────────────

console.log('Extracting Warframes...');
const wfSheet = getSheet('Warframe');

const wfRows = [['name', 'category', 'acquired', 'mastered']];

// Base frames — B2:F200, col B=name, C=acquired, D=mastered (E=subsumed ignored, F=method ignored)
// One section only; blank-stop detects end automatically.
const [baseFrames = []] = readSections(wfSheet, 'B2:F200');
for (const [name, acquired, mastered] of baseFrames) {
  wfRows.push([name, 'Base', acquired, mastered]);
}

// Prime + Umbra — H2:K200, two sections separated by a blank row.
// Section 0 = Primes, Section 1 = Umbra.
// col H=name, I=acquired, J=mastered (K=method ignored)
const [primeFrames = [], umbraFrames = []] = readSections(wfSheet, 'H2:K200');
for (const [name, acquired, mastered] of primeFrames) {
  wfRows.push([name, 'Prime', acquired, mastered]);
}
for (const [name, acquired, mastered] of umbraFrames) {
  wfRows.push([name, 'Umbra', acquired, mastered]);
}

writeCsv('wf_warframes.csv', wfRows);

// ── Primary: Weapons ────────────────────────────────────────────────────────

console.log('Extracting Primary...');
const primarySheet = getSheet('Primary');

// CSV columns: name, category, acquired, mastered_30, mastered_40, maxrank
// mastered_40 is empty for standard (maxRank 30) groups.
const pw = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];

function addStd(target, rows, category) {
  for (const [name, acquired, mastered] of rows) {
    target.push([name, category, acquired, mastered, '', 30]);
  }
}
function addDual(target, rows, category) {
  for (const [name, acquired, m30, m40] of rows) {
    target.push([name, category, acquired, m30, m40, 40]);
  }
}

// Standard groups — B column
addStd(pw, stdSection(primarySheet, 'B2:E200'),  'Rifle');

// Standard groups — G column (each starts at a known row; blank-stop finds the end)
addStd(pw, stdSection(primarySheet, 'G2:J200'),  'Shotgun');
addStd(pw, stdSection(primarySheet, 'G25:J200'), 'Sniper');
addStd(pw, stdSection(primarySheet, 'G37:J200'), 'Bow');
addStd(pw, stdSection(primarySheet, 'G55:J200'), 'Speargun');
addStd(pw, stdSection(primarySheet, 'G61:J200'), 'Bayonet');

// Standard groups — L column
addStd(pw, stdSection(primarySheet, 'L2:O200'),  'Launcher');
addStd(pw, stdSection(primarySheet, 'L15:O200'), 'Prime');
addStd(pw, stdSection(primarySheet, 'L50:O200'), 'MK1');

// Dual-row groups (maxRank 40) — G column
addDual(pw, dualSection(primarySheet, 'G64:J200'), 'Coda');

// Dual-row groups (maxRank 40) — L column
addDual(pw, dualSection(primarySheet, 'L56:O200'), 'Kuva');
addDual(pw, dualSection(primarySheet, 'L82:O200'), 'Tenet');

writeCsv('pw_primary.csv', pw);

// ── Secondary: Weapons ───────────────────────────────────────────────────────

console.log('Extracting Secondary...');
const secondarySheet = getSheet('Secondary');

const sw = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];

// Standard groups — B column
addStd(sw, stdSection(secondarySheet, 'B2:E200'),  'Single');

// Standard groups — G column
addStd(sw, stdSection(secondarySheet, 'G2:J200'),  'Dual');
addStd(sw, stdSection(secondarySheet, 'G29:J200'), 'Thrown');

// Standard groups — L column
addStd(sw, stdSection(secondarySheet, 'L2:O200'),  'Prime');
addStd(sw, stdSection(secondarySheet, 'L33:O200'), 'MK1');
addStd(sw, stdSection(secondarySheet, 'L37:O200'), 'Kitgun');

// Dual-row groups (maxRank 40) — G column
addDual(sw, dualSection(secondarySheet, 'G43:J200'), 'Coda');

// Dual-row groups (maxRank 40) — L column
addDual(sw, dualSection(secondarySheet, 'L45:O200'), 'Kuva');
addDual(sw, dualSection(secondarySheet, 'L58:O200'), 'Tenet');

writeCsv('sw_secondary.csv', sw);

// ── Melee: Weapons ───────────────────────────────────────────────────────────

console.log('Extracting Melee...');
const meleeSheet = getSheet('Melee');

const mw = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];

// Standard groups — B column
addStd(mw, stdSection(meleeSheet, 'B2:E200'),  'Sword/Nikana');
addStd(mw, stdSection(meleeSheet, 'B25:E200'), 'Dual Sword');
addStd(mw, stdSection(meleeSheet, 'B42:E200'), 'Heavy Blade');
addStd(mw, stdSection(meleeSheet, 'B55:E200'), 'Zaw');

// Standard groups — G column
addStd(mw, stdSection(meleeSheet, 'G2:J200'),  'Dagger');
addStd(mw, stdSection(meleeSheet, 'G12:J200'), 'Dual Dagger');
addStd(mw, stdSection(meleeSheet, 'G19:J200'), 'Machete');
addStd(mw, stdSection(meleeSheet, 'G30:J200'), 'Fist/Sparring');
addStd(mw, stdSection(meleeSheet, 'G42:J200'), 'Sword-Shield');
addStd(mw, stdSection(meleeSheet, 'G50:J200'), 'Gunblade');
addStd(mw, stdSection(meleeSheet, 'G56:J200'), 'Warfan');
addStd(mw, stdSection(meleeSheet, 'G62:J200'), 'Assault Saw');
addStd(mw, stdSection(meleeSheet, 'G65:J200'), 'Heavy Scythe');

// Standard groups — L column
addStd(mw, stdSection(meleeSheet, 'L2:O200'),  'Polearm/Staff');
addStd(mw, stdSection(meleeSheet, 'L22:O200'), 'Whip/B.Whip');
addStd(mw, stdSection(meleeSheet, 'L36:O200'), 'Glaive');
addStd(mw, stdSection(meleeSheet, 'L47:O200'), 'Tonfa/Nunchaku');
addStd(mw, stdSection(meleeSheet, 'L59:O200'), 'MK1');

// Standard groups — Q column
addStd(mw, stdSection(meleeSheet, 'Q2:T200'),  'Scythe');
addStd(mw, stdSection(meleeSheet, 'Q10:T200'), 'Hammer');
addStd(mw, stdSection(meleeSheet, 'Q24:T200'), 'Rapier');
addStd(mw, stdSection(meleeSheet, 'Q28:T200'), 'Claws');
addStd(mw, stdSection(meleeSheet, 'Q33:T200'), 'Prime');

// Dual-row groups (maxRank 40) — L column
addDual(mw, dualSection(meleeSheet, 'L63:O200'), 'Coda');

// Dual-row groups (maxRank 40) — Q column
addDual(mw, dualSection(meleeSheet, 'Q74:T200'), 'Kuva');
addDual(mw, dualSection(meleeSheet, 'Q80:T200'), 'Tenet');

writeCsv('mw_melee.csv', mw);

// ── Companion: Companions + Companion Weapons ────────────────────────────────

console.log('Extracting Companions...');
const companionSheet = getSheet('Companion');

// Two separate CSVs — companions go to cc prefix, companion weapons to cw prefix
const compRows = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];
const cwRows   = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];

// Companions — B column
addStd(compRows, stdSection(companionSheet, 'B2:E13'),  'Sentinel');
addStd(compRows, stdSection(companionSheet, 'B35:E41'), 'Prime Sentinel');

// Companion Weapons — B column (interleaved with companions in same column)
addStd(cwRows, stdSection(companionSheet, 'B15:E33'), 'Robotic Weapon');
addStd(cwRows, stdSection(companionSheet, 'B43:E49'), 'Prime Robotic Weapon');

// Companions — G column
// Moas (G17:J21) and Predasites (G22:J26) are contiguous — use exact end rows to prevent bleed.
addStd(compRows, stdSection(companionSheet, 'G2:J8'),   'Kubrow');
addStd(compRows, stdSection(companionSheet, 'G10:J15'), 'Kavat');
addStd(compRows, stdSection(companionSheet, 'G17:J21'), 'Moa');
addStd(compRows, stdSection(companionSheet, 'G22:J26'), 'Predasite');
addStd(compRows, stdSection(companionSheet, 'G28:J31'), 'Vulpaphyla');
addStd(compRows, stdSection(companionSheet, 'G33:J36'), 'Hound');

writeCsv('cc_companions.csv',  compRows);
writeCsv('cw_compweapons.csv', cwRows);

// ── Vehicle: Vehicles + Arch Weapons + Intrinsics ────────────────────────────

console.log('Extracting Vehicles...');
const vehicleSheet = getSheet('Vehicle');

const vehRows  = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];
const archRows = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];
const intrRows = [['name', 'level']];

// Vehicles — B column (standard)
addStd(vehRows, stdSection(vehicleSheet, 'B2:E6'),   'Archwing');
addStd(vehRows, stdSection(vehicleSheet, 'B45:E50'), 'K-Drive');

// Necramechs (B52:E56) — fully dual-row, maxRank 40
addDual(vehRows, dualSection(vehicleSheet, 'B52:E200'), 'Necramech');

// Prime section (B8:E11) — mixed: first 2 data rows are arch weapons, last is an archwing (vehicle)
const primeMixed = readRange(vehicleSheet, 'B8:E11').slice(1); // skip header B8
addStd(archRows, primeMixed.slice(0, 2).filter(r => String(r[0] ?? '').trim()), 'Prime Arch Weapon');
addStd(vehRows,  primeMixed.slice(2).filter(r => String(r[0] ?? '').trim()),   'Prime Archwing');

// Arch-Guns (B13:E33) — standard items up to B29; Kuva dual-row at B30:E33 (no header)
addStd(archRows, stdSection(vehicleSheet, 'B13:E29'), 'Arch-Gun');
addDual(archRows, dualSection(vehicleSheet, 'B30:E33', false), 'Kuva Arch-Gun');

// Arch-Melee (B35:E43) — standard
addStd(archRows, stdSection(vehicleSheet, 'B35:E200'), 'Arch-Melee');

// Plexus (G22:H22) — single item, no acquired column; use mastered as acquired proxy
const plexusRow = readRange(vehicleSheet, 'G22:H22')[0] || [];
if (String(plexusRow[0] ?? '').trim()) {
  vehRows.push([plexusRow[0], 'Plexus', plexusRow[1], plexusRow[1], '', 30]);
}

// Railjack Intrinsics (G24:J29) — G=name, H=level (numeric 0-10)
for (const row of readRange(vehicleSheet, 'G24:J29').slice(1)) {
  const name = String(row[0] ?? '').trim();
  if (!name) break;
  intrRows.push([name, row[1] ?? 0]);
}

writeCsv('veh_vehicles.csv',    vehRows);
writeCsv('veh_archweapons.csv', archRows);
writeCsv('veh_intrinsics.csv',  intrRows);

// ── AmpDrifter: Amps + Drifter Intrinsics ────────────────────────────────────

console.log('Extracting AmpDrifter...');
const ampSheet = getSheet('AmpDrifter');

const ampRows   = [['name', 'category', 'acquired', 'mastered_30', 'mastered_40', 'maxrank']];
const driftRows = [['name', 'level']];

// Amps (B2:E11) — standard, maxRank 30
addStd(ampRows, stdSection(ampSheet, 'B2:E200'), 'Amp');

// Drifter Intrinsics (H9:I13) — H=name, I=level (numeric 0-10)
for (const row of readRange(ampSheet, 'H9:I13').slice(1)) {
  const name = String(row[0] ?? '').trim();
  if (!name) break;
  driftRows.push([name, row[1] ?? 0]);
}

writeCsv('amp_amps.csv',       ampRows);
writeCsv('amp_intrinsics.csv', driftRows);

console.log('Done.\n');
