// update.js — validate CSVs and append new items to data.js
// Usage:
//   node update.js                                    dry-run all sections
//   node update.js --section warframes                dry-run one section
//   node update.js --section warframes primary melee  dry-run multiple sections
//   node update.js --apply                            write changes to data.js
//   node update.js --apply --override                 write, bypassing blocking validation errors
//
// Sections: warframes, companions, vehicles, primary, secondary, melee,
//           archWeapons, compWeapons, amps, intrinsics, mods, arcanes
'use strict';
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');
const { parseCSVLine, cleanStr, jsD, jsS, jsSArr } = require('./lib/csv.js');

// ── CLI ────────────────────────────────────────────────────────────
const APPLY    = process.argv.includes('--apply');
const OVERRIDE = process.argv.includes('--override');
const secArgI   = process.argv.indexOf('--section');
const ONLY_SECS = secArgI !== -1
  ? process.argv.slice(secArgI + 1).filter(a => !a.startsWith('--'))
  : [];

// ── PATHS ──────────────────────────────────────────────────────────
const ROOT    = path.join(__dirname, '..');
const DATA_JS = path.join(ROOT, 'data.js');
const SRC_DIR = path.join(__dirname, 'Source');
const IMG_DIR = path.join(ROOT, 'Images');

// ── OUTPUT ─────────────────────────────────────────────────────────
const TTY = process.stdout.isTTY;
const C = { reset:'\x1b[0m', red:'\x1b[31m', yellow:'\x1b[33m', green:'\x1b[32m', cyan:'\x1b[36m', bold:'\x1b[1m', dim:'\x1b[2m' };
const col  = (k, s) => (TTY ? C[k] : '') + s + (TTY ? C.reset : '');
const OK   = s => col('green',  '  ✓  ') + s;
const WARN = s => col('yellow', '  ⚠  ') + s;
const FAIL = s => col('red',    '  ✗  ') + s;
const INFO = s => col('dim',    '  ·  ') + s;
const HDR  = s => '\n' + col('bold', col('cyan', '── ' + s + ' '));

// ── GAME CONSTANTS ─────────────────────────────────────────────────
const VALID_POLARITIES = new Set([
  'Naramon','Madurai','Vazarin','Zenurik','Unairu','Penjaga','Umbra','Universal','',
]);

// Keep in sync with COMPANION_IMG_PLAIN in data.js
const COMPANION_IMG_PLAIN = new Set(['Venari','Venari Prime']);

