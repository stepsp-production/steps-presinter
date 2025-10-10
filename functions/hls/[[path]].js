// functions/hls/[...path].js
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const upstreamBase = (env.ORIGIN_BASE || '').replace(/\/+$/,''); // مثال: https://xxx.trycloudflare.com
  const prefix = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/,''); // مثال: /hls

  if (!upstreamBase) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  // المسار بعد /hls على نطاقك
  const sub = url.pathname.replace(/^\/hls/, '') + (url.search || '');
  const upstreamUrl = upstreamBase + prefix + sub;

  // مرر بعض الهيدرز المهمّة (Range وغيرها)
  const fwdHeaders = new Headers(request.headers);
  const up = await fetch(upstreamUrl, { method: 'GET', headers: fwdHeaders });

  const outHeaders = new Headers(up.headers);
  outHeaders.set('Access-Control-Allow-Origin', '*');
  outHeaders.set('Cache-Control', 'no-store');

  // m3u8 → أعد كتابة الروابط إلى /hls على نفس الدومين
  if (/\.m3u8($|\?)/i.test(url.pathname)) {
    const text = await up.text();
    const parent = url.pathname.replace(/\/[^\/]*$/, '/');
    const rewritten = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      // مطلق → رجّعه إلى /hls محليًا
      try {
        const abs = new URL(t);
        return '/hls' + abs.pathname + (abs.search || '');
      } catch {
        // نسبي → أبقه في مجلد المانيفست
        return parent + t;
      }
    }).join('\n');

    outHeaders.set('content-type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: up.status, headers: outHeaders });
  }

  // باقي القطع (ts, m4s, mp4, …) نمرّرها كما هي
  return new Response(up.body, { status: up.status, headers: outHeaders });
}
