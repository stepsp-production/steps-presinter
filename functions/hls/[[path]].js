export async function onRequest({ request, env, params }) {
  try {
    const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
    const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

    if (!ORIGIN_BASE) {
      return new Response('Missing ORIGIN_BASE', { status: 500 });
    }

    // sub = "/live/playlist.m3u8" مثلاً
    const sub = '/' + (params?.path || '');
    const url = new URL(request.url);
    const qs = url.search || '';

    const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
    const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

    // مرر بعض الهيدرز
    const fwd = {};
    for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
      const v = request.headers.get(h);
      if (v) fwd[h] = v;
    }

    const up = await fetch(upstreamUrl, { headers: fwd });

    // هيدرز الرد
    const hdr = new Headers(up.headers);
    hdr.set('Access-Control-Allow-Origin', '*');
    hdr.delete('transfer-encoding');
    hdr.set('Cache-Control', 'no-store');
    hdr.set('X-Upstream-URL', upstreamUrl);

    const isM3U8Path = /\.m3u8(\?.*)?$/i.test(sub);

    if (!up.ok) {
      const body = await up.text().catch(() => '');
      // مرر الحالة كما هي من الـorigin، مع X-Upstream-URL للتشخيص
      return new Response(body, { status: up.status, headers: hdr });
    }

    // لو ليست m3u8 (مثل TS segments) مررها كما هي
    if (!isM3U8Path) {
      return new Response(up.body, { status: 200, headers: hdr });
    }

    // هنا طلب مانيفست .m3u8 — افحص المحتوى
    const text = await up.text();
    const trimmed = text.slice(0, 20).trim();

    // تشخيص صارم: لو لا يبدأ بـ #EXTM3U → ارجع 502 برسالة واضحة
    if (!/^#EXTM3U/.test(trimmed)) {
      const preview = text.slice(0, 200).replace(/\s+/g, ' ');
      const diag = `Upstream did not return a valid M3U8.
X-Upstream-URL: ${upstreamUrl}
First 200 bytes: ${preview}`;
      return new Response(diag, {
        status: 502,
        headers: new Headers({
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'X-Upstream-URL': upstreamUrl,
        }),
      });
    }

    // إعادة كتابة روابط المانيفست لتسير عبر /hls على نفس النطاق
    const publicBase = `/hls${sub}${qs}`;
    const parent = publicBase.replace(/\/[^/]*$/, '/');

    const rewritten = text
      .split('\n')
      .map((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        if (/^https?:\/\//i.test(t)) {
          try {
            const u = new URL(t);
            return `/hls${u.pathname}${u.search || ''}`;
          } catch {
            return line;
          }
        }
        return parent + t;
      })
      .join('\n');

    const h2 = new Headers(hdr);
    h2.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: 200, headers: h2 });
  } catch (e) {
    return new Response(`HLS proxy error: ${e?.message || e}`, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  }
}
