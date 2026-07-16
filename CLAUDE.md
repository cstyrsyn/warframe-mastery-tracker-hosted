# WF_TRACK_V3 — Codebase Guide

Warframe mastery tracker, hosted version with Supabase cloud sync.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main HTML — all CSS inline, loads external scripts |
| `app.js` | All UI logic (~4950 lines) |
| `data/data-meta.js` | `MASTERY` rank table (~57 lines) |
| `data/data-items.js` | All item arrays (warframes/weapons/etc.), circuit schedules, star chart, `TAB_DATA`, `PFX` (~968 lines) |
| `data/data-blueprints.js` | `CURRENCIES`, `BLUEPRINTS` (~1353 lines) |
| `data/data-incarnons.js` | `INCARNON_WEAPONS`, `INCARNON_REQUIREMENTS`, `INCARNON_EVOLUTIONS` (~194 lines) |
| `data/data-mods.js` | `MODS`, `MOD_DESC` (~3015 lines) |
| `data/data-arcanes.js` | `ARCANE_RANK_COPIES`, `ARCANES`, `ARCANE_DESC` (~338 lines) |
| `data/data-kitguns.js` | `KITGUN_*`, `ZAW_*` component maps (~102 lines) |
| `data/data-overframe.js` | `OF_POLARITY`, `OVERFRAME_MAP`, `DEFAULT_POLARITIES` (~1264 lines) |
| `data/data-overframe-mods.js` | `OVERFRAME_MODS`, `OVERFRAME_MOD_CATS` (~3022 lines) |
| `data.js` | **Original monolith — kept as reference, not loaded by index.html** |
| `relics.js` | Relic drop data |
| `weapon-mr.js` | Extra weapon MR data |
| `build.js` | Build/bundle script |
| `config.js` | Supabase credentials — **gitignored**, see `config.example.js` |
| `config.example.js` | Template for config.js |
| `dev/` | Scraper scripts, data generators, Overframe proxy server |

All of `index.html` and `app.js` are tracked. Edit them directly.

## V3-Specific Additions (vs V2)

- **Supabase** cloud sync: `_sb` (client), `currentUser`, `_cloudSyncTimer`
- `deferCloudSync()` — debounces push to Supabase after local changes
- **Overframe API** proxy: `OF_API` — local dev uses `dev/overframe_proxy.js` on port 3001; production uses CF Pages `/of-proxy/`
- Second init block at the bottom of `app.js` that mirrors `switchTab()` DOM visibility for initial page load (see ⚠ Dual Init Block below)
- `config.js` / `config.example.js` — Supabase credentials pattern
- **Auto-backup**: `setBackupFile()` / `writeBackup()` — saves a JSON backup to a user-chosen file handle on every `saveProgress()` call

## HTML Structure

### Header (`#sticky-top`)

```
#app-title      — "Warframe Tracker"
#hdr            — MR badge, potential badge, XP block, progress bar, menu button
  #mr-badge     — current MR rank + title
  #pot-badge    — potential MR (hidden when no gain possible)
  #hdr-btns
    #btn-menu   — toggles #hdr-menu
    #hdr-menu   — Auto-backup, Import, Export, + Item, Reset All, Sign in
```

Topbar/sidebar toggle: `toggleLayout()` stores `'topbar'|'sidebar'` in `localStorage['navLayout']`.
`body.topbar-mode` class switches #sidebar from vertical to horizontal strip.

### Controls (`#ctrl`)

```
#ctrl-row1   (always visible)
  #search               — text input, oninput="render()"
  #btn-filters          — "Filters ▾" toggle button, shows/hides #ctrl-filters
  #tab-stat             — XP/completion stat (margin-left:auto)
#ctrl-filters  (collapsible; display:none / display:flex.open)
  #cat-btns             — display:contents; filled by populateCatFilter() / buildModDropdowns() / buildArcaneDropdowns()
  #status-dd            — filled by buildStatusDropdown(); hidden on special tabs
  #fb-incarnon          — toggle button, shown on primary/secondary/melee tabs
  #fb-hasparts          — toggle button "Has Prime Parts", shown on relics tab
  #circuit-week-ind     — text span, shown on incarnon tabs
  #circuit-wf-week-ind  — text span, shown on warframes tab
  #fb-conclave          — toggle button, shown on mods tab only
  #fb-flawed            — toggle button, shown on mods tab only
#ctrl-row2  (hidden on special tabs)
  #fb-tile / #fb-list   — view toggle buttons
  #fb-grp               — group toggle button
  #fb-wftile            — tile art toggle (CARD_IMAGE_TABS only)
  #fb-wfbg              — bg art toggle (intrinsics only)
```

