// يخدم: /vendor/hls.min.js  و /vendor/livekit-client.umd.min.js  و /vendor/ping.js
const CDN_MAP = {
  'hls.min.js': [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
  ],
  'livekit-client.umd.min.js': [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
  ],
};

async function serveFromList(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cf:{ cacheEverything:true, cacheTtl:86400 } });
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
  return null;
}

export async function onRequest({ params }) {
  const name = (params?.path || '').split('/').pop();

  if (name === 'ping.js') {
    return new Response(`window.VENDOR_PING="ok";`, {
      headers: { 'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store' }
    });
  }

  if (name && CDN_MAP[name]) {
    const res = await serveFromList(CDN_MAP[name]);
    if (res) return res;
    return new Response(`CDN fetch failed for ${name}`, { status: 502 });
  }

  return new Response('Not Found', { status: 404 });
}
