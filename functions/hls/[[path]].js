export async function onRequest({ request, env, params }) {
  const ORIGIN_RAW = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  if (!ORIGIN_RAW) return new Response('Missing ORIGIN_BASE', { status: 500 });

  // امنع تكرار /hls في النهاية
  const ORIGIN_BASE = ORIGIN_RAW.replace(/\/hls$/i, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX ?? '/hls');

  const sub = '/' + (params?.path || '');
  const qs = new URL(request.url).search || '';
  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  const fwd = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { headers: fwd });
  } catch (_) {
    return new Response('Upstream fetch failed', { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  if (!up.ok) {
    const body = await up.text().catch(() => '');
    return new Response(body, { status: up.status, headers: hdr });
  }

  // لو ليس مانيفست: مرره كما هو
  if (!isM3U8) {
    return new Response(up.body, { status: 200, headers: hdr });
  }

  // تحقق من أن المحتوى بالفعل m3u8
  const text = await up.text();
  const firstNonEmpty = (text.split('\n').find(l => l.trim().length > 0) || '').trim();
  if (!firstNonEmpty.startsWith('#EXTM3U')) {
    hdr.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(
      `Bad upstream for m3u8 (no #EXTM3U). First line: ${firstNonEmpty.slice(0,120)}`,
      { status: 502, headers: hdr }
    );
  }

  // اعد كتابة روابط المانيفست لتمر عبر نفس العامل /hls
  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        const p = (u.pathname || '') + (u.search || '');
        // منع /hls/hls
        if (p.startsWith('/hls/')) return p;
        return `/hls${p}`;
      } catch { return line; }
    }
    // relative path
    return parent + t;
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
