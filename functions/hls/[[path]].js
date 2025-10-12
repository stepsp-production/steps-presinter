// Cloudflare Pages Function
// بروكسي HLS يعيد كتابة الروابط داخل manifest إلى /hls على نفس النطاق.
// يتطلب متغيرات البيئة في Pages:
// ORIGIN_BASE = https://<your-tunnel-or-origin-domain>
// UPSTREAM_PREFIX = /hls  (أو / إذا كانت الروابط عند الجذر)

export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE = (env?.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env?.UPSTREAM_PREFIX ?? '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  const sub = '/' + (params?.path || '');             // مثل: /live/playlist.m3u8
  const url = new URL(request.url);
  const qs = url.search || '';

  // منع تكرار /hls/hls
  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // مرّر بعض الهيدر المفيدة لجزء TS والرنج
  const fwdHeaders = new Headers();
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwdHeaders.set(h, v);
  }

  let upstreamResp;
  try {
    upstreamResp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: fwdHeaders,
      // يمكنك تفعيل الكاش حسب حاجتك
      cf: { cacheEverything: false },
    });
  } catch (err) {
    return new Response('UPSTREAM_FETCH_FAILED', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ننسخ الهيدر مع بعض التعديل
  const outHeaders = new Headers(upstreamResp.headers);
  outHeaders.set('Access-Control-Allow-Origin', '*');
  outHeaders.delete('transfer-encoding');
  outHeaders.set('Cache-Control', 'no-store');
  outHeaders.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // لو ليس مانيفست، مرّره كما هو (TS، AAC، etc.)
  if (!isM3U8) {
    // تصحيح نوع TS إن لم يرسله الأصل
    const ct = outHeaders.get('Content-Type') || '';
    if (!ct) {
      // افتراض TS/بايتات
      if (/\.(ts|m4s)(\?.*)?$/i.test(sub)) {
        outHeaders.set('Content-Type', 'video/mp2t');
      } else {
        outHeaders.set('Content-Type', 'application/octet-stream');
      }
    }
    return new Response(upstreamResp.body, { status: upstreamResp.status, headers: outHeaders });
  }

  // مانيفست M3U8: لو upstream ليس OK - أعطِ نفس الكود
  if (!upstreamResp.ok) {
    const body = await upstreamResp.text().catch(() => '');
    return new Response(body || 'UPSTREAM_NOT_OK', {
      status: upstreamResp.status,
      headers: outHeaders,
    });
  }

  // اقرأ النص
  const text = await upstreamResp.text();

  // لو المحتوى ليس M3U8 أعد 502 لتفادي manifestParsingError المضلل
  if (!/^#EXTM3U/.test(text.trim())) {
    const sample = text.slice(0, 200).replace(/\n/g, '\\n');
    outHeaders.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(`NOT_M3U8_TEXT\nUPSTREAM: ${upstreamUrl}\nSAMPLE: ${sample}`, {
      status: 502,
      headers: outHeaders,
    });
  }

  // أعِد كتابة الروابط إلى /hls داخل نفس النطاق
  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const rewritten = text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line; // التعليقات تُترك

      // absolute URL
      if (/^https?:\/\//i.test(t)) {
        try {
          const u = new URL(t);
          return `/hls${u.pathname}${u.search || ''}`;
        } catch {
          return line;
        }
      }
      // relative URL
      return parent + t;
    })
    .join('\n');

  outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: outHeaders });
}
