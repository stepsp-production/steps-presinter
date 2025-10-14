// Cloudflare Pages Function
// Route: /vendor/*  (مثال: /vendor/hls.min.js أو /vendor/livekit-client.umd.min.js)
export async function onRequest({ request, params }) {
  const urlIn = new URL(request.url);
  const file = (params?.path || '').trim().toLowerCase();
  const isHead = request.method === 'HEAD';
  const wantDiag = urlIn.searchParams.has('diag');

  // جهّز لائحة الـ CDN حسب اسم الملف المطلوب
  function candidates(name) {
    // ثبّت نسخاً معقولة
    const LK = [
      'https://cdn.jsdelivr.net/npm/livekit-client@2.5.3/dist/livekit-client.umd.min.js',
      'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
      'https://unpkg.com/livekit-client@2.5.3/dist/livekit-client.umd.min.js',
      'https://cdn.livekit.io/libs/client-sdk/2.5.3/livekit-client.umd.min.js',
    ];
    const HLS = [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.8/dist/hls.min.js',
    ];

    // تطابق لأسماء معروفة
    if (name === 'livekit-client.umd.min.js' || name === 'livekit-client.min.js' || name === 'livekit-client.js' || name === 'livekit-client.umd.js') {
      return LK;
    }
    if (name === 'hls.min.js' || name === 'hls.js') {
      return HLS;
    }

    // أسماء إضافية شائعة
    if (name.endsWith('.js')) {
      // آخر محاولة: جرّب jsdelivr مباشرةً باسم الحزمة — غالباً لن ينجح لعدم معرفة المسار داخل الحزمة
      return [
        `https://cdn.jsdelivr.net/npm/${name}`,
        `https://unpkg.com/${name}`,
      ];
    }

    return [];
  }

  const list = candidates(file);
  const attempts = [];
  let lastErr = null;

  for (const cdnUrl of list) {
    try {
      const resp = await fetch(cdnUrl, {
        cf: { cacheEverything: true, cacheTtl: 86400 },
        redirect: 'follow',
      });

      attempts.push({ url: cdnUrl, ok: resp.ok, status: resp.status, ct: resp.headers.get('content-type') || '' });

      if (resp.ok) {
        // تأكد أن المحتوى JavaScript (ليس HTML صفحة خطأ)
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        const looksJs = ct.includes('javascript') || ct.includes('ecmascript') || cdnUrl.endsWith('.js');

        if (!looksJs) {
          // اقرأ نصاً صغيراً للتشخيص فقط
          if (wantDiag) {
            const text = await resp.text().catch(()=> '');
            return new Response(JSON.stringify({ ok:false, reason:'content-type-not-js', ct, snippet: text.slice(0, 200) }), {
              status: 502,
              headers: { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' }
            });
          }
          continue;
        }

        // HEAD: ارجع هيدرز فقط
        if (isHead) {
          return new Response(null, {
            status: 200,
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
              'Access-Control-Allow-Origin': '*',
              'X-Source-URL': cdnUrl,
            },
          });
        }

        // GET: مرّر الجسم
        return new Response(resp.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
            'Access-Control-Allow-Origin': '*',
            'X-Source-URL': cdnUrl,
          },
        });
      }
    } catch (e) {
      lastErr = e;
      attempts.push({ url: cdnUrl, ok: false, error: e?.message || String(e) });
    }
  }

  if (wantDiag) {
    return new Response(JSON.stringify({ ok:false, file, attempts, lastErr: lastErr?.message || String(lastErr || '') }), {
      status: 502,
      headers: { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' },
    });
  }

  return new Response('CDN fetch failed', { status: 502 });
}
