export async function onRequest({ request, env, params }) {
  // الإعدادات
  const ORIGIN_BASE = String(env.ORIGIN_BASE || '').replace(/\/+$/, '');     // مثال: https://fan-receiving-infinite-thus.trycloudflare.com
  const UPSTREAM_PREFIX_RAW = String(env.UPSTREAM_PREFIX || '').trim();      // مثال: /hls
  const UPSTREAM_PREFIX = ('/' + UPSTREAM_PREFIX_RAW).replace(/\/{2,}/g, '/').replace(/\/+$/, ''); // ← يضمن /hls
  const PUBLIC_PREFIX = '/hls'; // مسار الـ Function على Pages (اسم المجلد)

  if (!ORIGIN_BASE) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  // المسار المطلوب من المتصفح: /hls/<path...>
  const url = new URL(request.url);
  const sub = '/' + (params?.path || ''); // مثل: /live/playlist.m3u8
  const qs = url.search || '';

  // وجهة الـ upstream: ORIGIN_BASE + UPSTREAM_PREFIX + sub
  const upstreamPath = (UPSTREAM_PREFIX + sub).replace(/\/{2,}/g, '/');
  const upstreamUrl = ORIGIN_BASE + upstreamPath + qs;

  // تمرير بعض الهيدر المفيدة
  const fwdHeaders = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwdHeaders[h] = v;
  }

  // الجلب من الـ upstream
  const up = await fetch(upstreamUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: fwdHeaders,
    redirect: 'follow',
    cf: { cacheEverything: false },
  });

  // ترويسات الاستجابة
  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // أخطاء upstream كما هي (مع CORS)
  if (!up.ok) {
    const body = await up.text().catch(() => '');
    return new Response(body, { status: up.status, headers: hdr });
  }

  // المقاطع/الملفات غير m3u8: مرر المحتوى كما هو (مع CORS)
  if (!isM3U8) {
    // تحسين MIME لبعض الأنواع الشائعة
    const p = sub.toLowerCase();
    if (p.endsWith('.ts')) hdr.set('Content-Type', 'video/MP2T');
    if (p.endsWith('.mp4')) hdr.set('Content-Type', 'video/mp4');
    return new Response(up.body, { status: 200, headers: hdr });
  }

  // مانيفست m3u8: إعادة كتابة كل الروابط إلى نطاقك تحت /hls/* بدون مضاعفة /hls
  const text = await up.text();

  // parent: المسار العام لمجلد المانيفست
  const publicBase = `${PUBLIC_PREFIX}${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/'); // مثل: /hls/live/

  const rewritten = text.split('\n').map((line) => {
    const raw = line;
    const t = line.trim();
    if (!t || t.startsWith('#')) return raw;

    // مطلق http(s)
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        let p = u.pathname; // مثال: /hls/live/seg.ts أو /live/seg.ts
        if (UPSTREAM_PREFIX && p.startsWith(UPSTREAM_PREFIX)) {
          p = p.slice(UPSTREAM_PREFIX.length) || '/';
        }
        if (!p.startsWith('/')) p = '/' + p;
        return `${PUBLIC_PREFIX}${p}${u.search || ''}`;
      } catch {
        return raw;
      }
    }

    // مسار مطلق يبدأ بـ /
    if (t.startsWith('/')) {
      let p = t; // مثال: /hls/live/seg.ts
      if (UPSTREAM_PREFIX && p.startsWith(UPSTREAM_PREFIX)) {
        p = p.slice(UPSTREAM_PREFIX.length) || '/';
      }
      return `${PUBLIC_PREFIX}${p}`;
    }

    // مسار نسبي: أُلصقه على مجلد المانيفست العام
    return parent + t;
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
