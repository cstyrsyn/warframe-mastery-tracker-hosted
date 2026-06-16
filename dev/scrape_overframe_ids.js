const https = require('https');
const fs = require('fs');

const BASE_URL = 'https://overframe.gg/items/arsenal/';
const OUTPUT_FILE = 'overframe_ids.json';
const DELAY_MS = 400; // polite delay between requests

// Pre-seeded from manual checks already done
const KNOWN = {
  '0001': 'Nova',
  '0002': 'Nova Prime',
  '0003': 'Elytron',
  '0004': 'Odonata Prime',
  '0005': 'Odonata',
  '0006': 'Itzal',
  '0007': 'Amesha',
  '0008': 'Banshee',
  '0009': 'Banshee Prime',
  '0010': 'Octavia',
  '0011': 'Valkyr',
  '0012': 'Valkyr Prime',
  '0013': 'Atlas',
  '0014': 'Mesa',
  '0015': 'Chroma',
  '0016': 'Ember',
  '0017': 'Ember Prime',
  '0018': 'Excalibur',
  '0019': 'Excalibur Prime',
  '0020': 'Excalibur Umbra',
  '0021': 'Titania',
  '0022': 'Frost',
  '0023': 'Frost Prime',
  '0024': 'Gara',
  '0025': 'Mirage',
  '0026': 'Mirage Prime',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractItemName(html) {
  if (html.includes('There is nothing here')) return null;

  // Title format examples:
  //   "Warframe Nova - Warframe Nova Builds - Overframe"
  //   "Soma Prime - Soma Prime Builds - Overframe"
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    let name = titleMatch[1].split(' - ')[0].trim();
    // Strip leading "Warframe " prefix used for warframe pages
    if (name.toLowerCase().startsWith('warframe ')) {
      name = name.slice('warframe '.length);
    }
    return name || 'Unknown';
  }
  return 'Unknown';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const results = { ...KNOWN };
  const startFrom = Object.keys(KNOWN).length + 1; // resume after known entries

  console.log(`Starting from ID ${String(startFrom).padStart(4, '0')} (${Object.keys(KNOWN).length} pre-seeded)\n`);

  let i = startFrom;

  while (true) {
    const id = String(i).padStart(4, '0');
    const url = `${BASE_URL}${id}/`;

    process.stdout.write(`[${id}] `);

    try {
      const { body } = await fetchUrl(url);
      const name = extractItemName(body);

      if (name === null) {
        console.log('EMPTY — stopping.');
        break;
      }

      results[id] = name;
      console.log(name);
    } catch (err) {
      console.log(`ERROR: ${err.message} — skipping`);
      results[id] = `ERROR: ${err.message}`;
    }

    await sleep(DELAY_MS);
    i++;
  }

  // Also write a reverse map: name -> id (useful for building links)
  const byName = {};
  for (const [id, name] of Object.entries(results)) {
    if (!name.startsWith('ERROR')) byName[name] = id;
  }

  const output = { byId: results, byName };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\nDone. ${Object.keys(results).length} items saved to ${OUTPUT_FILE}`);
  console.log('Keys: byId (id -> name) and byName (name -> id)');
}

main().catch(console.error);
