export async function onRequest({ params }) {
  const name = (params?.path || '').trim().toLowerCase();
  const libs = {
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
  const list = libs[name] || [];
  for (const u of list) {
    try {
      const r = await fetch(u, { cf:{ cacheEverything:true, cacheTtl:86400 }, redirect:'follow' });
      if (r.ok) {
        return new Response(r.body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
            'Access-Control-Allow-Origin': '*',
            'X-Source-URL': u
          }
        });
      }
    } catch {}
  }
  return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
}
