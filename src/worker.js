export default {
  async fetch(request, env, ctx) {
    // إعدادات من بيئة الـWorker
    const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, ''); // مثال: https://coating-entities-camel-distances.trycloudflare.com
    const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

    // دعم CORS و OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (!ORIGIN_BASE) {
      return new Response('Missing ORIGIN_BASE', { status: 500 });
    }

    const url = new URL(request.url);
    // نتوقع المسار /hls/...
    if (!url.pathname.startsWith('/hls/')) {
      return new Response('Not found', { status: 404 });
    }

    // sub = ما بعد /hls (بدون تكرار سلاش)
    const sub = url.pathname.replace(/^\/hls/, '') || '/';
    const qs = url.search || '';

    // بعض خدمات HLS لا تدعم HEAD → نحوله لـ GET upstream ونرجّع HEAD للعميل
    const originalMethod = request.method;
    const upstreamMethod = originalMethod === 'HEAD' ? 'GET' : originalMethod;

    // نجمع الـ upstream URL
    const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
    const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

    // نمرّر هيدرز مهمة (خصوصًا للـ Range)
    const fwdHeaders = new Headers();
    for (const h of ['range','user-agent','accept','accept-encoding','origin','referer']) {
      const v = request.headers.get(h);
      if (v) fwdHeaders.set(h, v);
    }

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamUrl, { method: upstreamMethod, headers: fwdHeaders, redirect: 'follow' });
    } catch (e) {
      return new Response('Upstream fetch failed', {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'X-Upstream-URL': upstreamUrl,
        },
      });
    }

    // نبني هيدرز الاستجابة
    const hdr = new Headers(upstreamResp.headers);
    hdr.set('Access-Control-Allow-Origin', '*');
    hdr.set('Cache-Control', 'no-store');
    hdr.set('X-Upstream-URL', upstreamUrl);
    hdr.delete('transfer-encoding'); // نتفادى مشاكل مع المتصفح

    // إذا كان طلب العميل HEAD → رجّع نفس الحالة والهيدرز فقط
    if (originalMethod === 'HEAD') {
      return new Response(null, { status: upstreamResp.status, headers: hdr });
    }

    // لو ليس m3u8 → مرّره كما هو (ts, mp4, jpg, …)
    const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);
    if (!upstreamResp.ok) {
      const body = await upstreamResp.text().catch(()=>'');
      return new Response(body, { status: upstreamResp.status, headers: hdr });
    }
    if (!isM3U8) {
      return new Response(upstreamResp.body, { status: 200, headers: hdr });
    }

    // إعادة كتابة playlist: كل الروابط تصير عبر /hls على نفس الـWorker
    const text = await upstreamResp.text();
    const publicBase = `/hls${sub}${qs}`;
    const parent = publicBase.replace(/\/[^/]*$/, '/');
    const rewritten = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      if (/^https?:\/\//i.test(t)) {
        // رابط مطلق → حوله لـ /hls/<path>
        try {
          const u = new URL(t);
          return `/hls${u.pathname}${u.search || ''}`;
        } catch { return line; }
      }
      // رابط نسبي داخل نفس الليفل
      return parent + t;
    }).join('\n');

    hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: 200, headers: hdr });
  }
}
