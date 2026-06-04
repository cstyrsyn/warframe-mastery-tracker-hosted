// sheets-import.gs — Warframe Mastery Checklist → WF_TRACK_V2 progress JSON
//
// Setup (one-time):
//   1. Open your checklist Google Sheet
//   2. Extensions → Apps Script → paste this entire file → Save
//   3. Deploy → New deployment → Web app
//      Execute as: Me   |   Who has access: Anyone
//   4. Click Deploy, authorise when prompted, copy the web app URL
//   5. Paste the URL into the tracker's Import dialog → "Fetch from Sheets"
//
// Re-deploy after any edits: Deploy → Manage deployments → pencil icon → New version.

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTruthy(val) {
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  var s = String(val).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
}

// Read a standard section. Skips the header row (index 0), stops at blank name.
// Returns [{name, acquired, mastered}]
function readStd(sheet, range) {
  var v = sheet.getRange(range).getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][0] || '').trim();
    if (!name) break;
    out.push({ name: name, acquired: v[i][1], mastered: v[i][2] });
  }
  return out;
}

// Read a dual-row section (maxRank 40 items).
// hasHeader = false when data begins on the first row of the range.
// Returns [{name, acquired, mastered30, mastered40}]
function readDual(sheet, range, hasHeader) {
  if (hasHeader === undefined) hasHeader = true;
  var v = sheet.getRange(range).getValues();
  var out = [];
  var i = hasHeader ? 1 : 0;
  while (i < v.length) {
    var name = String(v[i][0] || '').trim();
    if (!name) break;
    var m40 = (i + 1 < v.length) ? v[i + 1][2] : false;
    out.push({ name: name, acquired: v[i][1], mastered30: v[i][2], mastered40: m40 });
    i += 2;
  }
  return out;
}

// Read multiple sections within one column block, separated by blank rows.
// Each section's first non-blank row is its header and is skipped.
// Returns an array of [{name, acquired, mastered}] arrays.
function readSections(sheet, range) {
  var v = sheet.getRange(range).getValues();
  var sections = [], cur = null, inSec = false;
  for (var r = 0; r < v.length; r++) {
    var name = String(v[r][0] || '').trim();
    if (!name) {
      if (cur && cur.length) { sections.push(cur); cur = null; }
      inSec = false;
    } else {
      if (!inSec) { inSec = true; continue; }
      if (!cur) cur = [];
      cur.push({ name: name, acquired: v[r][1], mastered: v[r][2] });
    }
  }
  if (cur && cur.length) sections.push(cur);
  return sections;
}

// ── Progress builders ─────────────────────────────────────────────────────────

function addStd(p, pfx, items, maxRank) {
  if (!maxRank) maxRank = 30;
  for (var i = 0; i < items.length; i++) {
    var n = items[i].name;
    if (isTruthy(items[i].mastered))       { p[pfx + n] = maxRank; p['aq:' + pfx + n] = true; }
    else if (isTruthy(items[i].acquired))  { p['aq:' + pfx + n] = true; }
  }
}

function addDual(p, pfx, items) {
  for (var i = 0; i < items.length; i++) {
    var n    = items[i].name;
    var rank = isTruthy(items[i].mastered40) ? 40 : isTruthy(items[i].mastered30) ? 30 : 0;
    if (rank > 0)                              { p[pfx + n] = rank; p['aq:' + pfx + n] = true; }
    else if (isTruthy(items[i].acquired))     { p['aq:' + pfx + n] = true; }
  }
}

