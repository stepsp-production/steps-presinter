// worker.js
export default {
  async fetch(request, env, ctx) {
    // غيّر هذا إلى نفقك الداخلي:
    const origin = 'https://dpi-magic-professionals-findings.trycloudflare.com';

    const inUrl = new URL(request.url);
    const outUrl = new URL(origin);
    outUrl.pathname = inUrl.pathname;
    outUrl.search   = inUrl.search;

    const upstream = await fetch(outUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.blob(),
      // تلميحات CF
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    });

    // اضبط Content-Type الصحيح + امنع التحويل/الضغط
    const path = outUrl.pathname;
    const newHeaders = new Headers(upstream.headers);

    if (path.endsWith('.m3u8')) {
      newHeaders.set('content-type', 'application/vnd.apple.mpegurl');
    } else if (path.endsWith('.ts')) {
      newHeaders.set('content-type', 'video/mp2t');
    }

    // منع أي ضغط قد يفسد TS (يؤدي لخطأ 0x47)
    newHeaders.delete('content-encoding');
    newHeaders.set('cache-control', 'no-cache, no-store, must-revalidate, no-transform');
    newHeaders.set('pragma', 'no-cache');
    newHeaders.set('expires', '0');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: newHeaders,
    });
  }
};
