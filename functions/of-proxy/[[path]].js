const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, params }) {
  const path     = params.path ? params.path.join('/') : '';
  const qs       = new URL(request.url).search;
  const upstream = `https://overframe.gg/api/v1/${path}/${qs}`;

  const res = await fetch(upstream, {
    headers: {
      'Accept':          'application/json',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.5',
    },
  });

  return new Response(res.body, {
    status:  res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      ...CORS,
    },
  });
}
