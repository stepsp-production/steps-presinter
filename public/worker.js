// worker.js
export default {
  async fetch(request, env, ctx) {
    // ✅ غيّر هذا إلى نفقك
    const origin = 'https://dpi-magic-professionals-findings.trycloudflare.com';

    const inUrl = new URL(request.url);
    const outUrl = new URL(origin);
    outUrl.pathname = inUrl.pathname;
    outUrl.search   = inUrl.search;

    // ننسخ الهيدرز لكن نُجبر عدم الضغط على الـorigin
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.set('Accept-Encoding', 'identity'); // ❗ مهم: لا gzip/br
    // منع أي حقن/تحويل
    fwdHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');

    // مرّر Range كما هو (HLS يستخدمه أحيانًا)
    const init = {
      method: request.method,
      headers: fwdHeaders,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.blob(),
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
        // لا نريد أي ضغط تلقائي
        // NOTE: Cloudflare لا يضغط عند Accept-Encoding: identity
      },
    };

    const upstream = await fetch(outUrl.toString(), init);

    // نُجهّز الهيدرز
    const path = outUrl.pathname;
    const newHeaders = new Headers(upstream.headers);

    // محتوى صحيح
    if (path.endsWith('.m3u8')) {
      newHeaders.set('content-type', 'application/vnd.apple.mpegurl');
    } else if (path.endsWith('.ts')) {
      newHeaders.set('content-type', 'video/mp2t');
    }

    // ❗ إزالة أي ترميز ضغط قادم من الأصل
    newHeaders.delete('content-encoding');

    // ❗ منع أي تحويل أو minify
    newHeaders.set('cache-control', 'no-cache, no-store, must-revalidate, no-transform');
    newHeaders.set('pragma', 'no-cache');
    newHeaders.set('expires', '0');

    // CORS (لو احتجته)
    newHeaders.set('access-control-allow-origin', '*');

    // نعيد الرد كما هو (حتى 206 للـRange)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: newHeaders,
    });
  }
};
