// Same-origin proxy for the Overframe builds API. Only the two endpoints the app uses are allowed,
// and the response is always served as JSON so upstream content can never render as a page on our origin.
// No CORS headers: the app calls this from its own origin, and other sites shouldn't use it.
const ALLOWED_PATH = /^builds(\/\d+)?$/; // builds/?item_id=… (list) and builds/<id>/ (detail)

export async function onRequestGet({ request, params }) {
  const segments = (params.path || []).filter(Boolean);
  const path     = segments.join('/');
  if (!ALLOWED_PATH.test(path)) {
    return new Response('{"error":"not found"}', { status: 404, headers: jsonHeaders() });
  }

  const qs       = new URL(request.url).search;
  const upstream = `https://overframe.gg/api/v1/${path}/${qs}`;

  const res = await fetch(upstream, {
    headers: {
      'Accept':          'application/json',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.5',
    },
  });

  return new Response(res.body, { status: res.status, headers: jsonHeaders() });
}

function jsonHeaders() {
  return {
    'Content-Type':           'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}
