// Builds the deployable site into dist/ for Cloudflare Pages.
// Run automatically by Cloudflare Pages (build command: node build.js, build output: dist, root directory: empty).
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

// Narrow the CSP's connect-src from any Supabase project to this one, so a script injected into the
// page can't send data to an attacker's own Supabase project. Only the deployed copy is changed.
let sbOrigin;
try { sbOrigin = new URL(url).origin; } catch {}
if (!sbOrigin || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(sbOrigin)) {
  console.error(`SUPABASE_URL must look like https://<project>.supabase.co (got ${url})`);
  process.exit(1);
}
const indexPath = path.join(OUT, 'index.html');
const html      = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('https://*.supabase.co')) {
  console.error('index.html CSP no longer contains https://*.supabase.co — update build.js');
  process.exit(1);
}
fs.writeFileSync(indexPath, html.replace('https://*.supabase.co', sbOrigin));

fs.writeFileSync(path.join(OUT, 'config.js'), `window.WF_CONFIG = {
  supabaseUrl:            ${JSON.stringify(url)},
  supabasePublishableKey: ${JSON.stringify(key)},
};\n`);

console.log(`Built ${OUT}/ with: ${PUBLIC_FILES.join(', ')}, config.js`);