// ── SECTION DEFINITIONS ────────────────────────────────────────────
const SECTIONS = [
  { id:'warframes',   type:'items', varName:'WARFRAMES',    xpPL:200,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'warframes.csv'),
    imgDir:'warframes',    imgFile:(n)=>n.replace(/ /g,'')+`Helmet.png` },

  { id:'companions',  type:'items', varName:'COMPANIONS',   xpPL:200,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'companions.csv'),
    imgDir:'companions',   imgFile:(n,cat)=>{
      const b=n.replace(/ /g,'');
      if(COMPANION_IMG_PLAIN.has(n)) return b+'.png';
      if(cat==='Kubrows') return b+'Kubrow.png';
      if(cat==='Kavats')  return b+'Kavat.png';
      if(cat==='Moas')    return b+'MOA.png';
      if(cat==='Hound')   return b+'Hound.png';
      return b+'.png';
    }},

  { id:'vehicles',    type:'items', varName:'VEHICLES',     xpPL:200,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'vehicles.csv'),
    imgDir:'vehicles',     imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'primary',     type:'items', varName:'PRIMARY',      xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_primary.csv'),
    imgDir:'primary',      imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'secondary',   type:'items', varName:'SECONDARY',    xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_secondary.csv'),
    imgDir:'secondary',    imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'melee',       type:'items', varName:'MELEE',        xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_melee.csv'),
    imgDir:'melee',        imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'archWeapons', type:'items', varName:'ARCH_WEAPONS', xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_vehicles.csv'),
    catMap: { 'Arch-Guns': 'Arch-Gun', 'Prime': 'Prime Arch-Gun' },
    imgDir:'arch-weapons', imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'compWeapons', type:'items', varName:'COMP_WEAPONS', xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_companions.csv'),
    catMap: { 'Robotic Weapons': 'Robotic', 'Prime Robotic Weapons': 'Prime Robotic' },
    imgDir:'comp-weapons', imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'amps',        type:'items', varName:'AMPS',         xpPL:100,  defaultMaxRank:30, rankBounds:[1,40],
    csvFile: path.join(SRC_DIR,'weapons_amps.csv'),
    imgDir:'amps',         imgFile:(n)=>n.replace(/ /g,'')+'.png' },

  { id:'intrinsics',  type:'items', varName:'INTRINSICS',   xpPL:1500, defaultMaxRank:10, rankBounds:[1,10],
    csvFile: path.join(SRC_DIR,'intrinsics.csv'),
    imgDir:'intrinsics',   imgFile:(n,cat)=>{
      const b=n.replace(/ /g,'');
      return cat==='Drifter' ? `DrifterIntrinsic${b}.png` : `${b}Intrinsic.png`;
    }},

  { id:'mods',    type:'mods',    varName:'MODS',    descVarName:'MOD_DESC',    rankBounds:[0,15],
    csvFile: path.join(__dirname,'warframe_mods_v3.csv') },

  { id:'arcanes', type:'arcanes', varName:'ARCANES', descVarName:'ARCANE_DESC', rankBounds:[0,10],
    csvFile: path.join(SRC_DIR,'arcanes.csv') },
];

// ── CSV PARSING ────────────────────────────────────────────────────
function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^,+$/.test(line)) continue;
    const fields = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, j) => { obj[h] = fields[j] ?? ''; }); // raw — no trim, preserves whitespace for checks
    if (!(obj[headers[0]] || '').trim()) continue;
    rows.push(obj);
  }
  return rows;
}

// ── DATA.JS HELPERS ────────────────────────────────────────────────
function getExisting(dataJS, varName) {
  const re = new RegExp(`const ${varName}\\s*=\\s*[\\[{]`);
  const m  = re.exec(dataJS);
  if (!m) return new Set();
  const rest   = dataJS.slice(m.index);
  const endIdx = rest.search(/\n[}\]];/);
  const section = endIdx === -1 ? rest : rest.slice(0, endIdx);
  const names  = new Set();
  for (const x of section.matchAll(/^\s*\[["']([^"']+)["']/gm))  names.add(x[1]);
  for (const x of section.matchAll(/^\s*["']([^"']+)["']\s*:/gm)) names.add(x[1]);
  return names;
}

function getCategories(dataJS, varName) {
  const re = new RegExp(`const ${varName}\\s*=\\s*\\[`);
  const m  = re.exec(dataJS);
  if (!m) return new Set();
  const rest   = dataJS.slice(m.index);
  const endIdx = rest.search(/\n\];/);
  const section = endIdx === -1 ? rest : rest.slice(0, endIdx);
  const cats   = new Set();
  for (const x of section.matchAll(/^\s*\[["'][^"']*["'],["']([^"']+)["']/gm)) cats.add(x[1]);
  return cats;
}

function insertArray(dataJS, varName, newLines) {
  const start = dataJS.indexOf(`const ${varName} = [`);
  if (start === -1) throw new Error(`${varName} not found in data.js`);
  const rest = dataJS.slice(start);
  const endM = rest.match(/\n\];/);
  if (!endM) throw new Error(`End of ${varName} not found`);
  const pos = start + endM.index + 1;
  return dataJS.slice(0, pos) + newLines.join('\n') + '\n' + dataJS.slice(pos);
}