Filter row open/close state is saved per-tab in `localStorage['filtersOpen-<tab>']`.

## State Variables (app.js)

```javascript
// ── Supabase / cloud
let _sb = null;               // Supabase client (null if offline/unconfigured)
let currentUser = null;
let _cloudSyncTimer = 0;

// ── Core progress
const LS_KEY = 'wf-mastery-v1';
let progress = {};            // all saved data — itemKey / aqKey / arcKey / modKey / incarnonKey

// ── Active tab & filters
let activeTab = 'summary';
let filters = { status: '', incarnon: false, hasParts: false };
//   status: '' | 'unowned' | 'notStarted' | 'inProgress' | 'maxed'
//   hasParts: true = only show relics that contain prime parts

// ── Category / type filters
let activeCategory = '';
let activeType = '';          // mods: type filter
let activeUse = '';           // mods: use filter
let activeArcaneType = '';
let activeArcaneRarity = '';
let activeArcaneCategory = '';

// ── View prefs
let groupedView = false;
let listView = false;
let wfTileImages = localStorage.getItem('wf-ui-wftile') !== '0';
let wfBgImages   = localStorage.getItem('wf-ui-wfbg')   !== '0';
let modShowConclave = false;
let modShowFlawed   = false;
let collapsedGroups = new Set(); // "tab:groupName"

// ── Search
const searchIndex = {};       // tab → Map<name, lowercased searchable text>

// ── Checklist
let checklistItems = new Set(); // Set<"tab\tname"> (or "incarnon\tname")
let checklistOwned = {};        // { resourceName: countOwned }
let clBpOwned = new Set();      // Set of blueprint component keys already owned
const CL_KEY     = 'wf-checklist';
const CL_OWN_KEY = 'wf-checklist-owned';
const CL_BP_KEY  = 'wf-checklist-bp-owned';

// ── Overframe Builds Panel (per-card "Builds" button)
const BP_PICKS_KEY = 'wf-build-picks';
let buildPicks = {};  // { itemName: overframeBuildId }
let _bpItemName = '';
let _bpOfId     = null;
let _bpBuilds   = [];
let _bpBuild    = null; // currently displayed detail build

// ── My Builds Page (Builds tab)
const MY_BUILDS_KEY = 'wf-my-builds';
let myBuilds = {};       // { [itemName]: BuildEntry[] }
let _blpTab        = 'warframes';
let _blpItem       = null;
let _blpBuildId    = null;        // UUID of the active build
let _blpOFId       = null;
let _blpOFBuilds   = null;        // null=not fetched, false=loading, array=loaded
let _blpOFSearch   = '';
let _blpActiveSlot = null;
let _blpSubForm    = null;        // null = main build, string = exalted sub-form name

// ── My Loadouts Page (Loadouts tab)
const MY_LOADOUTS_KEY = 'wf-my-loadouts';
let myLoadouts   = [];   // array of LoadoutEntry (id, name, slots)
let _lpLoadoutId = null; // id of the loadout being edited
```

## Tabs

| Tab key | AQ_TABS? | Notes |
|---------|----------|-------|
| `warframes` | ✅ | circuit-wf-week-ind shown |
| `companions` | ✅ | |
| `primary` | ✅ | incarnon filter shown |
| `secondary` | ✅ | incarnon filter shown |
| `melee` | ✅ | incarnon filter shown |
| `vehicles` | ✅ | |
| `compWeapons` | ✅ | |
| `archWeapons` | ✅ | |
| `amps` | ✅ | |
| `mods` | ❌ | special: Category/Type/Use dropdowns, Conclave/Flawed toggles |
| `arcanes` | ❌ | special: Type/Rarity/Category dropdowns |
| `relics` | ❌ | hasParts filter shown |
| `intrinsics` | ❌ | no group view |
| `conclave` | ❌ | |
| `starChart` | — | isSpecial: hides all filters |
| `summary` | — | isSpecial: hides all filters |
| `checklist` | — | isSpecial: hides all filters; uses `#checklist-view` |
| `incarnons` | — | isSpecial: `#incarnons-view`; dedicated Incarnon Acquired/Installed tracker, grouped by genesis |
| `builds` | — | isSpecial: `#builds-view`; the My Builds planner |
| `loadouts` | — | isSpecial: `#loadouts-view`; the My Loadouts planner (groups builds from `builds` into named loadouts) |
| `kitgunBuilder` | — | isSpecial: `#kitgun-view`; Kitgun/Zaw builder |
| `ducats` | — | isSpecial: `#ducats-view`; ducat value calculator |

