// functions/vendor/livekit-client.umd.min.js
export async function onRequest() {
  const cdns = [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
  ];

  for (const url of cdns) {
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        const body = await r.arrayBuffer();
        return new Response(body, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
          },
        });
      }
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502 });
}
