const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
  'X-Content-Type-Options': 'nosniff',
};

async function proxyFirstOk(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (r.ok) return new Response(r.body, { headers: JS_HEADERS });
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502, headers: JS_HEADERS });
}

export async function onRequest({ params }) {
  const p = String(params?.path || '');

  if (p === 'ping.js') {
    return new Response(`window.__VENDOR_PING__=true;`, { headers: JS_HEADERS });
  }

  if (p === 'hls.min.js' || p === 'hls.js') {
    return proxyFirstOk([
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
      'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',
    ]);
  }

  if (p === 'livekit-client.umd.min.js' || p === 'livekit-client.umd.js') {
    return proxyFirstOk([
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
    ]);
  }

  return new Response('Not Found', { status: 404, headers: JS_HEADERS });
}
