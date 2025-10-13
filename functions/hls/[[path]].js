export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');
  if (!ORIGIN_BASE) return new Response('Missing ORIGIN_BASE', { status: 500 });

  const url = new URL(request.url);
  const sub = '/' + (params?.path || '');
  const qs = url.search || '';
  const upstreamUrl = `${ORIGIN_BASE}${UPSTREAM_PREFIX}${sub}${qs}`.replace(/\/{2,}/g, '/');

  // إعداد رؤوس الطلب
  const fwd = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }

  try {
    const up = await fetch(upstreamUrl, { headers: fwd });

    const hdr = new Headers(up.headers);
    hdr.set('Access-Control-Allow-Origin', '*');
    hdr.set('Cache-Control', 'no-store');
    hdr.delete('transfer-encoding');

    if (!up.ok) {
      const body = await up.text().catch(() => '');
      return new Response(`Upstream ${up.status}\n${upstreamUrl}\n\n${body}`, { status: up.status, headers: hdr });
    }

    const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);
    if (!isM3U8) return new Response(up.body, { status: 200, headers: hdr });

    const text = await up.text();
    if (!/^#EXTM3U/.test(text.trim())) {
      return new Response(`Invalid manifest (no EXTM3U)\n${upstreamUrl}\n${text.slice(0, 200)}`, { status: 502 });
    }

    const parent = `/hls${sub}`.replace(/\/[^/]*$/, '/');
    const rewritten = text.split('\n').map(line => {
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
  } catch (e) {
    return new Response(`Fetch error\n${upstreamUrl}\n${e}`, { status: 502 });
  }
}
