// ─────────────────────────────────────────────
// SUPABASE CONFIG
// ─────────────────────────────────────────────
// Values are loaded from config.js (gitignored) — see config.example.js
// If config.js is missing or Supabase fails to initialise, the app falls back to localStorage-only mode.
let _sb = null;
try {
  if (window.WF_CONFIG && window.supabase) {
    _sb = window.supabase.createClient(window.WF_CONFIG.supabaseUrl, window.WF_CONFIG.supabasePublishableKey, {
      auth: {
        autoRefreshToken:   true,
        persistSession:     true,
        detectSessionInUrl: true,
      },
    });
  }
} catch (e) {
  console.warn('[WF Tracker] Supabase init failed — running in offline/local mode:', e.message);
}

let currentUser     = null;
let _cloudSyncTimer = 0;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
const LS_KEY = 'wf-mastery-v1';
let progress = {};
let activeTab = 'summary';
let filters = { status: '', incarnon: false, hasParts: false };
const searchIndex = {}; // tab → Map<name, lowercased searchable text>

function buildSearchIndex(tab) {
  const items = TAB_DATA[tab] || [];
  const idx = new Map();
  for (const item of items) {
    const [name, category, obtain] = item;
    let text = name + '\0' + (category || '') + '\0' + (obtain || '');
    const bp = BLUEPRINTS.get(name);
    if (bp) {
      for (const [pName,,, subCost] of (bp[2] ?? [])) {
        text += '\0' + pName;
        if (subCost) {
          for (const [sName] of (subCost[2] ?? [])) text += '\0' + sName;
        } else {
          const subKey = BLUEPRINTS.has(pName) ? pName
                       : BLUEPRINTS.has(name + ' ' + pName) ? name + ' ' + pName
                       : BLUEPRINTS.has(name + ' ' + pName.replace(/^Prime\s+/, '')) ? name + ' ' + pName.replace(/^Prime\s+/, '')
                       : null;
          if (subKey) for (const [sName] of (BLUEPRINTS.get(subKey)?.[2] ?? [])) text += '\0' + sName;
        }
      }
    }
    idx.set(name, text.toLowerCase());
  }
  searchIndex[tab] = idx;
}

// ─────────────────────────────────────────────
// CHECKLIST STATE
// ─────────────────────────────────────────────
let checklistItems = new Set();
let checklistOwned = {};
let clBpOwned = new Set();
const CL_KEY     = 'wf-checklist';
const CL_OWN_KEY = 'wf-checklist-owned';
const CL_BP_KEY  = 'wf-checklist-bp-owned';

function clKey(tab, name)         { return tab + '\t' + name; }
function isInChecklist(tab, name) { return checklistItems.has(clKey(tab, name)); }

function loadChecklist() {
  try { checklistItems = new Set(JSON.parse(localStorage.getItem(CL_KEY) || '[]')); } catch { checklistItems = new Set(); }
  try { checklistOwned = JSON.parse(localStorage.getItem(CL_OWN_KEY) || '{}'); } catch { checklistOwned = {}; }
  try { clBpOwned = new Set(JSON.parse(localStorage.getItem(CL_BP_KEY) || '[]')); } catch { clBpOwned = new Set(); }
}
function saveChecklist()      { localStorage.setItem(CL_KEY,     JSON.stringify([...checklistItems])); deferCloudSync(); }
function saveChecklistOwned() { localStorage.setItem(CL_OWN_KEY, JSON.stringify(checklistOwned)); deferCloudSync(); }
function saveClBpOwned()      { localStorage.setItem(CL_BP_KEY,  JSON.stringify([...clBpOwned])); deferCloudSync(); }

function toggleClBpOwned(key) {
  if (clBpOwned.has(key)) clBpOwned.delete(key);
  else clBpOwned.add(key);
  saveClBpOwned();
  renderChecklist();
}

function toggleChecklist(tab, name) {
  const k = clKey(tab, name);
  if (checklistItems.has(k)) checklistItems.delete(k);
  else checklistItems.add(k);
  saveChecklist();
  render();
}

function removeFromChecklist(tab, name) {
  checklistItems.delete(clKey(tab, name));
  saveChecklist();
  renderChecklist();
}

function clearChecklist() {
  checklistItems.clear();
  checklistOwned = {};
  clBpOwned.clear();
  saveChecklist();
  saveChecklistOwned();
  saveClBpOwned();
  renderChecklist();
}

function getChecklistItemResources(tab, name) {
  if (tab === 'incarnon') {
    const genesisName = INCARNON_WEAPONS.get(name) || (name + ' Incarnon Genesis');
    const reqs = INCARNON_REQUIREMENTS.get(genesisName);
    const result = {};
    if (reqs) for (const [r, c] of reqs) result[r] = (result[r] || 0) + c;
    return result;
  }
  const itemRes = flattenResources(name, 1, new Set());
  const itemCur = flattenCurrencies(name);
  for (const {key, costs} of getMissionDropComponents(name)) {
    if (clBpOwned.has(key)) {
      for (const [cur, amt] of Object.entries(costs))
        itemCur[cur] = Math.max(0, (itemCur[cur] || 0) - amt);
    }
  }
  for (const c of Object.keys(itemCur)) delete itemRes[c];
  const result = {};
  for (const [r, v] of Object.entries(itemRes)) if (v > 0) result[r] = v;
  for (const [r, v] of Object.entries(itemCur)) if (v > 0) result[r] = v;
  return result;
}

function markChecklistDone(tab, name) {
  const contrib = getChecklistItemResources(tab, name);
  for (const [r, cost] of Object.entries(contrib)) {
    if (checklistOwned[r]) {
      checklistOwned[r] = Math.max(0, checklistOwned[r] - cost);
      if (checklistOwned[r] === 0) delete checklistOwned[r];
    }
  }
  saveChecklistOwned();

  if (tab === 'incarnon') {
    const wTab = INCARNON_WEAPON_TAB.get(name) ?? null;
    if (wTab && !progress[incarnonKey(wTab, name)]) {
      progress[incarnonKey(wTab, name)] = true;
      saveProgress();
      updateHeader();
    }
  } else if (AQ_TABS.has(tab) && getItemRank(tab, name) === 0 && !progress[aqKey(tab, name)]) {
    progress[aqKey(tab, name)] = true;
    saveProgress();
    updateHeader();
  }
  checklistItems.delete(clKey(tab, name));
  saveChecklist();
  renderChecklist();
}

function incClKey(name)              { return 'incarnon\t' + name; }
function isInIncarnonChecklist(name) { return checklistItems.has(incClKey(name)); }
function toggleIncarnonChecklist(name) {
  const k = incClKey(name);
  if (checklistItems.has(k)) checklistItems.delete(k);
  else checklistItems.add(k);
  saveChecklist();
  render();
}
const INCARNON_WEAPON_TAB = new Map();
for (const wTab of ['primary', 'secondary', 'melee'])
  for (const [name] of (TAB_DATA[wTab] || []))
    if (INCARNON_WEAPONS.has(name)) INCARNON_WEAPON_TAB.set(name, wTab);

function updateChecklistOwned(resource, rawVal) {
  const qty = Math.max(0, parseInt(rawVal, 10) || 0);
  if (qty === 0) delete checklistOwned[resource];
  else checklistOwned[resource] = qty;
  saveChecklistOwned();
  for (const row of document.querySelectorAll('#checklist-view .cl-res-row')) {
    if (row.dataset.clRes !== resource) continue;
    const total = parseInt(row.dataset.clTotal, 10);
    const need  = Math.max(0, total - qty);
    const needEl = row.querySelector('.cl-res-need');
    needEl.textContent = 'Need: ' + fmt(need);
    needEl.classList.toggle('cl-done', need === 0);
    row.classList.toggle('cl-res-done', need === 0);
  }
}

// ─────────────────────────────────────────────
// KITGUN BUILDER STATE
// ─────────────────────────────────────────────
let modularBuilds = [];  // [{id, chamber, grip, loader, gildAt}]
let modularOwned  = {};  // {resourceName: qty} — "have" amounts for resource summary
const MOD_BUILDS_KEY = 'wf-modular-builds';
const MOD_OWNED_KEY  = 'wf-modular-owned';

function loadModularBuilds() {
  try { modularBuilds = JSON.parse(localStorage.getItem(MOD_BUILDS_KEY) || '[]'); } catch { modularBuilds = []; }
  try { modularOwned  = JSON.parse(localStorage.getItem(MOD_OWNED_KEY)  || '{}'); } catch { modularOwned  = {}; }
}
function saveModularBuilds() { localStorage.setItem(MOD_BUILDS_KEY, JSON.stringify(modularBuilds)); deferCloudSync(); }
function saveModularOwned()  { localStorage.setItem(MOD_OWNED_KEY,  JSON.stringify(modularOwned));  deferCloudSync(); }

function addKitgunBuild() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  modularBuilds.push({ id, type: 'kitgun', chamber: null, grip: null, loader: null, gildAt: null });
  saveModularBuilds();
  renderKitgunBuilder();
}

function removeKitgunBuild(id) {
  modularBuilds = modularBuilds.filter(b => b.id !== id);
  saveModularBuilds();
  renderKitgunBuilder();
}

function updateKitgunBuild(id, field, value) {
  const b = modularBuilds.find(b => b.id === id);
  if (!b) return;
  b[field] = value || null;
  saveModularBuilds();
  renderKitgunBuilder();
}

function updateModularOwned(resource, rawVal) {
  const qty = Math.max(0, parseInt(rawVal, 10) || 0);
  if (qty === 0) delete modularOwned[resource];
  else modularOwned[resource] = qty;
  saveModularOwned();
  for (const row of document.querySelectorAll('#kitgun-view .cl-res-row')) {
    if (row.dataset.kgRes !== resource) continue;
    const total = parseInt(row.dataset.kgTotal, 10);
    const need  = Math.max(0, total - qty);
    const needEl = row.querySelector('.cl-res-need');
    needEl.textContent = 'Need: ' + fmt(need);
    needEl.classList.toggle('cl-done', need === 0);
    row.classList.toggle('cl-res-done', need === 0);
  }
}

function getKitgunBuildResources(build) {
  const res = {};
  const add = (r, q) => { res[r] = (res[r] || 0) + q; };
  const addComponent = (data) => {
    if (!data) return;
    const [, syndicate, bpCost, craftCredits, parts] = data;
    add(syndicate + ' Standing', bpCost);
    add('Credits', craftCredits);
    for (const [r, q] of parts) add(r, q);
  };
  if (build.chamber) addComponent(KITGUN_CHAMBERS.get(build.chamber));
  if (build.grip)    addComponent(KITGUN_GRIPS.get(build.grip));
  if (build.loader)  addComponent(KITGUN_LOADERS.get(build.loader));
  if (build.gildAt === 'zuud') {
    add('Solaris United Standing', 5000);
    add('Shelter-Debt Bond', 10);
  } else if (build.gildAt === 'father') {
    add('Entrati Standing', 5000);
    add('Father Token', 25);
  }
  return res;
}

function addZawBuild() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  modularBuilds.push({ id, type: 'zaw', strike: null, grip: null, link: null, gildAt: null });
  saveModularBuilds();
  renderKitgunBuilder();
}

function getZawBuildResources(build) {
  const res = {};
  const add = (r, q) => { res[r] = (res[r] || 0) + q; };
  const addComponent = (data) => {
    if (!data) return;
    const [, syndicate, bpCost, craftCredits, parts] = data;
    add(syndicate + ' Standing', bpCost);
    add('Credits', craftCredits);
    for (const [r, q] of parts) add(r, q);
  };
  if (build.strike) addComponent(ZAW_STRIKES.get(build.strike));
  if (build.grip)   addComponent(ZAW_GRIPS.get(build.grip));
  if (build.link)   addComponent(ZAW_LINKS.get(build.link));
  if (build.gildAt) {
    add('Ostron Standing', 5000);
    add('Cetus Wisp', 2);
  }
  return res;
}

