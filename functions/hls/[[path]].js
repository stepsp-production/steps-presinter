export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const qs = url.search || '';
  const ping = url.searchParams.has('ping');
  const diag = url.searchParams.has('diag');

  // تقبل قائمة أصول مفصولة بفواصل
  const ORIGINS = (env.ORIGIN_BASES || env.ORIGIN_BASE || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/+$/, ''));

  const UP_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGINS.length) {
    const body = diag
      ? JSON.stringify({ error: 'Missing ORIGIN_BASE or ORIGIN_BASES' })
      : 'Missing ORIGIN_BASE';
    return new Response(body, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': diag ? 'application/json' : 'text/plain' }
    });
  }

  // تنظيف المسار (تجنّب /hls/hls)
  let sub = (params?.path || '').replace(/^\/+/, '');
  if (sub.startsWith('hls/')) sub = sub.slice(4);

  // شطب معلمات التشخيص من الـQS للأبستريم
  const scrubQS = qs
    .replace(/[?&](ping|diag)=[^&]*/g, '')
    .replace(/([?&])(ping|diag)(?=&|$)/g, '')
    .replace(/\?&/, '?');

  // ترويسات نمررها
  const baseFwd = new Headers();
  for (const h of ['range', 'user-agent', 'accept', 'origin', 'referer', 'accept-encoding']) {
    const v = request.headers.get(h);
    if (v) baseFwd.set(h, v);
  }

  const buildUp = (origin) => {
    const path = `${UP_PREFIX}/${sub}`.replace(/\/{2,}/g, '/');
    return `${origin}${path}${scrubQS}`;
  };

  const common = (hdrs, usedOrigin, upstreamUrl) => {
    hdrs.set('Access-Control-Allow-Origin', '*');
    hdrs.set('Cache-Control', 'no-store');
    if (usedOrigin) hdrs.set('X-Used-Origin', usedOrigin);
    if (upstreamUrl) hdrs.set('X-Upstream-URL', upstreamUrl);
  };

  // ---- PING / HEAD ----
  if (ping || method === 'HEAD') {
    for (const origin of ORIGINS) {
      const upstreamUrl = buildUp(origin);
      try {
        // HEAD أولاً
        let r = await fetch(upstreamUrl, { method: 'HEAD', headers: baseFwd, redirect: 'follow' });
        if (r.ok) {
          const h = new Headers(); common(h, origin, upstreamUrl);
          return new Response(null, { status: 204, headers: h });
        }
        // GET بنطاق صغير كاحتياط
        const fwd = new Headers(baseFwd);
        fwd.set('range', 'bytes=0-0');
        r = await fetch(upstreamUrl, { method: 'GET', headers: fwd, redirect: 'follow' });
        if (r.status === 206 || r.status === 200) {
          const h = new Headers(); common(h, origin, upstreamUrl);
          return new Response(null, { status: 204, headers: h });
        }
      } catch (e) {
        // جرّب الأصل التالي
      }
    }
    const h = new Headers(); common(h, null, null);
    return new Response(null, { status: 502, headers: h });
  }

  // ---- GET عادي ----
  const isM3U8 = /\.m3u8(?:\?.*)?$/i.test(sub);
  let lastStatus = 502, lastBody = '', lastHdrs = null;

  for (const origin of ORIGINS) {
    const upstreamUrl = buildUp(origin);
    let up;
    try {
      up = await fetch(upstreamUrl, { headers: baseFwd, redirect: 'follow' });
    } catch (e) {
      lastStatus = 502; lastBody = diag ? JSON.stringify({ origin, upstreamUrl, error: String(e) }) : 'Upstream error';
      continue;
    }

    const hdr = new Headers(up.headers);
    common(hdr, origin, upstreamUrl);

    if (!up.ok) {
      lastStatus = up.status;
      lastHdrs = hdr;
      lastBody = diag ? await up.text().catch(()=>'') : 'Upstream error';
      continue; // جرّب أصلًا آخر
    }

    if (!isM3U8) {
      return new Response(up.body, { status: 200, headers: hdr });
    }

    const text = await up.text();
    if (!/^#EXTM3U/m.test(text)) {
      // ليس ملف M3U8 حقيقي (أحيانًا صفحات HTML من أصل خاطئ)
      lastStatus = 502; lastHdrs = hdr; lastBody = diag ? text.slice(0, 400) : 'Bad playlist';
      continue;
    }

    const publicBase = `/hls/${sub}${qs || ''}`.replace(/\/{2,}/g, '/');
    const parent = publicBase.replace(/\/[^/]*$/, '/');
    const rewritten = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      if (/^https?:\/\//i.test(t)) {
        try { const u = new URL(t); return `/hls${u.pathname}${u.search || ''}`.replace(/\/{2,}/g, '/'); }
        catch { return line; }
      }
      return (parent + t).replace(/\/{2,}/g, '/');
    }).join('\n');

    hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: 200, headers: hdr });
  }

  // لم ينجح أي أصل
  const outHdr = lastHdrs || new Headers();
  common(outHdr, null, null);
  if (diag && typeof lastBody === 'string') {
    outHdr.set('Content-Type', 'text/plain; charset=utf-8');
  }
  return new Response(lastBody || 'Upstream error', { status: lastStatus || 502, headers: outHdr });
}