`AQ_TABS` = Set of tabs where items have an acquired flag separate from rank.
`CARD_IMAGE_TABS` = Set of tabs that show card artwork (warframes, primary, secondary, melee, companions, compWeapons, vehicles, archWeapons, amps, intrinsics).

## Data Model

### Progress keys (stored in `progress`, persisted to localStorage / Supabase)

| Key pattern | Meaning |
|-------------|---------|
| `PFX[tab] + name` | Item rank (0–maxRank) |
| `'aq:' + itemKey(tab, name)` | Acquired flag (AQ_TABS only) |
| `'inc:' + itemKey(tab, name)` | Incarnon Genesis **installed** flag (applied to the weapon) |
| `'incAcq:' + itemKey(tab, name)` | Incarnon Genesis **acquired** flag (have the adapter, not yet installed) |
| `'arc:' + name` | Arcane copy count |
| `itemKey('mods', name)` | Mod rank |
| `aqKey('mods', name)` | Mod owned flag |

### Item status (AQ_TABS)

| Status | Condition | Card class |
|--------|-----------|-----------|
| Unowned | rank=0, !aq | (none) |
| Not Started | rank=0, aq=true | `acquired` (blue) |
| In Progress | 0 < rank < maxRank | `partial` (gold) |
| Maxed | rank === maxRank | `maxed` (green) |

### Incarnon tracking

Two distinct per-weapon states, both keyed by `tab + name` (not by genesis — a genesis can cover
several weapon variants, e.g. Braton/Braton Vandal/Braton Prime/Mk1-Braton all share "Braton
Incarnon Genesis", but each variant tracks its own Acquired/Installed independently, matching how
the weapon cards have always worked):

- **Acquired** — `incAcqKey(tab, name)` returns `'incAcq:' + itemKey(tab, name)`. Have the Incarnon
  Genesis Adapter. Toggled by `toggleIncarnonAcquired(tab, name)`; also set automatically by
  `markChecklistDone('incarnon', name)` when the checklist item is crafted.
- **Installed** — `incarnonKey(tab, name)` returns `'inc:' + itemKey(tab, name)`. Applied to the
  weapon, unlocking its Incarnon form. Toggled by `toggleIncarnon(tab, name)`.

The two cascade to stay consistent: installing sets acquired too; un-acquiring clears installed too.

`INCARNON_WEAPON_TAB` — a `Map<weaponName, tab>` built from `INCARNON_WEAPONS` at startup.

On weapon cards, the "Incarnon" badge (`.card-incarnon`) is orange (neither), blue/`.acq` (acquired
only), or purple/`.on` (installed). `openAcqMenu()` exposes "Weapon acquired" / "Incarnon acquired" /
"Incarnon installed" as three independent toggles.

The dedicated `incarnons` tab (`renderIncarnonsPage()`) groups all Incarnon-capable weapons by
genesis name (`incGroups()`), shows Acquired/Installed toggle buttons per weapon variant, a Circuit
week badge per genesis, and quick status filters (`incFilter` / `setIncFilter()`).

### Incarnon Evolutions

Each weapon row on the `incarnons` tab shows its "Evolutions" section automatically once that
variant is **Installed** (`showEvo = hasEvo && isInst` in `renderIncarnonsPage()`) — no manual
expand/collapse, it just appears/disappears with the Installed toggle. Renders all 4 Evolution tiers
from `INCARNON_EVOLUTIONS` via `buildIncEvoTiers(tab, name, genesisName)`.

Tier I is always a single fixed perk (read-only). Tiers II–IV usually have 2-3 selectable perks —
rendered as a `<select>`; the choice is stored per weapon variant (not per genesis, since stat
values differ by variant) via `incEvoKey(tab, name, tierIdx)` → `'incEvo:' + itemKey(tab, name) +
':' + tierIdx`, value = the chosen perk's index, set by `setIncEvoChoice(tab, name, tierIdx, perkIdx)`.

Each perk's `desc` contains `+X`/`+Y`-style placeholders; `substituteEvoValues(desc, valuesStr)`
fills them in with that specific weapon variant's own numbers (looked up via
`evo.weapons.indexOf(name)` — the column index into each perk's `values` array) before the text is
run through `formatStatText()` for damage-icon rendering, so e.g. Braton and Mk1-Braton show the
same perk name but different substituted numbers.