function insertObject(dataJS, varName, newLines) {
  const start = dataJS.indexOf(`const ${varName} = {`);
  if (start === -1) throw new Error(`${varName} not found in data.js`);
  const rest = dataJS.slice(start);
  const endM = rest.match(/\n\};/);
  if (!endM) throw new Error(`End of ${varName} not found`);
  const pos = start + endM.index + 1;
  return dataJS.slice(0, pos) + newLines.join('\n') + '\n' + dataJS.slice(pos);
}

function normSplit(s) { return (s||'').split(';').map(cleanStr).filter(Boolean); }

function makeItemLine(row, cfg) {
  const name     = row['Name'].trim();
  const rawCat   = row['Category'].trim();
  const cat      = cfg.catMap?.[rawCat] ?? rawCat;
  const obtain   = (row['Method to Obtain'] || '').trim();
  const maxRank  = parseInt(row['Max Rank']) || cfg.defaultMaxRank;
  const tradable = (row['Tradable'] || '').trim().toLowerCase() === 'yes' ? 1 : 0;
  const compFor  = (row['Component for'] || '').trim();
  const parts = [jsD(name), jsD(cat), jsD(obtain), maxRank];
  if (tradable || compFor) parts.push(tradable);
  if (compFor) parts.push(jsD(compFor));
  return `  [${parts.join(',')}],`;
}

function makeModLine(row) {
  const name     = cleanStr(row['Name']);
  const cat      = cleanStr(row['Category']);
  const acq      = jsSArr(normSplit(row['Acquisition']));
  const maxRank  = parseInt(row['Max Rank']) || 0;
  const polarity = cleanStr(row['Polarity'] || '');
  const rarity   = cleanStr(row['Rarity']   || '');
  const exilus   = (row['IsExilus']||'').toLowerCase() === 'true' ? 1 : 0;
  const tradable = (row['Tradable'] ||'').toLowerCase() === 'true' ? 1 : 0;
  const type     = cleanStr(row['Type']     || '');
  const subType  = jsSArr(normSplit(row['Sub-Type']));
  const use      = jsSArr(normSplit(row['Use']));
  return `  [${jsS(name)},${jsS(cat)},${acq},${maxRank},${jsS(polarity)},${jsS(rarity)},${exilus},${tradable},${jsS(type)},${subType},${use}],`;
}

function makeModDescLine(name, row) {
  const desc = cleanStr(row['Description'] || '');
  return desc ? `  ${jsS(name)}:${jsS(desc)},` : null;
}

function makeArcaneLine(row) {
  const name     = cleanStr(row['Name']);
  const type     = cleanStr(row['Type']     || '');
  const acq      = jsSArr(normSplit(row['Acquisition']));
  const maxRank  = parseInt(row['Max Rank']) || 0;
  const rarity   = cleanStr(row['Rarity']   || '');
  const tradable = (row['Tradable'] ||'').toLowerCase() === 'true' ? 1 : 0;
  const category = cleanStr(row['Category'] || '');
  return `  [${jsS(name)},${jsS(type)},${acq},${maxRank},${jsS(rarity)},${tradable},${jsS(category)}],`;
}

function makeArcaneDescLine(name, row) {
  const desc = cleanStr(row['Description'] || '');
  return desc ? `  ${jsS(name)}:${jsS(desc)},` : null;
}

// ── NETWORK ────────────────────────────────────────────────────────
function httpHead(urlStr, followRedirects) {
  return new Promise((resolve, reject) => {
    function doGet(u, remaining) {
      if (remaining < 0) { reject(new Error('Too many redirects')); return; }
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'WFTracker-Updater/1.0' } }, res => {
        if (followRedirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try { doGet(new URL(res.headers.location, u).href, remaining - 1); } catch(e) { reject(e); }
          return;
        }
        res.resume();
        resolve({ status: res.statusCode });
      }).on('error', reject);
    }
    doGet(urlStr, 10);
  });
}

