export async function onRequest({ request, env, params }) {
  // المسار العام على نطاقك
  const PUBLIC_BASE = '/hls';

  // إعدادات الأبستريم من الـ Env
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UP_PREFIX   = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  // المسار المطلوب: /hls/<path...>
  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs  = url.search || '';

  // نبني مسار الأبستريم ثم نزيل أي // مكررة
  const upstreamPath = `${UP_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // نهيدر الحاجات المهمة فقط
  const fwd = new Headers();
  for (const h of [
    'range', 'user-agent', 'accept', 'accept-encoding',
    'origin', 'referer', 'cache-control', 'pragma'
  ]) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  // نرسل نفس الميثود (GET/HEAD) للأبستريم
  let upstreamResp;
  try {
    upstreamResp = await fetch(upstreamUrl, {
      method: request.method,
      headers: fwd,
      redirect: 'follow',
    });
  } catch (e) {
    return new Response('Upstream fetch error: ' + (e?.message || 'unknown'), { status: 502 });
  }

  // رؤوس الاستجابة
  const hdr = new Headers(upstreamResp.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.set('Vary', 'Origin');
  hdr.delete('transfer-encoding');
  hdr.set('X-Upstream-URL', upstreamUrl);

  // نكشف هل الطلب ملف m3u8
  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // لو طلب HEAD: رجّع الحالة والهيدرز كما هي بدون جسم
  if (request.method === 'HEAD') {
    return new Response(null, { status: upstreamResp.status, headers: hdr });
  }

  // لو الأبستريم فشل: مرِّر الخطأ مع الجسم (إن وجد)
  if (!upstreamResp.ok) {
    const body = await upstreamResp.text().catch(() => '');
    hdr.set('Cache-Control', 'no-store');
    return new Response(body, { status: upstreamResp.status, headers: hdr });
  }

  // لو ليس m3u8 (أي: ts/fragment/فيديو/صوت/…): مرِّر البودي كما هو
  if (!isM3U8) {
    hdr.set('Cache-Control', 'no-store');
    return new Response(upstreamResp.body, { status: 200, headers: hdr });
  }

  // ==== معالجة ملفات m3u8 ====
  const raw = await upstreamResp.text();
  const hasExt = /^\uFEFF?\s*#EXTM3U/.test(raw); // يسمح بـ BOM ومسافات

  // لو الأبستريم رجّع HTML أو أي شيء غير M3U8: رجّع 502 بدل 200
  const ct = (upstreamResp.headers.get('content-type') || '').toLowerCase();
  if (!hasExt) {
    const snippet = raw.slice(0, 80).replace(/\s+/g, ' ');
    hdr.set('Content-Type', 'text/plain; charset=utf-8');
    hdr.set('Cache-Control', 'no-store');
    hdr.set('X-Invalid-M3U8', '1');
    hdr.set('X-Upstream-CT', ct);
    hdr.set('X-M3U8-Snippet', snippet);
    return new Response('Bad upstream manifest (not M3U8).', { status: 502, headers: hdr });
  }

  // دالة لتحويل أي URL إلى المسار العام على نطاقك
  function toPublicPath(p) {
    if (!p) return p;

    // مطلق http/https
    if (/^https?:\/\//i.test(p)) {
      try {
        const u = new URL(p);
        let path = u.pathname || '/';
        // أزل بادئة UP_PREFIX لو موجودة لتجنّب /hls/hls
        if (UP_PREFIX && path.startsWith(UP_PREFIX)) {
          path = path.slice(UP_PREFIX.length) || '/';
        }
        return `${PUBLIC_BASE}${path}${u.search || ''}`;
      } catch {
        return p;
      }
    }

    // نسبي: ابنِه على مسار الأب
    const parent = `${PUBLIC_BASE}${sub}`.replace(/\/[^/]*$/, '/');
    return parent + p;
  }

  // نعيد كتابة كل خط ليس تعليق (#...)
  const rewritten = raw
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line; // التعليقات كما هي
      return toPublicPath(t);
    })
    .join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  hdr.set('Cache-Control', 'no-store');
  return new Response(rewritten, { status: 200, headers: hdr });
}
