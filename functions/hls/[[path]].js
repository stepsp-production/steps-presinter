export async function onRequest({ request, env, params }) {
  // إعدادات البيئة
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  // السماح بالـ CORS + Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // المسار المطلوب داخل pages
  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  // المسار لدى الـ upstream
  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // تمرير بعض رؤوس الطلب كما هي
  const fwd = new Headers();
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  let up;
  try {
    up = await fetch(upstreamUrl, {
      method: 'GET',
      headers: fwd,
    });
  } catch (e) {
    return new Response('Upstream fetch failed', {
      status: 502,
      headers: withDebug(corsHeaders(), upstreamUrl),
    });
  }

  // ترويسات الاستجابة (نضيف CORS ونحافظ على النوع والمدى إن وُجدت)
  const hdr = new Headers(up.headers);

  // CORS كامل + إظهار الرؤوس المفيدة للفيديو
  applyCors(hdr);
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // إن لم يكن OK نرجعه كما هو (مع CORS) لتظهر رسالة واضحة
  if (!up.ok) {
    const body = await up.text().catch(() => '');
    return new Response(body, { status: up.status, headers: hdr });
  }

  // ملفات القطع/الميديا: نمرر الجسم كما هو ونحتفظ بالحالة (200/206) وكل الترويسات
  if (!isM3U8) {
    // تأكد أن Accept-Ranges موجودة (يفيد في السحب الجزئي)
    if (!hdr.has('Accept-Ranges')) hdr.set('Accept-Ranges', 'bytes');
    // لا نحذف Content-Type/Range؛ نمررها كما جاءت
    return new Response(up.body, { status: up.status, headers: hdr });
  }

  // ملفات الـ m3u8: نعيد كتابتها لتشير إلى /hls دائمًا
  const text = await up.text();

  // base العام للملف الحالي تحت /hls
  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  // دالة تحويل أي URI (مطلق أو نسبي) إلى مسار /hls
  const toHls = (input) => {
    if (!input) return input;
    try {
      if (/^https?:\/\//i.test(input)) {
        const u = new URL(input);
        return `/hls${u.pathname}${u.search || ''}`;
      }
      // نسبي: نزوجه على parent
      if (input.startsWith('/')) {
        return `/hls${input}`;
      }
      return parent + input.replace(/^\.\//, '');
    } catch {
      return input;
    }
  };

  // 1) السطور غير التعليقية (مصادر المظاهر/البدائل..)
  // 2) إعادة كتابة URI داخل الوسوم التعليقية (#EXT-...: URI="...")
  const rewritten = text
    .split('\n')
    .map((line) => {
      const raw = line.trim();
      if (!raw) return line;

      // أسطر البيانات (ليست تعليقات)
      if (!raw.startsWith('#')) {
        return toHls(raw);
      }

      // أسطر التعليقات التي تحتوي URI="..."
      // تشمل: EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA … إلخ
      const m = raw.match(/URI="([^"]+)"/i);
      if (m) {
        const replaced = raw.replace(
          /URI="([^"]+)"/i,
          (_, uri) => `URI="${toHls(uri)}"`
        );
        return replaced;
      }

      return line;
    })
    .join('\n');

  // إجبار نوع المحتوى الصحيح لقوائم m3u8
  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');

  return new Response(rewritten, { status: 200, headers: hdr });

  // ===== أدوات مساعدة للترويسات =====
  function corsHeaders() {
    const h = new Headers();
    applyCors(h);
    return h;
  }
  function applyCors(h) {
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Range, Accept, Origin, Referer, Cache-Control');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    h.set('Vary', 'Origin');
  }
  function withDebug(h, upstream) {
    const hh = new Headers(h);
    hh.set('X-Upstream-URL', upstream);
    return hh;
  }
}
