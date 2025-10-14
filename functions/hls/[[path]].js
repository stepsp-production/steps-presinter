export async function onRequest({ request, env, params }) {
  const PUBLIC_BASE = '/hls';

  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UP_PREFIX   = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) return new Response('Missing ORIGIN_BASE', { status: 500 });

  const reqUrl = new URL(request.url);
  const sub = '/' + (params?.path || '');
  const qs  = reqUrl.search || '';
  const isDiag = reqUrl.searchParams.has('diag');
  const isPing = reqUrl.searchParams.has('ping'); // ping من الواجهة

  const upstreamPath = `${UP_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;

  // حوّل HEAD إلى GET + Range صغير
  const method = request.method === 'HEAD' ? 'GET' : request.method;

  const fwd = new Headers();
  for (const h of [
    'range','user-agent','accept','accept-encoding',
    'origin','referer','cache-control','pragma'
  ]) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }
  if (request.method === 'HEAD' && !fwd.has('range')) {
    fwd.set('range','bytes=0-1');
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { method, headers: fwd, redirect: 'follow' });
  } catch (e) {
    if (isDiag) {
      return new Response(JSON.stringify({ ok:false, when:'fetch', error: e?.message || String(e), upstreamUrl }), {
        status: 502,
        headers: { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' }
      });
    }
    return new Response('Upstream fetch error', { status: 502 });
  }

  // وضع التشخيص: أعطني ملخّصًا بدل الجسم
  if (isDiag) {
    const ct = up.headers.get('content-type');
    const head = {};
    up.headers.forEach((v,k)=> head[k]=v);
    return new Response(JSON.stringify({
      ok: up.ok, status: up.status, statusText: up.statusText,
      upstreamUrl, contentType: ct, headers: head
    }, null, 2), {
      status: up.ok ? 200 : up.status,
      headers: { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' }
    });
  }

  const hdr = new Headers(up.headers);
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.set('Vary', 'Origin');
  hdr.delete('transfer-encoding');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // لو الطلب الأصلي HEAD: نرجع بدون جسم
  if (request.method === 'HEAD') {
    const status = up.ok || up.status === 206 ? 200 : up.status;
    return new Response(null, { status, headers: hdr });
  }

  if (!up.ok) {
    const body = await up.text().catch(()=>'');
    hdr.set('Cache-Control','no-store');
    return new Response(body || 'Upstream not ok', { status: up.status, headers: hdr });
  }

  // السماح للـ ping بتجاوز فحص EXTM3U (الغرض مجرد تحقّق سريع)
  if (isPing && isM3U8) {
    hdr.set('Cache-Control','no-store');
    hdr.set('Content-Type', up.headers.get('content-type') || 'application/vnd.apple.mpegurl');
    return new Response(up.body, { status: 200, headers: hdr });
  }

  if (!isM3U8) {
    hdr.set('Cache-Control','no-store');
    return new Response(up.body, { status: 200, headers: hdr });
  }

  const raw = await up.text();
  const hasExt = /^\uFEFF?\s*#EXTM3U/.test(raw);
  const ct = (up.headers.get('content-type') || '').toLowerCase();

  if (!hasExt) {
    hdr.set('Cache-Control', 'no-store');
    hdr.set('Content-Type', 'text/plain; charset=utf-8');
    hdr.set('X-Upstream-CT', ct);
    return new Response('Bad upstream manifest (not M3U8).', { status: 502, headers: hdr });
  }

  function toPublicPath(p) {
    if (!p) return p;
    if (/^https?:\/\//i.test(p)) {
      try {
        const u = new URL(p);
        let path = u.pathname || '/';
        if (UP_PREFIX && path.startsWith(UP_PREFIX)) path = path.slice(UP_PREFIX.length) || '/';
        return `${PUBLIC_BASE}${path}${u.search || ''}`;
      } catch { return p; }
    }
    const parent = `${PUBLIC_BASE}${sub}`.replace(/\/[^/]*$/, '/');
    return parent + p;
  }

  const rewritten = raw
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      return toPublicPath(t);
    })
    .join('\n');

  hdr.set('Cache-Control','no-store');
  hdr.set('Content-Type','application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
