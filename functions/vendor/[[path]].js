// Cloudflare Pages Function: يقدّم أي ملف JS تحت /vendor/* من عدّة CDN مع fallback.
// أمثلة:
//   /vendor/hls.min.js
//   /vendor/livekit-client.umd.min.js
//   /vendor/livekit-client.umd.js
export async function onRequest({ request, params }) {
  const name = String(params?.path || '').split('/').pop() || '';

  // خرائط المصادر (يمكنك تعديل الإصدارات عند الحاجة)
  const cdnMap = {
    'hls.min.js': [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js',
    ],
    'livekit-client.umd.min.js': [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
    ],
    'livekit-client.umd.js': [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.js',
      'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.js',
    ],
  };

  // تجاهُل sourcemaps حتى لا تسبب أخطاء CSP/شبكة
  if (name.endsWith('.map')) {
    return new Response('', {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    });
  }

  const cdns = cdnMap[name];
  if (!cdns) {
    return new Response(`Not found: ${name}`, { status: 404 });
  }

  // HEAD على /vendor/* نعيد نفس الترويسات بدون جسم
  const wantHead = request.method === 'HEAD';

  let lastErr = '';
  for (const url of cdns) {
    try {
      const up = await fetch(url, {
        // تمكين كاش Cloudflare edge
        cf: { cacheEverything: true, cacheTtl: 86400 },
        redirect: 'follow',
      });

      if (!up.ok) {
        lastErr += `\n${url} -> HTTP ${up.status}`;
        continue;
      }

      const headers = new Headers(up.headers);
      headers.set('Content-Type', 'application/javascript; charset=utf-8');
      headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Fetched-From', url);
      headers.delete('Transfer-Encoding');

      if (wantHead) {
        // للطلبات HEAD يكفي الترويسات
        return new Response(null, { status: 200, headers });
      }

      // مرّر الجسم كما هو لتجنب تحميله في الذاكرة
      return new Response(up.body, { status: 200, headers });
    } catch (e) {
      lastErr += `\n${url} -> ${e?.message || e}`;
    }
  }

  return new Response(
    `CDN fetch failed for ${name}.${lastErr ? '\nTried:\n' + lastErr : ''}`,
    { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
