// ============================================================
// Overframe CORS Proxy — for local development only
//
// SETUP:
//   1. Open https://overframe.gg in your browser
//   2. DevTools (F12) → Application → Cookies → https://overframe.gg
//   3. Copy the value of the 'cf_clearance' cookie
//   4. Paste it into CF_CLEARANCE below
//   5. node overframe_proxy.js
//
// In V3 JS, use:
//   const OF_BASE = 'http://localhost:3001';
//   fetch(`${OF_BASE}/items/arsenal/1/`)
//
// The cf_clearance cookie typically lasts several hours.
// If you start getting "Just a moment..." pages, refresh it.
// ============================================================

const CF_CLEARANCE = 'PASTE_CF_CLEARANCE_VALUE_HERE';

const http  = require('http');
const https = require('https');

const PORT = 3001;

if (CF_CLEARANCE === 'PASTE_CF_CLEARANCE_VALUE_HERE') {
  console.warn('⚠  CF_CLEARANCE is not set. Requests will likely be blocked by Cloudflare.');
}

http.createServer((req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const targetPath = req.url;
  console.log(`→ https://overframe.gg${targetPath}`);

  const proxyReq = https.get({
    hostname: 'overframe.gg',
    path:     targetPath,
    method:   'GET',
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.5',
      'Cookie':          `cf_clearance=${CF_CLEARANCE}`,
    }
  }, (proxyRes) => {
    const isHtml = (proxyRes.headers['content-type'] || '').includes('text/html');
    console.log(`  ← ${proxyRes.statusCode} ${isHtml ? '(html)' : ''}`);

    res.writeHead(proxyRes.statusCode, {
      'Content-Type':                proxyRes.headers['content-type'] || 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    res.writeHead(504);
    res.end(JSON.stringify({ error: 'Upstream timeout' }));
  });

  proxyReq.on('error', (err) => {
    console.error('  ✗', err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

}).listen(PORT, () => {
  console.log(`Overframe proxy → http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.\n');
});
