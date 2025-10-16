// worker.js
export default {
  async fetch(request, env, ctx) {
    const origin = 'https://coating-entities-camel-distances.trycloudflare.com'; // نفس نفقك
    const inUrl = new URL(request.url);
    const outUrl = new URL(origin);
    outUrl.pathname = inUrl.pathname;
    outUrl.search   = inUrl.search;

    const fwd = new Headers(request.headers);
    // منع الضغط/التحويل
    fwd.set('Accept-Encoding', 'identity');
    fwd.set('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');

    const init = {
      method: request.method,
      headers: fwd,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.blob(),
      cf: { cacheTtl: 0, cacheEverything: false },
    };

    const upstream = await fetch(outUrl.toString(), init);
    const path = outUrl.pathname;
    const h = new Headers(upstream.headers);

    // أنواع صحيحة
    if (path.endsWith('.m3u8')) h.set('content-type', 'application/vnd.apple.mpegurl');
    else if (path.endsWith('.ts')) h.set('content-type', 'video/mp2t');

    // لا ضغط ولا تحويل
    h.delete('content-encoding');
    h.set('cache-control', 'no-cache, no-store, must-revalidate, no-transform');
    h.set('pragma', 'no-cache');
    h.set('expires', '0');
    h.set('access-control-allow-origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: h,
    });
  }
};
