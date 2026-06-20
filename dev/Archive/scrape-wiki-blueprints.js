// scrape-wiki-blueprints.js
// Fetches blueprint data from the Warframe wiki for items missing from
// Module:Blueprints/data (companions, archwings, necramechs, etc.)
//
// Handles three template types on <ItemName>/Main wiki pages:
//   {{BuildRequire}}           — simple sentinels/companions
//   {{BuildRequire/Archwing}}  — archwing + harness/wings/systems components
//   {{BuildRequire/Necramech}} — necramech frame + casing/engine/capsule/weaponpod
//
// Usage:
//   node dev/scrape-wiki-blueprints.js              # scrape all missing items
//   node dev/scrape-wiki-blueprints.js --dry-run    # list what would be fetched
//   node dev/scrape-wiki-blueprints.js --item "Carrier"  # scrape one item
//   node dev/scrape-wiki-blueprints.js --merge      # also merge into blueprints.json
//
// Output:
//   dev/supplementary-blueprints.json   — scraped data in blueprints.json format
//   dev/blueprints.json                 — updated if --merge is passed

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const WIKI_API      = 'https://wiki.warframe.com/api.php';
const BLUEPRINTS_JSON = path.join(__dirname, 'blueprints.json');
const SUPP_JSON       = path.join(__dirname, 'supplementary-blueprints.json');
const DATA_JS         = path.join(__dirname, '..', 'data.js');

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WFMasteryTracker/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWikiText(title) {
  for (const t of [title + '/Main', title]) {
    const qs = new URLSearchParams({
      action: 'query', prop: 'revisions', titles: t,
      rvprop: 'content', rvslots: 'main', format: 'json',
    });
    const raw  = await httpGet(`${WIKI_API}?${qs}`);
    const json = JSON.parse(raw);
    const page = Object.values(json.query.pages)[0];
    if (page.missing !== undefined) continue;
    return page.revisions?.[0]?.slots?.main?.['*'] ?? null;
  }
  return null;
}

// ── Template parsing ──────────────────────────────────────────────────────────
// Split wikitext template body on | respecting nested {{ }} and [[ ]]
function splitParams(body) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i], nx = body[i + 1];
    if ((ch === '{' && nx === '{') || (ch === '[' && nx === '[')) { depth++; i++; }
    else if ((ch === '}' && nx === '}') || (ch === ']' && nx === ']')) { depth--; i++; }
    else if (ch === '|' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts;
}

// Find and parse a template by name, returning a lowercase-keyed params object.
// Returns null if not found.
function parseTemplate(wikitext, name) {
  // Escape slashes and special chars in template name for regex
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  const re = new RegExp(`\\{\\{\\s*${escaped}\\s*([\\s\\S]*?)\\}\\}`, 'i');
  const m = wikitext.match(re);
  if (!m) return null;

  const params = {};
  for (const part of splitParams(m[1])) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    params[key] = val;
  }
  return params;
}

