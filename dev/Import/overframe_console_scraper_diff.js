// Paste into browser console on any https://overframe.gg/ page.
// Scrapes default slot polarities for non-warframe items (companions, melee, weapons).
// Run window.__wf_stop = true in console to abort at any time.
//
// Decode types:
//   companion     — arr[4] 10 slots reversed                  → flat [s1..s10]
//   melee         — arr[4] 8 slots reversed + stance at [8]   → [stance,[s1..s8],exilus?]
//   weaponExilus  — arr[4] 8 slots reversed + exilus at [8]   → [exilus,[s1..s8]]  (primary/secondary)
//   weaponFlat    — arr[4] 8 slots reversed only               → flat [s1..s8]       (archgun/archmelee/archwing/sentinel/comp weapons)
//   necramech     — arr[4] 12 slots reversed                  → flat [s1..s12]

(async () => {
  // ── CONFIGURATION ──────────────────────────────────────────────────────────
  const RUN = {
    companions:   true,
    melee:        true,
    weaponExilus: true,   // primary, secondary
    weaponFlat:   true,   // archgun, archmelee, archwing, sentinel + companion weapons
    necramech:    false,  // already scraped: Voidrig, Bonewidow
  };
  // ───────────────────────────────────────────────────────────────────────────

  // ── COMPANIONS (10-slot reversed → [s1..s10]) ─────────────────────────────
  const COMPANION_IDS = {
  };

  // ── MELEE (8 slots reversed + stance at [8] → [stance,[s1..s8],exilus?]) ──
  const MELEE_IDS = {
    "Krohkur":985,"Machete":976,"Obex":934,"Ack & Brunt":980,
    "Kesheg":973,"Sydon":988,"Arca Titron":933,"Ripkas":971,
  };

  // ── WEAPON_EXILUS (primary/secondary: exilus at arr[4][8]) ───────────────
  // Output: [exilus, [s1..s8]]
  const WEAPON_EXILUS_IDS = {
    // ── Primary — Rifles ──
    "Amprex":920,"Buzlok":964,"Dera":916,"Dera Vandal":914,"Flux Rifle":913,
    "Glaxion":924,"Gorgon Wraith":970,"Grakata":952,"Grinlok":955,"Harpak":966,
    "Ignis":908,"Ignis Wraith":909,"Opticor":923,"Supra":911,"Tetra":921,
    // ── Primary — Shotguns ──
    "Convectrix":928,"Drakgoon":954,
    // ── Primary — Snipers ──
    "Lanka":917,"Vulkar":959,
    // ── Primary — Bows ──
    "Lenz":919,
    // ── Primary — Spearguns ──
    "Ferrox":931,"Javlok":962,
    // ── Primary — Launchers ──
    "Miter":958,"Ogris":910,"Penta":929,"Tonkor":965,"Torid":907,"Zarr":961,
    // ── Secondary — Single ──
    "Acrid":906,"Arca Scisco":946,"Athodai":4772,"Cestra":939,"Cycron":942,
    "Detron":938,"Kraken":949,"Nukor":992,"Seer":950,"Spectra":912,"Stubba":997,
    // ── Secondary — Dual ──
    "Staticor":943,"Twin Grakatas":953,"Twin Kohmak":993,"Twin Rogga":995,
  };

  // ── WEAPON_FLAT (no exilus: archgun/archmelee/archwing/sentinel/comp weapons) ─
  // Output: [s1..s8]
  const WEAPON_FLAT_IDS = {
    "Elytron":3,
  };

  // ── NECRAMECH (12 slots reversed, no exilus/stance) ───────────────────────
  // arr[4]: [Mod12..Mod1] — Output: flat [s1..s12]
  const NECRAMECH_IDS = {
  };

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hasNextRouter = typeof window.next?.router?.push === 'function';
  console.log(`Navigation: ${hasNextRouter ? 'Next.js router' : 'history.pushState'}`);

  async function nextPush(path) {
    return new Promise(resolve => {
      const done = () => { window.next.router.events.off('routeChangeComplete', done); resolve(); };
      window.next.router.events.on('routeChangeComplete', done);
      window.next.router.push(path);
    });
  }

  async function navigateTo(id) {
    if (hasNextRouter) {
      await nextPush('/');
      await sleep(300);
      await nextPush(`/build/new/${id}/`);
    } else {
      history.pushState(null, '', `/build/new/${id}/`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }
  }

  async function waitForInput(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector('input[type="number"]');
      if (el && el.value !== '') return el;
      await sleep(250);
    }
    return null;
  }

  // ── DECODE ────────────────────────────────────────────────────────────────
  function decodeBs(bs, expectedId, type) {
    try {
      const arr = JSON.parse(atob(bs.replace(/-/g, '+').replace(/_/g, '/')));
      if (arr[1] !== expectedId) return { error: `wrong_item: got ${arr[1]}, expected ${expectedId}` };
      const slots = arr[4];
      if (!Array.isArray(slots)) return { error: 'bad_slots' };

      if (type === 'companion') {
        if (slots.length < 10) return { error: `slots<10 (got ${slots.length})` };
        return { result: slots.slice(0, 10).reverse().map(s => s?.[2] ?? 0) };
      }
      if (type === 'melee') {
        // Melee:  arr[4] = [Mod8..Mod1, Stance, Exilus, Arcane] — 11 slots → [stance,[mods],exilus]
        // Claws:  arr[4] = [Mod8..Mod1, Stance]                 —  9 slots → [stance,[mods]]
        if (slots.length < 9) return { error: `slots<9 (got ${slots.length})` };
        const stance = slots[8]?.[2] ?? 0;
        const mods   = slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0);
        if (slots.length >= 10) {
          const exilus = slots[9]?.[2] ?? 0;
          return { result: [stance, mods, exilus] };
        }
        return { result: [stance, mods] };
      }
      if (type === 'weaponExilus') {
        // arr[4]: [Mod8..Mod1, Exilus, Arcane]
        if (slots.length < 9) return { error: `slots<9 (got ${slots.length})` };
        const exilus = slots[8]?.[2] ?? 0;
        const mods   = slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0);
        return { result: [exilus, mods] };
      }
      if (type === 'necramech') {
        // arr[4]: [Mod12..Mod1] — 12 slots reversed, no exilus or stance
        if (slots.length < 12) return { error: `slots<12 (got ${slots.length})` };
        return { result: slots.slice(0, 12).reverse().map(s => s?.[2] ?? 0) };
      }
      // weaponFlat — archwing/archmelee only have 8 slots; archgun has 10 but last 2 are unused
      if (slots.length < 8) return { error: `slots<8 (got ${slots.length})` };
      return { result: slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0) };
    } catch (e) {
      return { error: 'decode_failed: ' + e.message };
    }
  }

  // ── SCRAPE ONE PAGE ───────────────────────────────────────────────────────
  async function scrapeItem(expectedId, type) {
    const input = await waitForInput(15000);
    if (!input) return { error: 'input_not_found' };

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const cur = parseInt(input.value, 10);
    setter.call(input, cur > 0 ? cur - 1 : 1);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1500);

    const bs = new URL(location.href).searchParams.get('bs');
    if (!bs) return { error: 'no_bs' };
    return decodeBs(bs, expectedId, type);
  }

  // ── SCRAPE CATEGORY ───────────────────────────────────────────────────────
  async function scrapeCategory(ids, type, label) {
    const results = {};
    const entries = Object.entries(ids);
    const total = entries.length;
    console.log(`%c[${label}] Starting ${total} items...`, 'color:#a0d0ff;font-weight:bold');

    for (let i = 0; i < total; i++) {
      if (window.__wf_stop) { console.warn(`[${label}] Aborted by user after ${i} items.`); break; }
      const [name, id] = entries[i];

      await navigateTo(id);
      await sleep(500);

      const r = await scrapeItem(id, type);

      if (r.error) {
        results[name] = { error: r.error };
        console.warn(`[${label}][${i+1}/${total}] ✗ ${name} (${id}): ${r.error}`);
      } else {
        results[name] = r.result;
        console.log(`[${label}][${i+1}/${total}] ✓ ${name}: ${JSON.stringify(r.result)}`);
      }

      await sleep(1000);
    }
    return results;
  }

  // ── FORMAT OUTPUT ─────────────────────────────────────────────────────────
  function formatLines(results) {
    return Object.entries(results).map(([name, val]) => {
      if (val && val.error) return `  // ✗ "${name}": ${val.error}`;
      return `  "${name}":${JSON.stringify(val)},`;
    }).join('\n');
  }

  // ── MAIN ──────────────────────────────────────────────────────────────────
  window.__wf_stop = false;

  const allResults = {};

  if (RUN.companions)   allResults.companions   = await scrapeCategory(COMPANION_IDS,    'companion',    'COMPANIONS');
  if (RUN.melee)        allResults.melee        = await scrapeCategory(MELEE_IDS,         'melee',        'MELEE');
  if (RUN.weaponExilus) allResults.weaponExilus = await scrapeCategory(WEAPON_EXILUS_IDS, 'weaponExilus', 'WEAPON_EXILUS');
  if (RUN.weaponFlat)   allResults.weaponFlat   = await scrapeCategory(WEAPON_FLAT_IDS,   'weaponFlat',   'WEAPON_FLAT');
  if (RUN.necramech)    allResults.necramech    = await scrapeCategory(NECRAMECH_IDS,     'necramech',    'NECRAMECH');

  window.__wf_results = allResults;

  // Build a copy-pasteable DEFAULT_POLARITIES block
  const lines = [];
  if (allResults.companions)   { lines.push('  // ── Companions ──');                              lines.push(formatLines(allResults.companions)); }
  if (allResults.melee)        { lines.push('  // ── Melee ──');                                   lines.push(formatLines(allResults.melee)); }
  if (allResults.weaponExilus) { lines.push('  // ── Primary / Secondary ──');                     lines.push(formatLines(allResults.weaponExilus)); }
  if (allResults.weaponFlat)   { lines.push('  // ── Archgun / Archmelee / Archwing / Comp weapons ──'); lines.push(formatLines(allResults.weaponFlat)); }
  if (allResults.necramech)    { lines.push('  // ── Necramech ──');                               lines.push(formatLines(allResults.necramech)); }
  const output = lines.join('\n');

  try {
    await navigator.clipboard.writeText(output);
    console.log('%cDone! Formatted output copied to clipboard.', 'color:#50d0d0;font-weight:bold');
  } catch {
    console.log('%cClipboard blocked. To copy output run: copy(window.__wf_output)', 'color:#e07060');
  }
  window.__wf_output = output;

  const ok    = Object.values(allResults).flatMap(Object.values).filter(v => !v?.error).length;
  const total = Object.values(allResults).flatMap(Object.values).length;
  console.log(`Complete: ${ok}/${total} successful.`);
  console.log('Raw data: window.__wf_results  |  Formatted: window.__wf_output');
})();
