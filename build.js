// Generates config.js from Cloudflare Pages environment variables.
// Run automatically by Cloudflare Pages before serving.
// Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Pages → Settings → Environment variables.
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('Missing env vars: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must both be set.');
  process.exit(1);
}

fs.writeFileSync('config.js', `window.WF_CONFIG = {
  supabaseUrl:            '${url}',
  supabasePublishableKey: '${key}',
};\n`);

console.log('config.js generated.');