function addIntrinsics(p, sheet, range) {
  var v = sheet.getRange(range).getValues();
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][0] || '').trim();
    if (!name) break;
    var lvl = Number(v[i][1]);
    if (!isNaN(lvl) && lvl > 0) p['in:' + name] = lvl;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function respond(e, data) {
  var json = JSON.stringify(data);
  var cb   = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ── Main export ───────────────────────────────────────────────────────────────

function doGet(e) {
  try {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Verify all required sheet tabs exist before doing any work.
  var REQUIRED = ['Main + Info', 'Warframe', 'Primary', 'Secondary', 'Melee', 'Companion', 'Vehicle', 'Amp/Drifter'];
  var missing  = REQUIRED.filter(function(n) { return ss.getSheetByName(n) === null; });
  if (missing.length) {
    return respond(e, { error: 'Sheet tab(s) not found: ' + missing.join(', ') + '. Check that your tab names match exactly (case-sensitive).' });
  }

  var p  = {};

  // ── Main + Info ─────────────────────────────────────────────────────────────
  var main = ss.getSheetByName('Main + Info');

  var planets = main.getRange('B16:E36').getValues();
  for (var i = 1; i < planets.length; i++) {
    var name = String(planets[i][0] || '').trim(); if (!name) break;
    if (isTruthy(planets[i][2])) p['pl:' + name]  = true;
    if (isTruthy(planets[i][3])) p['sp:' + name]  = true;
  }

  var junctions = main.getRange('G16:I29').getValues();
  for (var i = 1; i < junctions.length; i++) {
    var name = String(junctions[i][0] || '').trim(); if (!name) break;
    if (isTruthy(junctions[i][1])) p['jn:' + name]  = true;
    if (isTruthy(junctions[i][2])) p['spj:' + name] = true;
  }

  var ovr = main.getRange('G32:J33').getValues();
  if (ovr.length >= 2) {
    var reg = Number(ovr[1][1]), sp = Number(ovr[1][3]);
    if (!isNaN(reg) && ovr[1][1] !== '') p['sc-ovr:regular'] = reg;
    if (!isNaN(sp)  && ovr[1][3] !== '') p['sc-ovr:sp']      = sp;
  }

  // ── Warframes ───────────────────────────────────────────────────────────────
  var wf = ss.getSheetByName('Warframe');
  var wfSecs = readSections(wf, 'B2:F200');
  for (var s = 0; s < wfSecs.length; s++) addStd(p, 'w:', wfSecs[s]);
  var wfPrime = readSections(wf, 'H2:K200');
  for (var s = 0; s < wfPrime.length; s++) addStd(p, 'w:', wfPrime[s]);

  // ── Primary ─────────────────────────────────────────────────────────────────
  var pw = ss.getSheetByName('Primary');
  addStd (p, 'p1:', readStd (pw, 'B2:E200'));
  addStd (p, 'p1:', readStd (pw, 'G2:J200'));
  addStd (p, 'p1:', readStd (pw, 'G25:J200'));
  addStd (p, 'p1:', readStd (pw, 'G37:J200'));
  addStd (p, 'p1:', readStd (pw, 'G55:J200'));
  addStd (p, 'p1:', readStd (pw, 'G61:J200'));
  addStd (p, 'p1:', readStd (pw, 'L2:O200'));
  addStd (p, 'p1:', readStd (pw, 'L15:O200'));
  addStd (p, 'p1:', readStd (pw, 'L50:O200'));
  addDual(p, 'p1:', readDual(pw, 'G64:J200'));
  addDual(p, 'p1:', readDual(pw, 'L56:O200'));
  addDual(p, 'p1:', readDual(pw, 'L82:O200'));

  // ── Secondary ───────────────────────────────────────────────────────────────
  var sw = ss.getSheetByName('Secondary');
  addStd (p, 'p2:', readStd (sw, 'B2:E200'));
  addStd (p, 'p2:', readStd (sw, 'G2:J200'));
  addStd (p, 'p2:', readStd (sw, 'G29:J200'));
  addStd (p, 'p2:', readStd (sw, 'L2:O200'));
  addStd (p, 'p2:', readStd (sw, 'L33:O200'));
  addStd (p, 'p2:', readStd (sw, 'L37:O200'));
  addDual(p, 'p2:', readDual(sw, 'G43:J200'));
  addDual(p, 'p2:', readDual(sw, 'L45:O200'));
  addDual(p, 'p2:', readDual(sw, 'L58:O200'));

  // ── Melee ───────────────────────────────────────────────────────────────────
  var mw = ss.getSheetByName('Melee');
  addStd (p, 'p3:', readStd (mw, 'B2:E200'));
  addStd (p, 'p3:', readStd (mw, 'B25:E200'));
  addStd (p, 'p3:', readStd (mw, 'B42:E200'));
  addStd (p, 'p3:', readStd (mw, 'B55:E200'));
  addStd (p, 'p3:', readStd (mw, 'G2:J200'));
  addStd (p, 'p3:', readStd (mw, 'G12:J200'));
  addStd (p, 'p3:', readStd (mw, 'G19:J200'));
  addStd (p, 'p3:', readStd (mw, 'G30:J200'));
  addStd (p, 'p3:', readStd (mw, 'G42:J200'));
  addStd (p, 'p3:', readStd (mw, 'G50:J200'));
  addStd (p, 'p3:', readStd (mw, 'G56:J200'));
  addStd (p, 'p3:', readStd (mw, 'G62:J200'));
  addStd (p, 'p3:', readStd (mw, 'G65:J200'));
  addStd (p, 'p3:', readStd (mw, 'L2:O200'));
  addStd (p, 'p3:', readStd (mw, 'L22:O200'));
  addStd (p, 'p3:', readStd (mw, 'L36:O200'));
  addStd (p, 'p3:', readStd (mw, 'L47:O200'));
  addStd (p, 'p3:', readStd (mw, 'L59:O200'));
  addStd (p, 'p3:', readStd (mw, 'Q2:T200'));
  addStd (p, 'p3:', readStd (mw, 'Q10:T200'));
  addStd (p, 'p3:', readStd (mw, 'Q24:T200'));
  addStd (p, 'p3:', readStd (mw, 'Q28:T200'));
  addStd (p, 'p3:', readStd (mw, 'Q33:T200'));
  addDual(p, 'p3:', readDual(mw, 'L63:O200'));
  addDual(p, 'p3:', readDual(mw, 'Q74:T200'));
  addDual(p, 'p3:', readDual(mw, 'Q80:T200'));

  // ── Companion ───────────────────────────────────────────────────────────────
  var cp = ss.getSheetByName('Companion');
  addStd(p, 'c:',  readStd(cp, 'B2:E13'));
  addStd(p, 'c:',  readStd(cp, 'B35:E41'));
  addStd(p, 'c:',  readStd(cp, 'G2:J8'));
  addStd(p, 'c:',  readStd(cp, 'G10:J15'));
  addStd(p, 'c:',  readStd(cp, 'G17:J21'));
  addStd(p, 'c:',  readStd(cp, 'G22:J26'));
  addStd(p, 'c:',  readStd(cp, 'G28:J31'));
  addStd(p, 'c:',  readStd(cp, 'G33:J36'));
  addStd(p, 'cw:', readStd(cp, 'B15:E33'));
  addStd(p, 'cw:', readStd(cp, 'B43:E49'));

  // ── Vehicle ─────────────────────────────────────────────────────────────────
  var veh = ss.getSheetByName('Vehicle');
  addStd (p, 'v:',  readStd (veh, 'B2:E6'));
  addStd (p, 'v:',  readStd (veh, 'B45:E50'));
  addDual(p, 'v:',  readDual(veh, 'B52:E200'));

  // Prime B8:E11 — rows 1-2 (B9:B10) = arch weapons, row 3 (B11) = archwing
  var prime = veh.getRange('B8:E11').getValues();
  for (var j = 1; j <= 2; j++) {
    var name = String(prime[j][0] || '').trim();
    if (!name) continue;
    if (isTruthy(prime[j][2]))       { p['aw:' + name] = 30; p['aq:aw:' + name] = true; }
    else if (isTruthy(prime[j][1]))  { p['aq:aw:' + name] = true; }
  }
  var arow = prime[3];
  if (arow) {
    var name = String(arow[0] || '').trim();
    if (name) {
      if (isTruthy(arow[2]))       { p['v:' + name] = 30; p['aq:v:' + name] = true; }
      else if (isTruthy(arow[1]))  { p['aq:v:' + name] = true; }
    }
  }

  addStd (p, 'aw:', readStd (veh, 'B13:E29'));
  addDual(p, 'aw:', readDual(veh, 'B30:E33', false));
  addStd (p, 'aw:', readStd (veh, 'B35:E200'));

  // Plexus G22:H22 — no acquired col; mastered as proxy
  var plexus = veh.getRange('G22:H22').getValues();
  if (plexus.length && plexus[0]) {
    var name = String(plexus[0][0] || '').trim();
    if (name && isTruthy(plexus[0][1])) { p['v:' + name] = 30; p['aq:v:' + name] = true; }
  }

  addIntrinsics(p, veh, 'G24:J29');

  // ── AmpDrifter ──────────────────────────────────────────────────────────────
  var amp = ss.getSheetByName('Amp/Drifter');
  addStd(p, 'am:', readStd(amp, 'B2:E200'));
  addIntrinsics(p, amp, 'H9:I13');

  return respond(e, p);

  } catch(err) {
    return respond(e, { error: err.message + (err.lineNumber ? ' (line ' + err.lineNumber + ')' : '') });
  }
}