// Strip wiki markup and parse an integer
function parseNum(s) {
  if (!s) return 0;
  s = s.replace(/\[\[[^\]]*\]\]/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/[,\s]/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// Parse time: wiki templates store buildtime in hours (unlike the Lua module which uses seconds)
function parseTime(s) { return parseNum(s) * 3600; }

// ── BuildRequire (simple: sentinels, companions) ───────────────────────────────
function parseBuildRequire(params) {
  const credits = parseNum(params['buildcredits']);
  const time    = parseTime(params['buildtime']);
  const parts   = [];
  for (let i = 1; i <= 20; i++) {
    const name = params[`build${i}`];
    if (!name) break;
    parts.push({ Name: name, Count: parseNum(params[`build${i}amount`]) || 1, Type: 'Resource' });
  }
  return { Credits: credits, Time: time, Parts: parts };
}

// ── BuildRequire/Archwing ─────────────────────────────────────────────────────
// Main blueprint (buildcredits/buildtime) + buildresource (main resource like Orokin Cell)
// + three component blueprints (harness/wings/systems) each with their own params.
function parseBuildRequireArchwing(params) {
  const credits = parseNum(params['buildcredits']);
  const time    = parseTime(params['buildtime']);

  const parts = [];

  // Three sub-components
  for (const prefix of ['harness', 'wings', 'systems']) {
    const compName    = params[`${prefix}name`] || capitalize(prefix);
    const compCredits = parseNum(params[`${prefix}buildcredits`]);
    const compTime    = parseTime(params[`${prefix}buildtime`]);
    const subParts    = [];
    for (let i = 1; i <= 20; i++) {
      const rName = params[`${prefix}build${i}`];
      if (!rName) break;
      subParts.push({ Name: rName, Count: parseNum(params[`${prefix}build${i}amount`]) || 1, Type: 'Resource' });
    }
    if (subParts.length > 0 || compCredits) {
      parts.push({
        Name: compName, Count: 1, Type: 'Item',
        Cost: { Credits: compCredits, Time: compTime, Parts: subParts },
      });
    }
  }

  // Main blueprint direct resource (e.g. Orokin Cell)
  const mainRes = params['buildresource'];
  if (mainRes) {
    parts.push({ Name: mainRes, Count: parseNum(params['buildresourceamount']) || 1, Type: 'Resource' });
  }

  return { Credits: credits, Time: time, Parts: parts };
}

// ── BuildRequire/Necramech ────────────────────────────────────────────────────
// blueprint = credits for main; components use ${prefix}buildcredits and
// ${prefix}buildtime params, defaulting to 15,000 ₵ / 12 hrs when omitted.
// Note: casing time uses "helmetbuildtime" (legacy naming in the wiki template).
function parseBuildRequireNecramech(params) {
  // buildcredits/buildtime default to 25,000 and 72 hrs when not set on the item page
  const credits = params['buildcredits'] ? parseNum(params['buildcredits']) : 25000;
  const time    = params['buildtime']    ? parseTime(params['buildtime'])   : 72 * 3600;
  const parts   = [];

  // [prefix, timeParamKey, defaultCredits, defaultTimeHrs]
  const COMPS = [
    ['casing',    'helmetbuildtime',    15000, 12],
    ['engine',    'enginebuildtime',    15000, 12],
    ['capsule',   'capsulebuildtime',   15000, 12],
    ['weaponpod', 'weaponpodbuildtime', 15000, 12],
  ];

  for (const [prefix, timeKey, defCredits, defTimeHrs] of COMPS) {
    const label     = prefix === 'weaponpod' ? 'Weapon Pod' : capitalize(prefix);
    const compName  = params[`${prefix}name`] || label;
    const compCred  = params[`${prefix}buildcredits`] ? parseNum(params[`${prefix}buildcredits`]) : defCredits;
    const compTime  = params[timeKey] ? parseTime(params[timeKey]) : defTimeHrs * 3600;
    const subParts  = [];
    for (let i = 1; i <= 10; i++) {
      const rName = params[`${prefix}build${i}`];
      if (!rName) break;
      subParts.push({ Name: rName, Count: parseNum(params[`${prefix}build${i}amount`]) || 1, Type: 'Resource' });
    }
    if (subParts.length > 0) {
      parts.push({ Name: compName, Count: 1, Type: 'Item', Cost: { Credits: compCred, Time: compTime, Parts: subParts } });
    }
  }

  return { Credits: credits, Time: time, Parts: parts };
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Detect template and parse ─────────────────────────────────────────────────
function parseBlueprintFromWiki(wikitext, itemName) {
  if (!wikitext) return null;

  let params;

  params = parseTemplate(wikitext, 'BuildRequire/Necramech');
  if (params) { console.log(`  template: BuildRequire/Necramech`); return parseBuildRequireNecramech(params); }

  params = parseTemplate(wikitext, 'BuildRequire/Archwing');
  if (params) { console.log(`  template: BuildRequire/Archwing`); return parseBuildRequireArchwing(params); }

  params = parseTemplate(wikitext, 'BuildRequire');
  if (params) { console.log(`  template: BuildRequire`); return parseBuildRequire(params); }

  return null;
}

// ── Extract item names from data.js ──────────────────────────────────────────
// Item rows have the pattern: ["Name","Category","Source",<number>
// This excludes:
//   - BLUEPRINTS resource tuples: ["Neurodes",4,"Resource"]  (2nd elem is number)
//   - BLUEPRINTS map entries:     ["Acceltra",[25000,...]]    (2nd elem is array)
//   - SC_PLANETS flat array:      ["Mercury","Venus",...]     (no digit after 3 strings)
//   - Comments:                   stripped first
// WARFRAMES uses single-quoted strings so is not matched here (it's already
// covered by the Blueprints/Suits Lua data in blueprints.json).
function extractTrackedNames(src) {
  const clean = src.replace(/\/\/[^\n]*/g, ''); // strip // comments
  const names = new Set();
  const re = /\[\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*\d/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    names.add(m[1]);
  }
  return names;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args       = process.argv.slice(2);
  const dryRun     = args.includes('--dry-run');
  const doMerge    = args.includes('--merge');
  const itemIdx    = args.indexOf('--item');
  const singleItem = itemIdx !== -1 ? args[itemIdx + 1] : null;

  // Load existing blueprints
  const existing = JSON.parse(fs.readFileSync(BLUEPRINTS_JSON, 'utf-8'));
  console.log(`Loaded ${Object.keys(existing).length} entries from blueprints.json`);

  // Load existing supplementary (if any)
  let supp = {};
  if (fs.existsSync(SUPP_JSON)) {
    supp = JSON.parse(fs.readFileSync(SUPP_JSON, 'utf-8'));
    console.log(`Loaded ${Object.keys(supp).length} entries from supplementary-blueprints.json`);
  }

  // Determine which items to scrape
  let toScrape;
  if (singleItem) {
    toScrape = [singleItem];
  } else {
    const dataJs  = fs.readFileSync(DATA_JS, 'utf-8');
    const tracked = extractTrackedNames(dataJs);
    console.log(`Found ${tracked.size} tracked items in data.js`);

    const covered = new Set([...Object.keys(existing), ...Object.keys(supp).filter(k => supp[k] !== null)]);
    toScrape = [...tracked].filter(n => !covered.has(n)).sort();
    console.log(`${toScrape.length} items not yet in any blueprint source`);
  }

  if (dryRun) {
    console.log('\nItems that would be fetched:');
    toScrape.forEach(n => console.log(' ', n));
    return;
  }

  if (toScrape.length === 0) {
    console.log('Nothing to scrape — all tracked items are covered.');
    return;
  }

  let scraped = 0, notFound = 0, noTemplate = 0, skipped = 0;

  for (const name of toScrape) {
    // Skip items already in supplementary (unless --item override)
    if (!singleItem && supp.hasOwnProperty(name)) {
      skipped++;
      continue;
    }

    process.stdout.write(`[fetch] ${name} … `);
    try {
      const wikitext = await fetchWikiText(name);
      if (wikitext === null) {
        console.log('page not found');
        supp[name] = null;
        notFound++;
      } else {
        const bp = parseBlueprintFromWiki(wikitext, name);
        if (bp) {
          supp[name] = bp;
          scraped++;
          const partCount = bp.Parts?.length ?? 0;
          console.log(`✓  ${partCount} parts, ${bp.Credits.toLocaleString()} credits, ${bp.Time}s`);
        } else {
          console.log('no BuildRequire template');
          supp[name] = null;
          noTemplate++;
        }
      }
    } catch (err) {
      console.log(`error: ${err.message}`);
      noTemplate++;
    }

    await sleep(500); // polite to the wiki
  }

  console.log(`\nScraped: ${scraped}  Not found: ${notFound}  No template: ${noTemplate}  Skipped: ${skipped}`);

  // Save supplementary JSON
  fs.writeFileSync(SUPP_JSON, JSON.stringify(supp, null, 2), 'utf-8');
  console.log(`Saved → ${SUPP_JSON}`);

  if (doMerge) {
    const valid  = Object.fromEntries(Object.entries(supp).filter(([, v]) => v !== null));
    const merged = Object.assign({}, existing, valid);
    fs.writeFileSync(BLUEPRINTS_JSON, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`Merged → ${BLUEPRINTS_JSON} (${Object.keys(merged).length} total entries)`);
    console.log('Re-run the blueprints-map.js generator to rebuild data.js BLUEPRINTS entries.');
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
