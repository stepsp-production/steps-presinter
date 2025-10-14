// Cloudflare Pages Function: HLS proxy & rewriter with diagnostics
// Route: /hls/*  (أمثلة: /hls/live/playlist.m3u8 , /hls/live/segment123.ts)
export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const diag = url.searchParams.has('diag');   // ?diag=1 => JSON تشخيصي
  const ping = url.searchParams.has('ping');   // HEAD/GET سريع لصحة المصدر

  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  // يجب ضبط ORIGIN_BASE من إعدادات Pages > Functions > Environment Variables
  if (!ORIGIN_BASE) {
    const msg = { error: 'Missing ORIGIN_BASE env', hint: 'Set ORIGIN_BASE to your tunnel/base URL', got: env.ORIGIN_BASE || null };
    return new Response(diag ? JSON.stringify(msg) : 'Missing ORIGIN_BASE', {
      status: 500,
      headers: { 'Content-Type': diag ? 'application/json' : 'text/plain', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // path المطلوب (مثل "live/playlist.m3u8")
  const raw = (params?.path || '').replace(/^\/+/, '');
  const sub = '/' + raw;

  // ابنِ مسار upstream: لا تضاعف /hls
  // إذا كان raw يبدأ بـ "hls/" فنزيله لأننا أصلاً داخل /hls/*
  const trimmed = raw.startsWith('hls/') ? raw.slice(4) : raw;
  const upstreamPath = `${UPSTREAM_PREFIX}/${trimmed}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${url.search ? url.search.replace(/[?&](diag|ping)(=[^&]*)?/g, '') : ''}`;

  // نمرر بعض الهيدرز فقط
  const fwd = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }

  // لو طلب ping فقط، نعمل HEAD إن أمكن
  if (ping && request.method === 'GET') {
    try {
      const head = await fetch(upstreamUrl, { method: 'HEAD', headers: fwd, redirect: 'follow' });
      return new Response(null, {
        status: head.ok ? 204 : head.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'X-Upstream-URL': upstreamUrl,
          'Cache-Control': 'no-store'
        }
      });
    } catch (e) {
      return new Response(null, {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'X-Upstream-URL': upstreamUrl,
          'X-Error': (e?.message || String(e)).slice(0, 200),
          'Cache-Control': 'no-store'
        }
      });
    }
  }

  let up;
  let errMsg = null;
  try {
    up = await fetch(upstreamUrl, { headers: fwd, redirect: 'follow' });
  } catch (e) {
    errMsg = e?.message || String(e);
  }

  const hdr = new Headers(up?.headers || {});
  hdr.set('Access-Control-Allow-Origin', '*');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  // تشخيص مفيد عند الفشل
  if (!up || !up.ok) {
    if (diag) {
      const body = up ? (await up.text().catch(()=>'')) : '';
      const info = {
        ok: false,
        upstreamUrl,
        status: up ? up.status : 502,
        headers: Object.fromEntries(hdr),
        fetchError: errMsg,
        bodySnippet: (body || '').slice(0, 500)
      };
      return new Response(JSON.stringify(info, null, 2), {
        status: up ? up.status : 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }
    return new Response('Upstream error', { status: up ? up.status : 502, headers: hdr });
  }

  // مرّر غير m3u8 كما هو (ts, mp4, key, jpg…)
  const pathLower = trimmed.toLowerCase();
  const isM3U8 = pathLower.endsWith('.m3u8');

  if (!isM3U8) {
    // بعض السيرفرات تُرجع 302 للـ ts — الرد هنا سيكون follow بالفعل
    return new Response(up.body, { status: 200, headers: hdr });
  }

  // playlist: أعد كتابة الروابط لتشير لـ /hls على نفس نطاقك
  const text = await up.text();
  // تأكد أن أول سطر #EXTM3U وإلا سيعتبرها hls.js "no EXTM3U delimiter"
  if (!/^#EXTM3U/m.test(text)) {
    if (diag) {
      return new Response(JSON.stringify({ ok:false, reason:'not-m3u8', upstreamUrl, snippet: text.slice(0, 300) }, null, 2), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }
    return new Response('Bad playlist', { status: 502, headers: hdr });
  }

  const publicBase = `/hls/${trimmed}${url.search || ''}`.replace(/\/{2,}/g, '/');
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const rewritten = text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    // مطلق http(s)
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        return `/hls${u.pathname}${u.search || ''}`.replace(/\/{2,}/g, '/');
      } catch {
        return line;
      }
    }
    // نسبي: اجعله تحت parent
    return (parent + t).replace(/\/{2,}/g, '/');
  }).join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });
}
