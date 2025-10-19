// worker.js
export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/vendor/livekit-client.umd.js') {
      const upstreams = [
        'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.js',
        'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.js',
      ];

      for (const u of upstreams) {
        try {
          const r = await fetch(u, { cf: { cacheTtl: 86400, cacheEverything: true } });
          if (r.ok) {
            let body = await r.text();
            body = body.replace(/\/\/# sourceMappingURL=.*$/m, '');
            return new Response(body, {
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
                'cache-control': 'public, max-age=86400',
              },
            });
          }
        } catch (_) {}
      }

      return new Response(
        '/* Failed to fetch livekit-client.umd.js from upstreams */',
        { status: 502, headers: { 'content-type': 'application/javascript' } }
      );
    }

    // باقي الطلبات تذهب كما هي
    return fetch(req);
  },
};