### Incarnon Wishlist

Right-hand sticky panel on the `incarnons` tab (`buildIncWishlistPanel()`, laid out via `.inc-layout`
grid — same two-column/sticky-panel convention as the Checklist tab's `.cl-layout`). `incWishlist`
is a `Set<genesisName>`, toggled per-genesis via the ☆/★ button — present both on each group header
and on every weapon row (`.inc-row-toggles`, replacing the old per-row Evolutions toggle slot; all
variant rows in a group share and reflect the same genesis-level state) — both call
`toggleIncWishlist(genesisName)`, persisted to `localStorage['wf-inc-wishlist']` and included in
Import/Export (`buildSave()`/`applySave()`), and synced to Supabase (`syncToCloud()`/`loadFromCloud()`)
via an `inc_wishlist` column on the `saves` table (`jsonb`, array of genesis-name strings) — **this
column must exist in Supabase** or `syncToCloud()`'s upsert will fail (PostgREST rejects unknown
columns), which would also silently stop `progress`/`checklist`/etc. from syncing since it's one
upsert call. There is no migrations folder in this repo — the column must be added directly in the
Supabase dashboard/SQL editor: `alter table saves add column if not exists inc_wishlist jsonb
default '[]'::jsonb;`

`incWishlistSorted()` orders entries by: items matching `CIRCUIT_WEEK_NOW` first, then the rest by
circuit week descending. Since `CIRCUIT_WEEK_NOW` changes weekly, a different subset floats to the
top each week. Reuses `.card-circuit`/`.circuit-now` (the same badge class as group headers and
weapon cards elsewhere) for the week indicator, so the "current week" highlight stays visually
consistent app-wide.

### Incarnon Evolutions in the Builds page

The My Builds editor shows the same Acquired/Installed toggles + Evolutions tiers as the Incarnons
page, for whichever weapon is currently selected — `blpIncarnonHtml()` (called from
`blpRenderEditor()`, inserted right after `metaBarHtml`), guarded by `INCARNON_WEAPONS.has(_blpItem)`
and `!_blpSubForm` (exalted sub-weapons aren't separately Incarnon-trackable). It resolves the
item's real tab via `blpItemSourceTab()` (not `_blpTab`, which can be a Builds-page pseudo-tab like
`'kitguns'`/`'zaws'` or the `'mybuilds'` aggregate view) and calls the **exact same** functions the
Incarnons page uses — `toggleIncarnonAcquired`, `toggleIncarnon`, `buildIncEvoTiers` — against the
same `progress` keys, so there is only one source of truth and the two pages are always in sync with
no separate state or copy-pasted logic.

Because `toggleIncarnon`/`toggleIncarnonAcquired`/`setIncEvoChoice` all end by calling the app-global
`render()`, which only rebuilds `blp-editor-inner` when a *structural* change happens (item/build
switch, etc.) — not on every toggle — each of those three functions also calls `blpRenderEditor()`
directly when `activeTab === 'builds'`, so clicking Acquired/Installed/an Evolution `<select>` from
within the Builds editor refreshes the editor panel immediately, not just the Incarnons page.

## Data File Exports (split across data-*.js files)

