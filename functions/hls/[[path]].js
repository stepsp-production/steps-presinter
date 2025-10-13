export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE_RAW = env.ORIGIN_BASE || '';
  if (!ORIGIN_BASE_RAW) return new Response('Missing ORIGIN_BASE', { status: 500 });

  const ORIGIN_BASE = ORIGIN_BASE_RAW.replace(/\/+$/,'');
  const UPSTREAM_PREFIX_RAW = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/,'');
  // تفادي /hls/hls إذا كان ORIGIN_BASE منتهٍ بـ /hls
  const baseHasHls = /\/hls$/i.test(ORIGIN_BASE);
  const UPSTREAM_PREFIX = baseHasHls && UPSTREAM_PREFIX_RAW === '/hls' ? '' : UPSTREAM_PREFIX_RAW;

  const url = new URL(request.url);
  const qs = url.search || '';
  const sub = '/' + (params?.path || '');

  // ===== تشخيصات سريعة =====
  if (params?.path === '_echo') {
    return new Response(JSON.stringify({ ORIGIN_BASE, UPSTREAM_PREFIX }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (params?.path === '_probe') { // /hls/_probe?path=/live/playlist.m3u8
    const p = url.searchParams.get('path') || '/live/playlist.m3u8';
    const upstreamUrlProbe = `${ORIGIN_BASE}${UPSTREAM_PREFIX}${p}`;
    try {
      const r = await fetch(upstreamUrlProbe, { cf:{ cacheTtl:0 } });
      const text = await r.text();
      return new Response(JSON.stringify({
        upstreamUrl: upstreamUrlProbe,
        status: r.status,
        ok: r.ok,
        first: text.slice(0, 200)
      }, null, 2), { headers:{ 'Content-Type':'application/json' }});
    } catch (e) {
      return new Response(JSON.stringify({
        upstreamUrl: upstreamUrlProbe,
        error: e && e.message
      }), { status: 502, headers:{ 'Content-Type':'application/json' }});
    }
  }
  // =========================

  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g,'/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // تمرير رؤوس مهمة للأصل
  const fwd = new Headers();
  for (const h of ['range','user-agent','accept','accept-encoding','origin','referer']) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { headers: fwd, cf:{ cacheTtl:0, cacheEverything:false }});
  } catch (e) {
    return new Response(`Upstream fetch error\n${upstreamUrl}\n${e && e.message}`, { status: 502 });
  }

  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // مرّر أخطاء الأصل كما هي (404/5xx) مع الجسم إن وُجد
  if (!up.ok) {
    const body = await up.text().catch(()=> '');
    return new Response(body || `HTTP ${up.status} from upstream\n${upstreamUrl}`, {
      status: up.status || 502,
      headers: hdr
    });
  }

  // ملفات TS/غير m3u8: مرر البودي كما هو
  if (!isM3U8) {
    return new Response(up.body, { status: 200, headers: hdr });
  }

  // m3u8: نقرأ النص لنُعيد كتابة الروابط الداخلية إلى /hls/*
  const text = await up.text();
  if (!/^#EXTM3U/.test(text.trim())) {
    // إرجاع 502 واضح بدل manifestParsingError الغامض
    return new Response(`Invalid manifest content (not starting with #EXTM3U)\n${upstreamUrl}\n\n` + text.slice(0,400), {
      status: 502,
      headers: hdr
    });
  }

  // إعادة كتابة المراجع داخل المانيفست بحيث تبقى عبر نفس البروكسي
  const parent = (`/hls${sub}${qs}`).replace(/\/[^/]*$/, '/');
  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    if (/^https?:\/\//i.test(t)) { // روابط مطلقة
      try {
        const u = new URL(t);
        return `/hls${u.pathname}${u.search || ''}`;
      } catch { return line; }
    }
    // روابط نسبية
    return parent + t;
  }).join('\n');

  hdr.set('Content-Type','application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
