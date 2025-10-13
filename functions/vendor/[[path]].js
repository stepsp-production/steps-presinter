// functions/hls/[[path]].js
export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const debug = url.searchParams.has('debug');

  // يمكن تمرير origin= لاختبار سريع من المتصفح
  const ORIGIN_BASE = (env.ORIGIN_BASE || url.searchParams.get('origin') || '').replace(/\/+$/, '');
  const UP_PREFIX   = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');
  if (!ORIGIN_BASE) {
    return new Response(JSON.stringify({ error: 'Missing ORIGIN_BASE' }), {
      status: 500, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const sub = '/' + (params?.path || '');              // مثال: /live/playlist.m3u8
  const qs  = url.search ? url.search.replace(/^\?/, '')
                 .split('&').filter(kv => !/^debug=|^origin=/.test(kv)).join('&') : '';
  const qsp = qs ? ('?' + qs) : '';
  const upstreamPath = `${UP_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qsp}`;

  try {
    const fwd = new Headers();
    for (const h of ['range','user-agent','accept','accept-encoding']) {
      const v = request.headers.get(h); if (v) fwd.set(h, v);
    }

    // اتبع التحويلات في السِيرفر لتبقى الاستجابة من نفس نطاقك
    const res = await fetch(upstreamUrl, { headers: fwd, redirect: 'follow', cf: { cacheTtl: 0 } });

    const hdr = new Headers(res.headers);
    hdr.set('Access-Control-Allow-Origin', '*');
    hdr.delete('transfer-encoding');
    hdr.set('Cache-Control', 'no-store');

    if (!res.ok) {
      const body = await res.text().catch(()=>'');
      if (debug) {
        hdr.set('content-type','application/json');
        return new Response(JSON.stringify({
          upstreamUrl, status: res.status, statusText: res.statusText, sample: body.slice(0,300)
        }), { status: res.status, headers: hdr });
      }
      return new Response(body, { status: res.status, headers: hdr });
    }

    const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);
    if (!isM3U8) return new Response(res.body, { status: 200, headers: hdr });

    // إعادة كتابة روابط الـ m3u8 لتعود عبر /hls على نطاقك
    const text   = await res.text();
    const parent = `/hls${sub}`.replace(/\/[^/]*$/, '/');
    const rewritten = text.split('\n').map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      if (/^https?:\/\//i.test(t)) {
        try { const u = new URL(t); return `/hls${u.pathname}${u.search||''}`; }
        catch { return line; }
      }
      return parent + t;
    }).join('\n');

    hdr.set('content-type','application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: 200, headers: hdr });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'fetch_failed', upstreamUrl, message: String(e) }), {
      status: 502, headers: { 'content-type':'application/json','Access-Control-Allow-Origin':'*' },
    });
  }
}
