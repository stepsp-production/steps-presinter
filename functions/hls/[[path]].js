export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) return new Response('Missing ORIGIN_BASE', { status: 500 });

  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  const fwd = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }

  const up = await fetch(upstreamUrl, { headers: fwd });

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
