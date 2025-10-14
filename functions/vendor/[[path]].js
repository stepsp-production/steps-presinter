const CDN = {
  'hls.min.js': [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js'
  ],
  'livekit-client.umd.min.js': [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js'
  ],
  'ping.js': [
    'data:application/javascript;charset=utf-8,export default%20true;'
  ]
};

export async function onRequest({ params }) {
  const name = (params?.path || '').split('/').pop();
  const list = CDN[name];
  if (!list) return new Response('Not Found', { status: 404 });

  for (const url of list) {
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        return new Response(r.body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable'
          }
        });
      }
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502 });
}
