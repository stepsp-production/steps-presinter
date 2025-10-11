export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX ?? '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    return new Response('MISSING_ORIGIN_BASE', {
      status: 500,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // مثال: path = "live/playlist.m3u8"
  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/'); // يدمج البادئات
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // مرّر بعض الهيدرز المفيدة
  const fwd = new Headers();
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  let up;
  try {
    up = await fetch(upstreamUrl, {
      headers: fwd,
      cf: { cacheEverything: false, cacheTtl: 0 },
    });
  } catch (e) {
    return new Response(
      `FETCH_ERROR\nX-Upstream-URL: ${upstreamUrl}\n${String(e && e.stack || e)}`,
      { status: 502, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const hdr = new Headers({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  if (!up.ok) {
    const snippet = await up.text().catch(() => '');
    return new Response(
      `UPSTREAM_NOT_OK status=${up.status}\nX-Upstream-URL: ${upstreamUrl}\nFirst 400 bytes:\n${snippet.slice(0, 400)}`,
      { status: up.status, headers: hdr },
    );
  }

  // ملفات TS/تنفيذي → مرّر كما هي
  if (!isM3U8) {
    up.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'transfer-encoding') hdr.set(k, v);
    });
    return new Response(up.body, { status: 200, headers: hdr });
  }

  // مانيفست → اقرأه وأعد كتابته
  let text = '';
  try {
    text = await up.text();
  } catch (e) {
    return new Response(
      `READ_UPSTREAM_ERROR\nX-Upstream-URL: ${upstreamUrl}\n${String(e)}`,
      { status: 502, headers: hdr },
    );
  }

  const trimmed = text.trim();
  if (!/^#EXTM3U/.test(trimmed)) {
    return new Response(
      `NOT_M3U8_TEXT\nX-Upstream-URL: ${upstreamUrl}\nFirst 400:\n${trimmed.slice(0, 400)}`,
      { status: 502, headers: hdr },
    );
  }

  // أعد كتابة المسارات داخل المانيفست إلى /hls
  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    if (/^https?:\/\//i.test(t)) {
      // مطلق → حوله ليمر عبر /hls
      try {
        const u = new URL(t);
        return `/hls${u.pathname}${u.search || ''}`;
      } catch {
        return line;
      }
    }
    // نسبي → على نفس المجلد
    return parent + t;
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
