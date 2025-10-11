export async function onRequest({ request, env, params }) {
  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');
  if (!ORIGIN_BASE) return new Response('Missing ORIGIN_BASE', { status: 500 });

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const sub = '/' + (params?.path || '');
  const url = new URL(request.url);
  const qs = url.search || '';

  const upstreamPath = `${UPSTREAM_PREFIX}${sub}`.replace(/\/{2,}/g, '/');
  const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;
  const originHost   = safeHost(ORIGIN_BASE);

  // مرّر رؤوس مهمة + اضبط Host و Accept بوضوح
  const fwd = new Headers();
  fwd.set('Host', originHost);
  fwd.set('Accept', 'application/vnd.apple.mpegurl, application/x-mpegURL, */*');
  for (const h of ['range','user-agent','accept-encoding','origin','referer']) {
    const v = request.headers.get(h);
    if (v) fwd.set(h, v);
  }

  let up;
  try {
    up = await fetch(upstreamUrl, { method: 'GET', headers: fwd });
  } catch {
    return new Response('Upstream fetch failed', { status: 502, headers: withDebug(corsHeaders(), upstreamUrl) });
  }

  const hdr = new Headers(up.headers);
  applyCors(hdr);
  hdr.set('Cache-Control', 'no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  const isM3U8 = /\.m3u8(\?.*)?$/i.test(sub);

  // إن لم يكن OK نمرره كما هو (قد يكون 404/403 يعاد HTML)
  if (!up.ok) {
    const body = await up.text().catch(() => '');
    // اضبط نوع المحتوى نصي حتى لا يحاول Hls.js تفسير HTML كـ m3u8
    if (isM3U8) hdr.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(body, { status: up.status, headers: hdr });
  }

  // ملفات الميديا/القطاعات: مرر كما هي مع 200/206 وكل الرؤوس
  if (!isM3U8) {
    if (!hdr.has('Accept-Ranges')) hdr.set('Accept-Ranges', 'bytes');
    return new Response(up.body, { status: up.status, headers: hdr });
  }

  // ملفات m3u8: إعادة كتابة الروابط
  const text = await up.text();

  const publicBase = `/hls${sub}${qs}`;
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const toHls = (input) => {
    if (!input) return input;
    try {
      if (/^https?:\/\//i.test(input)) {
        const u = new URL(input);
        return `/hls${u.pathname}${u.search || ''}`;
      }
      if (input.startsWith('/')) return `/hls${input}`;
      return parent + input.replace(/^\.\//, '');
    } catch { return input; }
  };

  const rewritten = text
    .split('\n')
    .map((line) => {
      const raw = line.trim();
      if (!raw) return line;

      // أسطر البيانات (ليست تعليقات)
      if (!raw.startsWith('#')) return toHls(raw);

      // أسطر التعليقات التي تحتوي URI="..."
      const m = raw.match(/URI="([^"]+)"/i);
      if (m) {
        return raw.replace(/URI="([^"]+)"/i, (_, uri) => `URI="${toHls(uri)}"`);
      }
      return line;
    })
    .join('\n');

  hdr.set('Content-Type', 'application/vnd.apple.mpegurl');
  return new Response(rewritten, { status: 200, headers: hdr });

  // ===== Helpers =====
  function corsHeaders() {
    const h = new Headers();
    applyCors(h);
    return h;
  }
  function applyCors(h) {
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Range, Accept, Origin, Referer, Cache-Control');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    h.set('Vary', 'Origin');
  }
  function withDebug(h, upstream) {
    const hh = new Headers(h);
    hh.set('X-Upstream-URL', upstream);
    return hh;
  }
  function safeHost(base) {
    try { return new URL(base).host; } catch { return ''; }
  }
}
