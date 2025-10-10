// functions/vendor/[file].js
export async function onRequest(context) {
  const { file } = context.params; // مثلا: "livekit-client.umd.min"
  // نسمح فقط بالاسم المطلوب لأمان أعلى
  if (file !== 'livekit-client.umd.min') {
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
        const body = await up.arrayBuffer();
        return new Response(body, {
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
