// update-incarnon-evolutions.js
// Scrapes each Incarnon Genesis wiki page's "Evolutions" table (4 tiers of challenge-gated
// perk choices, with per-weapon-variant stat values) into INCARNON_EVOLUTIONS.
//
// There is no wiki Lua module for this data (unlike Mods/Arcanes/Blueprints) — it lives as a
// hand-authored wikitable transcluded on each "<Weapon> Incarnon Genesis" article, so this
// script fetches one wiki page per genesis (rate-limited) rather than one bulk Module fetch.
//
// Usage:
//   node dev/update-incarnon-evolutions.js              # scrape all, print preview (no writes)
//   node dev/update-incarnon-evolutions.js --item "Braton Incarnon Genesis"
//   node dev/update-incarnon-evolutions.js --apply       # backs up data-incarnons.js, writes it
//   node dev/update-incarnon-evolutions.js --revert      # restore data-incarnons.js from latest backup
//
// Output:
//   dev/incarnon-evolutions-cache.json   (resumable cache — re-runs reuse previously scraped entries)
//   Inserts/replaces const INCARNON_EVOLUTIONS in data/data-incarnons.js

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const DATA_INCARNONS = path.join(__dirname, '..', 'data', 'data-incarnons.js');
const OUT_JSON         = path.join(__dirname, 'incarnon-evolutions-cache.json');
const BACKUP_DIR       = path.join(__dirname, 'backups', 'incarnon-evolutions');
const KEEP_BACKUPS      = 5;
const CRLF              = '\r\n'; // data-incarnons.js is CRLF throughout — match it

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
  const dest = path.join(BACKUP_DIR, `data-incarnons-${ts}.js`);
  fs.copyFileSync(DATA_INCARNONS, dest);
  console.log(`Backed up: ${path.basename(dest)}`);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data-incarnons-') && f.endsWith('.js'))
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
    .filter(f => f.startsWith('data-incarnons-') && f.endsWith('.js'))
    .sort();
  if (!files.length) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
  const latest = files[files.length - 1];
  fs.copyFileSync(path.join(BACKUP_DIR, latest), DATA_INCARNONS);
  console.log(`Reverted data-incarnons.js from ${latest}`);
}

