// ============================================================
// Overframe Gap Finder
// Fires requests in parallel batches to quickly find where
// items resume after a dead zone.
// HOW TO USE:
//   1. Open https://overframe.gg in your browser
//   2. Open DevTools (F12) → Console tab
//   3. Paste and press Enter
//   4. To stop: window.stopFinder = true
// ============================================================

(async function findGap() {
  const BASE       = 'https://overframe.gg/items/arsenal/';
  const START_FROM = 7663;
  const BATCH_SIZE = 10;   // parallel requests per round
  const DELAY_MS   = 100;  // ms between batches (much faster than main scraper)
  const HIT_NEEDED = 3;    // consecutive hits before we report "found restart point"

  window.stopFinder = false;
  console.log(`%cGap finder starting from ${START_FROM} in batches of ${BATCH_SIZE}`, 'color: cyan; font-weight: bold');
  console.log('%cTo stop: window.stopFinder = true', 'color: yellow');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function checkId(id) {
    const padded = String(id).padStart(4, '0');
    try {
      const res = await fetch(`${BASE}${padded}/`);
      if (res.status === 404) return { id, padded, exists: false };
      const html = await res.text();
      if (html.includes('There is nothing there')) return { id, padded, exists: false };
      // Quick name extract for logging
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      let name = m ? m[1].split(' - ')[0].trim() : 'Unknown';
      if (name.toLowerCase().startsWith('warframe ')) name = name.slice('warframe '.length);
      return { id, padded, exists: true, name };
    } catch {
      return { id, padded, exists: false };
    }
  }

  let i = START_FROM;
  let hitStreak = 0;

  while (true) {
    if (window.stopFinder) {
      console.log('%cStopped by user.', 'color: yellow');
      break;
    }

    // Build a batch of IDs
    const batch = [];
    for (let b = 0; b < BATCH_SIZE; b++) batch.push(i + b);
    i += BATCH_SIZE;

    const results = await Promise.all(batch.map(checkId));

    for (const r of results) {
      if (r.exists) {
        hitStreak++;
        console.log(`%c[${r.padded}] FOUND: ${r.name} (streak: ${hitStreak})`, 'color: lime; font-weight: bold');
        if (hitStreak >= HIT_NEEDED) {
          const restartAt = String(r.id - (hitStreak - 1)).padStart(4, '0');
          console.log(`%c✓ Items resume at ID ${restartAt}. Re-run main scraper from that ID.`, 'color: lime; font-size: 14px; font-weight: bold');
          window.stopFinder = true;
          break;
        }
      } else {
        if (hitStreak > 0) hitStreak = 0;
        console.log(`[${r.padded}] empty`);
      }
    }

    if (window.stopFinder) break;
    await sleep(DELAY_MS);
  }
})();
