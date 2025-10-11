// وكّيل HLS إلى ORIGIN_BASE + UPSTREAM_PREFIX
export async function onRequest(context) {
  const { env, request, params } = context;
  const upstream = (env.ORIGIN_BASE || "").replace(/\/$/, ""); // مثال: https://several-congressional-modifications-valley.trycloudflare.com
  const prefix   = (env.UPSTREAM_PREFIX || "").replace(/^\/?/, "/"); // مثال: /hls
  const rest     = params.path || ""; // مثال: "live/playlist.m3u8"

  if (!upstream) return new Response("Missing ORIGIN_BASE", { status: 500 });

  const url = `${upstream}${prefix}/${rest}`;
  const r = await fetch(url, {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
    cf: { cacheEverything: true },
  });

  // مرر كل شيء، وأضف CORS احتياطيًا
  const headers = new Headers(r.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Timing-Allow-Origin", "*");

  return new Response(r.body, { status: r.status, headers });
}