// ── HTTP / rate limiting ────────────────────────────────────────────────────────

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetch(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWikitext(name) {
  const title = name.replace(/ /g, '_').replace(/&/g, '%26');
  const url = `https://wiki.warframe.com/api.php?action=query&prop=revisions&titles=${title}&rvprop=content&rvslots=main&format=json`;
  const json = await fetch(url);
  const data = JSON.parse(json);
  const page = Object.values(data.query.pages)[0];
  if (page.missing !== undefined) return null;
  return page.revisions[0].slots.main['*'];
}

// ── Wikitext → plain text ───────────────────────────────────────────────────────

function stripWikitext(s) {
  if (!s) return '';
  let t = s;
  t = t.replace(/\{\{clr\}\}/gi, '');
  t = t.replace(/\[\[File:[^\]]*\]\]/gi, '');
  t = t.replace(/'''/g, '').replace(/''/g, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');            // <br> -> real newline (matches this app's data convention)
  t = t.replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, ''); // strip other stray HTML tags (e.g. <u>), keep content
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2'); // [[Link|Alias]] -> Alias
  t = t.replace(/\[\[([^\]]+)\]\]/g, '$1');             // [[Link]] -> Link
  // {{D|Heat}} -> Heat, {{M|Mod}} -> Mod, {{WF|Warframe|Alias}} -> Alias, generic {{X|a|b}} -> b
  t = t.replace(/\{\{([^{}|]+)((?:\|[^{}]*)?)\}\}/g, (m, tmpl, args) => {
    if (!args) return tmpl.trim();
    const parts = args.split('|').slice(1);
    return parts.length ? parts[parts.length - 1].trim() : tmpl.trim();
  });
  t = t.split('\n').map(l => l.replace(/^\*+\s*/, '').trim()).filter(Boolean).join('\n');
  t = t.replace(/[ \t]+/g, ' ').trim();
  return t;
}

// ── Minimal MediaWiki table tokenizer ───────────────────────────────────────────
// Cell: { marker: '!'|'|', attrs, raw, span }
function parseTableRows(tableText) {
  const lines = tableText.split('\n');
  const rows = [];
  let currentRow = null;
  let currentCell = null;

  function flushCell() {
    if (currentCell) {
      const m = currentCell.attrs.match(/colspan\s*=\s*"?(\d+)"?/i);
      currentCell.span = m ? parseInt(m[1], 10) : 1;
      currentRow.push(currentCell);
      currentCell = null;
    }
  }
  function flushRow() {
    flushCell();
    if (currentRow && currentRow.length) rows.push(currentRow);
    currentRow = null;
  }
  function splitAttrsContent(raw) {
    const pipeIdx = raw.indexOf('|');
    if (pipeIdx === -1) return { attrs: '', content: raw.trim() };
    const before = raw.slice(0, pipeIdx);
    // Only treat text-before-pipe as attrs if it looks like key="value" — avoids misreading
    // a content-internal pipe (e.g. [[Link|Alias]]) as the attrs/content separator.
    if (before.includes('=')) return { attrs: before.trim(), content: raw.slice(pipeIdx + 1).trim() };
    return { attrs: '', content: raw.trim() };
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('{|')) continue;
    if (trimmed.startsWith('|}')) { flushRow(); break; }
    if (trimmed.startsWith('|-')) { flushRow(); currentRow = []; continue; }
    if (trimmed.startsWith('|+')) continue; // caption

    if (trimmed.startsWith('!') || trimmed.startsWith('|')) {
      if (!currentRow) currentRow = [];
      flushCell();
      const marker = trimmed[0];
      const sep = marker === '!' ? '!!' : '||';
      const parts = trimmed.slice(1).split(sep);
      for (const part of parts) {
        flushCell();
        const { attrs, content } = splitAttrsContent(part);
        currentCell = { marker, attrs, raw: content };
      }
    } else if (currentCell) {
      currentCell.raw += '\n' + line; // continuation of a multi-line cell (e.g. bullet lists)
    }
  }
  flushRow();
  return rows;
}

function extractEvolutionsTable(wikitext) {
  const headingMatch = wikitext.match(/={3,4}\s*Evolutions\s*={3,4}/i);
  if (!headingMatch) return null;
  const secIdx = headingMatch.index;
  const tblStart = wikitext.indexOf('{|', secIdx);
  if (tblStart === -1) return null;
  const tblEnd = wikitext.indexOf('\n|}', tblStart);
  if (tblEnd === -1) return null;
  return wikitext.slice(tblStart, tblEnd + 3);
}

// Fill `totalSlots` values from a list of (possibly colspan'd) cells.
function expandToSlots(cells, totalSlots) {
  const out = [];
  for (const c of cells) {
    const n = Math.max(1, c.span || 1);
    for (let i = 0; i < n && out.length < totalSlots; i++) out.push(stripWikitext(c.raw));
  }
  while (out.length < totalSlots) out.push('');
  return out;
}

// Returns { weapons: [variantName,...], tiers: [{ challenge, perks: [{name,desc,values,notes}] }] } or null.
function parseEvolutions(wikitext) {
  const tableText = extractEvolutionsTable(wikitext);
  if (!tableText) return null;
  const rows = parseTableRows(tableText);
  if (rows.length < 2) return null;

  // Header row cells are NOT colspan-expanded — its label cells ("Evolution", "Notes") are
  // purely visual merges; the real per-weapon columns are always individually span=1.
  // Column headers use {{Weapon|RealName}} or {{Weapon|RealName|DisplayAlias}} (e.g.
  // {{Weapon|Mk1-Braton|Mk1}}) — we need RealName (matches this app's INCARNON_WEAPONS keys),
  // not the alias, so extract the template's first arg directly instead of stripWikitext's
  // generic "last pipe arg" rule (which is right for other templates, wrong here).
  const header = rows[0];
  const weaponNames = header.slice(1, -1).map(c => {
    const m = c.raw.match(/\{\{\s*Weapon\s*\|\s*([^|}]+)/i);
    return m ? m[1].trim() : stripWikitext(c.raw);
  }).filter(Boolean);
  const n = weaponNames.length;
  if (n === 0) return null;

  const tiers = [];
  let currentTier = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length) continue;
    const firstText = stripWikitext(row[0].raw);

    if (firstText === 'Evolution Challenge') {
      const challengeText = row[1] ? stripWikitext(row[1].raw) : '';
      currentTier = { challenge: challengeText, perks: [] };
      tiers.push(currentTier);
      continue;
    }

    let cells;
    if (/^EVO\d+$/.test(firstText)) {
      if (firstText === 'EVO1') {
        currentTier = { challenge: null, perks: [] }; // granted on install, no challenge
        tiers.push(currentTier);
      }
      cells = row.slice(1); // drop the tier-label cell
    } else {
      cells = row; // continuation perk row within the current tier
    }
    if (!currentTier || cells.length < 2) continue;

    const nameCell = cells[0];
    const descCell = cells[1];
    const rest = cells.slice(2);
    const notesCellRaw = rest.length ? rest[rest.length - 1] : null;
    const valueCells = rest.slice(0, -1);

    currentTier.perks.push({
      name: stripWikitext(nameCell.raw),
      desc: stripWikitext(descCell.raw),
      values: expandToSlots(valueCells, n),
      notes: notesCellRaw ? stripWikitext(notesCellRaw.raw) : '',
    });
  }

  if (!tiers.length || !tiers.some(t => t.perks.length)) return null;
  return { weapons: weaponNames, tiers };
}

// ── Extract target genesis names from data-incarnons.js ───────────────────────

function extractGenesisNames(src) {
  const marker = 'const INCARNON_REQUIREMENTS = new Map([';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('INCARNON_REQUIREMENTS not found in data-incarnons.js');
  let depth = 0, end = -1;
  for (let i = start + marker.length - 1; i < src.length; i++) {
    if (src[i] === '[') depth++;
    if (src[i] === ']') {
      depth--;
      if (depth === 0) {
        const after = src.slice(i, i + 3);
        if (after === ']);') { end = i + 3; break; }
      }
    }
  }
  if (end === -1) throw new Error('Could not find closing ]); for INCARNON_REQUIREMENTS');
  const body = src.slice(start, end);
  const names = new Set();
  const re = /"([^"]+Incarnon Genesis)"/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return [...names].sort();
}

// ── Serialise / splice INCARNON_EVOLUTIONS into data-incarnons.js ─────────────

function buildMapContent(results) {
  const entries = Object.entries(results)
    .filter(([, v]) => v && typeof v === 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, evo]) => `  [${JSON.stringify(name)},${JSON.stringify(evo)}]`);
  const header = [
    '// ── INCARNON EVOLUTIONS ─────────────────────────────────────────',
    '// Maps genesis name → { weapons: [variantName,...] (table column order),',
    '//   tiers: [{ challenge: string|null, perks: [{name,desc,values,notes}] }] }',
    '// challenge = the text that unlocks THIS tier (null for tier 1, granted on install).',
    '// Scraped from each "<Weapon> Incarnon Genesis" wiki page — see dev/update-incarnon-evolutions.js.',
  ].join(CRLF);
  return header + CRLF + 'const INCARNON_EVOLUTIONS = new Map([' + CRLF
    + entries.join(',' + CRLF) + ',' + CRLF + ']);' + CRLF;
}

function spliceIntoDataFile(src, mapContent) {
  const marker = 'const INCARNON_EVOLUTIONS = new Map([';
  const start = src.indexOf(marker);
  if (start !== -1) {
    // Re-run: replace the existing block (bracket-depth matching, mirrors INCARNON_REQUIREMENTS's
    // own splice logic in the archived scraper, since entries here also contain nested [...]/{...}).
    let depth = 0, end = -1;
    for (let i = start + marker.length - 1; i < src.length; i++) {
      if (src[i] === '[') depth++;
      if (src[i] === ']') {
        depth--;
        if (depth === 0) {
          const after = src.slice(i, i + 3);
          if (after === ']);') { end = i + 3; break; }
        }
      }
    }
    if (end === -1) throw new Error('Could not find closing ]); for existing INCARNON_EVOLUTIONS');
    // Walk back to include the preceding header comment block, if present, so we don't duplicate it.
    let headerStart = start;
    const commentBlockRe = /(?:\/\/[^\r\n]*\r?\n)+$/;
    const before = src.slice(0, start);
    const cm = before.match(commentBlockRe);
    if (cm) headerStart = start - cm[0].length;
    return src.slice(0, headerStart) + mapContent + src.slice(end);
  }
  // First run: insert right after INCARNON_REQUIREMENTS's closing ]);
  const reqMarker = 'const INCARNON_REQUIREMENTS = new Map([';
  const reqStart = src.indexOf(reqMarker);
  if (reqStart === -1) throw new Error('INCARNON_REQUIREMENTS not found — cannot locate insertion point');
  let depth = 0, reqEnd = -1;
  for (let i = reqStart + reqMarker.length - 1; i < src.length; i++) {
    if (src[i] === '[') depth++;
    if (src[i] === ']') {
      depth--;
      if (depth === 0) {
        const after = src.slice(i, i + 3);
        if (after === ']);') { reqEnd = i + 3; break; }
      }
    }
  }
  if (reqEnd === -1) throw new Error('Could not find closing ]); for INCARNON_REQUIREMENTS');
  return src.slice(0, reqEnd) + CRLF + CRLF + mapContent + src.slice(reqEnd);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2);
  const doApply = args.includes('--apply');
  const single  = args.includes('--item') ? args[args.indexOf('--item') + 1] : null;

  if (args.includes('--revert')) { revert(); return; }

  const src = fs.readFileSync(DATA_INCARNONS, 'utf-8');
  const allGenesis = extractGenesisNames(src);
  const targets = single ? [single] : allGenesis;
  console.log(`Processing ${targets.length} Incarnon Genesis page${targets.length === 1 ? '' : 's'}`);

  // Always load the cache first (even in --item mode) so a single-item re-scrape merges into
  // the existing set instead of --apply wiping every other genesis down to just this one.
  let existing = {};
  if (fs.existsSync(OUT_JSON)) {
    existing = JSON.parse(fs.readFileSync(OUT_JSON, 'utf-8'));
  }

  let ok = 0, missing = 0, errors = 0;

  for (const name of targets) {
    process.stdout.write(`  ${name}... `);
    try {
      const wikitext = await fetchWikitext(name);
      if (!wikitext) {
        console.log('page not found');
        existing[name] = null;
        missing++;
      } else {
        const evo = parseEvolutions(wikitext);
        if (evo) {
          const tierSummary = evo.tiers.map(t => t.perks.length).join('/');
          console.log(`${evo.weapons.length} variant(s), ${evo.tiers.length} tiers (${tierSummary} perks)`);
          existing[name] = evo;
          ok++;
        } else {
          console.log('Evolutions table not found/unparsable');
          existing[name] = null;
          missing++;
        }
      }
    } catch (e) {
      console.log('ERROR: ' + e.message);
      errors++;
    }
    if (targets.length > 1) await sleep(500);
  }

  console.log(`\nResults: ${ok} ok · ${missing} missing · ${errors} errors`);

  if (!doApply) {
    console.log('\nDry run — no files written. Re-run with --apply to write.');
    if (!single) fs.writeFileSync(OUT_JSON, JSON.stringify(existing, null, 2), 'utf-8');
    return;
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`Saved → ${OUT_JSON}`);

  saveBackup();
  const mapContent = buildMapContent(existing);
  const updatedSrc = fs.readFileSync(DATA_INCARNONS, 'utf-8'); // re-read in case backup step matters
  const updated = spliceIntoDataFile(updatedSrc, mapContent);
  fs.writeFileSync(DATA_INCARNONS, updated, 'utf-8');
  console.log(`Updated → ${DATA_INCARNONS}`);
  console.log('Done.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