| Const | Type | Purpose |
|-------|------|---------|
| `MASTERY` | Array | `{r, t, xp}` per MR rank |
| `INCARNON_WEAPONS` | Map | weapon name → genesis name |
| `INCARNON_REQUIREMENTS` | Map | genesis name → `[[resource, count], ...]` |
| `INCARNON_EVOLUTIONS` | Map | genesis name → `{ weapons: [variantName,...], tiers: [{ challenge, perks: [{name,desc,values,notes}] }] }` — the 4 Evolution tiers, scraped per-weapon-page (see `dev/update-incarnon-evolutions.js`) |
| `CURRENCIES` | Map | blueprint/item name → `{currencyName: amount}` for vendor-purchased components |
| `BLUEPRINTS` | Map | item name → `[credits, craftTime_s, [[partName, count, type?, subCost?], ...]]` |
| `WARFRAMES` / `PRIMARY` / `SECONDARY` / `MELEE` / `VEHICLES` / `COMPANIONS` / `COMP_WEAPONS` / `ARCH_WEAPONS` / `AMPS` / `INTRINSICS` | Arrays | Item data `["Name", "Category", "Obtain", maxRank, xpPerLevel, tradable?, compFor?]` |
| `CIRCUIT_WF` | Set | Warframes eligible for The Circuit |
| `CIRCUIT_WF_SCHEDULE` | Array | 11-week warframe circuit rotation (array of arrays of names) |
| `CIRCUIT_INCARNON_SCHEDULE` | Array | 8-week incarnon genesis rotation |
| `VAULTED_WF` | Set | Vaulted prime warframe names |
| `SC_PLANETS` / `SC_SP_PLANETS` | Arrays | Star Chart / Steel Path planet names |
| `SC_JUNCTIONS` / `SC_SP_JUNCTIONS` | Arrays | Junction names |
| `SC_PLANET_XP` | Object | XP per planet node-set |
| `TAB_DATA` | Object | `{ tabKey: dataArray }` — wires tabs to their item arrays |
| `PFX` | Object | `{ tabKey: prefix }` — localStorage key prefixes per tab |
| `OF_POLARITY` | Map | Overframe polarity integer → polarity name string |
| `MODS` | Array | Mod data `["Name", "Category", "Type", "Use", polarity, maxRank, tradable?, rarity?, exilus?, conclave?, desc?]` |
| `MOD_DESC` | Object | `{ modName: descriptionString }` |
| `ARCANE_RANK_COPIES` | Array | `[1,3,6,10,15,21]` — copies needed per rank |
| `ARCANES` | Array | Arcane data |
| `ARCANE_DESC` | Object | `{ arcaneName: descriptionString }` |
| `KITGUN_CHAMBERS` / `KITGUN_GRIPS` / `KITGUN_LOADERS` | Maps | Kitgun component stats |
| `ZAW_STRIKES` / `ZAW_GRIPS` / `ZAW_LINKS` | Maps | Zaw component stats |
| `OVERFRAME_MAP` | Map | Item name → Overframe item ID |
| `OVERFRAME_MODS` | Map | Overframe mod ID → mod name |
| `OVERFRAME_MOD_CATS` | Map | Overframe mod category ID → category name |
| `DEFAULT_POLARITIES` | Object | Item name → default polarity layout for the Builds page |

### Adding new content to data.js

Each item array element: `["Name", "Category", "How to obtain", maxRank, xpPerLevel, tradable?, compFor?]`

- `tradable`: 1 if tradeable, 0/omit if not
- `compFor`: semicolon-separated craft targets (omit if none)

Max rank values: 30 (standard), 40 (Kuva/Tenet/Coda/Necramechs/Paracesis), 10 (Intrinsics).

For star chart: edit `SC_PLANETS`, `SC_JUNCTIONS`, or SP counterparts.

## XP Rates (`TAB_XP_PER_LEVEL`)

| Category | XP/rank |
|----------|---------|
| warframes, companions, vehicles | 200 |
| all weapons, amps | 100 |
| intrinsics | 1500 |
| mods, arcanes | not in table (no MR XP) |

## Circuit Week Tracking

```javascript
const CIRCUIT_EPOCH = new Date('2026-05-29T00:00:00Z'); // shared Thursday reset
const CIRCUIT_WEEK_NOW    = _circuitWeek(5, 8);   // incarnon: 8-week cycle, epoch=week 6
const CIRCUIT_WF_WEEK_NOW = _circuitWeek(7, 11);  // warframe: 11-week cycle, epoch=week 8
```

Current week sets derive from `CIRCUIT_INCARNON_SCHEDULE` and `CIRCUIT_WF_SCHEDULE`. If either `const` is undefined (missing from data.js), the sets default empty.

## Checklist System

Items added via the `+` button on cards (uses context menu `openChecklistMenu()`).
Incarnon genesis entries use the pseudo-tab `'incarnon'` as their key prefix: `incClKey(name)` → `'incarnon\t' + name`.

| Function | Purpose |
|----------|---------|
| `toggleChecklist(tab, name)` | Add/remove item from checklist |
| `toggleIncarnonChecklist(name)` | Add/remove incarnon genesis from checklist |
| `markChecklistDone(tab, name)` | Mark item crafted: deducts resources, sets acquired flag, removes from list |
| `getChecklistItemResources(tab, name)` | Returns `{resource: count}` needed to build item |
| `renderChecklist()` | Re-renders `#checklist-view` |
| `clearChecklist()` | Clears all checklist state |

