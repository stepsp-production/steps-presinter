// يخدم ملفات JS من /vendor/* عبر نطاقك (أهمها livekit-client.umd.min.js)
export async function onRequest(context) {
  const { params } = context;
  const path = params.path || ""; // مثال: "livekit-client.umd.min.js" أو "ping.js"

  // ping اختياري للفحص السريع
  if (path === "ping.js") {
    return new Response(`console.log("vendor ping ok")`, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // نخدم مكتبة LiveKit فقط
  if (!/^(livekit-client(\.umd)?(\.min)?\.js|livekit-client\.umd\.min\.js)$/i.test(path)) {
    return new Response("Not found", { status: 404 });
  }

  const cdns = [
    "https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.min.js",
    "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js",
    "https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.min.js",
    "https://cdn.livekit.io/libs/client-sdk/2.5.0/livekit-client.umd.min.js",
  ];

  for (const url of cdns) {
    try {
      const r = await fetch(url, {
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (r.ok) {
        // أعد المحتوى كـ JS وليس HTML
        const headers = new Headers(r.headers);
        headers.set("Content-Type", "application/javascript; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(r.body, { status: 200, headers });
      }
    } catch (_e) {/* جرّب التالي */}
  }
  return new Response("CDN fetch failed", { status: 502 });
}
