export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const diag = url.searchParams.has('diag');
  const ping = url.searchParams.has('ping');

  const ORIGIN_BASE = (env.ORIGIN_BASE || '').replace(/\/+$/, '');
  const UPSTREAM_PREFIX = (env.UPSTREAM_PREFIX || '/hls').replace(/\/+$/, '');

  if (!ORIGIN_BASE) {
    const msg = { error: 'Missing ORIGIN_BASE', hint: 'Set Pages Function env ORIGIN_BASE to your tunnel/base URL' };
    return new Response(diag ? JSON.stringify(msg) : 'Missing ORIGIN_BASE', {
      status: 500,
      headers: { 'Content-Type': diag ? 'application/json' : 'text/plain', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const raw = (params?.path || '').replace(/^\/+/, '');        // e.g. "live/playlist.m3u8" or "hls/live/playlist.m3u8"
  const trimmed = raw.startsWith('hls/') ? raw.slice(4) : raw;  // امنع /hls/hls
  const upstreamPath = `${UPSTREAM_PREFIX}/${trimmed}`.replace(/\/{2,}/g, '/');
  const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${url.search ? url.search.replace(/[?&](diag|ping)(=[^&]*)?/g,'') : ''}`;

  const fwd = {};
  for (const h of ['range','user-agent','accept','accept-encoding','origin','referer']) {
    const v = request.headers.get(h); if (v) fwd[h]=v;
  }

  if (ping && request.method === 'GET') {
    try {
      const r = await fetch(upstreamUrl, { method:'HEAD', headers:fwd, redirect:'follow' });
      return new Response(null, {
        status: r.ok ? 204 : r.status,
        headers: { 'Access-Control-Allow-Origin':'*','X-Upstream-URL':upstreamUrl,'Cache-Control':'no-store' }
      });
    } catch (e) {
      return new Response(null, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin':'*','X-Upstream-URL':upstreamUrl,'X-Error':String(e).slice(0,200),'Cache-Control':'no-store' }
      });
    }
  }

  let up, fetchErr=null;
  try { up = await fetch(upstreamUrl, { headers:fwd, redirect:'follow' }); }
  catch(e){ fetchErr = e?.message || String(e); }

  const hdr = new Headers(up?.headers || {});
  hdr.set('Access-Control-Allow-Origin','*');
  hdr.delete('transfer-encoding');
  hdr.set('Cache-Control','no-store');
  hdr.set('X-Upstream-URL', upstreamUrl);

  if (!up || !up.ok) {
    if (diag) {
      const body = up ? (await up.text().catch(()=>'')) : '';
      const info = { ok:false, upstreamUrl, status: up?up.status:502, fetchError:fetchErr, bodySnippet: body.slice(0,400) };
      return new Response(JSON.stringify(info,null,2), { status: up?up.status:502, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
    }
    return new Response('Upstream error', { status: up?up.status:502, headers: hdr });
  }

  const pathLower = trimmed.toLowerCase();
  const isM3U8 = pathLower.endsWith('.m3u8');

  if (!isM3U8) return new Response(up.body, { status:200, headers: hdr });

  const text = await up.text();
  if (!/^#EXTM3U/m.test(text)) {
    if (diag) {
      return new Response(JSON.stringify({ ok:false, reason:'not-m3u8', upstreamUrl, head:text.slice(0,200) },null,2), {
        status: 502, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
      });
    }
    return new Response('Bad playlist', { status:502, headers: hdr });
  }

  const publicBase = `/hls/${trimmed}${url.search || ''}`.replace(/\/{2,}/g,'/');
  const parent = publicBase.replace(/\/[^/]*$/, '/');

  const rewritten = text.split('\n').map((line)=>{
    const t=line.trim();
    if (!t || t.startsWith('#')) return line;
    if (/^https?:\/\//i.test(t)) {
      try { const u=new URL(t); return `/hls${u.pathname}${u.search||''}`.replace(/\/{2,}/g,'/'); }
      catch { return line; }
    }
    return (parent + t).replace(/\/{2,}/g,'/');
  }).join('\n');

  hdr.set('Content-Type','application/vnd.apple.mpegurl');
  return new Response(rewritten, { status:200, headers:hdr });
}