`checklistOwned` tracks how many of each resource you already have (stored to `CL_OWN_KEY`).
`clBpOwned` tracks which blueprint components you already own (stored to `CL_BP_KEY`), affecting resource deduction via `getMissionDropComponents()`.

## Overframe Builds Panel

Opened from the "Builds" badge on item cards. Fetches top builds from Overframe API.

```javascript
const OF_API = location.hostname === 'localhost'
  ? 'http://localhost:3001/api/v1'    // dev/overframe_proxy.js
  : '/of-proxy';                       // CF Pages Function
```

| Function | Purpose |
|----------|---------|
| `openBuildsPanel(name, ofId)` | Opens `#bp-overlay`, fetches builds for item |
| `fetchBuildList()` | GET `{OF_API}/builds/?item_id=…&ordering=-score&limit=20` |
| `fetchBuildDetail(buildId)` | GET `{OF_API}/builds/{id}/` |
| `toggleBuildPick(buildId)` | Marks/unmarks a build as "currently using" in `buildPicks` |
| `renderBuildList()` | Renders list of builds with picked state |
| `renderBuildDetail()` | Renders mod slots for one build |

`buildPicks` persisted in `BP_PICKS_KEY`. `OVERFRAME_MODS` maps Overframe mod IDs → mod names for slot display.

## Builds Page (`builds` tab)

Full build planner for owned items. Accessed via the "Builds" tab.

### State

`myBuilds` = `{ [itemName]: BuildEntry[] }` where each `BuildEntry` has:
```
{ id, name, subForms, baseBuildId, baseBuildTitle, baseBuildUrl, baseAuthor, slots, isModified, potatoed }
```
`subForms` = `{ [exaltedName]: SlotData }` for warframe exalted weapons.
`slots` = array of `{ type, polarity, mod, rank }`.

### Key functions

| Function | Purpose |
|----------|---------|
| `blpSetTab(tabKey)` | Switch category in builds page |
| `blpSelectItem(name)` | Select item, show its builds |
| `blpSelectBuild(buildId)` | Select a build to edit |
| `blpCreateBuild()` | Add a new build entry |
| `blpDeleteBuild()` | Delete active build |
| `blpRenderEditor()` | Re-render the build editor |
| `blpSetSubForm(name)` | Switch to/from exalted sub-form |
| `blpCyclePolarity(i)` / `blpSetPolarity(i, p)` | Cycle or set slot polarity |
| `blpApplyDefaultPolarities(slots)` | Apply `DEFAULT_POLARITIES[item]` to fresh slots |
| `blpTogglePotato()` | Toggle Reactor/Catalyst on active build |
| `renderBuildsPage()` | Re-render tab bar + item list |

`POLARITY_LABELS = ['—','M','V','N','Z','P','','U','B','O']` (index = polarity value; 6 unused).
`BLP_TABS` — array of `{ key, label }` for the left-panel category tabs.

## My Loadouts Page (`loadouts` tab)

Groups builds from the Builds page into named, multi-slot loadouts (e.g. "Eidolon Hunting" = a
specific Warframe build + Primary + Secondary + ...). Entirely separate state/render functions from
the Builds page (`_lp*` globals, not `_blp*`) — it only *reads* `myBuilds` via `blpItemBuilds()` to
resolve build names, so the two pages can't desync each other.

### State

`myLoadouts` = array of `LoadoutEntry`:
```
{ id, name, slots: { <slotKey>: { item: string, buildId: string|null } | null, ... } }
```
A slot value of `null` means unassigned. `buildId: null` with a non-null `item` means "this item,
no specific build linked" (allowed — a loadout slot doesn't require a saved build to exist).

`LOADOUT_SLOTS` — ordered array of slot definitions, each resolving items from `TAB_DATA`:

| Slot key | Label | Source tab | Category filter |
|---|---|---|---|
| `warframe` | Warframe | `warframes` | — (only **required** slot) |
| `primary` | Primary | `primary` | — |
| `secondary` | Secondary | `secondary` | — |
| `melee` | Melee | `melee` | — |
| `companion` | Companion | `companions` | — |
| `companionWeapon` | Companion Weapon | `compWeapons` | — |
| `necramech` | Necramech | `vehicles` | `category === 'Necramech'` |
| `necramechWeapon` | Necramech Weapon | `archWeapons` | `category` includes `'Arch-Gun'` |
| `archwing` | Archwing | `vehicles` | `category === 'Archwing'` |
| `archGun` | Arch Gun | `archWeapons` | `category` includes `'Arch-Gun'` |
| `archMelee` | Arch Melee | `archWeapons` | `category` includes `'Arch-Melee'` |