async function downloadFile(urlStr, dest) {
  return new Promise((resolve, reject) => {
    function doGet(u, remaining) {
      if (remaining < 0) { reject(new Error('Too many redirects')); return; }
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'WFTracker-Updater/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try { doGet(new URL(res.headers.location, u).href, remaining - 1); } catch(e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const f = fs.createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => f.close(resolve));
        f.on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
      }).on('error', reject);
    }
    doGet(urlStr, 10);
  });
}

async function checkWiki(name) {
  const url = 'https://wiki.warframe.com/w/' + encodeURIComponent(name.replace(/ /g,'_'));
  try {
    const { status } = await httpHead(url, true);
    if (status === 404) return { ok:false, msg:`wiki 404 — ${url}` };
    if (status !== 200) return { ok:false, msg:`wiki HTTP ${status}` };
    return { ok:true };
  } catch(e) { return { ok:false, msg:`wiki error: ${e.message}` }; }
}

async function checkMarket(name) {
  const slug = name.toLowerCase().replace(/[ -]/g,'_') + '_set';
  const url  = 'https://warframe.market/items/' + slug + '?type=sell';
  try {
    const { status } = await httpHead(url, false); // don't follow redirects
    if (status >= 300 && status < 400) return { ok:false, msg:`market ${status} redirect (item may not be listed yet) — ${url}` };
    if (status === 200) return { ok:true };
    return { ok:false, msg:`market HTTP ${status}` };
  } catch(e) { return { ok:false, msg:`market error: ${e.message}` }; }
}

function needsMarketSlugReview(name) {
  // marketSlug() only replaces spaces and hyphens — these chars would produce a broken URL
  return /[&\/\\@#%+]/.test(name);
}

async function handleImage(cfg, name, cat) {
  const filename = cfg.imgFile(name, cat);
  const dest     = path.join(IMG_DIR, cfg.imgDir, filename);
  const wikiUrl  = 'https://wiki.warframe.com/w/Special:Redirect/file/' + encodeURIComponent(filename);

  if (fs.existsSync(dest)) return { exists:true, filename };

  if (!APPLY) return { wouldDownload:true, filename };

  try {
    fs.mkdirSync(path.join(IMG_DIR, cfg.imgDir), { recursive:true });
    await downloadFile(wikiUrl, dest);
    return { downloaded:true, filename };
  } catch(e) {
    try { fs.unlinkSync(dest); } catch {}
    return { failed:true, filename, msg:e.message };
  }
}

// ── VAULTED_WF UPDATE ──────────────────────────────────────────────
// updates: [{name, vaulted: bool}] — adds or removes names from the set.
function updateVaultedWF(dataJS, updates) {
  const MARKER = 'const VAULTED_WF = new Set([';
  const start  = dataJS.indexOf(MARKER);
  if (start === -1) throw new Error('VAULTED_WF not found in data.js');
  const rest = dataJS.slice(start);
  const endM = rest.match(/\n\]\);/);
  if (!endM) throw new Error('End of VAULTED_WF not found');
  const blockEnd = start + endM.index + endM[0].length;

  // Extract current names
  const block = dataJS.slice(start, blockEnd);
  const names = new Set();
  for (const m of block.matchAll(/'([^']+)'/g)) names.add(m[1]);

  // Apply changes
  let changed = 0;
  for (const { name, vaulted } of updates) {
    const before = names.has(name);
    if (vaulted) names.add(name); else names.delete(name);
    if (before !== names.has(name)) changed++;
  }
  if (changed === 0) return dataJS;

  // Rebuild — ~5 names per line, trailing comma on every line (valid JS)
  const sorted  = [...names].sort();
  const PER_LINE = 5;
  let newBlock = MARKER + '\n';
  for (let i = 0; i < sorted.length; i += PER_LINE) {
    newBlock += '  ' + sorted.slice(i, i + PER_LINE).map(n => `'${n}'`).join(',') + ',\n';
  }
  newBlock += ']);';

  return dataJS.slice(0, start) + newBlock + dataJS.slice(blockEnd);
}

// ── SLEEP ──────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── STATS ──────────────────────────────────────────────────────────
const stats = { added:0, skipped:0, blocked:0, fixed:0, warnings:0, vaulted:0 };

