// functions/vendor/[file].js
export async function onRequest(context) {
  const { file } = context.params;            // مثال: "livekit-client.umd.min.js"
  // اسم واحد مسموح به: livekit-client.umd.min.js
  if (!file || !/^livekit-client(\.umd)?\.min\.js$/i.test(file)) {
    return new Response('Not found', { status: 404 });
  }

  const cdns = [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js',
    'https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js',
  ];

  for (const url of cdns) {
    try {
      const up = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (up.ok) {
        // مرِّر المحتوى كما هو مع MIME صحيح
        return new Response(await up.arrayBuffer(), {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
          },
        });
      }
    } catch (_) {}
  }
  return new Response('CDN fetch failed', { status: 502 });
}