Necramech Weapon and Arch Gun intentionally draw from the same item pool (Necramechs can only mount
Arch-Guns, not Arch-Melee, in-game) but are tracked as independent slot choices, since a user may run
a different weapon on their mech than in Archwing mode. `lpItemsForSlot(slotDef)` resolves the
filtered item list for a slot.

### Key functions

| Function | Purpose |
|----------|---------|
| `renderLoadoutsPage()` | Re-renders the loadout list + editor |
| `lpSelectLoadout(id)` | Select a loadout to edit |
| `lpCreateLoadout()` / `lpDeleteLoadout()` / `lpRenameLoadout(name)` | Loadout CRUD |
| `lpSetSlotItem(slotKey, itemName)` | Assign/clear an item on a slot (clears any linked build) |
| `lpSetSlotBuild(slotKey, buildId)` | Link/unlink a specific My Builds entry to a filled slot |
| `lpClearSlot(slotKey)` | Unassign a slot entirely |
| `lpOpenInBuilds(slotKey)` | Jumps to the Builds page with that slot's item/build pre-selected |

**Stale build cleanup**: `blpDeleteBuild()` (Builds page) calls `lpCleanupBuildRef(itemName, buildId)`
after removing a build — any loadout slot pointing at that exact `(item, buildId)` pair has its
`buildId` reset to `null` (the item assignment itself is left alone, since items are static data and
never disappear).

### Persistence & cloud sync

`loadMyLoadouts()` / `saveMyLoadouts()` mirror `loadMyBuilds()`/`saveMyBuilds()` exactly (localStorage
key `MY_LOADOUTS_KEY = 'wf-my-loadouts'`, `saveMyLoadouts()` calls `deferCloudSync()`). Synced to
Supabase via a `my_loadouts` column on the `saves` table (`jsonb`, array of `LoadoutEntry`), read
through `sanitizeMyLoadouts()` on cloud load — same pattern and **same caveat** as `inc_wishlist`
(see Incarnon Wishlist above): **this column must exist in Supabase** or the whole `saves` upsert
fails silently, breaking sync for `progress`/`checklist`/`myBuilds`/etc. too. Add it via the Supabase
dashboard/SQL editor: `alter table saves add column if not exists my_loadouts jsonb default
'[]'::jsonb;`

Not included in manual JSON Import/Export (`buildSave()`/`applySave()`) — same as `myBuilds`, which
also isn't included there today.

## Key Functions (app.js)

### Tab switching
- `switchTab(tabEl)` — resets all filter state, restores prefs, calls `restoreStatus()` + `populateCatFilter()`, wires DOM visibility

### Category filter
- `populateCatFilter()` — for mods → `buildModDropdowns()`; for arcanes → `buildArcaneDropdowns()`; others → injects `makeDd('dd-cat', ...)` into `#cat-btns`
- `setCatFilter(val)` — sets `activeCategory`, calls `populateCatFilter()`, `render()`
- `buildModDropdowns()` / `buildArcaneDropdowns()` — multi-dropdown builds for mods/arcanes

### Status filter
- `buildStatusDropdown()` — injects `makeDd('dd-status', ...)` (noSearch=true) into `#status-dd`
- `setStatusFilter(val)` — sets `filters.status`, saves to localStorage, rebuilds dropdown, renders
- `restoreStatus()` — loads from localStorage, calls `buildStatusDropdown()`

### Dropdown widget
- `makeDd(id, label, options, activeVal, onSelect, noSearch=false)` — builds `.sdd` custom dropdown
- `toggleDd(id)` / `closeDd(id)` / `closeAllDd()` — open/close state

### Filtering
- `getVisibleItems()` — checks `filters.status` + `filters.incarnon` + search
- `getVisibleMods()` — checks cat/type/use + `filters.status`
- `getVisibleArcanes()` — checks type/rarity/cat + `filters.status`

### Rendering
- `render()` — main render dispatcher; routes to `buildItem()` / `buildModItem()` / `buildArcaneItem()` etc., or to `renderDucats()` / `renderKitgunBuilder()` / `renderBuildsPage()`
- `buildItem(tab, name, ...)` — builds a card element; assigns `maxed`/`partial`/`acquired` CSS class
- `updateTabStat()` — updates `#tab-stat`
- `updateHeader()` — updates MR badge, potential badge, XP bar
- `buildSearchIndex(tab)` — pre-builds search text for a tab into `searchIndex[tab]`

