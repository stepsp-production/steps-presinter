// Cloudflare Pages Function
// يخدم مكتبات JS من نفس نطاقك لتجاوز قيود الـ CSP.
// أمثلة: /vendor/hls.min.js  /vendor/livekit-client.umd.min.js  /vendor/ping.js

export async function onRequest({ params }) {
  const name = params?.name || '';

  // خريطة المصادر المسموح بها
  const SOURCES = {
    'hls.min.js': [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
    ],
    'livekit-client.umd.min.js': [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
    ],
  };

  // ملف اختبار بسيط
  if (name === 'ping.js') {
    const body = `console.log("[vendor/ping] ok", new Date().toISOString());`;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const cdnList = SOURCES[name];
  if (!cdnList) {
    return new Response(`Not allowed: ${name}`, { status: 404 });
  }

  for (const url of cdnList) {
    try {
      const r = await fetch(url, {
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (r.ok) {
        // نعيد المحتوى مع نوع MIME الصحيح حتى لا يحدث nosniff
        return new Response(r.body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
            'Access-Control-Allow-Origin': '*',
            'X-Source-URL': url,
          },
        });
      }
    } catch (_) {
      // جرّب التالي
    }
  }

  return new Response('CDN fetch failed for ' + name, { status: 502 });
}
