export async function onRequest({ request, env, params }) {
  const PUBLIC_BASE = '/hls';

  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UP_PREFIX   = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    return new Response('Missing ORIGIN_BASE', { status: 500 });
  }

  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs  = url.search || '';

  const upstreamPath = `${UP_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // بعض الأورجن لا يدعم HEAD: نحول HEAD -> GET ونرجع فقط الهيدر
  const method = request.method === 'HEAD' ? 'GET' : request.method;

  const fwd = new Headers();
  for (const h of [
    'range','user-agent','accept','accept-encoding',
    'origin','referer','cache-control','pragma'
  ]) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }
  // لو كان HEAD أصلاً، أرسل GET مع Range صغير
  if (request.method === 'HEAD') {
    if (!fwd.has('range')) fwd.set('range','bytes=0-1');
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { method, headers: fwd, redirect:'follow' });
  } catch (e) {
    return new Response('Upstream fetch error: ' + (e?.message || 'unknown'), { status: 502 });
  }

  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.set('Vary', 'Origin');
  hdr.delete('transfer-encoding');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // لو كان الطلب الأصلي HEAD: أعطِ نفس الحالة بدون جسم
  if (request.method === 'HEAD') {
    // إن كان GET رجع OK/206 نعتبرها 200
    const status = up.ok || up.status === 206 ? 200 : up.status;
    return new Response(null, { status, headers: hdr });
  }

  if (!up.ok) {
    const body = await up.text().catch(() => '');
    hdr.set('Cache-Control', 'no-store');
    return new Response(body, { status: up.status, headers: hdr });
  }

  if (!isM3U8) {
    hdr.set('Cache-Control', 'no-store');
    return new Response(up.body, { status: 200, headers: hdr });
  }

  const raw = await up.text();
  const hasExt = /^\uFEFF?\s*#EXTM3U/.test(raw);
  const ct = (up.headers.get('content-type') || '').toLowerCase();

  if (!hasExt) {
    hdr.set('Content-Type', 'text/plain; charset=utf-8');
    hdr.set('Cache-Control', 'no-store');
    hdr.set('X-Invalid-M3U8', '1');
    hdr.set('X-Upstream-CT', ct);
    return new Response('Bad upstream manifest (not M3U8).', { status: 502, headers: hdr });
  }

  function toPublicPath(p) {
    if (!p) return p;
    if (/^https?:\/\//i.test(p)) {
      try {
        const u = new URL(p);
        let path = u.pathname || '/';
        if (UP_PREFIX && path.startsWith(UP_PREFIX)) {
          path = path.slice(UP_PREFIX.length) || '/';
        }
        return `${PUBLIC_BASE}${path}${u.search || ''}`;
      } catch { return p; }
    }
    const parent = `${PUBLIC_BASE}${sub}`.replace(/\/[^/]*$/, '/');
    return parent + p;
  }

  const rewritten = raw
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      return toPublicPath(t);
    })
    .join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  hdr.set('Cache-Control', 'no-store');
  return new Response(rewritten, { status: 200, headers: hdr });
}