function renderKitgunBuilder() {
  const el = document.getElementById('kitgun-view');
  if (!el) return;

  const kitgunBuilds = modularBuilds.filter(b => b.type !== 'zaw');
  const zawBuilds    = modularBuilds.filter(b => b.type === 'zaw');

  const totalRes = {};
  for (const build of kitgunBuilds) {
    for (const [r, q] of Object.entries(getKitgunBuildResources(build)))
      totalRes[r] = (totalRes[r] || 0) + q;
  }
  for (const build of zawBuilds) {
    for (const [r, q] of Object.entries(getZawBuildResources(build)))
      totalRes[r] = (totalRes[r] || 0) + q;
  }

  const STANDING_NAMES = new Set(['Solaris United Standing', 'Entrati Standing', 'Ostron Standing', 'Plague Star Standing']);
  const sortedRes = Object.entries(totalRes).sort((a, b) => {
    const rank = r => STANDING_NAMES.has(r) ? 0 : r === 'Credits' ? 1 : 2;
    const dr = rank(a[0]) - rank(b[0]);
    return dr !== 0 ? dr : b[1] - a[1];
  });

  // ── Kitgun builds ──
  let kitgunHtml = '';
  for (const build of kitgunBuilds) {
    const { id, chamber, grip, loader, gildAt } = build;
    const eid = jsStr(id);
    const parts = [chamber, grip, loader].filter(Boolean);
    const displayName = parts.length ? parts.join(' / ') : 'New Kitgun';

    const chamberOpts = [...KITGUN_CHAMBERS.keys()].map(n =>
      `<option value="${esc(n)}"${chamber === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const gripOpts = [...KITGUN_GRIPS.keys()].map(n =>
      `<option value="${esc(n)}"${grip === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const loaderOpts = [...KITGUN_LOADERS.keys()].map(n =>
      `<option value="${esc(n)}"${loader === n ? ' selected' : ''}>${esc(n)}</option>`).join('');

    kitgunHtml += `<div class="kg-build">
<div class="kg-build-hdr">
  <span class="kg-build-name">${esc(displayName)}</span>
  <button class="qbtn zr" onclick="removeKitgunBuild('${eid}')">✕</button>
</div>
<div class="kg-build-body">
  <div class="kg-selects">
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','chamber',this.value)">
      <option value="">— Chamber —</option>${chamberOpts}
    </select>
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','grip',this.value)">
      <option value="">— Grip —</option>${gripOpts}
    </select>
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','loader',this.value)">
      <option value="">— Loader —</option>${loaderOpts}
    </select>
  </div>
  <div class="kg-gild-row">
    <span class="kg-gild-lbl">Gild at:</span>
    <label class="kg-gild-opt">
      <input type="radio" name="gild_${eid}" value="zuud"${gildAt === 'zuud' ? ' checked' : ''} onchange="updateKitgunBuild('${eid}','gildAt','zuud')">
      Rude Zuud <span class="kg-gild-cost">(5,000 Solaris United Standing + 10 Shelter-Debt Bonds)</span>
    </label>
    <label class="kg-gild-opt">
      <input type="radio" name="gild_${eid}" value="father"${gildAt === 'father' ? ' checked' : ''} onchange="updateKitgunBuild('${eid}','gildAt','father')">
      Father <span class="kg-gild-cost">(5,000 Entrati Standing + 25 Father Tokens)</span>
    </label>
  </div>
</div>
</div>`;
  }

  // ── Zaw builds ──
  let zawHtml = '';
  for (const build of zawBuilds) {
    const { id, strike, grip, link, gildAt } = build;
    const eid = jsStr(id);
    const parts = [strike, grip, link].filter(Boolean);
    const displayName = parts.length ? parts.join(' / ') : 'New Zaw';

    const strikeOpts = [...ZAW_STRIKES.keys()].map(n =>
      `<option value="${esc(n)}"${strike === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const zawGripOpts = [...ZAW_GRIPS.keys()].map(n =>
      `<option value="${esc(n)}"${grip === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const linkOpts = [...ZAW_LINKS.keys()].map(n =>
      `<option value="${esc(n)}"${link === n ? ' selected' : ''}>${esc(n)}</option>`).join('');

    zawHtml += `<div class="kg-build">
<div class="kg-build-hdr">
  <span class="kg-build-name">${esc(displayName)}</span>
  <button class="qbtn zr" onclick="removeKitgunBuild('${eid}')">✕</button>
</div>
<div class="kg-build-body">
  <div class="kg-selects">
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','strike',this.value)">
      <option value="">— Strike —</option>${strikeOpts}
    </select>
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','grip',this.value)">
      <option value="">— Grip —</option>${zawGripOpts}
    </select>
    <select class="kg-sel" onchange="updateKitgunBuild('${eid}','link',this.value)">
      <option value="">— Link —</option>${linkOpts}
    </select>
  </div>
  <div class="kg-gild-row">
    <span class="kg-gild-lbl">Gild at Hok:</span>
    <label class="kg-gild-opt">
      <input type="checkbox"${gildAt ? ' checked' : ''} onchange="updateKitgunBuild('${eid}','gildAt',this.checked?'hok':null)">
      <span class="kg-gild-cost">5,000 Ostron Standing + 2 Cetus Wisp</span>
    </label>
  </div>
</div>
</div>`;
  }

  const kitgunSection = kitgunBuilds.length === 0
    ? '<div class="empty" style="padding:24px;text-align:center">No Kitguns tracked yet.</div>'
    : `<div class="cl-section">${kitgunHtml}</div>`;

  const zawSection = zawBuilds.length === 0
    ? '<div class="empty" style="padding:24px;text-align:center">No Zaws tracked yet.</div>'
    : `<div class="cl-section">${zawHtml}</div>`;

  const resSection = sortedRes.length
    ? `<div class="cl-section">
<div class="cl-section-hdr">Resources Required</div>
${sortedRes.map(([rName, total]) => {
  const owned = modularOwned[rName] || 0;
  const need  = Math.max(0, total - owned);
  return `<div class="cl-res-row${need === 0 ? ' cl-res-done' : ''}" data-kg-res="${esc(rName)}" data-kg-total="${total}">
  <span class="cl-res-name">${esc(rName)}</span>
  <span class="cl-res-total">×${fmt(total)}</span>
  <span class="cl-res-lbl">Have</span>
  <input class="cl-res-input" type="number" min="0" value="${owned}" oninput="updateModularOwned('${jsStr(rName)}',this.value)">
  <span class="cl-res-need${need === 0 ? ' cl-done' : ''}">Need: ${fmt(need)}</span>
</div>`;
}).join('\n')}
</div>`
    : `<div class="cl-section"><div class="cl-section-hdr" style="color:var(--text-muted);text-align:center;padding:12px">Select components to see resource totals</div></div>`;

  const countLabel = [
    kitgunBuilds.length ? `${kitgunBuilds.length} kitgun${kitgunBuilds.length !== 1 ? 's' : ''}` : '',
    zawBuilds.length    ? `${zawBuilds.length} zaw${zawBuilds.length !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ') || '0 builds';

  el.innerHTML = `<div class="cl-layout">
<div class="cl-col-items">
  <div class="kg-hdr">
    <span style="font-size:11px;color:var(--text-muted)">${countLabel}</span>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="addKitgunBuild()">+ Add Kitgun</button>
      <button class="btn" onclick="addZawBuild()">+ Add Zaw</button>
    </div>
  </div>
  <div class="kg-type-label" style="font-size:11px;font-weight:600;color:var(--text-muted);padding:6px 14px 2px;text-transform:uppercase;letter-spacing:.06em">Kitguns</div>
  ${kitgunSection}
  <div class="kg-type-label" style="font-size:11px;font-weight:600;color:var(--text-muted);padding:10px 14px 2px;text-transform:uppercase;letter-spacing:.06em">Zaws</div>
  ${zawSection}
</div>
<div class="cl-col-resources">${resSection}</div>
</div>`;
}

let activeCategory = '';
let activeType = '';
let activeUse = '';
let activeArcaneType     = '';
let activeArcaneRarity   = '';
let activeArcaneCategory = '';
let groupedView = false;
let listView = false;
let modShowConclave = false;
let modShowFlawed   = false;
let collapsedGroups = new Set(); // "tab:groupName"
let wfTileImages = localStorage.getItem('wf-ui-wftile') !== '0';
let wfBgImages   = localStorage.getItem('wf-ui-wfbg')   !== '0';

function loadProgress() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) { progress = {}; return; }
  try {
    progress = JSON.parse(raw);
  } catch {
    progress = {};
    const bar = document.getElementById('warn-bar');
    bar.textContent = 'Save data was corrupt and could not be loaded — progress has been reset. The raw data has been logged to the browser console (F12).';
    bar.style.display = 'block';
    console.error('[WF Tracker] Corrupt save data:', raw);
  }
}
function saveProgress() {
  localStorage.setItem(LS_KEY, JSON.stringify(progress));
  writeBackup();
  deferCloudSync();
}

let _saveTimer = 0;
function deferSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { saveProgress(); updateHeader(); }, 300);
}

// ─────────────────────────────────────────────
// XP CALCULATIONS
// ─────────────────────────────────────────────
function itemKey(tab, name) { return (PFX[tab] || tab+':') + name; }
function aqKey(tab, name)   { return 'aq:' + itemKey(tab, name); }

const AQ_TABS = new Set(['warframes','companions','primary','secondary','melee','vehicles','compWeapons','archWeapons','amps']);
const WEAPON_MR_TABS = new Set(['primary','secondary','melee','archWeapons','compWeapons']);
const TAB_XP_PER_LEVEL = { warframes:200, companions:200, vehicles:200, primary:100, secondary:100, melee:100, compWeapons:100, archWeapons:100, amps:100, intrinsics:1500 };

// Circuit week rolling — both circuits share the same Thursday reset epoch (2026-05-29)
// Incarnon: 8-week cycle, currently Week 6. Warframe: 11-week cycle, currently Week 8.
const CIRCUIT_EPOCH = new Date('2026-05-29T00:00:00Z');
function _circuitWeek(epochWeekIdx, cycle) {
  const w = Math.floor((Date.now() - CIRCUIT_EPOCH.getTime()) / 604800000);
  return ((epochWeekIdx + w) % cycle) + 1;
}
const CIRCUIT_WEEK_NOW     = _circuitWeek(5, 8);  // incarnon: epoch = week 6 (idx 5)
const CIRCUIT_WF_WEEK_NOW  = _circuitWeek(7, 11); // warframe: epoch = week 8 (idx 7)
const CIRCUIT_INCARNON_NOW = new Set(
  typeof CIRCUIT_INCARNON_SCHEDULE !== 'undefined' ? CIRCUIT_INCARNON_SCHEDULE[CIRCUIT_WEEK_NOW - 1] : []
);
const CIRCUIT_WF_NOW = new Set(
  typeof CIRCUIT_WF_SCHEDULE !== 'undefined' ? CIRCUIT_WF_SCHEDULE[CIRCUIT_WF_WEEK_NOW - 1] : []
);
// warframe name → circuit week number (for tooltip)
const CIRCUIT_WF_WEEK_LOOKUP = typeof CIRCUIT_WF_SCHEDULE !== 'undefined'
  ? Object.fromEntries(CIRCUIT_WF_SCHEDULE.flatMap((wfs, i) => wfs.map(wf => [wf, i + 1])))
  : {};
// incarnon genesis name → circuit week number (for tooltip)
const CIRCUIT_INCARNON_WEEK_LOOKUP = typeof CIRCUIT_INCARNON_SCHEDULE !== 'undefined'
  ? Object.fromEntries(CIRCUIT_INCARNON_SCHEDULE.flatMap((items, i) => items.map(item => [item, i + 1])))
  : {};

function getItemRank(tab, name) { return progress[itemKey(tab, name)] || 0; }
function setItemRank(tab, name, rank) {
  progress[itemKey(tab, name)] = rank;
  if (rank > 0 && AQ_TABS.has(tab)) progress[aqKey(tab, name)] = true;
  deferSave();
  updateTabStat();
}

function toggleAcquired(tab, name) {
  const k = aqKey(tab, name);
  const wasAcquired = !!progress[k];
  progress[k] = !progress[k];
  saveProgress();
  updateHeader();
  render();
  if (!wasAcquired) _checkDucatAcquiredPrompt(name);
}

function incarnonKey(tab, name) { return 'inc:' + itemKey(tab, name); }
function toggleIncarnon(tab, name) {
  const k = incarnonKey(tab, name);
  progress[k] = !progress[k];
  if (!progress[k]) delete progress[k];
  saveProgress();
  render();
}

function flipCard(btn) {
  btn.closest('.card').classList.toggle('flipped');
}

function flattenResources(name, multiplier, visited) {
  if (visited.has(name)) return {};
  visited.add(name);
  const bp = BLUEPRINTS.get(name);
  if (!bp) return {};
  const [,,parts] = bp;
  const acc = {};
  for (const [pName, pCount, pType, subCost] of (parts || [])) {
    const qty = pCount * multiplier;
    if (subCost) {
      const [,,subParts] = subCost;
      for (const [sName, sCount] of (subParts || [])) acc[sName] = (acc[sName] || 0) + sCount * qty;
    } else if (pType === 'Item') {
      // Warframe components are stored as "Dante Neuroptics" but listed as "Neuroptics" in the parent
      const key = BLUEPRINTS.has(pName) ? pName : BLUEPRINTS.has(name + ' ' + pName) ? name + ' ' + pName : BLUEPRINTS.has(name + ' ' + pName.replace(/^Prime\s+/, '')) ? name + ' ' + pName.replace(/^Prime\s+/, '') : null;
      if (key) {
        const sub = flattenResources(key, qty, new Set(visited));
        for (const [r, c] of Object.entries(sub)) acc[r] = (acc[r] || 0) + c;
      } else {
        acc[pName] = (acc[pName] || 0) + qty;
      }
    } else {
      acc[pName] = (acc[pName] || 0) + qty;
    }
  }
  return acc;
}

function flattenCurrencies(name) {
  if (typeof CURRENCIES === 'undefined') return {};
  const totals = {};
  function addEntry(entry, mult) {
    if (!entry) return;
    for (const [cur, amt] of Object.entries(entry))
      totals[cur] = (totals[cur] || 0) + amt * mult;
  }
  addEntry(CURRENCIES.get(name), 1);
  addEntry(CURRENCIES.get(name + ' Blueprint'), 1);
  const bp = BLUEPRINTS.get(name);
  if (bp) {
    const [,,parts] = bp;
    for (const [pName, pCount] of (parts || [])) {
      const bare = pName.replace(/^Prime\s+/, '');
      const candidates = [pName, name + ' ' + pName, name + ' ' + bare, name + ' ' + bare + ' Blueprint'];
      for (const c of candidates) {
        if (CURRENCIES.has(c)) { addEntry(CURRENCIES.get(c), pCount); break; }
      }
    }
  }
  return totals;
}

// Currencies whose blueprints drop from the same mission as the currency itself,
// so users may already own some blueprints and can deduct them from the total.
const MISSION_DROP_CURRENCIES = new Set([
  'Atramentum', 'Beating Heartstrings',
  'Belric Crystal Fragment', 'Rania Crystal Fragment',
  'Fate Pearl', 'Fergolyte', 'Lua Thrax Plasm',
  'Maphica', 'Scuttler Husk', 'Vessel Capillary', 'Vestigial Mote',
]);

// Returns [{key, label, costs}] for each blueprint/part of `name` that costs a
// mission-drop currency. `key` is the CURRENCIES map key; `label` is a short
// display name (e.g. "Blueprint", "Neuroptics", or the item name for single crafts).
function getMissionDropComponents(name) {
  if (typeof CURRENCIES === 'undefined') return [];
  const result = [];
  function isMDC(costs) { return Object.keys(costs).some(c => MISSION_DROP_CURRENCIES.has(c)); }

  if (CURRENCIES.has(name) && isMDC(CURRENCIES.get(name))) {
    result.push({key: name, label: name, costs: CURRENCIES.get(name)});
  } else if (CURRENCIES.has(name + ' Blueprint') && isMDC(CURRENCIES.get(name + ' Blueprint'))) {
    result.push({key: name + ' Blueprint', label: 'Blueprint', costs: CURRENCIES.get(name + ' Blueprint')});
  }

  const bp = BLUEPRINTS.get(name);
  if (bp) {
    for (const [pName] of (bp[2] || [])) {
      const bare = pName.replace(/^Prime\s+/, '');
      for (const c of [pName, name + ' ' + pName, name + ' ' + bare, name + ' ' + bare + ' Blueprint']) {
        if (CURRENCIES.has(c) && isMDC(CURRENCIES.get(c))) {
          result.push({key: c, label: pName, costs: CURRENCIES.get(c)});
          break;
        }
      }
    }
  }
  return result;
}

function setRecipeView(btn, view) {
  const back = btn.closest('.card-back');
  back.classList.toggle('all-res', view === 'all');
  back.querySelectorAll('.recipe-tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
}

function wikiLink(name) {
  const href = 'https://wiki.warframe.com/w/' + name.replace(/ /g, '_');
  return `<a class="recipe-link" href="${href}" target="_blank" rel="noopener">${esc(name)}</a>`;
}

function isPrimeVaulted(name) {
  if (typeof RELIC_DROPS === 'undefined') return false;
  const entry = RELIC_DROPS.get(name);
  return entry !== undefined && entry[0] === 1;
}

function relicDropsForPart(itemName, pName, pType) {
  if (typeof RELIC_DROPS === 'undefined') return null;
  const entry = RELIC_DROPS.get(itemName);
  if (!entry) return null;
  const parts = entry[1];
  if (parts[pName]) return parts[pName];
  if (pType === 'Item' && pName.startsWith('Prime ')) {
    const key = pName.slice(6) + ' Blueprint';
    if (parts[key]) return parts[key];
  }
  return null;
}

function relicChipsHtml(drops) {
  if (!drops || !drops.length) return '';
  const R = ['C','U','R'];
  const chips = drops.map(([idx, rar, v]) => {
    const rname = RELIC_INDEX[idx];
    const cls = RELIC_VAULTED.has(idx) ? 'vaulted' : 'active';
    return `<span class="relic-chip ${cls}" title="${esc(rname)}">${esc(rname)} ${R[rar]||'?'}</span>`;
  }).join('');
  return `<div class="relic-row">${chips}</div>`;
}

// Recursively renders a parts list, expanding craftable sub-parts in place.
// parentName: the resolved item name whose parts we're rendering (used for BLUEPRINTS key lookups).
// Returns { html, hasCraftable }.
function renderRecipeParts(parentName, parts) {
  let html = '';
  let hasCraftable = false;
  for (const part of (parts || [])) {
    const [pName, pCount, pType, subCost] = part;
    // Inline subCost sub-parts have no pType — they are always plain resources.
    if (!pType) {
      html += `<div class="recipe-item"><span class="recipe-res">${wikiLink(pName)}</span><span class="recipe-count">×${fmt(pCount)}</span></div>`;
      continue;
    }
    const cls = pType === 'PrimePart' ? ' prime' : pType === 'Weapon' ? ' weapon' : '';
    const bpKey = subCost ? null
      : BLUEPRINTS.has(pName) ? pName
      : BLUEPRINTS.has(parentName + ' ' + pName) ? parentName + ' ' + pName
      : BLUEPRINTS.has(parentName + ' ' + pName.replace(/^Prime\s+/, '')) ? parentName + ' ' + pName.replace(/^Prime\s+/, '')
      : null;
    const craftable = !!subCost || !!bpKey;
    if (craftable) hasCraftable = true;
    let badge = '';
    let subPartsData = null;
    let subParentName = parentName;
    if (craftable) {
      const [cr, t] = subCost || BLUEPRINTS.get(bpKey) || [];
      const h = t >= 3600 ? (t/3600).toFixed(0)+'h' : t > 0 ? (t/60).toFixed(0)+'m' : '';
      const costStr = [cr ? fmt(cr)+' ₵' : '', h].filter(Boolean).join(' · ');
      badge = `<span class="recipe-craftable">⚙${costStr ? ' '+costStr : ''}</span>`;
      subPartsData = subCost ? subCost[2] : BLUEPRINTS.get(bpKey)[2];
      subParentName = bpKey || parentName;
    }
    let nameHtml;
    let relicHtml = '';
    if (pType === 'PrimePart' || pType === 'Item') {
      const drops = relicDropsForPart(parentName, pName, pType);
      if (drops) {
        relicHtml = relicChipsHtml(drops);
        let ducPart = pName;
        if (pType === 'Item' && pName.startsWith('Prime ')) ducPart = pName.slice(6) + ' Blueprint';
        const acqBadge = getDucatQty(parentName, ducPart) > 0 ? ' <span class="recipe-acq-badge">Acq</span>' : '';
        nameHtml = `<span class="recipe-duc-name" data-item="${esc(parentName)}" data-part="${esc(ducPart)}" onclick="ducatAcqAdd(this)">${esc(pName)}</span>${acqBadge}`;
      } else {
        nameHtml = esc(pName);
      }
    } else {
      nameHtml = (craftable || pType !== 'Resource') ? esc(pName) : wikiLink(pName);
    }
    html += `<div class="recipe-item"><span class="recipe-res${cls}">${nameHtml}${badge}</span><span class="recipe-count">×${fmt(pCount)}</span></div>${relicHtml}`;
    if (subPartsData && subPartsData.some(([,,t]) => t === 'Item')) {
      const {html: subHtml} = renderRecipeParts(subParentName, subPartsData);
      html += `<div class="recipe-sublist">${subHtml}</div>`;
    }
  }
  return {html, hasCraftable};
}

function buildRecipeBack(name) {
  const bp = BLUEPRINTS.get(name);
  if (!bp) return '';
  const [credits, time, parts] = bp;
  const hours = time >= 3600 ? (time / 3600).toFixed(0) + 'h' : time > 0 ? (time / 60).toFixed(0) + 'm' : '';
  const metaParts = [];
  if (credits) metaParts.push(fmt(credits) + ' ₵');
  if (hours) metaParts.push(hours);
  const meta = metaParts.join(' · ');

  // Relic drop row for the main blueprint itself
  const itemRelicEntry = typeof RELIC_DROPS !== 'undefined' ? RELIC_DROPS.get(name) : null;
  const bpDrops = itemRelicEntry ? itemRelicEntry[1]['Blueprint'] : null;
  const bpAcqBadge = bpDrops && getDucatQty(name, 'Blueprint') > 0 ? ' <span class="recipe-acq-badge">Acq</span>' : '';
  const bpRow = bpDrops
    ? `<div class="recipe-item"><span class="recipe-res prime"><span class="recipe-duc-name" data-item="${esc(name)}" data-part="Blueprint" onclick="ducatAcqAdd(this)">Blueprint</span>${bpAcqBadge}</span><span class="recipe-count">×1</span></div>${relicChipsHtml(bpDrops)}`
    : '';

  let hasCraftable = false;
  let compHtml;
  if (!parts || parts.length === 0) {
    compHtml = bpRow + '<div class="recipe-empty">No components listed</div>';
  } else {
    const {html: partsHtml, hasCraftable: hc} = renderRecipeParts(name, parts);
    hasCraftable = hc;
    compHtml = bpRow + partsHtml;
  }

  let allResHtml = '';
  let toggleHtml = '';
  if (hasCraftable) {
    const flat = flattenResources(name, 1, new Set());
    allResHtml = Object.entries(flat)
      .sort((a, b) => b[1] - a[1])
      .map(([rName, rCount]) => `<div class="recipe-item"><span class="recipe-res">${wikiLink(rName)}</span><span class="recipe-count">×${fmt(rCount)}</span></div>`)
      .join('');
    toggleHtml = `<div class="recipe-toggle">
    <button class="recipe-tab on" onclick="setRecipeView(this,'comp')">Components</button>
    <button class="recipe-tab" onclick="setRecipeView(this,'all')">All Resources</button>
  </div>`;
  }

  return `<div class="card-back">
  <div class="recipe-header">
    <span class="recipe-title">Recipe</span>
    <span class="recipe-meta">${esc(meta)}</span>
  </div>
  ${toggleHtml}
  <div class="recipe-list recipe-components">${compHtml}</div>
  ${hasCraftable ? `<div class="recipe-list recipe-all-res">${allResHtml}</div>` : ''}
  <div class="card-foot"><div class="qbtns"><button class="qbtn" onclick="flipCard(this)">&#8592; Back</button></div></div>
</div>`;
}

function toggleVaultedState(name) {
  const k = 'wf-resurgence:' + name;
  if (progress[k]) delete progress[k];
  else progress[k] = true;
  saveProgress();
  render();
}

function scXP() {
  let xp = 0;
  const regularOvr = progress['sc-ovr:regular'];
  if (regularOvr != null && regularOvr >= 0) {
    xp += regularOvr;
  } else {
    for (const p of SC_PLANETS)   { if (progress['pl:'+p]) xp += SC_PLANET_XP[p] || 0; }
    for (const j of SC_JUNCTIONS) { if (progress['jn:'+j]) xp += SC_JUNCTION_XP; }
  }
  const spOvr = progress['sc-ovr:sp'];
  if (spOvr != null && spOvr >= 0) {
    xp += spOvr;
  } else {
    for (const p of SC_SP_PLANETS)   { if (progress['sp:'+p])  xp += SC_PLANET_XP[p] || 0; }
    for (const j of SC_SP_JUNCTIONS) { if (progress['spj:'+j]) xp += SC_JUNCTION_XP; }
  }
  return xp;
}

const SC_MAX_XP = SC_PLANETS.reduce((s,n) => s + (SC_PLANET_XP[n]||0), 0)
  + SC_JUNCTIONS.length * SC_JUNCTION_XP
  + SC_SP_PLANETS.reduce((s,n) => s + (SC_PLANET_XP[n]||0), 0)
  + SC_SP_JUNCTIONS.length * SC_JUNCTION_XP;

function totalXP() {
  let xp = 0;
  for (const [tab, items] of Object.entries(TAB_DATA)) {
    for (const [name,,, maxRank] of items) {
      xp += (progress[itemKey(tab,name)] || 0) * TAB_XP_PER_LEVEL[tab];
    }
  }
  xp += scXP();
  return xp;
}

function getCurrentMR(xp) {
  let cur = MASTERY[0];
  for (const m of MASTERY) { if (m.xp <= xp) cur = m; else break; }
  return cur;
}
function getNextMR(xp) {
  for (const m of MASTERY) { if (m.xp > xp) return m; }
  return null;
}

function potentialXP() {
  let xp = totalXP();
  for (const [tab, items] of Object.entries(TAB_DATA)) {
    if (!AQ_TABS.has(tab)) continue;
    for (const [name,,, maxRank] of items) {
      const rank = progress[itemKey(tab, name)] || 0;
      if (rank < maxRank && (rank > 0 || !!progress[aqKey(tab, name)])) {
        xp += (maxRank - rank) * TAB_XP_PER_LEVEL[tab];
      }
    }
  }
  return xp;
}

function fmt(n) { return n.toLocaleString(); }

// ─────────────────────────────────────────────
// HEADER UPDATE
// ─────────────────────────────────────────────
function updateHeader() {
  const xp = totalXP();
  const cur = getCurrentMR(xp);
  const nxt = getNextMR(xp);
  document.getElementById('mr-rank').textContent = cur.r;
  document.getElementById('mr-title').textContent = cur.t;
  const potXP = potentialXP();
  const potMR = getCurrentMR(potXP);
  const potBadge = document.getElementById('pot-badge');
  if (potXP > xp) {
    document.getElementById('pot-rank').textContent = potMR.r;
    potBadge.style.display = 'flex';
    potBadge.title = potMR.t + ' · ' + fmt(potXP) + ' XP';
  } else {
    potBadge.style.display = 'none';
  }
  document.getElementById('xp-total').textContent = fmt(xp) + ' XP';
  if (nxt) {
    const inCur = xp - cur.xp;
    const span = nxt.xp - cur.xp;
    const pct = Math.min(100, (inCur / span) * 100);
    document.getElementById('xp-next').textContent = fmt(nxt.xp - xp) + ' to ' + nxt.r + ' · ' + nxt.t;
    document.getElementById('pb-l').textContent = fmt(cur.xp);
    document.getElementById('pb-r').textContent = fmt(nxt.xp);
    document.getElementById('pb-fill').style.width = pct.toFixed(1) + '%';
  } else {
    document.getElementById('xp-next').textContent = 'Max rank achieved!';
    document.getElementById('pb-fill').style.width = '100%';
  }
}

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(tabEl) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  activeTab = tabEl.dataset.tab;
  localStorage.setItem('wf-ui-tab', activeTab);
  document.getElementById('search').value = '';
  filters = { status: '', incarnon: false, hasParts: false };
  activeCategory = '';
  activeType = '';
  activeUse = '';
  activeArcaneType     = '';
  activeArcaneRarity   = '';
  activeArcaneCategory = '';
  collapsedGroups.clear();
  restoreViewPrefs();
  restoreStatus();
  restoreFilters();
  populateCatFilter();
  const isChart   = activeTab === 'starChart';
  const isSummary = activeTab === 'summary';
  const isMods    = activeTab === 'mods';
  const isCl      = activeTab === 'checklist';
  const isDucats  = activeTab === 'ducats';
  const isKitgun  = activeTab === 'kitgunBuilder';
  const isSpecial = isChart || isSummary || isCl || isDucats || isKitgun;
  document.getElementById('summary').classList.toggle('open', isSummary);
  document.getElementById('checklist-view').style.display = isCl     ? 'block' : 'none';
  document.getElementById('ducats-view').style.display    = isDucats  ? 'block' : 'none';
  document.getElementById('kitgun-view').style.display    = isKitgun  ? 'block' : 'none';
  document.getElementById('grid').style.display     = isSpecial ? 'none' : 'grid';
  document.getElementById('sc').style.display       = isChart   ? 'block' : 'none';
  document.getElementById('bulk-bar').style.display = isSpecial ? 'none' : 'flex';
  document.getElementById('cat-btns').style.display = (isSpecial && !isDucats) ? 'none' : '';
  document.getElementById('search').style.display   = (isCl || isKitgun) ? 'none' : '';
  document.getElementById('status-dd').style.display = isSpecial ? 'none' : '';
  const isIncarnon = ['primary','secondary','melee'].includes(activeTab);
  document.getElementById('fb-incarnon').style.display = isIncarnon ? '' : 'none';
  const isAqTab = AQ_TABS.has(activeTab);
  const hpBtn = document.getElementById('fb-hasparts');
  hpBtn.style.display = isAqTab ? '' : 'none';
  hpBtn.classList.toggle('on', false);
  const _cwInd = document.getElementById('circuit-week-ind');
  _cwInd.textContent = 'Circuit: Week ' + CIRCUIT_WEEK_NOW;
  _cwInd.style.display = isIncarnon ? '' : 'none';
  const _cwWfInd = document.getElementById('circuit-wf-week-ind');
  _cwWfInd.textContent = 'Circuit: Week ' + CIRCUIT_WF_WEEK_NOW;
  _cwWfInd.style.display = activeTab === 'warframes' ? '' : 'none';
  document.getElementById('fb-conclave').style.display = isMods ? '' : 'none';
  document.getElementById('fb-flawed').style.display   = isMods ? '' : 'none';
  const wfTileBtn = document.getElementById('fb-wftile');
  const wfBgBtn   = document.getElementById('fb-wfbg');
  wfTileBtn.style.display = CARD_IMAGE_TABS.has(activeTab) ? '' : 'none';
  wfBgBtn.style.display   = activeTab === 'intrinsics' ? '' : 'none';
  wfTileBtn.classList.toggle('on', wfTileImages);
  wfBgBtn.classList.toggle('on', wfBgImages);
  const hasAnyFilter = !(isSpecial && !isDucats);
  const _btnF = document.getElementById('btn-filters');
  const _ctrlF = document.getElementById('ctrl-filters');
  if(_btnF) _btnF.style.display = hasAnyFilter ? '' : 'none';
  if(_ctrlF) {
    if(!hasAnyFilter) {
      _ctrlF.style.display = 'none';
    } else {
      const panelOpen = localStorage.getItem('filtersOpen-' + activeTab) === '1';
      _ctrlF.classList.toggle('open', panelOpen);
      _ctrlF.style.display = '';
      if(_btnF) _btnF.textContent = panelOpen ? 'Filters ▴' : 'Filters ▾';
    }
  }
  render();
  if(typeof updateStickyOffset === 'function') requestAnimationFrame(updateStickyOffset);
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t)));
document.addEventListener('click', e => { if (!e.target.closest('.sdd')) closeAllDd(); });

// ─────────────────────────────────────────────
// CATEGORY FILTER
// ─────────────────────────────────────────────
function populateCatFilter() {
  const container = document.getElementById('cat-btns');
  container.innerHTML = '';
  if (activeTab === 'mods') {
    document.getElementById('ctrl-row2').style.display = '';
    document.getElementById('fb-grp').style.display = '';
    buildModDropdowns();
    return;
  }
  if (activeTab === 'arcanes') {
    document.getElementById('ctrl-row2').style.display = '';
    document.getElementById('fb-grp').style.display = '';
    buildArcaneDropdowns();
    return;
  }
  if (activeTab === 'ducats') {
    document.getElementById('ctrl-row2').style.display = 'none';
    const availCats = _ducatAvailableCategories();
    if (availCats.length > 1) {
      container.appendChild(makeDd('dd-cat', 'Category', availCats, activeCategory, setCatFilter, true));
    }
    return;
  }
  if (!TAB_DATA[activeTab]) {
    document.getElementById('ctrl-row2').style.display = 'none';
    return;
  }
  document.getElementById('ctrl-row2').style.display = '';
  const cats = [...new Set(TAB_DATA[activeTab].map(i => i[1]))];
  const showGroup = cats.length > 1 && activeTab !== 'intrinsics';
  document.getElementById('fb-grp').style.display = showGroup ? '' : 'none';
  if (cats.length <= 1) return;
  container.appendChild(makeDd('dd-cat', 'Category', cats, activeCategory, setCatFilter));
}

function setCatFilter(val) {
  activeCategory = val;
  localStorage.setItem('wf-filt-cat-' + activeTab, val);
  populateCatFilter();
  render();
}

function setTypeFilter(val) {
  activeType = val;
  localStorage.setItem('wf-filt-type-mods', val);
  buildModDropdowns();
  render();
}

function setUseFilter(val) {
  activeUse = val;
  localStorage.setItem('wf-filt-use-mods', val);
  buildModDropdowns();
  render();
}

function restoreFilters() {
  activeCategory = localStorage.getItem('wf-filt-cat-' + activeTab) || '';
  if (activeTab === 'mods') {
    activeType = localStorage.getItem('wf-filt-type-mods') || '';
    activeUse  = localStorage.getItem('wf-filt-use-mods')  || '';
  }
  if (activeTab === 'arcanes') {
    activeArcaneType     = localStorage.getItem('wf-filt-arc-type')    || '';
    activeArcaneRarity   = localStorage.getItem('wf-filt-arc-rarity')  || '';
    activeArcaneCategory = localStorage.getItem('wf-filt-arc-cat')     || '';
  }
}

function toggleGroupCollapse(tab, grpCat) {
  const key = tab + ':' + grpCat;
  if (collapsedGroups.has(key)) collapsedGroups.delete(key);
  else collapsedGroups.add(key);
  render();
}

// ── Arcane helpers ────────────────────────────────────────────────
function arcKey(name) { return 'arc:' + name; }
function getArcaneCopies(name)          { return progress[arcKey(name)] || 0; }
function isArcaneOwned(name)            { return getArcaneCopies(name) >= 1; }
function isArcaneMaxed(name, maxRank)   { return getArcaneCopies(name) >= ARCANE_RANK_COPIES[maxRank]; }

function derivedArcaneRank(copies, maxRank) {
  for (let r = maxRank; r >= 0; r--) {
    if (copies >= ARCANE_RANK_COPIES[r]) return r;
  }
  return -1; // unowned
}

function setArcaneCopies(name, copies) {
  if (copies > 0) progress[arcKey(name)] = copies;
  else            delete progress[arcKey(name)];
  saveProgress(); updateHeader(); render();
}

function arcRankLabel(copies, maxRank) {
  const r = derivedArcaneRank(copies, maxRank);
  if (r < 0)          return 'Unowned';
  if (r >= maxRank)   return 'Rank ' + r + ' (Max)';
  return 'Rank ' + r;
}

function arcaneSliderInput(el, name, maxRank) {
  const copies   = parseInt(el.value);
  const maxCopies = ARCANE_RANK_COPIES[maxRank];
  const pct      = (copies / maxCopies * 100).toFixed(1);
  el.style.setProperty('--pct', pct + '%');
  el.closest('.card-row').querySelector('.rank-num').textContent = copies;
  const card    = el.closest('.card');
  const rank    = derivedArcaneRank(copies, maxRank);
  const isMax   = rank >= maxRank;
  card.classList.toggle('maxed',    isMax);
  card.classList.toggle('partial',  rank > 0 && !isMax);
  card.classList.toggle('acquired', copies > 0 && rank <= 0);
  const rankLbl = card.querySelector('.arc-rank-lbl');
  if (rankLbl) rankLbl.textContent = arcRankLabel(copies, maxRank);
  const qbtns = card.querySelector('.qbtns');
  const existingOwned = qbtns.querySelector('.qbtn.aq');
  if (copies > 0 && existingOwned) {
    existingOwned.remove();
  } else if (copies === 0 && !existingOwned) {
    const btn = document.createElement('button');
    btn.className = 'qbtn aq';
    btn.textContent = 'Owned';
    btn.onclick = () => setArcaneCopies(name, 1);
    qbtns.insertBefore(btn, qbtns.firstChild);
  }
  if (copies > 0) progress[arcKey(name)] = copies;
  else            delete progress[arcKey(name)];
  deferSave();
  updateTabStat();
}

function buildArcaneDropdowns() {
  const container = document.getElementById('cat-btns');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.id = 'mod-dropdowns';
  const types    = [...new Set(ARCANES.map(a => a[1]))].sort();
  const rarities = [...new Set(ARCANES.map(a => a[4]))].sort();
  const cats     = [...new Set(ARCANES.map(a => a[6]).filter(Boolean))].sort();
  wrap.appendChild(makeDd('dd-arc-type',   'Type',     types,    activeArcaneType,     val => { activeArcaneType     = val; localStorage.setItem('wf-filt-arc-type',    val); buildArcaneDropdowns(); render(); }));
  wrap.appendChild(makeDd('dd-arc-rarity', 'Rarity',   rarities, activeArcaneRarity,   val => { activeArcaneRarity   = val; localStorage.setItem('wf-filt-arc-rarity',  val); buildArcaneDropdowns(); render(); }));
  wrap.appendChild(makeDd('dd-arc-cat',    'Category', cats,     activeArcaneCategory, val => { activeArcaneCategory = val; localStorage.setItem('wf-filt-arc-cat',      val); buildArcaneDropdowns(); render(); }));
  container.appendChild(wrap);
}

function buildModDropdowns() {
  const container = document.getElementById('cat-btns');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.id = 'mod-dropdowns';

  const visible = MODS.filter(m => (modShowConclave || m[1] !== 'Conclave Only') && (modShowFlawed || m[1] !== 'Flawed'));
  const cats  = [...new Set(visible.map(m => m[1]))].sort();
  const types = [...new Set(visible.map(m => m[8]).filter(Boolean))].sort();
  const uses  = [...new Set(visible.flatMap(m => m[10] || []).filter(Boolean))].sort();

  wrap.appendChild(makeDd('dd-cat',  'Category', cats,  activeCategory, setCatFilter));
  wrap.appendChild(makeDd('dd-type', 'Type',     types, activeType,     setTypeFilter));
  wrap.appendChild(makeDd('dd-use',  'Use',      uses,  activeUse,      setUseFilter));
  container.appendChild(wrap);
}

function makeDd(id, label, options, activeVal, onSelect, noSearch = false) {
  const sdd = document.createElement('div');
  sdd.className = 'sdd';
  sdd.id = id;

  const pluralLabel = label === 'Category' ? 'Categories' : label === 'Status' ? 'Statuses' : label + 's';
  const displayLabel = activeVal || ('All ' + pluralLabel);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sdd-trigger' + (activeVal ? ' on' : '');
  trigger.innerHTML = `<span class="sdd-lbl">${esc(displayLabel)}</span><span class="sdd-arrow">▾</span>`;
  trigger.addEventListener('click', e => { e.stopPropagation(); toggleDd(id); });

  const panel = document.createElement('div');
  panel.className = 'sdd-panel';
  panel.id = id + '-panel';

  if (!noSearch) {
    const searchWrap = document.createElement('div');
    searchWrap.className = 'sdd-search-wrap';
    const inp = document.createElement('input');
    inp.className = 'sdd-search';
    inp.placeholder = 'Search ' + pluralLabel.toLowerCase() + '…';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => filterDdOpts(inp, id + '-panel'));
    inp.addEventListener('click', e => e.stopPropagation());
    searchWrap.appendChild(inp);
    panel.appendChild(searchWrap);
  }

  const opts = document.createElement('div');
  opts.className = 'sdd-opts';

  const allOpt = document.createElement('div');
  allOpt.className = 'sdd-opt' + (activeVal === '' ? ' on' : '');
  allOpt.textContent = 'All';
  allOpt.addEventListener('click', () => { onSelect(''); closeDd(id); });
  opts.appendChild(allOpt);

  for (const o of options) {
    const opt = document.createElement('div');
    opt.className = 'sdd-opt' + (o === activeVal ? ' on' : '');
    opt.textContent = o;
    opt.addEventListener('click', () => { onSelect(o); closeDd(id); });
    opts.appendChild(opt);
  }

  panel.appendChild(opts);
  sdd.appendChild(trigger);
  sdd.appendChild(panel);
  return sdd;
}

function toggleDd(id) {
  const panel = document.getElementById(id + '-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  closeAllDd();
  if (!isOpen) {
    panel.classList.add('open');
    panel.closest('.sdd').querySelector('.sdd-trigger').classList.add('open');
    const inp = panel.querySelector('.sdd-search');
    if (inp) { inp.value = ''; filterDdOpts(inp, id + '-panel'); inp.focus(); }
  }
}

function closeDd(id) {
  const panel = document.getElementById(id + '-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.closest('.sdd').querySelector('.sdd-trigger').classList.remove('open');
}

function closeAllDd() {
  document.querySelectorAll('.sdd-panel.open').forEach(p => {
    p.classList.remove('open');
    p.closest('.sdd').querySelector('.sdd-trigger').classList.remove('open');
  });
}

function filterDdOpts(inp, panelId) {
  const q = inp.value.toLowerCase();
  document.querySelectorAll('#' + panelId + ' .sdd-opt').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function toggleFilt(key, btn) {
  filters[key] = !filters[key];
  btn.classList.toggle('on', filters[key]);
  localStorage.setItem('wf-filt-' + key + '-' + activeTab, filters[key] ? '1' : '');
  render();
}

const STATUS_KEYS   = { 'Unowned': 'unowned', 'Not Started': 'notStarted', 'In Progress': 'inProgress', 'Maxed': 'maxed' };
const STATUS_LABELS = { 'unowned': 'Unowned', 'notStarted': 'Not Started', 'inProgress': 'In Progress', 'maxed': 'Maxed' };

function buildStatusDropdown() {
  const container = document.getElementById('status-dd');
  container.innerHTML = '';
  const showNotStarted = AQ_TABS.has(activeTab) || activeTab === 'mods' || activeTab === 'arcanes';
  const opts = showNotStarted
    ? ['Unowned', 'Not Started', 'In Progress', 'Maxed']
    : ['Unowned', 'In Progress', 'Maxed'];
  container.appendChild(makeDd('dd-status', 'Status', opts,
    STATUS_LABELS[filters.status] || '',
    label => setStatusFilter(STATUS_KEYS[label] || ''), true));
}

function setStatusFilter(val) {
  filters.status = val;
  localStorage.setItem('wf-filt-status-' + activeTab, val);
  buildStatusDropdown();
  render();
}

function restoreStatus() {
  filters.status = localStorage.getItem('wf-filt-status-' + activeTab) || '';
  buildStatusDropdown();
}

function toggleGroupView() {
  groupedView = !groupedView;
  localStorage.setItem('wf-ui-group-' + activeTab, groupedView ? '1' : '');
  document.getElementById('fb-grp').classList.toggle('on', groupedView);
  render();
}

function setListView(val) {
  listView = val;
  localStorage.setItem('wf-ui-list-' + activeTab, val ? '1' : '');
  document.getElementById('fb-tile').classList.toggle('on', !val);
  document.getElementById('fb-list').classList.toggle('on', val);
  document.getElementById('grid').classList.toggle('list-view', val);
  render();
}

function restoreViewPrefs() {
  listView    = !!localStorage.getItem('wf-ui-list-'  + activeTab);
  groupedView = !!localStorage.getItem('wf-ui-group-' + activeTab);
  document.getElementById('fb-tile').classList.toggle('on', !listView);
  document.getElementById('fb-list').classList.toggle('on', listView);
  document.getElementById('fb-grp').classList.toggle('on', groupedView);
  document.getElementById('grid').classList.toggle('list-view', listView);
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function buildItem(tab, name, cat, obtain, maxRank, tradable, compFor, listMode) {
  const showAcq = AQ_TABS.has(tab);
  const rank = getItemRank(tab, name);
  const xpPL = TAB_XP_PER_LEVEL[tab];
  const xp = rank * xpPL;
  const maxXP = maxRank * xpPL;
  const pct = maxRank > 0 ? (rank / maxRank * 100).toFixed(1) : 0;
  const isMax = rank === maxRank;
  const isPartial = rank > 0 && !isMax;
  const isAcq = showAcq && !!progress[aqKey(tab, name)];
  const cardCls = isMax ? 'maxed' : isPartial ? 'partial' : isAcq ? 'acquired' : '';
  const ename = jsStr(name);
  const incarnonGenesis = INCARNON_WEAPONS.get(name);
  const isIncAcq = incarnonGenesis && !!progress[incarnonKey(tab, name)];
  let compTag = '';
  if (compFor) {
    const parts = compFor.split(/\s*;\s*/).filter(Boolean);
    const label = parts.length === 1 ? `→ ${parts[0]}` : `→ ${parts[0]}+${parts.length-1}`;
    compTag = `<div class="card-comp" title="Used to craft: ${esc(parts.join(', '))}">${esc(label)}</div>`;
  }
  const _inCircuit = tab === 'warframes' && CIRCUIT_WF.has(name);
  const _circuitNow = _inCircuit && CIRCUIT_WF_NOW.has(name);
  const circuitTag = _inCircuit ? `<div class="card-circuit${_circuitNow ? ' circuit-now' : ''}" title="Circuit Week ${CIRCUIT_WF_WEEK_LOOKUP[name] ?? '?'}${_circuitNow ? ' (current)' : ''}">Circuit</div>` : '';
  const vaultedTag = isPrimeVaulted(name)
    ? (progress['wf-resurgence:' + name]
        ? `<button class="card-resurgence" onclick="toggleVaultedState('${ename}')">Resurgence</button>`
        : `<button class="card-vaulted" onclick="toggleVaultedState('${ename}')">Vaulted</button>`)
    : '';
  const incarnonTag = incarnonGenesis ? `<a class="card-incarnon${isIncAcq?' on':''}" href="${esc(wikiUrl(incarnonGenesis))}" target="_blank" rel="noopener">Incarnon</a>` : '';
  const _incInCircuit = !!incarnonGenesis && CIRCUIT_INCARNON_WEEK_LOOKUP[incarnonGenesis] != null;
  const _incCircuitNow = _incInCircuit && CIRCUIT_INCARNON_NOW.has(incarnonGenesis);
  const _incCircuitWk = _incInCircuit ? CIRCUIT_INCARNON_WEEK_LOOKUP[incarnonGenesis] : null;
  const incCircuitTag = _incInCircuit ? `<div class="card-circuit${_incCircuitNow ? ' circuit-now' : ''}" title="Incarnon Genesis — Circuit Week ${_incCircuitWk}${_incCircuitNow ? ' (current)' : ''}">Inc. Circuit</div>` : '';
  const hasRecipe = BLUEPRINTS.has(name);
  const inCl = isInChecklist(tab, name);
  const _mr = WEAPON_MR_TABS.has(tab) && typeof WEAPON_MR !== 'undefined' ? (WEAPON_MR.get(name) ?? -1) : -1;
  const mrTag = _mr > 0 ? `<div class="card-mr">MR ${_mr}</div>` : '';
  const tradableTag = tradable ? `<a class="card-tradable" href="${esc(marketUrl(name))}" target="_blank" rel="noopener">Tradable</a>` : '';
  const badges = `${incarnonTag}${incCircuitTag}${vaultedTag}${circuitTag}${mrTag}<div class="card-cat">${esc(cat)}</div><button class="card-addlist${inCl?' on':''}" onclick="toggleChecklist('${tab}','${ename}')" title="Add to Checklist">+</button>`;
  const slider = `<div class="card-row">
    <span class="rank-num">${rank}</span>
    <input class="rank-slider" type="range" min="0" max="${maxRank}"
      value="${rank}" style="--pct:${pct}%"
      oninput="sliderInput(this,'${tab}','${ename}',${maxRank})"
      onchange="sliderInput(this,'${tab}','${ename}',${maxRank})">
    <span class="rank-max">${maxRank}</span>
  </div>`;
  const qbtns = `<div class="qbtns">
      ${hasRecipe ? `<button class="qbtn rec" onclick="flipCard(this)">Recipe</button>` : ''}
      ${showAcq && rank === 0 ? `<button class="qbtn aq${isAcq?' on':''}" onclick="toggleAcquired('${tab}','${ename}')">Acq</button>` : ''}
      ${incarnonGenesis ? `<span class="qbtn-split"><button class="qbtn inc${isIncAcq?' on':''}" onclick="toggleIncarnon('${tab}','${ename}')" title="Toggle Incarnon Owned">Inc</button><button class="qbtn cl${isInIncarnonChecklist(name)?' on':''}" onclick="toggleIncarnonChecklist('${ename}')" title="Add Incarnon to Checklist">+</button></span>` : ''}
      <button class="qbtn mx" onclick="setRank('${tab}','${ename}',${maxRank})">Max</button>
      <button class="qbtn zr" onclick="setRank('${tab}','${ename}',0)">0</button>
    </div>`;
  const obtain_row = `<div class="card-obtain-row"><div class="card-obtain" title="${esc(obtain)}">${esc(obtain)}</div>${compTag}${tradableTag}</div>`;
  const recipe = hasRecipe ? buildRecipeBack(name) : '';

  if (listMode) {
    return `<div class="card list-row${cardCls ? ' '+cardCls : ''}">
<div class="card-front">
  <div class="list-name-col">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener">${esc(name)}</a></div>
    <div class="list-badges">${badges}</div>
  </div>
  ${obtain_row}
  ${slider}
  <div class="card-xp"><span>${fmt(xp)}</span> / ${fmt(maxXP)} XP</div>
  ${qbtns}
</div>
${recipe}
</div>`;
  }

  const _imgSrc = wfTileImages ? getCardImage(tab, name, cat) : null;
  const _imgCls = (tab === 'warframes' || tab === 'intrinsics') ? 'card-wf-img' : 'card-wf-img card-wf-img--lg';
  const wfImg = _imgSrc
    ? `<img class="${_imgCls}" src="${esc(_imgSrc)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '';
  return `<div class="card${cardCls ? ' '+cardCls : ''}">
<div class="card-front">${wfImg}
  <div class="card-top">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener">${esc(name)}</a></div>
    <div style="display:flex;gap:3px;flex-shrink:0;align-items:center">${badges}</div>
  </div>
  ${obtain_row}
  ${slider}
  <div class="card-foot">
    <div class="card-xp"><span>${fmt(xp)}</span> / ${fmt(maxXP)} XP</div>
    ${qbtns}
  </div>
</div>
${recipe}
</div>`;
}

function render() {
  if (activeTab === 'summary')   { renderSummary();   return; }
  if (activeTab === 'starChart') { renderStarChart(); return; }
  if (activeTab === 'mods')      { renderMods();      return; }
  if (activeTab === 'arcanes')   { renderArcanes();   return; }
  if (activeTab === 'checklist')     { renderChecklist();     updateTabStat(); return; }
  if (activeTab === 'ducats')        { renderDucats();        updateTabStat(); return; }
  if (activeTab === 'kitgunBuilder') { renderKitgunBuilder(); updateTabStat(); return; }
  const items = TAB_DATA[activeTab] || [];
  const visible = getVisibleItems();

  const grid = document.getElementById('grid');
  if (visible.length === 0) {
    grid.innerHTML = '<div class="empty">No items match your filters.</div>';
    updateBulkLabel(0, items.length);
    updateTabStat();
    return;
  }

  if (activeTab === 'intrinsics') {
    const INTRINSIC_BG = { Railjack: 'Images/intrinsics/Railjackretrofit.png', Drifter: 'Images/intrinsics/DuviriLandscape.png' };
    const cats = [...new Set(items.map(i => i[1]))];
    grid.innerHTML = cats.flatMap(grpCat => {
      const catVisible = visible.filter(([,c]) => c === grpCat);
      if (catVisible.length === 0) return [];
      const grpLabel = grpCat === 'Drifter' ? 'Duviri' : grpCat;
      const catAll = items.filter(([,c]) => c === grpCat);
      let maxed = 0, earnedXP = 0, maxXP = 0;
      for (const [name,,, maxRank] of catAll) {
        const rank = getItemRank(activeTab, name);
        if (rank === maxRank) maxed++;
        earnedXP += rank * TAB_XP_PER_LEVEL[activeTab];
        maxXP += maxRank * TAB_XP_PER_LEVEL[activeTab];
      }
      const key = 'intrinsics:' + grpCat;
      const collapsed = collapsedGroups.has(key);
      const hdr = `<div class="grid-group-hdr" onclick="toggleGroupCollapse('intrinsics','${jsStr(grpCat)}')">
  <span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${esc(grpLabel)} Intrinsics</span>
  <span style="color:var(--text-muted);font-weight:400;font-size:10px">${maxed}/${catAll.length} maxed · <b style="color:var(--gold)">${fmt(earnedXP)}</b> / ${fmt(maxXP)} XP</span>
</div>`;
      const bgSrc = wfBgImages ? (INTRINSIC_BG[grpCat] ?? null) : null;
      const bgImg = bgSrc ? `<img class="intrinsic-bg" src="${esc(bgSrc)}" alt="" onerror="this.style.display='none'">` : '';
      const cards = collapsed ? '' : `<div class="intrinsic-cards-grid">${catVisible.map(([n,c,o,mr,tr,cf]) => buildItem(activeTab,n,c,o,mr,tr,cf,listView)).join('')}</div>`;
      return [`<div class="intrinsic-group">${bgImg}${hdr}${cards}</div>`];
    }).join('');
    updateBulkLabel(visible.length, items.length);
    updateTabStat();
    return;
  }

  if (groupedView) {
    const allCats = [...new Set(items.map(i => i[1]))];
    if (allCats.length > 1) {
      grid.innerHTML = allCats.flatMap(grpCat => {
        const catVisible = visible.filter(([,c]) => c === grpCat);
        if (catVisible.length === 0) return [];
        const catAll = items.filter(([,c]) => c === grpCat);
        let maxed = 0, earnedXP = 0, maxXP = 0;
        for (const [name,,, maxRank] of catAll) {
          const rank = getItemRank(activeTab, name);
          if (rank === maxRank) maxed++;
          earnedXP += rank * TAB_XP_PER_LEVEL[activeTab];
          maxXP += maxRank * TAB_XP_PER_LEVEL[activeTab];
        }
        const key = activeTab + ':' + grpCat;
        const collapsed = collapsedGroups.has(key);
        const hdr = `<div class="grid-group-hdr" onclick="toggleGroupCollapse('${activeTab}','${jsStr(grpCat)}')">
  <span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${esc(grpCat)}</span>
  <span style="color:var(--text-muted);font-weight:400;font-size:10px">${maxed}/${catAll.length} maxed · <b style="color:var(--gold)">${fmt(earnedXP)}</b> / ${fmt(maxXP)} XP</span>
</div>`;
        return collapsed ? [hdr] : [hdr + catVisible.map(([n,c,o,mr,tr,cf]) => buildItem(activeTab,n,c,o,mr,tr,cf,listView)).join('')];
      }).join('');
      updateBulkLabel(visible.length, items.length);
      updateTabStat();
      return;
    }
  }

  grid.innerHTML = visible.map(([name, cat, obtain, maxRank, tradable, compFor]) =>
    buildItem(activeTab, name, cat, obtain, maxRank, tradable, compFor, listView)
  ).join('');

  updateBulkLabel(visible.length, items.length);
  updateTabStat();
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Escapes a value for use as a single-quoted JS string inside an HTML attribute.
// Handles: backslash, single-quote, control chars (break JS), double-quote (breaks HTML attribute).
function jsStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '&quot;');
}
function wikiUrl(name) {
  return 'https://wiki.warframe.com/w/' + name.replace(/ /g, '_');
}
const CARD_IMAGE_TABS = new Set(['warframes', 'primary', 'secondary', 'melee', 'companions', 'compWeapons', 'vehicles', 'archWeapons', 'amps', 'intrinsics']);
function getCardImage(tab, name, cat) {
  const base = name.replace(/ /g, '');
  if (tab === 'warframes') return 'Images/warframes/'  + base + 'Helmet.png';
  if (tab === 'primary')   return 'Images/primary/'    + base + '.png';
  if (tab === 'secondary') return 'Images/secondary/'  + base + '.png';
  if (tab === 'melee')        return 'Images/melee/'         + base + '.png';
  if (tab === 'compWeapons')  return 'Images/comp-weapons/'  + base + '.png';
  if (tab === 'vehicles')     return 'Images/vehicles/'       + base + '.png';
  if (tab === 'archWeapons')  return 'Images/arch-weapons/'   + base + '.png';
  if (tab === 'amps')         return 'Images/amps/'            + base + '.png';
  if (tab === 'intrinsics') {
    if (cat === 'Railjack') return 'Images/intrinsics/' + base + 'Intrinsic.png';
    if (cat === 'Drifter')  return 'Images/intrinsics/DrifterIntrinsic' + base + '.png';
  }
  if (tab === 'companions') {
    if (!COMPANION_IMG_PLAIN.has(name)) {
      if (cat === 'Kubrows') return 'Images/companions/' + base + 'Kubrow.png';
      if (cat === 'Kavats')  return 'Images/companions/' + base + 'Kavat.png';
      if (cat === 'Moas')    return 'Images/companions/' + base + 'MOA.png';
      if (cat === 'Hound')   return 'Images/companions/' + base + 'Hound.png';
    }
    return 'Images/companions/' + base + '.png';
  }
  return null;
}
function toggleWfTileImages(btn) {
  wfTileImages = !wfTileImages;
  localStorage.setItem('wf-ui-wftile', wfTileImages ? '1' : '0');
  btn.classList.toggle('on', wfTileImages);
  render();
}
function toggleWfBgImages(btn) {
  wfBgImages = !wfBgImages;
  localStorage.setItem('wf-ui-wfbg', wfBgImages ? '1' : '0');
  btn.classList.toggle('on', wfBgImages);
  render();
}
function marketSlug(name) {
  return name.toLowerCase().replace(/[ -]/g, '_');
}
const MARKET_NO_SET = new Set([
  'Prisma Dual Decurions',
  'Glaxion Vandal','Prisma Gorgon','Prisma Grakata','Prisma Grinlok','Prisma Tetra',
  'Quanta Vandal','Supra Vandal','Telos Boltor','Sancti Tigris','Vaykor Hek',
  'Vulkar Wraith','Prisma Lenz','Secura Penta','Synoid Simulor','Gotva Prime',
  'Mara Detron','Viper Wraith','Prisma Twin Gremlins','Secura Dual Cestra',
  'Sancti Castanas','Prisma Skana','Prisma Dual Cleavers','Machete Wraith',
  'Prisma Machete','Prova Vandal','Prisma Obex','Vericres','Secura Lecta',
  'Halikar Wraith','Prisma Ohma','Telos Boltace','Prisma Veritux',
]);
const MARKET_SLUG_MAP = {
  'Basmu':              'basmu_blueprint',
  'Quellor':            'quellor_blueprint',
  'Pennant':            'pennant_blueprint',
  'Cobra & Crane Prime':'cobra_and_crane_prime_set',
  'Silva & Aegis Prime':'silva_and_aegis_prime_set',
  'Chesa':              'chesa_kubrow_imprint',
  'Huras':              'huras_kubrow_imprint',
  'Raksa':              'raksa_kubrow_imprint',
  'Sahasa':             'sahasa_kubrow_imprint',
  'Sunika':             'sunika_kubrow_imprint',
  'Adarza':             'adarza_kavat_imprint',
  'Smeeta':             'smeeta_kavat_imprint',
  'Vasca':              'vasca_kavat_imprint',
};
function marketUrl(name) {
  if (MARKET_SLUG_MAP[name]) return 'https://warframe.market/items/' + MARKET_SLUG_MAP[name] + '?type=sell';
  const suffix = MARKET_NO_SET.has(name) ? '' : '_set';
  return 'https://warframe.market/items/' + marketSlug(name) + suffix + '?type=sell';
}
function modMarketUrl(name) {
  return 'https://warframe.market/items/' + marketSlug(name) + '?type=sell';
}

function sliderInput(el, tab, name, maxRank) {
  const rank = parseInt(el.value);
  const pct = (rank / maxRank * 100).toFixed(1);
  el.style.setProperty('--pct', pct + '%');
  el.closest('.card-row').querySelector('.rank-num').textContent = rank;
  const card = el.closest('.card');
  const xpPL = TAB_XP_PER_LEVEL[tab] ?? 100;
  const maxXP = maxRank * xpPL;
  card.querySelector('.card-xp').innerHTML = `<span>${fmt(rank * xpPL)}</span> / ${fmt(maxXP)} XP`;
  card.classList.toggle('maxed', rank === maxRank);
  card.classList.toggle('partial', rank > 0 && rank < maxRank);
  if (rank > 0) card.classList.remove('acquired');
  const qbtns = card.querySelector('.qbtns');
  const existingAcq = qbtns.querySelector('.qbtn.aq');
  if (rank > 0 && existingAcq) {
    existingAcq.remove();
  } else if (rank === 0 && !existingAcq && AQ_TABS.has(tab)) {
    const ename = jsStr(name);
    const isAcq = !!progress[aqKey(tab, name)];
    const btn = document.createElement('button');
    btn.className = 'qbtn aq' + (isAcq ? ' on' : '');
    btn.textContent = 'Acq';
    btn.onclick = () => toggleAcquired(tab, name);
    qbtns.insertBefore(btn, qbtns.firstChild);
  }
  setItemRank(tab, name, rank);
}

function setRank(tab, name, rank) {
  const wasAcq = AQ_TABS.has(tab) && !!progress[aqKey(tab, name)];
  progress[itemKey(tab, name)] = rank;
  if (rank > 0 && AQ_TABS.has(tab)) progress[aqKey(tab, name)] = true;
  saveProgress();
  updateHeader();
  render();
  if (rank > 0 && AQ_TABS.has(tab) && !wasAcq) _checkDucatAcquiredPrompt(name);
}

function updateTabStat() {
  if (['starChart','summary','checklist','ducats','kitgunBuilder'].includes(activeTab)) { document.getElementById('tab-stat').innerHTML = ''; return; }
  if (activeTab === 'mods') {
    let owned = 0, maxed = 0;
    for (const [name,, , maxRank] of MODS) {
      const rank = getModRank(name);
      const isOwn = rank > 0 || !!progress[modAqKey(name)];
      if (isOwn) owned++;
      if (maxRank === 0 ? isOwn : rank >= maxRank) maxed++;
    }
    document.getElementById('tab-stat').innerHTML =
      `<b>${owned}</b>/${MODS.length} owned · <b>${maxed}</b> maxed`;
    return;
  }
  if (activeTab === 'arcanes') {
    let owned = 0, maxed = 0;
    for (const [name,,, maxRank] of ARCANES) {
      if (isArcaneOwned(name))          owned++;
      if (isArcaneMaxed(name, maxRank)) maxed++;
    }
    document.getElementById('tab-stat').innerHTML =
      `<b>${owned}</b>/${ARCANES.length} owned · <b>${maxed}</b> maxed`;
    return;
  }
  const items = TAB_DATA[activeTab] || [];
  let maxed = 0, totalXPTab = 0, maxXPTab = 0;
  const xpPL = TAB_XP_PER_LEVEL[activeTab];
  for (const [name,,, maxRank] of items) {
    const rank = getItemRank(activeTab, name);
    if (rank === maxRank) maxed++;
    totalXPTab += rank * xpPL;
    maxXPTab += maxRank * xpPL;
  }
  document.getElementById('tab-stat').innerHTML =
    `<b>${maxed}</b>/${items.length} maxed · <b>${fmt(totalXPTab)}</b>/${fmt(maxXPTab)} XP`;
}

function updateBulkLabel(shown, total) {
  document.getElementById('bulk-label').textContent =
    shown === total ? `Showing all ${total} items` : `Showing ${shown} of ${total} items`;
}

// ─────────────────────────────────────────────
// BULK ACTIONS
// ─────────────────────────────────────────────
function getVisibleItems() {
  const items = TAB_DATA[activeTab] || [];
  const q = document.getElementById('search').value.toLowerCase();
  const cat = activeCategory;
  if (q && !searchIndex[activeTab]) buildSearchIndex(activeTab);
  const idx = searchIndex[activeTab];
  return items.filter(([name, category,,maxRank]) => {
    if (q && !(idx?.get(name) ?? '').includes(q)) return false;
    if (cat && category !== cat) return false;
    const rank = getItemRank(activeTab, name);
    const status = filters.status;
    if (status) {
      const isAcqTab = AQ_TABS.has(activeTab);
      const isAcq = isAcqTab && !!progress[aqKey(activeTab, name)];
      if (status === 'unowned'    && (rank > 0 || isAcq)) return false;
      if (status === 'notStarted' && !(rank === 0 && isAcq)) return false;
      if (status === 'inProgress' && (rank === 0 || rank === maxRank)) return false;
      if (status === 'maxed'      && rank !== maxRank) return false;
    }
    if (filters.incarnon && !INCARNON_WEAPONS.has(name)) return false;
    if (filters.hasParts && !_hasAnyDucatParts(name)) return false;
    return true;
  });
}

function getVisibleMods() {
  const q   = document.getElementById('search').value.toLowerCase();
  const cat = activeCategory;
  const ty  = activeType;
  const use = activeUse;
  return MODS.filter(m => {
    const [name, category,,maxRank] = m;
    const type = m[8];
    if (!modShowConclave && category === 'Conclave Only') return false;
    if (!modShowFlawed   && category === 'Flawed')        return false;
    if (q && !name.toLowerCase().includes(q)) return false;
    if (cat && category !== cat) return false;
    if (ty && type !== ty) return false;
    if (use && !(m[10] || []).includes(use)) return false;
    const rank  = getModRank(name);
    const isOwn = rank > 0 || !!progress[modAqKey(name)];
    const isMax = maxRank === 0 ? isOwn : rank >= maxRank;
    const status = filters.status;
    if (status === 'unowned'    && isOwn) return false;
    if (status === 'notStarted' && !(isOwn && !isMax && rank === 0)) return false;
    if (status === 'inProgress' && (!isOwn || isMax || rank === 0)) return false;
    if (status === 'maxed'      && !isMax) return false;
    return true;
  });
}

function maxAllVisible() {
  if (activeTab === 'mods') {
    for (const [name,,, maxRank] of getVisibleMods()) {
      if (maxRank > 0) { progress[modKey(name)] = maxRank; }
      progress[modAqKey(name)] = true;
    }
    saveProgress(); updateHeader(); render(); return;
  }
  if (activeTab === 'arcanes') {
    for (const [name,,, maxRank] of getVisibleArcanes()) {
      progress[arcKey(name)] = ARCANE_RANK_COPIES[maxRank];
    }
    saveProgress(); updateHeader(); render(); return;
  }
  const visible = getVisibleItems();
  for (const [name,,, maxRank] of visible) {
    progress[itemKey(activeTab,name)] = maxRank;
    if (AQ_TABS.has(activeTab)) progress[aqKey(activeTab,name)] = true;
  }
  saveProgress(); updateHeader(); render();
}
function zeroAllVisible() {
  if (activeTab === 'mods') {
    for (const [name] of getVisibleMods()) {
      delete progress[modKey(name)];
      delete progress[modAqKey(name)];
    }
    saveProgress(); updateHeader(); render(); return;
  }
  if (activeTab === 'arcanes') {
    for (const [name] of getVisibleArcanes()) {
      delete progress[arcKey(name)];
    }
    saveProgress(); updateHeader(); render(); return;
  }
  const visible = getVisibleItems();
  for (const [name] of visible) progress[itemKey(activeTab,name)] = 0;
  saveProgress(); updateHeader(); render();
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────
const SUMMARY_LABELS = {
  warframes: 'Warframes',
  primary: 'Primary', secondary: 'Secondary', melee: 'Melee',
  vehicles: 'Vehicles', companions: 'Companions',
  compWeapons: 'Companion Weapons', archWeapons: 'Arch Weapons',
  amps: 'Amps', intrinsics: 'Intrinsics', mods: 'Mods',
  incarnon: 'Incarnon Genesis',
};

function makeSumCard(label, total, showOwned, owned, maxed, earnedXP, maxXP) {
  const ownedPct = total > 0 ? (owned / total * 100).toFixed(1) : 0;
  const maxedPct = total > 0 ? (maxed / total * 100).toFixed(1) : 0;
  return `<div class="sum-card">
  <div class="sum-hdr"><span class="sum-name">${esc(label)}</span><span class="sum-total">${total} items</span></div>
  ${showOwned ? `<div class="sum-row"><span class="sum-lbl">Owned</span><div class="sum-bar-bg"><div class="sum-bar sum-owned" style="width:${ownedPct}%"></div></div><span class="sum-cnt">${owned} / ${total}</span></div>` : ''}
  <div class="sum-row"><span class="sum-lbl">Maxed</span><div class="sum-bar-bg"><div class="sum-bar sum-maxed" style="width:${maxedPct}%"></div></div><span class="sum-cnt">${maxed} / ${total}</span></div>
  <div class="sum-xp"><span>${fmt(earnedXP)}</span> / ${fmt(maxXP)} XP</div>
</div>`;
}

function sumHdr(key, label, rightHtml) {
  const collapsed = collapsedGroups.has('summary:' + key);
  return `<div class="sum-section-hdr" onclick="toggleGroupCollapse('summary','${key}')">
  <span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${label}</span>
  ${rightHtml ? `<span style="color:var(--text-muted);font-weight:400;font-size:10px">${rightHtml}</span>` : ''}
</div>`;
}

// ─────────────────────────────────────────────
// CHECKLIST RENDER
// ─────────────────────────────────────────────
const CL_TAB_ORDER = ['warframes','primary','secondary','melee','companions','compWeapons','vehicles','archWeapons','amps','intrinsics','incarnon'];
const CL_RARITY    = ['Common','Uncommon','Rare'];

function renderChecklist() {
  const el = document.getElementById('checklist-view');

  if (checklistItems.size === 0) {
    el.innerHTML = '<div class="empty" style="padding:40px;text-align:center">No items in checklist.<br>Use <b>+</b> on any item tile to add it.</div>';
    return;
  }

  const grouped = new Map();
  for (const key of checklistItems) {
    const sep = key.indexOf('\t');
    const tab = key.slice(0, sep), name = key.slice(sep + 1);
    if (!grouped.has(tab)) grouped.set(tab, []);
    grouped.get(tab).push(name);
  }

  const totalRes = {};
  for (const key of checklistItems) {
    const sep = key.indexOf('\t');
    const kTab = key.slice(0, sep), name = key.slice(sep + 1);
    if (kTab === 'incarnon') {
      const genesisName = INCARNON_WEAPONS.get(name) || (name + ' Incarnon Genesis');
      const reqs = INCARNON_REQUIREMENTS.get(genesisName);
      if (reqs) for (const [r, c] of reqs) totalRes[r] = (totalRes[r] || 0) + c;
      continue;
    }
    const itemRes = flattenResources(name, 1, new Set());
    const itemCur = flattenCurrencies(name);
    for (const {key, costs} of getMissionDropComponents(name)) {
      if (clBpOwned.has(key)) {
        for (const [cur, amt] of Object.entries(costs))
          itemCur[cur] = Math.max(0, (itemCur[cur] || 0) - amt);
      }
    }
    for (const c of Object.keys(itemCur)) delete itemRes[c];
    for (const [r, v] of Object.entries(itemRes)) totalRes[r] = (totalRes[r] || 0) + v;
    for (const [r, v] of Object.entries(itemCur)) if (v > 0) totalRes[r] = (totalRes[r] || 0) + v;
  }
  const sortedRes = Object.entries(totalRes).sort((a, b) => b[1] - a[1]);

  const headerHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
  <span style="font-size:11px;color:var(--text-muted)">${checklistItems.size} item${checklistItems.size !== 1 ? 's' : ''}</span>
  <button class="btn" onclick="clearChecklist()">Clear All</button>
</div>`;

  const resHtml = sortedRes.length ? `<div class="cl-section">
<div class="cl-section-hdr">Resources Required</div>
${sortedRes.map(([rName, total]) => {
  const owned = checklistOwned[rName] || 0;
  const need  = Math.max(0, total - owned);
  return `<div class="cl-res-row${need === 0 ? ' cl-res-done' : ''}" data-cl-res="${esc(rName)}" data-cl-total="${total}">
  <span class="cl-res-name">${wikiLink(rName)}</span>
  <span class="cl-res-total">×${fmt(total)}</span>
  <span class="cl-res-lbl">Have</span>
  <input class="cl-res-input" type="number" min="0" value="${owned}" oninput="updateChecklistOwned('${jsStr(rName)}',this.value)">
  <span class="cl-res-need${need === 0 ? ' cl-done' : ''}">Need: ${fmt(need)}</span>
</div>`;
}).join('\n')}
</div>` : '';

  let itemsHtml = '';
  for (const tab of CL_TAB_ORDER) {
    if (!grouped.has(tab)) continue;
    const label = SUMMARY_LABELS[tab] || tab;
    let rows = '';
    for (const name of grouped.get(tab)) {
      const ename  = jsStr(name);

      if (tab === 'incarnon') {
        const genesisName = INCARNON_WEAPONS.get(name) || (name + ' Incarnon Genesis');
        const wTab = INCARNON_WEAPON_TAB.get(name) ?? null;
        const isIncOwned = wTab ? !!progress[incarnonKey(wTab, name)] : false;
        rows += `<div class="cl-item">
<div class="cl-item-hdr">
  <a class="cl-item-name" href="${esc(wikiUrl(genesisName))}" target="_blank" rel="noopener">${esc(genesisName)}</a>
  ${isIncOwned ? '<span class="cl-acq-tag">Acquired</span>' : ''}
  <div class="cl-item-btns">
    <button class="qbtn" onclick="markChecklistDone('incarnon','${ename}')" title="Mark done &amp; remove">✓ Done</button>
    <button class="qbtn zr" onclick="removeFromChecklist('incarnon','${ename}')" title="Remove">✕</button>
  </div>
</div>
</div>`;
        continue;
      }

      const isAcq  = AQ_TABS.has(tab) && (!!progress[aqKey(tab, name)] || getItemRank(tab, name) > 0);

      let relicHtml = '';
      const relicEntry = typeof RELIC_DROPS !== 'undefined' ? RELIC_DROPS.get(name) : null;
      if (relicEntry) {
        const [, partsObj] = relicEntry;
        const partRows = Object.entries(partsObj).map(([partName, drops]) => {
          const label = partName.replace(/\s*Blueprint$/i, '').trim();
          const best  = [...drops].sort((a, b) => {
            const aV = a[2] === 1 ? 1 : 0, bV = b[2] === 1 ? 1 : 0;
            return aV !== bV ? aV - bV : a[1] - b[1];
          })[0];
          const relicName = RELIC_INDEX[best[0]];
          const vaulted   = best[2] === 1;
          return `<div class="cl-relic-row${vaulted ? ' cl-vaulted' : ''}">
  <span class="cl-part">${esc(label)}</span>
  <span class="cl-relic-name">${esc(relicName)}</span>
  <span class="cl-rar-${best[1]}">${esc(CL_RARITY[best[1]])}${vaulted ? ' <span class="cl-vaulted-tag">(Vaulted)</span>' : ''}</span>
</div>`;
        }).join('');
        if (partRows) relicHtml = `<div class="cl-relics">${partRows}</div>`;
      }

      const mdComps = getMissionDropComponents(name);
      let bpOwnedHtml = '';
      if (mdComps.length) {
        bpOwnedHtml = '<div class="cl-bp-list">' + mdComps.map(({key, label, costs}) => {
          const owned = clBpOwned.has(key);
          const costStr = Object.entries(costs).map(([c, a]) => `${fmt(a)} ${c}`).join(', ');
          return `<label class="cl-bp-row${owned ? ' cl-bp-owned' : ''}">
  <input type="checkbox" ${owned ? 'checked' : ''} onchange="toggleClBpOwned('${key}')">
  <span class="cl-bp-label">${esc(label)}</span>
  <span class="cl-bp-cost">${esc(costStr)}</span>
</label>`;
        }).join('') + '</div>';
      }

      rows += `<div class="cl-item">
<div class="cl-item-hdr">
  <a class="cl-item-name" href="${esc(wikiUrl(name))}" target="_blank" rel="noopener">${esc(name)}</a>
  ${isAcq ? '<span class="cl-acq-tag">Acquired</span>' : ''}
  <div class="cl-item-btns">
    <button class="qbtn" onclick="markChecklistDone('${tab}','${ename}')" title="Mark done &amp; remove">✓ Done</button>
    <button class="qbtn zr" onclick="removeFromChecklist('${tab}','${ename}')" title="Remove">✕</button>
  </div>
</div>
${bpOwnedHtml}${relicHtml}
</div>`;
    }
    itemsHtml += `<div class="cl-section"><div class="cl-section-hdr">${esc(label)}</div>${rows}</div>`;
  }

  el.innerHTML = `<div class="cl-layout"><div class="cl-col-items">${headerHtml}${itemsHtml}</div><div class="cl-col-resources">${resHtml}</div></div>`;
}

function renderSummary() {
  const parts = [];

  for (const [tab, items] of Object.entries(TAB_DATA)) {
    const tabLabel = SUMMARY_LABELS[tab] || tab;
    const showOwned = AQ_TABS.has(tab);
    const cats = [...new Set(items.map(i => i[1]))];
    let tabEarned = 0, tabMax = 0;
    const tabXpPL = TAB_XP_PER_LEVEL[tab];
    for (const [name,,, maxRank] of items) {
      tabEarned += (progress[itemKey(tab, name)] || 0) * tabXpPL;
      tabMax    += maxRank * tabXpPL;
    }
    const collapsed = collapsedGroups.has('summary:' + tab);
    parts.push(sumHdr(tab, esc(tabLabel), `<b style="color:var(--gold)">${fmt(tabEarned)}</b> / ${fmt(tabMax)} XP`));
    if (!collapsed) {
      for (const cat of cats) {
        const catItems = items.filter(i => i[1] === cat);
        const total = catItems.length;
        let owned = 0, maxed = 0, earnedXP = 0, maxXP = 0;
        for (const [name,,, maxRank] of catItems) {
          const rank = progress[itemKey(tab, name)] || 0;
          if (showOwned && (rank > 0 || !!progress[aqKey(tab, name)])) owned++;
          if (rank === maxRank) maxed++;
          earnedXP += rank * tabXpPL;
          maxXP += maxRank * tabXpPL;
        }
        const cardLabel = tab === 'intrinsics' ? (cat === 'Drifter' ? 'Duviri' : cat) : cat;
        parts.push(makeSumCard(cardLabel, total, showOwned, owned, maxed, earnedXP, maxXP));
      }
    }
  }

  // Star Chart
  const scEarned = scXP();
  const scPct = SC_MAX_XP > 0 ? (scEarned / SC_MAX_XP * 100).toFixed(1) : 0;
  const scCollapsed = collapsedGroups.has('summary:starChart');
  parts.push(sumHdr('starChart', 'Star Chart', `<b style="color:var(--gold)">${fmt(scEarned)}</b> / ${fmt(SC_MAX_XP)} XP`));
  if (!scCollapsed) {
    parts.push(`<div class="sum-card">
  <div class="sum-hdr"><span class="sum-name">Star Chart</span><span class="sum-total">${scPct}% complete</span></div>
  <div class="sum-row"><span class="sum-lbl">XP</span><div class="sum-bar-bg"><div class="sum-bar sum-maxed" style="width:${scPct}%"></div></div><span class="sum-cnt">${scPct}%</span></div>
  <div class="sum-xp"><span>${fmt(scEarned)}</span> / ${fmt(SC_MAX_XP)} XP</div>
</div>`);
  }

  // Mods & Arcanes — ownership only, not mastery
  const maCollapsed = collapsedGroups.has('summary:modsArcanes');
  parts.push(sumHdr('modsArcanes', 'Mods &amp; Arcanes', ''));
  if (!maCollapsed) {
    const modTotal = MODS.length;
    let modOwned = 0, modMaxed = 0;
    for (const [name,,, maxRank] of MODS) {
      const rank = progress[modKey(name)] || 0;
      const isOwn = rank > 0 || !!progress[modAqKey(name)];
      if (isOwn) modOwned++;
      if (maxRank === 0 ? isOwn : rank >= maxRank) modMaxed++;
    }
    const modOwnedPct = modTotal > 0 ? (modOwned / modTotal * 100).toFixed(1) : 0;
    const modMaxedPct = modTotal > 0 ? (modMaxed / modTotal * 100).toFixed(1) : 0;
    parts.push(`<div class="sum-card">
  <div class="sum-hdr"><span class="sum-name">Mods</span><span class="sum-total">${modTotal} mods</span></div>
  <div class="sum-row"><span class="sum-lbl">Owned</span><div class="sum-bar-bg"><div class="sum-bar sum-owned" style="width:${modOwnedPct}%"></div></div><span class="sum-cnt">${modOwned} / ${modTotal}</span></div>
  <div class="sum-row"><span class="sum-lbl">Maxed</span><div class="sum-bar-bg"><div class="sum-bar sum-maxed" style="width:${modMaxedPct}%"></div></div><span class="sum-cnt">${modMaxed} / ${modTotal}</span></div>
</div>`);
    const arcTotal = ARCANES.length;
    let arcOwned = 0, arcMaxed = 0;
    for (const [name,,, maxRank] of ARCANES) {
      if (isArcaneOwned(name))          arcOwned++;
      if (isArcaneMaxed(name, maxRank)) arcMaxed++;
    }
    const arcOwnedPct = arcTotal > 0 ? (arcOwned / arcTotal * 100).toFixed(1) : 0;
    const arcMaxedPct = arcTotal > 0 ? (arcMaxed / arcTotal * 100).toFixed(1) : 0;
    parts.push(`<div class="sum-card">
  <div class="sum-hdr"><span class="sum-name">Arcanes</span><span class="sum-total">${arcTotal} arcanes</span></div>
  <div class="sum-row"><span class="sum-lbl">Owned</span><div class="sum-bar-bg"><div class="sum-bar sum-owned" style="width:${arcOwnedPct}%"></div></div><span class="sum-cnt">${arcOwned} / ${arcTotal}</span></div>
  <div class="sum-row"><span class="sum-lbl">Maxed</span><div class="sum-bar-bg"><div class="sum-bar sum-maxed" style="width:${arcMaxedPct}%"></div></div><span class="sum-cnt">${arcMaxed} / ${arcTotal}</span></div>
</div>`);
  }

  document.getElementById('summary').innerHTML = parts.join('');
  document.getElementById('tab-stat').innerHTML = '';
}

// ─────────────────────────────────────────────
// STAR CHART
// ─────────────────────────────────────────────
function scKey(type, name) { return type + name; }

function toggleSC(type, name) {
  const k = scKey(type, name);
  progress[k] = !progress[k];
  saveProgress();
  updateHeader();
  renderStarChart();
}

function setSCOverride(key, val) {
  const num = Math.round(parseFloat(val));
  if (val === '' || isNaN(num) || num < 0) {
    delete progress[key];
  } else {
    progress[key] = num;
  }
  saveProgress();
  updateHeader();
  renderStarChart();
}

function renderStarChart() {
  updateTabStat();
  const sc = document.getElementById('sc');

  const groups = [
    {
      ovKey: 'sc-ovr:regular',
      label: 'Regular Star Chart',
      sections: [
        { title: 'Planets',   items: SC_PLANETS,   type: 'pl:', getXP: n => SC_PLANET_XP[n] || 0 },
        { title: 'Junctions', items: SC_JUNCTIONS, type: 'jn:', getXP: () => SC_JUNCTION_XP },
      ],
    },
    {
      ovKey: 'sc-ovr:sp',
      label: 'Steel Path',
      sections: [
        { title: 'Planets',   items: SC_SP_PLANETS,   type: 'sp:',  getXP: n => SC_PLANET_XP[n] || 0 },
        { title: 'Junctions', items: SC_SP_JUNCTIONS, type: 'spj:', getXP: () => SC_JUNCTION_XP },
      ],
    },
  ];

  sc.innerHTML = groups.map(({ ovKey, label, sections }) => {
    const ovr = (progress[ovKey] != null && progress[ovKey] >= 0) ? progress[ovKey] : null;

    const totalGroupXP  = sections.reduce((s, { items, getXP }) => s + items.reduce((ss, n) => ss + getXP(n), 0), 0);
    const doneGroupXP   = sections.reduce((s, { items, type, getXP }) => s + items.filter(n => progress[scKey(type,n)]).reduce((ss,n) => ss + getXP(n), 0), 0);
    const doneGroupCount = sections.reduce((s, { items, type }) => s + items.filter(n => progress[scKey(type,n)]).length, 0);
    const totalGroupCount = sections.reduce((s, { items }) => s + items.length, 0);

    const groupStat = ovr != null
      ? `<span style="color:var(--gold-dim)">${fmt(ovr)} XP <span style="color:var(--text-muted);font-size:8px;letter-spacing:1px">OVERRIDE</span></span>`
      : `<span style="color:var(--text-muted);font-weight:400">${doneGroupCount}/${totalGroupCount} · ${fmt(doneGroupXP)} XP / ${fmt(totalGroupXP)}</span>`;

    const sectionsHtml = sections.map(({ title, items, type, getXP }) => {
      const done = items.filter(n => progress[scKey(type,n)]).length;
      const doneXP = items.filter(n => progress[scKey(type,n)]).reduce((s,n) => s + getXP(n), 0);
      const secTotalXP = items.reduce((s,n) => s + getXP(n), 0);
      const cards = items.map(name => {
        const isDone = !!progress[scKey(type,name)];
        const xp = getXP(name);
        const lbl = (type === 'jn:' || type === 'spj:') ? name + ' Junction' : name;
        return `<div class="sc-card${isDone?' done':''}" onclick="toggleSC('${type}','${name}')">
  <div class="sc-box">✓</div>
  <div class="sc-name">${esc(lbl)}</div>
  <div class="sc-xp-tag">${isDone ? fmt(xp)+' XP' : '+'+fmt(xp)}</div>
</div>`;
      }).join('');
      return `<div class="sc-section">
  <h3>${esc(title)} <span>${done}/${items.length} · ${fmt(doneXP)} XP <span style="color:var(--text-muted)">/ ${fmt(secTotalXP)}</span></span></h3>
  <div class="sc-grid${ovr != null ? ' dimmed' : ''}">${cards}</div>
</div>`;
    }).join('');

    return `<div class="sc-group">
  <div class="sc-group-hdr">
    <span class="sc-group-title">${esc(label)}</span>
    ${groupStat}
  </div>
  <div class="sc-ovr-row">
    <span>[OVERRIDE] Game total XP:</span>
    <input class="sc-ovr-input${ovr != null ? ' active' : ''}" type="number" min="0"
      placeholder="blank = use checkboxes"
      value="${ovr != null ? ovr : ''}"
      oninput="setSCOverride('${ovKey}', this.value)">
    ${ovr != null ? '<span class="sc-ovr-note">Override active — checkboxes ignored</span>' : ''}
  </div>
  ${sectionsHtml}
</div>`;
  }).join('');

  document.getElementById('tab-stat').innerHTML =
    `<b>${fmt(scXP())}</b> / ${fmt(SC_MAX_XP)} XP from star chart`;
}

// ─────────────────────────────────────────────
// MODS
// ─────────────────────────────────────────────
function modKey(name)   { return itemKey('mods', name); }
function modAqKey(name) { return aqKey('mods', name); }
function getModRank(name)  { return progress[modKey(name)] || 0; }
function isModOwned(name)  { return getModRank(name) > 0 || !!progress[modAqKey(name)]; }

function setModRank(name, rank) {
  if (rank > 0) {
    progress[modKey(name)] = rank;
    progress[modAqKey(name)] = true;
  } else {
    delete progress[modKey(name)];
  }
  saveProgress();
  updateHeader();
  render();
}

function toggleModOwned(name) {
  const k = modAqKey(name);
  progress[k] = !progress[k];
  if (!progress[k]) delete progress[k];
  saveProgress();
  updateHeader();
  render();
}

function modSliderInput(el, name, maxRank) {
  const rank = parseInt(el.value);
  const pct = maxRank > 0 ? (rank / maxRank * 100).toFixed(1) : 0;
  el.style.setProperty('--pct', pct + '%');
  el.closest('.card-row').querySelector('.rank-num').textContent = rank;
  const card = el.closest('.card');
  const isMax = rank >= maxRank;
  const isPartial = rank > 0 && !isMax;
  card.classList.toggle('maxed',   isMax);
  card.classList.toggle('partial', isPartial);
  if (rank > 0) card.classList.remove('acquired');
  const costRow = card.querySelector('.mod-cost-row');
  if (costRow) costRow.innerHTML = modCostContent(card.dataset.rarity, card.dataset.cat, rank, maxRank);
  const qbtns = card.querySelector('.qbtns');
  const existingOwned = qbtns.querySelector('.qbtn.aq');
  if (rank > 0 && existingOwned) {
    existingOwned.remove();
  } else if (rank === 0 && !existingOwned) {
    const ename = jsStr(name);
    const isOwn = !!progress[modAqKey(name)];
    const btn = document.createElement('button');
    btn.className = 'qbtn aq' + (isOwn ? ' on' : '');
    btn.textContent = 'Owned';
    btn.onclick = () => toggleModOwned(name);
    qbtns.insertBefore(btn, qbtns.firstChild);
  }
  if (rank > 0) {
    progress[modKey(name)] = rank;
    progress[modAqKey(name)] = true;
  } else {
    delete progress[modKey(name)];
  }
  deferSave();
  updateTabStat();
}

function toggleConclaveFilter(btn) {
  modShowConclave = !modShowConclave;
  btn.classList.toggle('on', modShowConclave);
  activeCategory = '';
  activeType = '';
  activeUse = '';
  populateCatFilter();
  render();
}

function toggleFlawedFilter(btn) {
  modShowFlawed = !modShowFlawed;
  btn.classList.toggle('on', modShowFlawed);
  activeCategory = '';
  activeType = '';
  activeUse = '';
  populateCatFilter();
  render();
}

// ─────────────────────────────────────────────
// RANKING COST LOOKUP
// ─────────────────────────────────────────────
const RANK_CREDITS = {
  'Common':           [483,1449,3381,7245,14973,30429,61341,123165,246813,494109],
  'Uncommon':         [966,2898,6762,14490,29946,60858,122682,246330,493626,988218],
  'Rare':             [1449,4347,10143,21735,44919,91287,184023,369495,740439,1482327],
  'Legendary':        [1932,5796,13524,28980,59892,121716,245364,492660,987252,1976436],
  'Common Antique':   [5000,15000,35000,75000,155000],
  'Uncommon Antique': [10000,30000,70000,150000,310000],
  'Rare Antique':     [15000,45000,105000,225000,465000],
};
const RANK_ENDO = {
  'Common':           [10,30,70,150,310,630,1270,2550,5110,10230],
  'Uncommon':         [20,40,80,160,320,640,1280,2560,5120,10240],
  'Rare':             [30,90,210,450,930,1890,3810,7650,15330,30690],
  'Legendary':        [40,120,280,600,1240,2520,5080,10200,20440,40920],
  'Common Antique':   [160,480,1120,2400,4960],
  'Uncommon Antique': [320,960,2240,4800,9920],
  'Rare Antique':     [480,1440,3360,7200,14880],
};

function modCostContent(rarity, category, fromRank, toRank) {
  if (fromRank >= toRank) return '<span class="mod-cost-lbl">Fully ranked</span>';
  const key = category === 'Antique' ? rarity + ' Antique' : rarity;
  const cr = RANK_CREDITS[key];
  const en = RANK_ENDO[key];
  if (!cr || !en) return '';
  const credits = cr[toRank - 1] - (fromRank > 0 ? cr[fromRank - 1] : 0);
  const endo    = en[toRank - 1] - (fromRank > 0 ? en[fromRank - 1] : 0);
  return `<span><span class="mod-cost-lbl">Endo</span><span class="mod-cost-val">${fmt(endo)}</span></span>`
       + `<span><span class="mod-cost-lbl">Credits</span><span class="mod-cost-val">${fmt(credits)}</span></span>`
       + `<span class="mod-cost-lbl">to max</span>`;
}

// ─────────────────────────────────────────────
// ARCANES TAB
// ─────────────────────────────────────────────
function getVisibleArcanes() {
  const q   = document.getElementById('search').value.toLowerCase();
  const ty  = activeArcaneType;
  const rar = activeArcaneRarity;
  const cat = activeArcaneCategory;
  return ARCANES.filter(a => {
    const [name, type,, maxRank, rarity,, category] = a;
    if (q   && !name.toLowerCase().includes(q)) return false;
    if (ty  && type     !== ty)  return false;
    if (rar && rarity   !== rar) return false;
    if (cat && category !== cat) return false;
    const copies = getArcaneCopies(name);
    const isOwn  = copies >= 1;
    const isMax  = isArcaneMaxed(name, maxRank);
    const arcRank = derivedArcaneRank(copies, maxRank);
    const status = filters.status;
    if (status === 'unowned'    && isOwn) return false;
    if (status === 'notStarted' && !(isOwn && arcRank === 0)) return false;
    if (status === 'inProgress' && (!isOwn || isMax || arcRank === 0)) return false;
    if (status === 'maxed'      && !isMax) return false;
    return true;
  });
}

function buildArcaneItem(name, type, acq, maxRank, rarity, tradable, listMode) {
  const copies    = getArcaneCopies(name);
  const maxCopies = ARCANE_RANK_COPIES[maxRank];
  const rank      = derivedArcaneRank(copies, maxRank);
  const isMax     = rank >= maxRank;
  const cardCls = isMax ? 'maxed' : rank > 0 ? 'partial' : copies > 0 ? 'acquired' : '';
  const ename     = jsStr(name);
  const desc      = ARCANE_DESC[name] || '';
  const pct       = (copies / maxCopies * 100).toFixed(1);

  const tradableTag = tradable ? `<a class="card-tradable" href="${esc(modMarketUrl(name))}" target="_blank" rel="noopener">Tradable</a>` : '';
  const typeTag     = type ? `<div class="card-cat">${esc(type)}</div>` : '';

  const rankSection = `
  <div class="card-row"${listMode ? ' style="flex-shrink:0;width:220px;gap:8px"' : ''}>
    <span class="rank-num">${copies}</span>
    <div style="flex:1;display:flex;flex-direction:column;gap:2px">
      <input class="rank-slider" type="range" min="0" max="${maxCopies}" value="${copies}" style="--pct:${pct}%"
        oninput="arcaneSliderInput(this,'${ename}',${maxRank})"
        onchange="arcaneSliderInput(this,'${ename}',${maxRank})">
      <div class="arc-rank-lbl">${arcRankLabel(copies, maxRank)}</div>
    </div>
    <span class="rank-max">${maxCopies}</span>
  </div>`;

  let qbtns = '';
  if (copies === 0) {
    qbtns = `<button class="qbtn aq" onclick="setArcaneCopies('${ename}',1)">Owned</button>`;
    qbtns += `<button class="qbtn mx" onclick="setArcaneCopies('${ename}',${maxCopies})">Max</button>`;
  } else {
    qbtns = `<button class="qbtn mx" onclick="setArcaneCopies('${ename}',${maxCopies})">Max</button>`;
    qbtns += `<button class="qbtn zr" onclick="setArcaneCopies('${ename}',0)">0</button>`;
  }

  if (listMode) {
    return `<div class="card list-row${cardCls ? ' '+cardCls : ''}" data-rarity="${esc(rarity)}">
  <div class="list-name-col">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener"${desc ? ` title="${esc(desc)}"` : ''}>${esc(name)}</a></div>
    <div class="list-badges">${typeTag}</div>
  </div>
  <div class="card-obtain-row">${buildAcqTags(acq)}${tradableTag}</div>
  ${rankSection}
  <div class="qbtns" style="flex-shrink:0;gap:5px;min-width:112px">${qbtns}</div>
</div>`;
  }
  return `<div class="card${cardCls ? ' '+cardCls : ''}" data-rarity="${esc(rarity)}">
  <div class="card-top">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener"${desc ? ` title="${esc(desc)}"` : ''}>${esc(name)}</a></div>
    <div style="display:flex;gap:3px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end">${typeTag}</div>
  </div>
  <div class="card-obtain-row">${buildAcqTags(acq)}${tradableTag}</div>
  ${rankSection}
  <div class="card-foot" style="margin-top:8px"><div class="qbtns">${qbtns}</div></div>
</div>`;
}

function renderArcanes() {
  const visible = getVisibleArcanes();
  const grid = document.getElementById('grid');
  if (visible.length === 0) {
    grid.innerHTML = '<div class="empty">No arcanes match your filters.</div>';
    updateBulkLabel(0, ARCANES.length);
    updateTabStat();
    return;
  }
  if (groupedView) {
    const allCats = [...new Set(ARCANES.map(a => a[6]).filter(Boolean))].sort();
    grid.innerHTML = allCats.flatMap(grpCat => {
      const catVisible = visible.filter(a => a[6] === grpCat);
      if (catVisible.length === 0) return [];
      const catAll = ARCANES.filter(a => a[6] === grpCat);
      let owned = 0, maxed = 0;
      for (const [name,,, maxRank] of catAll) {
        if (isArcaneOwned(name))          owned++;
        if (isArcaneMaxed(name, maxRank)) maxed++;
      }
      const key = 'arcanes:' + grpCat;
      const collapsed = collapsedGroups.has(key);
      const hdr = `<div class="grid-group-hdr" onclick="toggleGroupCollapse('arcanes','${jsStr(grpCat)}')">
  <span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${esc(grpCat)}</span>
  <span style="color:var(--text-muted);font-weight:400;font-size:10px"><b style="color:var(--gold)">${owned}</b>/${catAll.length} owned · ${maxed} maxed</span>
</div>`;
      return collapsed ? [hdr] : [hdr + catVisible.map(([n,t,a,mr,rar,tr]) => buildArcaneItem(n,t,a,mr,rar,tr,listView)).join('')];
    }).join('');
  } else {
    grid.innerHTML = visible.map(([n,t,a,mr,rar,tr]) => buildArcaneItem(n,t,a,mr,rar,tr,listView)).join('');
  }

  updateBulkLabel(visible.length, ARCANES.length);
  updateTabStat();
}

function buildAcqTags(acq) {
  if (!acq || acq.length === 0) return '<div class="acq-tags"></div>';
  const tags = acq.map(s => `<span class="acq-tag">${esc(s)}</span>`).join('');
  return `<div class="acq-tags"><span class="acq-label">Obtain</span>${tags}</div>`;
}

function buildModItem(name, cat, acq, maxRank, polarity, rarity, exilus, tradable, type, subType, listMode) {
  const rank = getModRank(name);
  const isOwn = isModOwned(name);
  const isMax = maxRank === 0 ? isOwn : rank >= maxRank;
  const isPartial = maxRank > 0 && rank > 0 && !isMax;
  const cardCls = isMax ? 'maxed' : isPartial ? 'partial' : isOwn ? 'acquired' : '';
  const ename = jsStr(name);
  const desc = MOD_DESC[name] || '';
  const pct = maxRank > 0 ? (rank / maxRank * 100).toFixed(1) : 0;
  const rarityLow = rarity.toLowerCase().replace(/ /g, '-');

  const tradableTag  = tradable ? `<a class="card-tradable" href="${esc(modMarketUrl(name))}" target="_blank" rel="noopener">Tradable</a>` : '';
  const exilusTag    = exilus   ? `<div class="mod-exilus">Exilus</div>` : '';
  const polarityTag  = polarity ? `<div class="mod-polarity">${esc(polarity)}</div>` : '';
  const subTypeTags  = (subType || []).filter(st => st && st !== type && st !== cat).map(st => `<div class="card-subtype">${esc(st)}</div>`).join('');

  const rankSection = maxRank > 0 ? `
  <div class="card-row"${listMode ? ' style="flex-shrink:0;width:200px;gap:8px"' : ''}>
    <span class="rank-num">${rank}</span>
    <input class="rank-slider" type="range" min="0" max="${maxRank}" value="${rank}" style="--pct:${pct}%"
      oninput="modSliderInput(this,'${ename}',${maxRank})"
      onchange="modSliderInput(this,'${ename}',${maxRank})">
    <span class="rank-max">${maxRank}</span>
  </div>` : (listMode ? `<div style="flex-shrink:0;width:200px;font-size:10px;color:var(--text-muted);font-style:italic;padding:0 4px">No rank</div>` : '');

  let qbtns = '';
  if (maxRank > 0) {
    const ownedBtn = rank === 0 ? `<button class="qbtn aq${isOwn?' on':''}" onclick="toggleModOwned('${ename}')">Owned</button>` : '';
    qbtns = `${ownedBtn}<button class="qbtn mx" onclick="setModRank('${ename}',${maxRank})">Max</button><button class="qbtn zr" onclick="setModRank('${ename}',0)">0</button>`;
  } else {
    qbtns = `<button class="qbtn aq${isOwn?' on':''}" onclick="toggleModOwned('${ename}')">${isOwn ? 'Owned ✓' : 'Owned'}</button>`;
  }

  if (listMode) {
    const xpCell = maxRank > 0
      ? `<div class="card-xp" style="white-space:nowrap;flex-shrink:0;font-size:10px;min-width:60px"><span>${rank}</span> / ${maxRank}</div>`
      : `<div style="min-width:60px"></div>`;
    return `<div class="card list-row${cardCls ? ' '+cardCls : ''}" data-rarity="${esc(rarity)}" data-cat="${esc(cat)}">
  <div class="list-name-col">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener"${desc ? ` title="${esc(desc)}"` : ''}>${esc(name)}</a></div>
    <div class="list-badges">${type && type !== cat ? `<div class="card-type">${esc(type)}</div>` : ''}${subTypeTags}${exilusTag}${polarityTag}</div>
  </div>
  <div class="card-obtain-row">${buildAcqTags(acq)}${tradableTag}</div>
  ${rankSection}
  ${xpCell}
  <div class="qbtns" style="flex-shrink:0;gap:5px;min-width:112px">${qbtns}</div>
</div>`;
  }
  const footLeft = maxRank > 0
    ? `<div class="mod-cost-row" style="margin:0">${modCostContent(rarity, cat, rank, maxRank)}</div>`
    : `<div class="mod-no-rank">No rank</div>`;
  return `<div class="card${cardCls ? ' '+cardCls : ''}" data-rarity="${esc(rarity)}" data-cat="${esc(cat)}">
  <div class="card-top">
    <div class="card-name"><a href="${esc(wikiUrl(name))}" target="_blank" rel="noopener"${desc ? ` title="${esc(desc)}"` : ''}>${esc(name)}</a></div>
    <div style="display:flex;gap:3px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end">${type && type !== cat ? `<div class="card-type">${esc(type)}</div>` : ''}${subTypeTags}${exilusTag}${polarityTag}</div>
  </div>
  <div class="card-obtain-row">${buildAcqTags(acq)}${tradableTag}</div>
  ${rankSection}
  <div class="card-foot">${footLeft}<div class="qbtns">${qbtns}</div></div>
</div>`;
}

function renderMods() {
  const visible = getVisibleMods();

  const grid = document.getElementById('grid');
  if (visible.length === 0) {
    grid.innerHTML = '<div class="empty">No mods match your filters.</div>';
    updateBulkLabel(0, MODS.length);
    updateTabStat();
    return;
  }

  if (groupedView) {
    const allCats = [...new Set(MODS
      .filter(m => (modShowConclave || m[1] !== 'Conclave Only') && (modShowFlawed || m[1] !== 'Flawed'))
      .map(m => m[1])
    )].sort();
    grid.innerHTML = allCats.flatMap(grpCat => {
      const catVisible = visible.filter(([,c]) => c === grpCat);
      if (catVisible.length === 0) return [];
      const catAll = MODS.filter(([,c]) => c === grpCat);
      let owned = 0, maxed = 0;
      for (const [n,,, mr] of catAll) {
        const r = getModRank(n);
        const isOwn = r > 0 || !!progress[modAqKey(n)];
        if (isOwn) owned++;
        if (mr === 0 ? isOwn : r >= mr) maxed++;
      }
      const key = 'mods:' + grpCat;
      const collapsed = collapsedGroups.has(key);
      const hdr = `<div class="grid-group-hdr" onclick="toggleGroupCollapse('mods','${jsStr(grpCat)}')">
  <span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${esc(grpCat)}</span>
  <span style="color:var(--text-muted);font-weight:400;font-size:10px"><b style="color:var(--gold)">${owned}</b>/${catAll.length} owned · ${maxed} maxed</span>
</div>`;
      return collapsed ? [hdr] : [hdr + catVisible.map(([n,c,a,mr,pol,rar,ex,tr,ty,st]) => buildModItem(n,c,a,mr,pol,rar,ex,tr,ty,st,listView)).join('')];
    }).join('');
  } else {
    grid.innerHTML = visible.map(([n,c,a,mr,pol,rar,ex,tr,ty,st]) => buildModItem(n,c,a,mr,pol,rar,ex,tr,ty,st,listView)).join('');
  }

  updateBulkLabel(visible.length, MODS.length);
  updateTabStat();
}

// ─────────────────────────────────────────────
// SAVE BUNDLE HELPERS
// ─────────────────────────────────────────────
// Full save bundle — includes progress, checklist, and custom items.
// v1 (legacy): flat { key: number|boolean } — progress only.
// v2: { version, progress, checklist, checklistOwned, customItems }

function buildSave() {
  return {
    version: 2,
    progress: progress,
    checklist: [...checklistItems],
    checklistOwned: checklistOwned,
    customItems: customItems,
    modularBuilds: modularBuilds,
    modularOwned: modularOwned,
  };
}

function saveBackupBundle() {
  localStorage.setItem(LS_KEY + '-backup', JSON.stringify(buildSave()));
}

function applySave(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || bundle === null)
    throw new Error('Expected a JSON object');

  const isV2 = bundle.version >= 2 || 'progress' in bundle;

  if (isV2) {
    if (!bundle.progress || typeof bundle.progress !== 'object' || Array.isArray(bundle.progress))
      throw new Error('Invalid save format: missing progress object');
    const sanitizedProgress = {};
    for (const [k, v] of Object.entries(bundle.progress)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (typeof v !== 'number' && typeof v !== 'boolean')
        throw new Error('Unexpected value type in progress data');
      sanitizedProgress[k] = v;
    }
    // Remove existing custom items from TAB_DATA before replacing
    for (const it of customItems) {
      const arr = TAB_DATA[it.tab];
      if (arr) {
        const i = arr.findIndex(row => row[0] === it.name && row[7] === true);
        if (i !== -1) arr.splice(i, 1);
      }
    }
    progress       = sanitizedProgress;
    checklistItems = new Set(Array.isArray(bundle.checklist) ? bundle.checklist : []);
    checklistOwned = (bundle.checklistOwned && typeof bundle.checklistOwned === 'object' && !Array.isArray(bundle.checklistOwned))
                     ? bundle.checklistOwned : {};
    const VALID_CUSTOM_TABS = new Set(ADD_TABS.map(([v]) => v));
    customItems    = (Array.isArray(bundle.customItems) ? bundle.customItems : []).filter(it =>
      it && typeof it === 'object' && !Array.isArray(it) &&
      typeof it.name === 'string' && it.name.trim() &&
      typeof it.tab === 'string' && VALID_CUSTOM_TABS.has(it.tab)
    );
    for (const it of customItems) { _mergeCustomItem(it); delete searchIndex[it.tab]; }
    if (Array.isArray(bundle.modularBuilds)) {
      modularBuilds = bundle.modularBuilds.filter(b =>
        b && typeof b === 'object' && typeof b.id === 'string');
      saveModularBuilds();
    }
    if (bundle.modularOwned && typeof bundle.modularOwned === 'object' && !Array.isArray(bundle.modularOwned)) {
      modularOwned = bundle.modularOwned;
      saveModularOwned();
    }
    saveProgress();
    saveChecklist();
    saveChecklistOwned();
    saveCustomItems();
  } else {
    // Legacy format: flat progress object (number|boolean values only)
    const sanitizedProgress = {};
    for (const [k, v] of Object.entries(bundle)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (typeof v !== 'number' && typeof v !== 'boolean')
        throw new Error('Unexpected value type in save data');
      sanitizedProgress[k] = v;
    }
    progress = sanitizedProgress;
    saveProgress();
  }

  updateHeader();
  render();
}

// EXPORT / IMPORT
// ─────────────────────────────────────────────
let modalMode = 'export';

function openExport() {
  modalMode = 'export';
  document.getElementById('modal-title').textContent = 'Export Save';
  document.getElementById('modal-desc').textContent = 'Save to a file or copy to clipboard to back up or share your progress.';
  document.getElementById('modal-ta').value = JSON.stringify(buildSave(), null, 2);
  document.getElementById('modal-ta').readOnly = true;
  document.getElementById('modal-act').textContent = 'Copy to Clipboard';
  document.getElementById('modal-msg').textContent = '';
  document.getElementById('modal-file-row').style.display = 'none';
  document.getElementById('modal-sheets-row').style.display = 'none';
  document.getElementById('modal-sheets-help').style.display = 'none';
  document.getElementById('modal-save-file').style.display = '';
  document.getElementById('overlay').classList.add('open');
}

function openImport() {
  modalMode = 'import';
  document.getElementById('modal-title').textContent = 'Import Save';
  document.getElementById('modal-desc').textContent = 'Choose a file, fetch from Google Sheets, or paste JSON below.';
  document.getElementById('modal-ta').value = '';
  document.getElementById('modal-ta').readOnly = false;
  document.getElementById('modal-act').textContent = 'Import';
  document.getElementById('modal-msg').textContent = '';
  document.getElementById('modal-file-row').style.display = 'flex';
  document.getElementById('modal-file-name').textContent = 'JSON or .xlsx checklist · or paste below';
  document.getElementById('modal-file-input').value = '';
  document.getElementById('modal-sheets-row').style.display = 'flex';
  document.getElementById('modal-sheets-url').value = sessionStorage.getItem('wf-sheets-url') || '';
  document.getElementById('modal-sheets-help').style.display = 'none';
  document.getElementById('sheets-help-link').textContent = 'Setup ▸';
  document.getElementById('modal-save-file').style.display = 'none';
  document.getElementById('overlay').classList.add('open');
}

document.getElementById('modal-act').addEventListener('click', () => {
  if (modalMode === 'export') {
    navigator.clipboard.writeText(document.getElementById('modal-ta').value).then(() => {
      document.getElementById('modal-msg').textContent = 'Copied!';
    });
  } else {
    const msg = document.getElementById('modal-msg');
    const raw = document.getElementById('modal-ta').value;
    if (raw.length > 5 * 1024 * 1024) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Data too large to import (max 5 MB).';
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      saveBackupBundle();
      applySave(parsed);
      msg.style.color = 'var(--green)';
      msg.innerHTML = 'Imported! <button class="btn" style="font-size:9px;padding:2px 6px;margin-left:6px" onclick="undoImport()">Undo</button>';
    } catch {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Invalid JSON — check your data.';
    }
  }
});

async function saveProgressToFile() {
  const json = JSON.stringify(buildSave(), null, 2);
  const msg  = document.getElementById('modal-msg');
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'warframe-progress.json',
        types: [{ description: 'JSON Save File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      msg.style.color = 'var(--green)';
      msg.textContent = 'Saved!';
    } catch (e) {
      if (e.name !== 'AbortError') {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Save failed.';
      }
    }
  } else {
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'warframe-progress.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    msg.style.color = 'var(--green)';
    msg.textContent = 'Downloaded!';
  }
}

async function openImportFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Save Files', accept: { 'application/json': ['.json'], 'application/vnd.ms-excel': ['.xlsx', '.xlsm'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      document.getElementById('modal-file-name').textContent = file.name;
      handleFileSelect({ target: { files: [file] } });
    } catch (e) {
      if (e.name !== 'AbortError') {
        const msg = document.getElementById('modal-msg');
        msg.style.color = 'var(--red)';
        msg.textContent = 'Could not open file.';
      }
    }
  } else {
    document.getElementById('modal-file-input').click();
  }
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('modal-file-name').textContent = file.name;
  const isXlsx = /\.xlsx?$|\.xlsm$/i.test(file.name);
  if (isXlsx) {
    const msg = document.getElementById('modal-msg');
    if (file.size > 5 * 1024 * 1024) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'File is too large (max 5 MB). Are you sure this is the right file?';
      return;
    }
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Reading spreadsheet…';
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = convertXlsxToProgress(e.target.result);
        const count = Object.keys(parsed).length;
        saveBackupBundle();
        progress = parsed;
        saveProgress();
        updateHeader();
        render();
        msg.style.color = 'var(--green)';
        msg.innerHTML = `Imported ${count} entries from spreadsheet. <button class="btn" style="font-size:9px;padding:2px 6px;margin-left:6px" onclick="undoImport()">Undo</button>`;
      } catch (err) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Failed to parse spreadsheet: ' + err.message;
      }
    };
    reader.onerror = () => { msg.style.color = 'var(--red)'; msg.textContent = 'Could not read file.'; };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('modal-ta').value = e.target.result;
      document.getElementById('modal-msg').textContent = '';
    };
    reader.onerror = () => {
      const msg = document.getElementById('modal-msg');
      msg.style.color = 'var(--red)';
      msg.textContent = 'Could not read file.';
    };
    reader.readAsText(file);
  }
}

// ── XLSX → progress conversion ────────────────────────────────────────────────

function _xlTruthy(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
}

function _xlRows(ws, range) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, range, defval: '', blankrows: true });
}

function _xlStd(ws, range) {
  const rows = _xlRows(ws, range);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    if (!name) break;
    out.push({ name, acquired: rows[i][1], mastered: rows[i][2] });
  }
  return out;
}

function _xlDual(ws, range, hasHeader = true) {
  const rows = _xlRows(ws, range);
  const out = [];
  let i = hasHeader ? 1 : 0;
  while (i < rows.length) {
    const name = String(rows[i][0] || '').trim();
    if (!name) break;
    const m40 = (i + 1 < rows.length) ? rows[i + 1][2] : false;
    out.push({ name, acquired: rows[i][1], mastered30: rows[i][2], mastered40: m40 });
    i += 2;
  }
  return out;
}

function _xlSections(ws, range) {
  const rows = _xlRows(ws, range);
  const sections = [];
  let cur = null, inSec = false;
  for (const row of rows) {
    const name = String(row[0] || '').trim();
    if (!name) {
      if (cur && cur.length) { sections.push(cur); cur = null; }
      inSec = false;
    } else {
      if (!inSec) { inSec = true; continue; }
      if (!cur) cur = [];
      cur.push({ name, acquired: row[1], mastered: row[2] });
    }
  }
  if (cur && cur.length) sections.push(cur);
  return sections;
}

function _addStd(p, pfx, items, maxRank = 30) {
  for (const { name, acquired, mastered } of items) {
    if (_xlTruthy(mastered))       { p[pfx + name] = maxRank; p['aq:' + pfx + name] = true; }
    else if (_xlTruthy(acquired))  { p['aq:' + pfx + name] = true; }
  }
}

function _addDual(p, pfx, items) {
  for (const { name, acquired, mastered30, mastered40 } of items) {
    const rank = _xlTruthy(mastered40) ? 40 : _xlTruthy(mastered30) ? 30 : 0;
    if (rank > 0)                  { p[pfx + name] = rank; p['aq:' + pfx + name] = true; }
    else if (_xlTruthy(acquired))  { p['aq:' + pfx + name] = true; }
  }
}

function _addIntrinsics(p, ws, range) {
  const rows = _xlRows(ws, range);
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    if (!name) break;
    const lvl = Number(rows[i][1]);
    if (!isNaN(lvl) && lvl > 0) p['in:' + name] = lvl;
  }
}

function convertXlsxToProgress(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const p = {};

  // ── Main + Info ───────────────────────────────────────────────────────────
  const main = wb.Sheets['Main + Info'];
  const planets = _xlRows(main, 'B16:E36');
  for (let i = 1; i < planets.length; i++) {
    const name = String(planets[i][0] || '').trim(); if (!name) break;
    if (_xlTruthy(planets[i][2])) p['pl:' + name]  = true;
    if (_xlTruthy(planets[i][3])) p['sp:' + name]  = true;
  }
  const junctions = _xlRows(main, 'G16:I29');
  for (let i = 1; i < junctions.length; i++) {
    const name = String(junctions[i][0] || '').trim(); if (!name) break;
    if (_xlTruthy(junctions[i][1])) p['jn:' + name]  = true;
    if (_xlTruthy(junctions[i][2])) p['spj:' + name] = true;
  }
  const ovr = _xlRows(main, 'G32:J33');
  if (ovr.length >= 2) {
    const reg = Number(ovr[1][1]), sp = Number(ovr[1][3]);
    if (!isNaN(reg) && ovr[1][1] !== '') p['sc-ovr:regular'] = reg;
    if (!isNaN(sp)  && ovr[1][3] !== '') p['sc-ovr:sp']      = sp;
  }

  // ── Warframes ─────────────────────────────────────────────────────────────
  const wf = wb.Sheets['Warframe'];
  for (const sec of _xlSections(wf, 'B2:F200'))  _addStd(p, 'w:', sec);
  for (const sec of _xlSections(wf, 'H2:K200'))  _addStd(p, 'w:', sec);

  // ── Primary ───────────────────────────────────────────────────────────────
  const pw = wb.Sheets['Primary'];
  _addStd (p, 'p1:', _xlStd (pw, 'B2:E200'));
  _addStd (p, 'p1:', _xlStd (pw, 'G2:J200'));
  _addStd (p, 'p1:', _xlStd (pw, 'G25:J200'));
  _addStd (p, 'p1:', _xlStd (pw, 'G37:J200'));
  _addStd (p, 'p1:', _xlStd (pw, 'G55:J200'));
  _addStd (p, 'p1:', _xlStd (pw, 'G61:J200'));
  _addStd (p, 'p1:', _xlStd (pw, 'L2:O200'));
  _addStd (p, 'p1:', _xlStd (pw, 'L15:O200'));
  _addStd (p, 'p1:', _xlStd (pw, 'L50:O200'));
  _addDual(p, 'p1:', _xlDual(pw, 'G64:J200'));
  _addDual(p, 'p1:', _xlDual(pw, 'L56:O200'));
  _addDual(p, 'p1:', _xlDual(pw, 'L82:O200'));

  // ── Secondary ─────────────────────────────────────────────────────────────
  const sw = wb.Sheets['Secondary'];
  _addStd (p, 'p2:', _xlStd (sw, 'B2:E200'));
  _addStd (p, 'p2:', _xlStd (sw, 'G2:J200'));
  _addStd (p, 'p2:', _xlStd (sw, 'G29:J200'));
  _addStd (p, 'p2:', _xlStd (sw, 'L2:O200'));
  _addStd (p, 'p2:', _xlStd (sw, 'L33:O200'));
  _addStd (p, 'p2:', _xlStd (sw, 'L37:O200'));
  _addDual(p, 'p2:', _xlDual(sw, 'G43:J200'));
  _addDual(p, 'p2:', _xlDual(sw, 'L45:O200'));
  _addDual(p, 'p2:', _xlDual(sw, 'L58:O200'));

  // ── Melee ─────────────────────────────────────────────────────────────────
  const mw = wb.Sheets['Melee'];
  _addStd (p, 'p3:', _xlStd (mw, 'B2:E200'));
  _addStd (p, 'p3:', _xlStd (mw, 'B25:E200'));
  _addStd (p, 'p3:', _xlStd (mw, 'B42:E200'));
  _addStd (p, 'p3:', _xlStd (mw, 'B55:E200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G2:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G12:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G19:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G30:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G42:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G50:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G56:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G62:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'G65:J200'));
  _addStd (p, 'p3:', _xlStd (mw, 'L2:O200'));
  _addStd (p, 'p3:', _xlStd (mw, 'L22:O200'));
  _addStd (p, 'p3:', _xlStd (mw, 'L36:O200'));
  _addStd (p, 'p3:', _xlStd (mw, 'L47:O200'));
  _addStd (p, 'p3:', _xlStd (mw, 'L59:O200'));
  _addStd (p, 'p3:', _xlStd (mw, 'Q2:T200'));
  _addStd (p, 'p3:', _xlStd (mw, 'Q10:T200'));
  _addStd (p, 'p3:', _xlStd (mw, 'Q24:T200'));
  _addStd (p, 'p3:', _xlStd (mw, 'Q28:T200'));
  _addStd (p, 'p3:', _xlStd (mw, 'Q33:T200'));
  _addDual(p, 'p3:', _xlDual(mw, 'L63:O200'));
  _addDual(p, 'p3:', _xlDual(mw, 'Q74:T200'));
  _addDual(p, 'p3:', _xlDual(mw, 'Q80:T200'));

  // ── Companion ─────────────────────────────────────────────────────────────
  const cp = wb.Sheets['Companion'];
  _addStd(p, 'c:',  _xlStd(cp, 'B2:E13'));
  _addStd(p, 'c:',  _xlStd(cp, 'B35:E41'));
  _addStd(p, 'c:',  _xlStd(cp, 'G2:J8'));
  _addStd(p, 'c:',  _xlStd(cp, 'G10:J15'));
  _addStd(p, 'c:',  _xlStd(cp, 'G17:J21'));
  _addStd(p, 'c:',  _xlStd(cp, 'G22:J26'));
  _addStd(p, 'c:',  _xlStd(cp, 'G28:J31'));
  _addStd(p, 'c:',  _xlStd(cp, 'G33:J36'));
  _addStd(p, 'cw:', _xlStd(cp, 'B15:E33'));
  _addStd(p, 'cw:', _xlStd(cp, 'B43:E49'));

  // ── Vehicle ───────────────────────────────────────────────────────────────
  const veh = wb.Sheets['Vehicle'];
  _addStd (p, 'v:',  _xlStd (veh, 'B2:E6'));
  _addStd (p, 'v:',  _xlStd (veh, 'B45:E50'));
  _addDual(p, 'v:',  _xlDual(veh, 'B52:E200'));
  // Prime B8:E11 — rows 1-2 = arch weapons, row 3 = archwing
  const prime = _xlRows(veh, 'B8:E11');
  for (const row of [prime[1], prime[2]]) {
    const name = row && String(row[0] || '').trim();
    if (!name) continue;
    if (_xlTruthy(row[2]))       { p['aw:' + name] = 30; p['aq:aw:' + name] = true; }
    else if (_xlTruthy(row[1]))  { p['aq:aw:' + name] = true; }
  }
  const arow = prime[3];
  if (arow) {
    const name = String(arow[0] || '').trim();
    if (name) {
      if (_xlTruthy(arow[2]))       { p['v:' + name] = 30; p['aq:v:' + name] = true; }
      else if (_xlTruthy(arow[1]))  { p['aq:v:' + name] = true; }
    }
  }
  _addStd (p, 'aw:', _xlStd (veh, 'B13:E29'));
  _addDual(p, 'aw:', _xlDual(veh, 'B30:E33', false));
  _addStd (p, 'aw:', _xlStd (veh, 'B35:E200'));
  // Plexus G22:H22 — no acquired col; mastered as proxy
  const plexus = _xlRows(veh, 'G22:H22');
  if (plexus.length && plexus[0]) {
    const name = String(plexus[0][0] || '').trim();
    if (name && _xlTruthy(plexus[0][1])) { p['v:' + name] = 30; p['aq:v:' + name] = true; }
  }
  _addIntrinsics(p, veh, 'G24:J29');

  // ── AmpDrifter ────────────────────────────────────────────────────────────
  const amp = wb.Sheets['AmpDrifter'];
  _addStd(p, 'am:', _xlStd(amp, 'B2:E200'));
  _addIntrinsics(p, amp, 'H9:I13');

  return p;
}

function undoImport() {
  try {
    const raw = localStorage.getItem(LS_KEY + '-backup');
    if (!raw) throw new Error('no backup');
    applySave(JSON.parse(raw));
    const msg = document.getElementById('modal-msg');
    msg.style.color = 'var(--green)';
    msg.textContent = 'Previous save restored.';
    setTimeout(closeModal, 1500);
  } catch {
    const msg = document.getElementById('modal-msg');
    msg.style.color = 'var(--red)';
    msg.textContent = 'Restore failed — backup may be missing.';
  }
}

function toggleSheetsHelp(e) {
  e.preventDefault();
  const h = document.getElementById('modal-sheets-help');
  const open = h.style.display !== 'none';
  h.style.display = open ? 'none' : 'block';
  document.getElementById('sheets-help-link').textContent = open ? 'Setup ▸' : 'Setup ▴';
}

function testSheetsUrl() {
  const rawUrl = document.getElementById('modal-sheets-url').value.trim();
  if (!rawUrl) { alert('Paste the Apps Script URL first.'); return; }
  try {
    if (new URL(rawUrl).hostname !== 'script.google.com') throw new Error();
  } catch {
    alert('URL must be a Google Apps Script URL (script.google.com).');
    return;
  }
  window.open(rawUrl.split('?')[0] + '?callback=test', '_blank');
}

function fetchFromSheets() {
  const rawUrl = document.getElementById('modal-sheets-url').value.trim();
  const msg    = document.getElementById('modal-msg');
  if (!rawUrl) { msg.style.color = 'var(--red)'; msg.textContent = 'Paste the Apps Script URL above first.'; return; }
  try {
    if (new URL(rawUrl).hostname !== 'script.google.com') throw new Error();
  } catch {
    msg.style.color = 'var(--red)';
    msg.textContent = 'URL must be a Google Apps Script URL (script.google.com).';
    return;
  }
  sessionStorage.setItem('wf-sheets-url', rawUrl);
  msg.style.color = 'var(--text-muted)';
  msg.textContent = 'Fetching from Google Sheets…';

  // JSONP: a <script> tag bypasses CORS restrictions on Apps Script URLs.
  const cbName = '_wfSheets_' + crypto.randomUUID().replace(/-/g, '');
  let script;

  const cleanup = () => {
    delete window[cbName];
    if (script && script.parentNode) script.parentNode.removeChild(script);
  };

  const timer = setTimeout(() => {
    cleanup();
    msg.style.color = 'var(--red)';
    msg.textContent = 'Timed out. Script loaded but returned no data — re-deploy the Apps Script as a new version after adding the JSONP code.';
  }, 30000);

  window[cbName] = parsed => {
    clearTimeout(timer);
    cleanup();
    if (parsed && parsed.error) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Script error: ' + parsed.error;
      return;
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Invalid data received from Sheets — expected a JSON object.';
      return;
    }
    for (const v of Object.values(parsed)) {
      if (typeof v !== 'number' && typeof v !== 'boolean') {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Unexpected value type in Sheets data — import aborted.';
        return;
      }
    }
    const sanitized = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      sanitized[k] = v;
    }
    const count = Object.keys(sanitized).length;
    saveBackupBundle();
    progress = sanitized;
    saveProgress(); updateHeader(); render();
    msg.style.color = 'var(--green)';
    msg.innerHTML = 'Imported ' + count + ' entries from Google Sheets. <button class="btn" style="font-size:9px;padding:2px 6px;margin-left:6px" onclick="undoImport()">Undo</button>';
  };

  script = document.createElement('script');
  script.onerror = () => {
    clearTimeout(timer);
    cleanup();
    msg.style.color = 'var(--red)';
    msg.textContent = 'Script URL failed to load. Most likely cause: deployment access is set to "Anyone with Google account" instead of "Anyone". Create a new deployment with access set to Anyone (no qualifier), then use the new URL.';
  };
  script.src = rawUrl.split('?')[0] + '?callback=' + cbName;
  document.head.appendChild(script);
}

function closeModal() { document.getElementById('overlay').classList.remove('open'); }
function overlayClick(e) { if (e.target === document.getElementById('overlay')) closeModal(); }

// ─────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────
function askReset() { document.getElementById('confirm-overlay').classList.add('open'); }
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); }
function confirmOverlayClick(e) { if (e.target === document.getElementById('confirm-overlay')) closeConfirm(); }
function doReset() {
  progress = {};
  saveProgress();
  updateHeader();
  render();
  closeConfirm();
}

// ─────────────────────────────────────────────
// CUSTOM ITEMS
// ─────────────────────────────────────────────
const CUSTOM_LS_KEY = 'wf-custom-items-v1';
let customItems = [];

const ADD_TABS = [
  ['warframes','Warframes'],['primary','Primary Weapons'],['secondary','Secondary Weapons'],
  ['melee','Melee Weapons'],['vehicles','Vehicles'],['companions','Companions'],
  ['compWeapons','Companion Weapons'],['archWeapons','Arch Weapons'],
  ['amps','Amps'],['intrinsics','Intrinsics'],
];

function loadCustomItems() {
  try { customItems = JSON.parse(localStorage.getItem(CUSTOM_LS_KEY) || '[]'); }
  catch { customItems = []; }
  for (const it of customItems) _mergeCustomItem(it);
}

function _mergeCustomItem(it) {
  const arr = TAB_DATA[it.tab];
  if (!arr) return;
  if (arr.find(i => i[0] === it.name)) return;
  arr.push([it.name, it.cat, it.obtain, it.maxRank, it.tradable ? 1 : 0, it.compFor || undefined, true]);
}

function saveCustomItems() {
  localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(customItems));
  deferCloudSync();
}

function openAddModal() {
  const sel = document.getElementById('add-tab');
  sel.innerHTML = ADD_TABS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  if (TAB_DATA[activeTab]) sel.value = activeTab;
  updateAddTabDefaults();
  document.getElementById('add-name').value = '';
  document.getElementById('add-obtain').value = '';
  document.getElementById('add-compfor').value = '';
  document.getElementById('add-tradable').checked = false;
  document.getElementById('add-msg').textContent = '';
  document.getElementById('add-msg').style.color = '';
  renderCustomItemsList();
  document.getElementById('add-overlay').classList.add('open');
}

function closeAddModal() { document.getElementById('add-overlay').classList.remove('open'); }
function addOverlayClick(e) { if (e.target === document.getElementById('add-overlay')) closeAddModal(); }

function updateAddTabDefaults() {
  const tab = document.getElementById('add-tab').value;
  const rkSel = document.getElementById('add-maxrank');
  if (tab === 'intrinsics') { rkSel.value = '10'; }
  else { rkSel.value = '30'; }
  const cats = TAB_DATA[tab] ? [...new Set(TAB_DATA[tab].map(i => i[1]))] : [];
  document.getElementById('add-cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  document.getElementById('add-cat').value = '';
}

function submitAddItem() {
  const tab      = document.getElementById('add-tab').value;
  const name     = document.getElementById('add-name').value.trim();
  const cat      = document.getElementById('add-cat').value.trim();
  const obtain   = document.getElementById('add-obtain').value.trim();
  const maxRank  = parseInt(document.getElementById('add-maxrank').value);
  const tradable = document.getElementById('add-tradable').checked;
  const compFor  = document.getElementById('add-compfor').value.trim();
  const msg = document.getElementById('add-msg');
  if (!name) { msg.style.color = 'var(--red)'; msg.textContent = 'Name is required.'; return; }
  if (!cat)  { msg.style.color = 'var(--red)'; msg.textContent = 'Category is required.'; return; }
  if (TAB_DATA[tab] && TAB_DATA[tab].find(i => i[0] === name)) {
    msg.style.color = 'var(--red)';
    msg.textContent = `"${name}" already exists in this tab.`;
    return;
  }
  const it = { tab, name, cat, obtain, maxRank, tradable, compFor };
  customItems.push(it);
  _mergeCustomItem(it);
  delete searchIndex[it.tab];
  saveCustomItems();
  msg.style.color = 'var(--green)';
  msg.textContent = `"${name}" added.`;
  document.getElementById('add-name').value = '';
  document.getElementById('add-obtain').value = '';
  document.getElementById('add-compfor').value = '';
  document.getElementById('add-tradable').checked = false;
  renderCustomItemsList();
  updateHeader();
  if (activeTab === tab) render();
}

function deleteCustomItem(index) {
  const it = customItems[index];
  const arr = TAB_DATA[it.tab];
  if (arr) {
    const i = arr.findIndex(row => row[0] === it.name && row[7] === true);
    if (i !== -1) arr.splice(i, 1);
  }
  delete searchIndex[it.tab];
  customItems.splice(index, 1);
  saveCustomItems();
  renderCustomItemsList();
  updateHeader();
  render();
}

function renderCustomItemsList() {
  const el = document.getElementById('custom-items-list');
  if (customItems.length === 0) {
    el.innerHTML = '<div style="font-size:10px;color:var(--text-muted);padding:6px 0">No custom items added yet.</div>';
    return;
  }
  el.innerHTML = customItems.map((it, i) => {
    const tabLabel = ADD_TABS.find(([v]) => v === it.tab)?.[1] || it.tab;
    return `<div class="custom-item-row">
  <div class="custom-item-name">${esc(it.name)}</div>
  <div class="custom-item-meta">${esc(tabLabel)} · ${esc(it.cat)}</div>
  <button class="qbtn zr" onclick="deleteCustomItem(${i})" title="Remove">✕</button>
</div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// AUTO-BACKUP  (File System Access API + IndexedDB)
// ─────────────────────────────────────────────
let backupHandle = null;
let _idb = null;

async function getIDB() {
  if (_idb) return _idb;
  return new Promise((res, rej) => {
    const r = indexedDB.open('wf-tracker', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    r.onsuccess = e => { _idb = e.target.result; res(_idb); };
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await getIDB();
    return new Promise(res => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function idbSet(key, val) {
  try {
    const db = await getIDB();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
  } catch {}
}

async function writeBackup() {
  if (!backupHandle) return;
  try {
    if (await backupHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      await backupHandle.requestPermission({ mode: 'readwrite' });
    }
    const w = await backupHandle.createWritable();
    await w.write(JSON.stringify(buildSave(), null, 2));
    await w.close();
  } catch (e) {
    console.warn('[WF Tracker] Auto-backup write failed:', e.message);
  }
}

async function setBackupFile() {
  if (!window.showSaveFilePicker) {
    alert('Auto-backup requires Chrome or Edge — the File System Access API is not available in this browser.');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'warframe-save.json',
      types: [{ description: 'JSON Save', accept: { 'application/json': ['.json'] } }],
    });
    backupHandle = handle;
    await idbSet('backupHandle', handle);
    await writeBackup();
    updateBackupBtn();
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[WF Tracker] setBackupFile:', e);
  }
}

function updateBackupBtn() {
  const btn = document.getElementById('btn-backup');
  if (!btn) return;
  if (backupHandle) {
    btn.textContent = backupHandle.name;
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'rgba(74,150,96,0.6)';
  } else {
    btn.textContent = 'Auto-backup';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

// Restore handle from IndexedDB on load
(async () => {
  if (!window.showSaveFilePicker) return;
  const handle = await idbGet('backupHandle');
  if (handle) { backupHandle = handle; updateBackupBtn(); }
})();

// ─────────────────────────────────────────────
// AUTH & CLOUD SYNC
// ─────────────────────────────────────────────

async function initAuth() {
  if (!_sb) return;

  // Register BEFORE getSession so SIGNED_IN from OAuth redirect is never missed
  _sb.auth.onAuthStateChange((_event, session) => {
    const wasSignedIn = !!currentUser;
    currentUser = session?.user ?? null;
    updateAuthUI();
    // Only trigger cloud load on an actual new sign-in, not token refreshes
    if (currentUser && !wasSignedIn) loadFromCloud();
  });

  // Handle already-active session (page refresh while logged in)
  const { data: { session } } = await _sb.auth.getSession();
  if (session?.user && !currentUser) {
    currentUser = session.user;
    updateAuthUI();
    await loadFromCloud();
  }
}

async function login() {
  if (!_sb) { alert('Cloud sync is not configured — fill in config.js to enable sign-in.'); return; }
  await _sb.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

async function logout() {
  if (!_sb) return;
  await _sb.auth.signOut();
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(CL_KEY);
  localStorage.removeItem(CL_OWN_KEY);
  localStorage.removeItem(CL_BP_KEY);
  localStorage.removeItem(CUSTOM_LS_KEY);
  localStorage.removeItem('wf-cloud-ts');
  progress = {};
  customItems = [];
  loadChecklist();
  updateAuthUI();
  updateHeader();
  render();
}

async function loadFromCloud() {
  if (!currentUser) return;
  try {
    const { data, error } = await _sb
      .from('saves')
      .select('progress, checklist, ui_prefs, custom_items, modular_builds, updated_at')
      .eq('user_id', currentUser.id)
      .single();

    if (error) { console.warn('[WF Tracker] loadFromCloud query error:', error.code, error.message); return; }
    if (!data)  { console.warn('[WF Tracker] loadFromCloud: no saved data found for user', currentUser?.id); return; }

    const localTs = parseInt(localStorage.getItem('wf-cloud-ts') || '0', 10);
    const cloudTs = new Date(data.updated_at).getTime();
    if (cloudTs <= localTs) return;

    progress = data.progress ?? {};
    localStorage.setItem(LS_KEY, JSON.stringify(progress));

    if (data.checklist) {
      checklistItems = new Set(data.checklist.items ?? []);
      checklistOwned  = data.checklist.owned ?? {};
      clBpOwned       = new Set(data.checklist.bpOwned ?? []);
      localStorage.setItem(CL_KEY,     JSON.stringify([...checklistItems]));
      localStorage.setItem(CL_OWN_KEY, JSON.stringify(checklistOwned));
      localStorage.setItem(CL_BP_KEY,  JSON.stringify([...clBpOwned]));
    }

    if (Array.isArray(data.custom_items)) {
      customItems = data.custom_items.filter(it => it && typeof it.name === 'string' && it.name.trim());
      localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(customItems));
      for (const it of customItems) _mergeCustomItem(it);
    }

    if (data.modular_builds) {
      if (Array.isArray(data.modular_builds.builds)) {
        modularBuilds = data.modular_builds.builds.filter(b => b && typeof b.id === 'string');
        localStorage.setItem(MOD_BUILDS_KEY, JSON.stringify(modularBuilds));
      }
      if (data.modular_builds.owned && typeof data.modular_builds.owned === 'object') {
        modularOwned = data.modular_builds.owned;
        localStorage.setItem(MOD_OWNED_KEY, JSON.stringify(modularOwned));
      }
    }

    if (data.ui_prefs) {
      for (const [k, v] of Object.entries(data.ui_prefs)) {
        if (k.startsWith('wf-ui-') || k.startsWith('wf-filt-')) localStorage.setItem(k, v);
      }
    }

    localStorage.setItem('wf-cloud-ts', String(cloudTs));
    updateHeader();
    render();
  } catch (e) {
    console.warn('[WF Tracker] loadFromCloud failed:', e.message);
  }
}

function deferCloudSync() {
  if (!_sb || !currentUser) return;
  clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = setTimeout(syncToCloud, 4000);
}

async function syncToCloud() {
  if (!_sb || !currentUser) return;
  try {
    const ui_prefs = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('wf-ui-') || k.startsWith('wf-filt-'))) {
        ui_prefs[k] = localStorage.getItem(k);
      }
    }

    const { error } = await _sb.from('saves').upsert({
      user_id:      currentUser.id,
      progress,
      checklist: {
        items:   [...checklistItems],
        owned:   checklistOwned,
        bpOwned: [...clBpOwned],
      },
      ui_prefs,
      custom_items: customItems,
      modular_builds: { builds: modularBuilds, owned: modularOwned },
      updated_at:   new Date().toISOString(),
    });

    if (!error) localStorage.setItem('wf-cloud-ts', String(Date.now()));
  } catch (e) {
    console.warn('[WF Tracker] syncToCloud failed:', e.message);
  }
}

function updateAuthUI() {
  const btn = document.getElementById('btn-auth');
  if (!btn) return;
  if (currentUser) {
    const name = currentUser.user_metadata?.full_name
               ?? currentUser.user_metadata?.name
               ?? currentUser.email
               ?? 'Signed in';
    btn.textContent = `${name} · Sign out`;
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'rgba(74,150,96,0.6)';
  } else {
    btn.textContent = 'Sign in';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

// ─────────────────────────────────────────────
// DUCAT CALCULATOR
// ─────────────────────────────────────────────
const DUCAT_VALUES  = [15, 45, 100]; // 0=Common, 1=Uncommon, 2=Rare
const DUCAT_EXCLUDE = new Set(['Forma', 'Exilus Weapon Adapter', 'Kavasa Prime']);
// Parts whose ducat value differs from what their minimum drop rarity would imply
const DUCAT_EXCEPTIONS = new Map([
  ['Akstiletto Prime\tReceiver',         45],
  ['Braton Prime\tReceiver',             45],
  ['Bronco Prime\tBarrel',               45],
  ['Fang Prime\tBlueprint',              15],
  ['Gauss Prime\tBlueprint',             25],
  ['Khora Prime\tBlueprint',             65],
  ['Knell Prime\tReceiver',              45],
  ['Limbo Prime\tNeuroptics Blueprint', 100],
  ['Mesa Prime\tSystems Blueprint',     100],
  ['Panthera Prime\tReceiver',          100],
  ['Rubico Prime\tStock',                45],
  ['Saryn Prime\tNeuroptics Blueprint',  45],
  ['Soma Prime\tBlueprint',              15],
]);

function ducatKey(item, part) { return 'duc:' + item + '\t' + part; }
function getDucatQty(item, part) { return progress[ducatKey(item, part)] || 0; }

function _ducatPartRarity(drops) {
  let min = 2;
  for (const drop of drops) { if (drop[1] < min) min = drop[1]; }
  return min;
}

function _ducatPartValue(item, part, drops) {
  const ex = DUCAT_EXCEPTIONS.get(item + '\t' + part);
  return ex !== undefined ? ex : DUCAT_VALUES[_ducatPartRarity(drops)];
}

function _ducatGrandTotal() {
  let total = 0;
  for (const [k, v] of Object.entries(progress)) {
    if (!k.startsWith('duc:') || typeof v !== 'number' || v <= 0) continue;
    const sep = k.indexOf('\t');
    if (sep < 0) continue;
    const item = k.slice(4, sep);
    const part = k.slice(sep + 1);
    if (DUCAT_EXCLUDE.has(item)) continue;
    const entry = typeof RELIC_DROPS !== 'undefined' ? RELIC_DROPS.get(item) : null;
    if (!entry) continue;
    const drops = entry[1][part];
    if (!drops) continue;
    total += v * _ducatPartValue(item, part, drops);
  }
  return total;
}

let _ducatCatMap = null;
function _getDucatCategoryMap() {
  if (_ducatCatMap) return _ducatCatMap;
  _ducatCatMap = new Map();
  if (typeof TAB_DATA === 'undefined') return _ducatCatMap;
  const TABS = [
    ['warframes',   'Warframes'],
    ['primary',     'Primary'],
    ['secondary',   'Secondary'],
    ['melee',       'Melee'],
    ['companions',  'Companions'],
    ['compWeapons', 'Companion Weapons'],
    ['archWeapons', 'Arch-Weapons'],
    ['vehicles',    'Vehicles'],
    ['amps',        'Amps'],
  ];
  for (const [tabKey, label] of TABS) {
    const arr = TAB_DATA[tabKey];
    if (!arr) continue;
    for (const item of arr) {
      const name = item[0];
      const key = name.endsWith(' Prime') ? name : name + ' Prime';
      if (!_ducatCatMap.has(key)) _ducatCatMap.set(key, label);
    }
  }
  return _ducatCatMap;
}

const DUCAT_CAT_ORDER = ['Warframes', 'Primary', 'Secondary', 'Melee', 'Companions', 'Companion Weapons', 'Arch-Weapons', 'Vehicles', 'Amps', 'Other'];

function _ducatAvailableCategories() {
  if (typeof RELIC_DROPS === 'undefined') return [];
  const catMap = _getDucatCategoryMap();
  const seen = new Set();
  for (const [itemName] of RELIC_DROPS) {
    if (!DUCAT_EXCLUDE.has(itemName)) seen.add(catMap.get(itemName) || 'Other');
  }
  return DUCAT_CAT_ORDER.filter(c => seen.has(c));
}

function buildDucatSets(searchTerm) {
  if (typeof RELIC_DROPS === 'undefined') return [];
  const catMap = _getDucatCategoryMap();
  const q = (searchTerm || '').toLowerCase();
  const sets = [];
  for (const [itemName, entry] of RELIC_DROPS) {
    if (DUCAT_EXCLUDE.has(itemName)) continue;
    if (q && !itemName.toLowerCase().includes(q)) continue;
    const cat = catMap.get(itemName) || 'Other';
    if (activeCategory && cat !== activeCategory) continue;
    const partsObj = entry[1];
    const parts = [];
    for (const [partName, drops] of Object.entries(partsObj)) {
      const rarity = _ducatPartRarity(drops);
      parts.push({ name: partName, rarity, value: _ducatPartValue(itemName, partName, drops) });
    }
    parts.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
    sets.push({ name: itemName, vaulted: entry[0] === 1, parts, category: cat });
  }
  sets.sort((a, b) => a.name.localeCompare(b.name));
  return sets;
}

function ducatInput(el) {
  const row   = el.closest('.dc-part-row');
  const setEl = el.closest('.dc-set');
  const qty   = Math.max(0, parseInt(el.value) || 0);
  el.value    = qty;
  const item  = row.dataset.item;
  const part  = row.dataset.part;
  const value = parseInt(row.dataset.value);
  const k = ducatKey(item, part);
  if (qty > 0) progress[k] = qty; else delete progress[k];
  deferSave();
  const partDucats = qty * value;
  row.querySelector('.dc-part-total').textContent = partDucats > 0 ? fmt(partDucats) : '—';
  let setTotal = 0;
  for (const r of setEl.querySelectorAll('.dc-part-row')) {
    setTotal += (parseInt(r.querySelector('.dc-qty').value) || 0) * parseInt(r.dataset.value);
  }
  setEl.querySelector('.dc-set-sub').textContent = setTotal > 0 ? fmt(setTotal) + ' D' : '—';
  const totalEl = document.getElementById('dc-total-val');
  if (totalEl) totalEl.textContent = fmt(_ducatGrandTotal());
}

function ducatAcqAdd(el) {
  const item = el.dataset.item;
  const part = el.dataset.part;
  const k = ducatKey(item, part);
  if ((progress[k] || 0) > 0) return;
  progress[k] = 1;
  deferSave();
  if (!el.nextElementSibling?.classList.contains('recipe-acq-badge')) {
    const badge = document.createElement('span');
    badge.className = 'recipe-acq-badge';
    badge.textContent = 'Acq';
    el.insertAdjacentElement('afterend', badge);
  }
  if (activeTab === 'ducats') {
    const view = document.getElementById('ducats-view');
    if (view) {
      for (const row of view.querySelectorAll('.dc-part-row')) {
        if (row.dataset.item === item && row.dataset.part === part) {
          const inp = row.querySelector('.dc-qty');
          if (inp) { inp.value = '1'; ducatInput(inp); }
          break;
        }
      }
    }
  }
}

function _checkDucatAcquiredPrompt(itemName) {
  if (typeof RELIC_DROPS === 'undefined') return;
  const entry = RELIC_DROPS.get(itemName);
  if (!entry) return;
  const affected = [];
  for (const partName of Object.keys(entry[1])) {
    const qty = getDucatQty(itemName, partName);
    if (qty > 0) affected.push({ partName, qty });
  }
  if (affected.length === 0) return;
  const lines = affected.map(a => `  • ${a.partName}: ${a.qty} → ${Math.max(0, a.qty - 1)}`).join('\n');
  if (!confirm(`"${itemName}" marked as acquired.\n\nSubtract 1 from these Ducat trade-in entries?\n\n${lines}`)) return;
  for (const { partName } of affected) {
    const k = ducatKey(itemName, partName);
    const cur = progress[k] || 0;
    if (cur <= 1) delete progress[k]; else progress[k] = cur - 1;
  }
  saveProgress();
  render();
}

function _hasAnyDucatParts(name) {
  if (typeof RELIC_DROPS === 'undefined') return false;
  const entry = RELIC_DROPS.get(name);
  if (!entry) return false;
  for (const partName of Object.keys(entry[1])) {
    if (getDucatQty(name, partName) > 0) return true;
  }
  return false;
}

function clearDucats() {
  for (const k of Object.keys(progress)) {
    if (k.startsWith('duc:')) delete progress[k];
  }
  saveProgress();
  renderDucats();
}

function renderDucats() {
  const view = document.getElementById('ducats-view');
  if (!view) return;
  const searchTerm = document.getElementById('search')?.value || '';
  const sets = buildDucatSets(searchTerm);
  const grand = _ducatGrandTotal();
  const R_CLS = ['dc-rarity-0', 'dc-rarity-1', 'dc-rarity-2'];

  let html = `<div class="dc-hdr">
  <span class="dc-total-label">Total Ducats</span>
  <span id="dc-total-val" class="dc-total-val">${fmt(grand)}</span>
  <button class="btn" style="margin-left:auto;font-size:10px;padding:3px 9px;color:var(--red)" onclick="clearDucats()">Clear All</button>
</div>`;

  if (sets.length === 0) {
    html += '<div class="empty">No prime sets match your search.</div>';
    view.innerHTML = html;
    return;
  }

  const byCategory = new Map();
  for (const set of sets) {
    if (!byCategory.has(set.category)) byCategory.set(set.category, []);
    byCategory.get(set.category).push(set);
  }

  for (const cat of DUCAT_CAT_ORDER) {
    const catSets = byCategory.get(cat);
    if (!catSets || catSets.length === 0) continue;
    const collapsed = collapsedGroups.has('ducats:' + cat);
    html += `<div class="dc-section"><div class="dc-section-hdr" onclick="toggleGroupCollapse('ducats','${jsStr(cat)}')"><span class="sc-group-title"><span class="grp-arrow">${collapsed ? '▶' : '▼'}</span>${esc(cat)}</span></div>`;
    if (!collapsed) {
      html += '<div class="dc-grid">';
      for (const set of catSets) {
        let setTotal = 0;
        let partsHtml = '';
        for (const part of set.parts) {
          const qty = getDucatQty(set.name, part.name);
          const partDucats = qty * part.value;
          setTotal += partDucats;
          partsHtml += `<div class="dc-part-row" data-item="${esc(set.name)}" data-part="${esc(part.name)}" data-value="${part.value}">
  <span class="dc-part-name">${esc(part.name)}</span>
  <span class="dc-rarity ${R_CLS[part.rarity]}">${part.value}D</span>
  <input class="dc-qty" type="number" min="0" max="999" value="${qty}" oninput="ducatInput(this)">
  <span class="dc-part-total">${partDucats > 0 ? fmt(partDucats) : '—'}</span>
</div>`;
        }
        html += `<div class="dc-set">
  <div class="dc-set-hdr">
    <span class="dc-set-name"><a href="${esc(wikiUrl(set.name))}" target="_blank" rel="noopener">${esc(set.name)}</a></span>
    ${set.vaulted ? '<span class="dc-vaulted-tag">Vaulted</span>' : ''}
    <a class="card-tradable" href="${esc(marketUrl(set.name))}" target="_blank" rel="noopener">Market</a>
    <span class="dc-set-sub">${setTotal > 0 ? fmt(setTotal) + ' D' : '—'}</span>
  </div>
  ${partsHtml}
</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  view.innerHTML = html;
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
loadProgress();
loadCustomItems();
loadChecklist();
loadModularBuilds();
initAuth();
const _savedTab = localStorage.getItem('wf-ui-tab');
if (_savedTab && document.querySelector(`.tab[data-tab="${_savedTab}"]`)) {
  activeTab = _savedTab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === _savedTab));
}
// Display setup runs unconditionally — fixes blank screen on first-ever load (no localStorage)
{
  const _isChart   = activeTab === 'starChart';
  const _isSummary = activeTab === 'summary';
  const _isMods    = activeTab === 'mods';
  const _isCl      = activeTab === 'checklist';
  const _isDucats  = activeTab === 'ducats';
  const _isKitgun  = activeTab === 'kitgunBuilder';
  const _isSpecial = _isChart || _isSummary || _isCl || _isDucats || _isKitgun;
  document.getElementById('summary').classList.toggle('open', _isSummary);
  document.getElementById('checklist-view').style.display = _isCl     ? 'block' : 'none';
  document.getElementById('ducats-view').style.display    = _isDucats  ? 'block' : 'none';
  document.getElementById('kitgun-view').style.display    = _isKitgun  ? 'block' : 'none';
  document.getElementById('grid').style.display     = _isSpecial ? 'none' : 'grid';
  document.getElementById('sc').style.display       = _isChart   ? 'block' : 'none';
  document.getElementById('bulk-bar').style.display = _isSpecial ? 'none' : 'flex';
  document.getElementById('cat-btns').style.display = (_isSpecial && !_isDucats) ? 'none' : '';
  document.getElementById('search').style.display   = (_isCl || _isKitgun) ? 'none' : '';
  document.getElementById('status-dd').style.display = _isSpecial ? 'none' : '';
  const _isIncarnon = ['primary','secondary','melee'].includes(activeTab);
  document.getElementById('fb-incarnon').style.display = _isIncarnon ? '' : 'none';
  const _isAqTab = AQ_TABS.has(activeTab);
  const _hpBtn = document.getElementById('fb-hasparts');
  _hpBtn.style.display = _isAqTab ? '' : 'none';
  _hpBtn.classList.toggle('on', false);
  const _cwInd2 = document.getElementById('circuit-week-ind');
  _cwInd2.textContent = 'Circuit: Week ' + CIRCUIT_WEEK_NOW;
  _cwInd2.style.display = _isIncarnon ? '' : 'none';
  const _cwWfInd2 = document.getElementById('circuit-wf-week-ind');
  _cwWfInd2.textContent = 'Circuit: Week ' + CIRCUIT_WF_WEEK_NOW;
  _cwWfInd2.style.display = activeTab === 'warframes' ? '' : 'none';
  document.getElementById('fb-conclave').style.display = _isMods ? '' : 'none';
  document.getElementById('fb-flawed').style.display   = _isMods ? '' : 'none';
  const _wfTileBtn = document.getElementById('fb-wftile');
  const _wfBgBtn   = document.getElementById('fb-wfbg');
  _wfTileBtn.style.display = CARD_IMAGE_TABS.has(activeTab) ? '' : 'none';
  _wfBgBtn.style.display   = activeTab === 'intrinsics' ? '' : 'none';
  _wfTileBtn.classList.toggle('on', wfTileImages);
  _wfBgBtn.classList.toggle('on', wfBgImages);
  const _hasAnyFilter = !(_isSpecial && !_isDucats);
  const __btnF = document.getElementById('btn-filters');
  const __ctrlF = document.getElementById('ctrl-filters');
  if(__btnF) __btnF.style.display = _hasAnyFilter ? '' : 'none';
  if(__ctrlF) {
    if(!_hasAnyFilter) {
      __ctrlF.style.display = 'none';
    } else {
      const _panelOpen = localStorage.getItem('filtersOpen-' + activeTab) === '1';
      __ctrlF.classList.toggle('open', _panelOpen);
      __ctrlF.style.display = '';
      if(__btnF) __btnF.textContent = _panelOpen ? 'Filters ▴' : 'Filters ▾';
    }
  }
}
restoreViewPrefs();
restoreStatus();
restoreFilters();
populateCatFilter();
updateHeader();
updateTabStat();
render();
if(typeof updateStickyOffset === 'function') requestAnimationFrame(updateStickyOffset);