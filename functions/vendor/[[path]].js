// Cloudflare Pages Functions: /vendor/*
//
// يغطي:
//   /vendor/hls.min.js
//   /vendor/livekit-client.umd.min.js
//   /vendor/ping.js   (اختياري لفحص الصحة)

const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
  'X-Content-Type-Options': 'nosniff',
};

async function proxyFirstOk(urls, cfCache = true) {
  for (const url of urls) {
    try {
      const res = await fetch(url, cfCache ? { cf: { cacheEverything: true, cacheTtl: 86400 } } : {});
      if (res.ok) {
        // نُعيد البودي كما هو مع هيدرز JS صحيحة
        return new Response(res.body, { headers: JS_HEADERS });
      }
    } catch (_) { /* تجاهل واستمر */ }
  }
  return new Response('CDN fetch failed', { status: 502 });
}

export async function onRequest(ctx) {
  // param [[path]] يلتقط الباقي بعد /vendor/
  // أمثلة:
  //   /vendor/hls.min.js  => path: "hls.min.js"
  //   /vendor/livekit-client.umd.min.js => path: "livekit-client.umd.min.js"
  const p = (ctx?.params?.path || '').toString();

  // فحص سريع: ping
  if (p === 'ping.js') {
    return new Response(`window.__VENDOR_PING__=true;`, { headers: JS_HEADERS });
  }

  // HLS
  if (p === 'hls.min.js' || p === 'hls.js') {
    return proxyFirstOk([
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
      'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',
    ]);
  }

  // LiveKit UMD
  if (p === 'livekit-client.umd.min.js' || p === 'livekit-client.umd.js') {
    return proxyFirstOk([
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
    ]);
  }

  // غير معروف
  return new Response('Not Found', { status: 404 });
}