// ── SHARED ITEM VALIDATION ─────────────────────────────────────────
// Returns trimmed name, or null if item should be blocked/skipped.
// Mutates stats and prints messages.
function validateCommon(rawName, cat, maxRankRaw, validCats, rankBounds, csvNamesSeen, existing, rowIdx) {
  const name    = rawName.trim();
  const hadWS   = name !== rawName;

  if (!name) { console.log(FAIL(`row ${rowIdx}: empty Name — skipped`)); stats.blocked++; return null; }

  if (hadWS) {
    console.log(WARN(`[fix] name whitespace trimmed: "${rawName}" → "${name}"`));
    stats.fixed++;
  }

  if (!cat.trim()) { console.log(FAIL(`${name}: missing Category`)); stats.blocked++; return null; }

  // Duplicate in CSV
  if (csvNamesSeen.has(name)) {
    console.log(WARN(`[skip] ${name}: duplicate in CSV (first at row ${csvNamesSeen.get(name)})`));
    stats.skipped++;
    return null;
  }
  csvNamesSeen.set(name, rowIdx);

  // Already in data.js
  if (existing.has(name)) {
    console.log(INFO(`${name}: already in data.js — skipping`));
    stats.skipped++;
    return null;
  }

  // Unknown category
  if (validCats.size > 0 && !validCats.has(cat.trim())) {
    if (!OVERRIDE) {
      console.log(FAIL(`${name}: unknown category "${cat.trim()}" (known: ${[...validCats].sort().join(', ')})`));
      console.log(INFO(`        use --override to bypass`));
      stats.blocked++;
      return null;
    }
    console.log(WARN(`[override] ${name}: unknown category "${cat.trim()}"`));
  }

  // Max rank out of range
  const maxRank = parseInt(maxRankRaw);
  if (!isNaN(maxRank) && (maxRank < rankBounds[0] || maxRank > rankBounds[1])) {
    if (!OVERRIDE) {
      console.log(FAIL(`${name}: Max Rank ${maxRank} outside [${rankBounds[0]}–${rankBounds[1]}]`));
      console.log(INFO(`        use --override to bypass`));
      stats.blocked++;
      return null;
    }
    console.log(WARN(`[override] ${name}: Max Rank ${maxRank} outside expected range`));
  }

  return name;
}

