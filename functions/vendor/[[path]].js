// functions/vendor/[...path].js
const CDN_LIST = [
  'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/',
  'https://unpkg.com/livekit-client@2.5.0/dist/',
  'https://cdn.livekit.io/libs/client-sdk/2.5.0/'
];

export async function onRequest({ params }) {
  const file = params.path; // مثال: 'livekit-client.umd.min.js' أو 'ping.js'

  // فحص سريع
  if (file === 'ping.js') {
    return new Response('console.log("vendor ok")', {
      headers: { 'content-type': 'application/javascript; charset=utf-8' }
    });
  }

  for (const base of CDN_LIST) {
    const url = base + file;
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) {
        const h = new Headers(r.headers);
        h.set('content-type', 'application/javascript; charset=utf-8');
        h.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
        return new Response(r.body, { status: 200, headers: h });
      }
    } catch { /* تجاهل وحاول التالي */ }
  }
  return new Response('not found', { status: 404 });
}
