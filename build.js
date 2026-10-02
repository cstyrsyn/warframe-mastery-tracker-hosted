// Builds the deployable site into dist/ for Cloudflare Pages.
// Run automatically by Cloudflare Pages (build command: npm run build, output directory: dist).
// Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Pages → Settings → Environment variables.
//
// Only the files in PUBLIC_FILES are deployed — everything else in the repo (dev/, docs, CI config)
// stays private. If the page starts loading a new file, add it here or it will 404 in production.
// functions/ is not listed: Pages reads it from the repo root, not from the output directory.
const fs   = require('fs');
const path = require('path');

const OUT = 'dist';
const PUBLIC_FILES = [
  'index.html',
  'app.js',
  'layout.js',
  'weapon-mr.js',
  'data',
  'Images',
  '_headers',
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('Missing env vars: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must both be set.');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

for (const file of PUBLIC_FILES) {
  if (!fs.existsSync(file)) {
    console.error(`Missing public file: ${file}`);
    process.exit(1);
  }
  fs.cpSync(file, path.join(OUT, file), { recursive: true });
}

fs.writeFileSync(path.join(OUT, 'config.js'), `window.WF_CONFIG = {
  supabaseUrl:            ${JSON.stringify(url)},
  supabasePublishableKey: ${JSON.stringify(key)},
};\n`);

console.log(`Built ${OUT}/ with: ${PUBLIC_FILES.join(', ')}, config.js`);