// ── PROCESS ITEMS ─────────────────────────────────────────────────
async function processItems(cfg, dataJS) {
  console.log(HDR(`${cfg.id} → ${cfg.varName}`));

  if (!fs.existsSync(cfg.csvFile)) {
    console.log(INFO(`CSV not found: ${cfg.csvFile} — skipping`));
    return dataJS;
  }

  const rows          = parseCSV(cfg.csvFile);
  const existing      = getExisting(dataJS, cfg.varName);
  const validCats     = getCategories(dataJS, cfg.varName);
  const seenNames     = new Map();
  const newLines      = [];
  const vaultedUpdates = []; // WARFRAMES only

  for (let i = 0; i < rows.length; i++) {
    const row        = rows[i];
    const rawName    = row['Name'] ?? '';
    const cat        = (row['Category'] ?? '').trim();
    const obtain     = (row['Method to Obtain'] ?? '').trim();
    const maxRankRaw = row['Max Rank'] ?? '';
    const tradable   = (row['Tradable'] ?? '').trim().toLowerCase() === 'yes';

    // WARFRAMES: intercept existing items to check for a vaulted override.
    // We do this before validateCommon so we can update VAULTED_WF even when
    // the item is already present and would otherwise just be skipped.
    if (cfg.varName === 'WARFRAMES') {
      const tentName   = rawName.trim();
      const rawVaulted = (row['Vaulted'] ?? '').trim().toLowerCase();
      if (tentName && existing.has(tentName)) {
        if (rawVaulted === 'yes' || rawVaulted === 'no') {
          vaultedUpdates.push({ name: tentName, vaulted: rawVaulted === 'yes' });
          console.log(INFO(`${tentName}: existing — queued VAULTED_WF ${rawVaulted === 'yes' ? 'add' : 'remove'}`));
        } else {
          console.log(INFO(`${tentName}: already in data.js — skipping`));
        }
        stats.skipped++;
        continue;
      }
    }

    if (!obtain) {
      const n = rawName.trim() || `row ${i+2}`;
      console.log(FAIL(`${n}: missing Method to Obtain`));
      stats.blocked++;
      continue;
    }

    const name = validateCommon(rawName, cat, maxRankRaw || cfg.defaultMaxRank, validCats, cfg.rankBounds, seenNames, existing, i+2);
    if (name === null) continue;

    // Skip: needs MARKET_SLUG_MAP
    if (tradable && needsMarketSlugReview(name)) {
      console.log(WARN(`[skip] ${name}: tradable but name contains characters that break the market URL slug — add a MARKET_SLUG_MAP entry first`));
      stats.skipped++;
      continue;
    }

    // Network checks — run concurrently
    const [wiki, market, img] = await Promise.all([
      checkWiki(name),
      tradable ? checkMarket(name) : Promise.resolve(null),
      handleImage(cfg, name, cat),
    ]);

    if (!wiki.ok) { console.log(WARN(`${name}: ${wiki.msg}`)); stats.warnings++; }
    if (market && !market.ok) { console.log(WARN(`${name}: ${market.msg}`)); stats.warnings++; }

    if (img.exists)          console.log(INFO(`${name}: image already exists (${img.filename}) — skipping download`));
    else if (img.downloaded) console.log(OK(`${name}: image downloaded → ${img.filename}`));
    else if (img.failed)     { console.log(WARN(`${name}: image download failed (${img.msg}) — provide override image`)); stats.warnings++; }
    else if (img.wouldDownload) console.log(INFO(`${name}: would download image ${img.filename}`));

    // WARFRAMES: queue vaulted update for new items too
    if (cfg.varName === 'WARFRAMES') {
      const rawVaulted = (row['Vaulted'] ?? '').trim().toLowerCase();
      if (rawVaulted === 'yes') vaultedUpdates.push({ name, vaulted: true });
    }

    newLines.push(makeItemLine(row, cfg));
    console.log(OK(`${name} → queued for ${cfg.varName}`));
    stats.added++;

    await sleep(200);
  }

  // Apply array changes
  if (newLines.length > 0) {
    if (APPLY) {
      dataJS = insertArray(dataJS, cfg.varName, newLines);
    } else {
      console.log(INFO(`Dry run: ${newLines.length} item(s) would be added to ${cfg.varName}`));
    }
  }

  // Apply VAULTED_WF changes (WARFRAMES only)
  if (vaultedUpdates.length > 0) {
    const adds    = vaultedUpdates.filter(u =>  u.vaulted).length;
    const removes = vaultedUpdates.filter(u => !u.vaulted).length;
    if (APPLY) {
      dataJS = updateVaultedWF(dataJS, vaultedUpdates);
      const parts = [adds > 0 ? `+${adds} vaulted` : '', removes > 0 ? `-${removes} unvaulted` : ''].filter(Boolean);
      console.log(col('cyan', `  ·  VAULTED_WF updated (${parts.join(', ')})`));
    } else {
      for (const u of vaultedUpdates) {
        console.log(INFO(`Dry run: ${u.vaulted ? 'add to' : 'remove from'} VAULTED_WF — "${u.name}"`));
      }
    }
    stats.vaulted += adds + removes;
  }

  return dataJS;
}

