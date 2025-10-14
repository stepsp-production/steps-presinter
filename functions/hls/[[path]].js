export async function onRequest({ request, env, params }) {
  const PUBLIC_BASE = '/hls'; // مسار الوكيل على نطاقك
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UP = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) return new Response('Missing ORIGIN_BASE', { status: 500 });

  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  const upstreamPath = `${UP}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  const fwd = new Headers();
  for (const h of ['range','user-agent','accept','accept-encoding','origin','referer','cache-control','pragma']) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  let up;
  try {
    up = await fetch(upstreamUrl, {
      method: request.method,           // ← نحافظ على GET/HEAD
      headers: fwd,
      redirect: 'follow',
    });
  } catch (e) {
    return new Response('Upstream fetch error: ' + (e?.message || 'unknown'), { status: 502 });
  }

  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.set('Vary', 'Origin');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control', request.method === 'GET' ? 'no-store' : 'no-cache');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // HEAD: أعِد نفس الحالة والهيدرز بدون جسم
  if (request.method === 'HEAD') {
    return new Response(null, { status: up.status, headers: hdr });
  }

  if (!up.ok) {
    const body = await up.text().catch(() => '');
    return new Response(body, { status: up.status, headers: hdr });
  }

  if (!isM3U8) {
    return new Response(up.body, { status: 200, headers: hdr });
  }

  const text = await up.text();

  function toPublic(p) {
    if (!p) return p;
    // مطلق
    if (/^https?:\/\//i.test(p)) {
      try {
        const u = new URL(p);
        let path = u.pathname || '/';
        // ازل البادئة المكررة إن وُجدت
        if (UP && path.startsWith(UP)) path = path.slice(UP.length);
        return `${PUBLIC_BASE}${path}${u.search || ''}`;
      } catch { return p; }
    }
    // نسبي
    const parent = `${PUBLIC_BASE}${sub}`.replace(/\/[^/]*$/, '/');
    return parent + p;
  }

  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    return toPublic(t);
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
