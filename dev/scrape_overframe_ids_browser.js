// ============================================================
// Overframe Arsenal ID Scraper
// HOW TO USE:
//   1. Open https://overframe.gg in your browser
//   2. Open DevTools (F12) → Console tab
//   3. Paste this entire script and press Enter
//   4. Wait for it to finish — results are logged and auto-downloaded
// ============================================================

(async function scrapeOverframeIds() {
  const BASE = 'https://overframe.gg/items/arsenal/';
  const DELAY = 300; // ms between requests — be polite

  // Pre-seeded from manual checks — { name, category }
  // category matches the slug in https://overframe.gg/items/<category>/
  const results = {
    '0001': { name: 'Nova',             category: 'warframe' },
    '0002': { name: 'Nova Prime',       category: 'warframe' },
    '0003': { name: 'Elytron',          category: 'archwing' },
    '0004': { name: 'Odonata Prime',    category: 'archwing' },
    '0005': { name: 'Odonata',          category: 'archwing' },
    '0006': { name: 'Itzal',            category: 'archwing' },
    '0007': { name: 'Amesha',           category: 'archwing' },
    '0008': { name: 'Banshee',          category: 'warframe' },
    '0009': { name: 'Banshee Prime',    category: 'warframe' },
    '0010': { name: 'Octavia',          category: 'warframe' },
    '0011': { name: 'Valkyr',           category: 'warframe' },
    '0012': { name: 'Valkyr Prime',     category: 'warframe' },
    '0013': { name: 'Atlas',            category: 'warframe' },
    '0014': { name: 'Mesa',             category: 'warframe' },
    '0015': { name: 'Chroma',           category: 'warframe' },
    '0016': { name: 'Ember',            category: 'warframe' },
    '0017': { name: 'Ember Prime',      category: 'warframe' },
    '0018': { name: 'Excalibur',        category: 'warframe' },
    '0019': { name: 'Excalibur Prime',  category: 'warframe' },
    '0020': { name: 'Excalibur Umbra',  category: 'warframe' },
    '0021': { name: 'Titania',          category: 'warframe' },
    '0022': { name: 'Frost',            category: 'warframe' },
    '0023': { name: 'Frost Prime',      category: 'warframe' },
    '0024': { name: 'Gara',             category: 'warframe' },
    '0025': { name: 'Mirage',           category: 'warframe' },
    '0026': { name: 'Mirage Prime',     category: 'warframe' },
  };

  // Override start ID here (as a number) to resume from a specific point,
  // e.g. after a gap found by the gap-finder script. Set to null to auto-start
  // after the last pre-seeded entry.
  const START_OVERRIDE = 7937;

  const startFrom = START_OVERRIDE ?? Object.keys(results).length + 1;
  const EMPTY_STREAK_LIMIT = 20; // stop after this many consecutive empty/404 pages

  // Set window.stopScraper = true in the console to cancel after the current request
  window.stopScraper = false;

  console.log(`%cOverframe scraper starting from ID ${String(startFrom).padStart(4, '0')} (${startFrom - 1} pre-seeded)`, 'color: cyan; font-weight: bold');
  console.log('%cTo stop: type   window.stopScraper = true   in the console', 'color: yellow');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function extractItem(status, html) {
    if (status === 404 || html.includes('There is nothing there')) return null;

    // Name from title tag: "Warframe Nova - ... - Overframe" or "Soma Prime - ... - Overframe"
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!titleMatch) return { name: 'Unknown', category: 'unknown' };

    let name = titleMatch[1].split(' - ')[0].trim();
    if (name.toLowerCase().startsWith('warframe ')) name = name.slice('warframe '.length);

    // Category from breadcrumb link: href="/items/<category>/"
    // Excludes "arsenal", "all", and paths with a number (individual item links)
    const catMatch = html.match(/href="\/items\/((?!arsenal|all)[a-z][a-z0-9-]*)\/"/i);
    const category = catMatch ? catMatch[1] : 'unknown';

    return { name: name || 'Unknown', category };
  }

  let i = startFrom;
  let emptyStreak = 0;

  while (true) {
    if (window.stopScraper) {
      console.log('%cStopped by user.', 'color: yellow');
      break;
    }

    const id = String(i).padStart(4, '0');
    const url = `${BASE}${id}/`;

    try {
      const res = await fetch(url);
      const html = await res.text();
      const item = extractItem(res.status, html);

      if (item === null) {
        emptyStreak++;
        console.log(`%c[${id}] empty (${emptyStreak}/${EMPTY_STREAK_LIMIT})`, 'color: gray');
        if (emptyStreak >= EMPTY_STREAK_LIMIT) {
          console.log('%cReached 5 consecutive empty pages — stopping.', 'color: orange');
          break;
        }
      } else {
        emptyStreak = 0;
        results[id] = item;
        console.log(`[${id}] ${item.name} (${item.category})`);
      }
    } catch (err) {
      console.warn(`[${id}] ERROR: ${err.message} — skipping`);
    }

    await sleep(DELAY);
    i++;
  }

  // Build reverse map: item name → { id, category }
  const byName = {};
  for (const [id, { name, category }] of Object.entries(results)) {
    byName[name] = { id, category };
  }

  const output = { byId: results, byName };
  console.log('%cDone! Downloading overframe_ids.json...', 'color: lime; font-weight: bold');
  console.log(output);

  // Auto-download as JSON file
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'overframe_ids.json';
  a.click();
})();
