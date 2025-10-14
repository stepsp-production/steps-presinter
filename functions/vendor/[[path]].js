export async function onRequest({ request, params }) {
  const name = (params?.path || '').trim().toLowerCase();

  const lists = {
    'hls.min.js': [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js'
    ],
    'livekit-client.umd.min.js': [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.3/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.3/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.3/livekit-client.umd.min.js'
    ],
  };

  const cdns = lists[name] || [];
  for (const u of cdns) {
    try {
      const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 86400 }, redirect: 'follow' });
      if (r.ok) {
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('javascript') && !u.endsWith('.js')) continue;
        return new Response(r.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
            'Access-Control-Allow-Origin': '*',
            'X-Source-URL': u
          },
        });
      }
    } catch {}
  }
  return new Response('CDN fetch failed', { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
}
