// worker.js
export default {
  async fetch(request, env, ctx) {
    const origin = 'https://dpi-magic-professionals-findings.trycloudflare.com'; // غيّره إلى نفقك

    const inUrl = new URL(request.url);
    const outUrl = new URL(origin);
    outUrl.pathname = inUrl.pathname;
    outUrl.search   = inUrl.search;

    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.set('Accept-Encoding', 'identity');
    fwdHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');

    const init = {
      method: request.method,
      headers: fwdHeaders,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.blob(),
      cf: { cacheTtl: 0, cacheEverything: false },
    };

    const upstream = await fetch(outUrl.toString(), init);

    const path = outUrl.pathname;
    const newHeaders = new Headers(upstream.headers);

    if (path.endsWith('.m3u8')) newHeaders.set('content-type', 'application/vnd.apple.mpegurl');
    else if (path.endsWith('.ts')) newHeaders.set('content-type', 'video/mp2t');

    newHeaders.delete('content-encoding');
    newHeaders.set('cache-control', 'no-cache, no-store, must-revalidate, no-transform');
    newHeaders.set('pragma', 'no-cache');
    newHeaders.set('expires', '0');
    newHeaders.set('access-control-allow-origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: newHeaders,
    });
  }
};
