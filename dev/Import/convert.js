// convert.js — reads intermediate CSV files and writes import.json for WF_TRACK_V2
// Run: node convert.js
// Then paste the contents of import.json into the webapp's Import Save dialog.

const fs   = require('fs');
const path = require('path');

const CSV_DIR     = './csv';
const OUTPUT_FILE = './import.json';

function readCsv(filename) {
  const filepath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filepath)) { console.warn(`  skipping ${filename} (not found)`); return []; }
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    // simple CSV parse — fields may be quoted
    const values = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]));
  });
}

function truthy(val) {
  const v = String(val).trim().toUpperCase();
  return v === 'TRUE' || v === '1' || v === 'YES';
}

const progress = {};

// ── Star Chart ───────────────────────────────────────────────────────────────

for (const { name, regular, steelpath } of readCsv('sc_planets.csv')) {
  if (!name) continue;
  if (truthy(regular))   progress[`pl:${name}`] = true;
  if (truthy(steelpath)) progress[`sp:${name}`] = true;
}

for (const { name, regular, steelpath } of readCsv('sc_junctions.csv')) {
  if (!name) continue;
  if (truthy(regular))   progress[`jn:${name}`]  = true;
  if (truthy(steelpath)) progress[`spj:${name}`] = true;
}

const [ovr] = readCsv('sc_overrides.csv');
if (ovr) {
  const reg = Number(ovr.regular_override);
  const sp  = Number(ovr.sp_override);
  if (!isNaN(reg) && ovr.regular_override !== '') progress['sc-ovr:regular'] = reg;
  if (!isNaN(sp)  && ovr.sp_override !== '')      progress['sc-ovr:sp']      = sp;
}

// Resolves rank from mastered_30 / mastered_40 / maxrank columns.
// Standard items (maxrank 30) only have mastered_30; dual items (maxrank 40) have both.
function resolveRank(mastered_30, mastered_40, maxrank) {
  const max = Number(maxrank) || 30;
  if (truthy(mastered_40)) return max;   // fully mastered at 40
  if (truthy(mastered_30)) return 30;
  return 0;
}

// ── Warframes ────────────────────────────────────────────────────────────────
// prefix w:, acquired prefix aq:w:, maxRank 30

for (const { name, acquired, mastered } of readCsv('wf_warframes.csv')) {
  if (!name) continue;
  if (truthy(mastered)) {
    progress[`w:${name}`]    = 30;
    progress[`aq:w:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:w:${name}`] = true;
  }
}

// ── Primary Weapons ──────────────────────────────────────────────────────────
// prefix p1:, acquired prefix aq:p1:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('pw_primary.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`p1:${name}`]    = rank;
    progress[`aq:p1:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:p1:${name}`] = true;
  }
}

// ── Secondary Weapons ────────────────────────────────────────────────────────
// prefix p2:, acquired prefix aq:p2:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('sw_secondary.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`p2:${name}`]    = rank;
    progress[`aq:p2:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:p2:${name}`] = true;
  }
}

// ── Melee Weapons ────────────────────────────────────────────────────────────
// prefix p3:, acquired prefix aq:p3:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('mw_melee.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`p3:${name}`]    = rank;
    progress[`aq:p3:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:p3:${name}`] = true;
  }
}

// ── Companions ────────────────────────────────────────────────────────────────
// prefix c:, acquired prefix aq:c:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('cc_companions.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`c:${name}`]    = rank;
    progress[`aq:c:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:c:${name}`] = true;
  }
}

// ── Companion Weapons ─────────────────────────────────────────────────────────
// prefix cw:, acquired prefix aq:cw:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('cw_compweapons.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`cw:${name}`]    = rank;
    progress[`aq:cw:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:cw:${name}`] = true;
  }
}

// ── Vehicles ──────────────────────────────────────────────────────────────────
// prefix v:, acquired prefix aq:v:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('veh_vehicles.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`v:${name}`]    = rank;
    progress[`aq:v:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:v:${name}`] = true;
  }
}

// ── Arch Weapons ──────────────────────────────────────────────────────────────
// prefix aw:, acquired prefix aq:aw:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('veh_archweapons.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`aw:${name}`]    = rank;
    progress[`aq:aw:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:aw:${name}`] = true;
  }
}

// ── Intrinsics ─────────────────────────────────────────────────────────────────
// prefix in:, level stored directly (no acquired flag)

for (const { name, level } of readCsv('veh_intrinsics.csv')) {
  if (!name) continue;
  const lvl = Number(level);
  if (!isNaN(lvl) && lvl > 0) progress[`in:${name}`] = lvl;
}

// ── Amps ──────────────────────────────────────────────────────────────────────
// prefix am:, acquired prefix aq:am:

for (const { name, acquired, mastered_30, mastered_40, maxrank } of readCsv('amp_amps.csv')) {
  if (!name) continue;
  const rank = resolveRank(mastered_30, mastered_40, maxrank);
  if (rank > 0) {
    progress[`am:${name}`]    = rank;
    progress[`aq:am:${name}`] = true;
  } else if (truthy(acquired)) {
    progress[`aq:am:${name}`] = true;
  }
}

// ── Drifter Intrinsics ────────────────────────────────────────────────────────
// prefix in: (same as Railjack intrinsics), level stored directly

for (const { name, level } of readCsv('amp_intrinsics.csv')) {
  if (!name) continue;
  const lvl = Number(level);
  if (!isNaN(lvl) && lvl > 0) progress[`in:${name}`] = lvl;
}

// ─────────────────────────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(progress, null, 2), 'utf8');
console.log(`Wrote ${OUTPUT_FILE} — ${Object.keys(progress).length} entries.`);