// ── PROCESS MODS ──────────────────────────────────────────────────
async function processMods(cfg, dataJS) {
  console.log(HDR('mods → MODS + MOD_DESC'));

  if (!fs.existsSync(cfg.csvFile)) {
    console.log(INFO(`CSV not found: ${cfg.csvFile} — skipping`));
    return dataJS;
  }

  const rows        = parseCSV(cfg.csvFile);
  const existing    = getExisting(dataJS, 'MODS');
  const existingDesc= getExisting(dataJS, 'MOD_DESC');
  const validCats   = getCategories(dataJS, 'MODS');
  const seenNames   = new Map();
  const newModLines = [];
  const newDescLines= [];

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i];
    const cat  = cleanStr(row['Category'] || '');
    if (cat === 'Unobtainable') continue;

    const rawName    = row['Name'] ?? '';
    const maxRankRaw = row['Max Rank'] ?? '';
    const polarity   = cleanStr(row['Polarity'] || '');

    if (!row['Max Rank'] && row['Max Rank'] !== '0') {
      console.log(FAIL(`${rawName.trim()||`row ${i+2}`}: missing Max Rank`));
      stats.blocked++;
      continue;
    }

    const name = validateCommon(rawName, cat, maxRankRaw, validCats, cfg.rankBounds, seenNames, existing, i+2);
    if (name === null) continue;

    // Block: unknown polarity
    if (!VALID_POLARITIES.has(polarity)) {
      if (!OVERRIDE) {
        console.log(FAIL(`${name}: unknown polarity "${polarity}" (known: ${[...VALID_POLARITIES].filter(Boolean).join(', ')})`));
        console.log(INFO(`        use --override to bypass`));
        stats.blocked++;
        continue;
      }
      console.log(WARN(`[override] ${name}: unknown polarity "${polarity}"`));
    }

    const wiki = await checkWiki(name);
    if (!wiki.ok) { console.log(WARN(`${name}: ${wiki.msg}`)); stats.warnings++; }

    newModLines.push(makeModLine(row));
    const descLine = makeModDescLine(name, row);
    if (descLine && !existingDesc.has(name)) newDescLines.push(descLine);

    console.log(OK(`${name} → queued for MODS`));
    stats.added++;

    await sleep(200);
  }

  if (newModLines.length > 0) {
    if (APPLY) {
      dataJS = insertArray(dataJS, 'MODS', newModLines);
      if (newDescLines.length > 0) dataJS = insertObject(dataJS, 'MOD_DESC', newDescLines);
    } else {
      console.log(INFO(`Dry run: ${newModLines.length} mod(s) would be added to MODS`));
    }
  }

  return dataJS;
}

// ── PROCESS ARCANES ───────────────────────────────────────────────
async function processArcanes(cfg, dataJS) {
  console.log(HDR('arcanes → ARCANES + ARCANE_DESC'));

  if (!fs.existsSync(cfg.csvFile)) {
    console.log(INFO(`CSV not found: ${cfg.csvFile} — skipping`));
    return dataJS;
  }

  const rows         = parseCSV(cfg.csvFile);
  const existing     = getExisting(dataJS, 'ARCANES');
  const existingDesc = getExisting(dataJS, 'ARCANE_DESC');
  const seenNames    = new Map();
  const newArcLines  = [];
  const newDescLines = [];

  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const rawName = row['Name'] ?? '';
    const type    = cleanStr(row['Type'] || '');
    const maxRankRaw = row['Max Rank'] ?? '';
    const tradable = (row['Tradable'] || '').toLowerCase() === 'true';

    if (!type) {
      console.log(FAIL(`${rawName.trim()||`row ${i+2}`}: missing Type`));
      stats.blocked++;
      continue;
    }
    if (maxRankRaw === '') {
      console.log(FAIL(`${rawName.trim()||`row ${i+2}`}: missing Max Rank`));
      stats.blocked++;
      continue;
    }

    // validateCommon with empty validCats (arcanes have no category in CSV)
    const name = validateCommon(rawName, type, maxRankRaw, new Set(), cfg.rankBounds, seenNames, existing, i+2);
    if (name === null) continue;

    const [wiki, market] = await Promise.all([
      checkWiki(name),
      tradable ? checkMarket(name) : Promise.resolve(null),
    ]);

    if (!wiki.ok) { console.log(WARN(`${name}: ${wiki.msg}`)); stats.warnings++; }
    if (market && !market.ok) { console.log(WARN(`${name}: ${market.msg}`)); stats.warnings++; }

    newArcLines.push(makeArcaneLine(row));
    const descLine = makeArcaneDescLine(name, row);
    if (descLine && !existingDesc.has(name)) newDescLines.push(descLine);

    console.log(OK(`${name} → queued for ARCANES`));
    stats.added++;

    await sleep(200);
  }

  if (newArcLines.length > 0) {
    if (APPLY) {
      dataJS = insertArray(dataJS, 'ARCANES', newArcLines);
      if (newDescLines.length > 0) dataJS = insertObject(dataJS, 'ARCANE_DESC', newDescLines);
    } else {
      console.log(INFO(`Dry run: ${newArcLines.length} arcane(s) would be added to ARCANES`));
    }
  }

  return dataJS;
}

