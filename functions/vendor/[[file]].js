const MAP = {
  'hls.min.js': [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
    'https://cdn.jsdelivr.net/npm/hls.js@latest',
  ],
  'livekit-client.umd.min.js': [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
  ],
};

export async function onRequest({ params }) {
  const name = decodeURIComponent(params?.file || '').trim();
  const cds = MAP[name];
  if (!cds) return new Response('Not found', { status: 404 });

  for (const url of cds) {
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        return new Response(r.body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
          },
        });
      }
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502 });
}
