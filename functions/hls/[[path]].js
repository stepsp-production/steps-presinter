export async function onRequest({ request, env, params }) {
  const ORIGIN_RAW = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  if (!ORIGIN_RAW) return new Response('Missing ORIGIN_BASE', { status: 500 });

  // أزل أي /hls في نهاية ORIGIN_BASE حتى لا يحدث /hls/hls
  const ORIGIN_BASE = ORIGIN_RAW.replace(/\/hls$/i, '');
  const UPSTREAM_PREFIX = ((env.UPSTREAM_PREFIX ?? '/hls') || '').replace(/\/+$/, '') || '';

  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // مرّر بعض الرؤوس المهمة فقط
  const fwd = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { headers: fwd });
  } catch (e) {
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

  if (!isM3U8) {
    return new Response(up.body, { status: 200, headers: hdr });
  }

  const text = await up.text();
  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  // أعد كتابة روابط المانيفست ليعود كل شيء عبر نفس الـWorker
  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        return `/hls${u.pathname}${u.search || ''}`;
      } catch { return line; }
    }
    return parent + t;
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