// ── MAIN ───────────────────────────────────────────────────────────
async function main() {
  console.log(col('bold', 'WF Mastery Tracker — Data Updater'));
  console.log(col('dim',  APPLY ? 'Mode: APPLY' : 'Mode: DRY RUN  (use --apply to write changes)'));
  if (OVERRIDE) console.log(col('yellow', 'Override: blocking category/polarity/rank errors are warnings'));
  if (ONLY_SECS.length) console.log(col('dim', `Section filter: ${ONLY_SECS.join(', ')}`));

  if (!fs.existsSync(DATA_JS)) {
    console.error(FAIL(`data.js not found at ${DATA_JS}`));
    process.exit(1);
  }

  const validIds = SECTIONS.map(s => s.id);
  const unknown = ONLY_SECS.filter(s => !validIds.includes(s));
  if (unknown.length) {
    console.error(FAIL(`Unknown section(s): ${unknown.join(', ')}. Valid: ${validIds.join(', ')}`));
    process.exit(1);
  }

  let dataJS  = fs.readFileSync(DATA_JS, 'utf-8');
  const toRun = ONLY_SECS.length ? SECTIONS.filter(s => ONLY_SECS.includes(s.id)) : SECTIONS;

  for (const cfg of toRun) {
    if      (cfg.type === 'items')   dataJS = await processItems(cfg, dataJS);
    else if (cfg.type === 'mods')    dataJS = await processMods(cfg, dataJS);
    else if (cfg.type === 'arcanes') dataJS = await processArcanes(cfg, dataJS);
  }

  if (APPLY && stats.added > 0) {
    fs.writeFileSync(DATA_JS, dataJS, 'utf-8');
    console.log(col('green', col('bold', `\n✓ data.js written — ${stats.added} item(s) added`)));
  } else if (APPLY && stats.added === 0) {
    console.log(INFO('\nNothing new to write — data.js unchanged'));
  }

  console.log('\n' + col('bold', '── Summary ──────────────────────────────────────'));
  if (stats.added)    console.log(col('green',  `  Added:    ${stats.added}`));
  if (stats.skipped)  console.log(col('dim',    `  Skipped:  ${stats.skipped}  (duplicates / already present / needs MARKET_SLUG_MAP)`));
  if (stats.blocked)  console.log(col('red',    `  Blocked:  ${stats.blocked}  (validation errors)`));
  if (stats.warnings) console.log(col('yellow', `  Warnings: ${stats.warnings}  (wiki/market/image soft failures)`));
  if (stats.fixed)    console.log(col('cyan',   `  Fixed:    ${stats.fixed}   (whitespace trimmed)`));
  if (stats.vaulted)  console.log(col('cyan',   `  Vaulted:  ${stats.vaulted}  (VAULTED_WF changes)  ← warframes only`));
  if (!APPLY && stats.added > 0) console.log(col('dim', '\nRe-run with --apply to write changes.'));
}

main().catch(e => { console.error(FAIL('Fatal: ' + e.message)); process.exit(1); });
