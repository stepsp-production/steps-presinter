const CDN = {
  'livekit-client.umd.min.js': [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js'
  ],
  'hls.min.js': [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js'
  ],
  'ping.js': ['data:text/javascript,console.log("vendor ok")'] // فحص سريع
};

export async function onRequest({ params }) {
  const name = String(params?.path || '');
  const list = CDN[name];
  if (!list) return new Response('Not found', { status: 404 });

  for (const src of list) {
    try {
      if (src.startsWith('data:')) {
        return new Response(await (await fetch(src)).text(), {
          headers: baseHeaders()
        });
      }
      const r = await fetch(src, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        const h = baseHeaders();
        h.set('Cache-Control','public, max-age=86400, s-maxage=604800, immutable');
        return new Response(r.body, { headers: h });
      }
    } catch {}
  }
  return new Response('Upstream CDN error', { status: 502, headers: baseHeaders() });

  function baseHeaders() {
    const h = new Headers();
    h.set('Content-Type', 'application/javascript; charset=utf-8');
    h.set('Access-Control-Allow-Origin', '*');
    return h;
  }
}