### XP / MR
- `totalXP()` — earned XP across all tabs + star chart
- `potentialXP()` — `totalXP()` + remaining XP on owned AQ_TABS items
- `getCurrentMR(xp)` / `getNextMR(xp)` — look up rank from `MASTERY` array

### Persistence
- `saveProgress()` / `deferSave()` — write `progress` to localStorage (+ Supabase + backup file)
- `loadProgress()` — reads from localStorage, triggers Supabase pull
- `saveChecklist()` / `saveChecklistOwned()` / `saveClBpOwned()` — each also calls `deferCloudSync()`
- `writeBackup()` — writes JSON to auto-backup file handle (set via `setBackupFile()`)

### View controls
- `setListView(val)` / `toggleGroupView()` / `toggleWfTileImages(btn)` / `toggleWfBgImages(btn)`

### Import/Export
- `openImport()` / `openExport()` — JSON export/import via modal textarea
- `handleFileSelect(event)` — also accepts `.xlsx` / `.xlsm` (SheetJS) and triggers `fetchFromSheets()` for Google Sheets
- `setBackupFile()` — opens a file-picker to choose the auto-backup destination

## Status Filter Values

```javascript
const STATUS_KEYS   = { 'Unowned': 'unowned', 'Not Started': 'notStarted', 'In Progress': 'inProgress', 'Maxed': 'maxed' };
const STATUS_LABELS = { 'unowned': 'Unowned', 'notStarted': 'Not Started', 'inProgress': 'In Progress', 'maxed': 'Maxed' };
```

"Not Started" option only shown for AQ_TABS, mods, and arcanes.

## Potential MR Logic

`potentialXP()` = `totalXP()` + remaining XP for every **AQ_TABS** item where `rank < maxRank && (rank > 0 || acquired)`. Mods, arcanes, intrinsics, and uncompleted star chart nodes are NOT included.

## localStorage Keys

| Key | Managed by |
|-----|-----------|
| `'wf-mastery-v1'` | `saveProgress()` / `loadProgress()` |
| `'wf-checklist'` | `saveChecklist()` / `loadChecklist()` |
| `'wf-checklist-owned'` | `saveChecklistOwned()` |
| `'wf-checklist-bp-owned'` | `saveClBpOwned()` |
| `'wf-build-picks'` | `saveBuildPicks()` / `loadBuildPicks()` |
| `'wf-my-builds'` | `saveMyBuilds()` / `loadMyBuilds()` |
| `'wf-my-loadouts'` | `saveMyLoadouts()` / `loadMyLoadouts()` |
| `'navLayout'` | `toggleLayout()` — `'topbar'` or `'sidebar'` |
| `'filtersOpen-<tab>'` | `toggleFilterRow()` — `'1'` or `'0'` |
| `'wf-ui-wftile'` | tile art toggle — `'0'` = off |
| `'wf-ui-wfbg'` | bg art toggle — `'0'` = off |
| Status filter keys | `setStatusFilter()` per tab |

## dev/ Directory

Offline tools for maintaining data.js:

| Script/Dir | Purpose |
|-----------|---------|
| `overframe_proxy.js` | Local proxy server for Overframe API (port 3001) |
| `update.js` | Main data update script |
| `extract-blueprints.js` / `generate-blueprints-map.js` | Blueprint scraping pipeline |
| `scrape-incarnon-requirements.js` | (archived) Scrapes incarnon genesis resource costs into `INCARNON_REQUIREMENTS` |
| `update-incarnon-evolutions.js` | Scrapes each Incarnon Genesis wiki page's Evolutions table into `INCARNON_EVOLUTIONS` (per-page fetch — no wiki Lua module exists for this data) |
| `scrape-weapon-mr.js` | Scrapes weapon MR data |
| `scrape_overframe_ids.js` | Scrapes Overframe item IDs into `OVERFRAME_MAP` |
| `Import/` | Google Sheets + xlsx import helpers (`sheets-import.gs`, SheetJS) |
| `wiki-diff/` | Diff tool for detecting wiki content changes |
| `node_modules/` | xlsx dependency (gitignored-ish) |

## ⚠ Dual Init Block

`app.js` has two places that wire up DOM visibility for the initial tab on page load — one inside `switchTab()` and one in a standalone block near the bottom of the file. If you change what `switchTab()` shows/hides, you **must also update the second block** or the initial page load will be inconsistent.
