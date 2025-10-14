export async function onRequest({ params }) {
  const name = (params?.path || '').toLowerCase();

  const CANDIDATES = {
    'hls.min.js': [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js'
    ],
    'livekit-client.umd.min.js': [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js'
    ],
  };

  const cdns = CANDIDATES[name];
  if (!cdns) return new Response('Not Found', { status: 404 });

  for (const url of cdns) {
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        const body = await r.arrayBuffer();
        return new Response(body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
            'X-Source-URL': url,
          }
        });
      }
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502 });
}
