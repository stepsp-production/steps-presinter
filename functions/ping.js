// فنكشن بسيطة لفحص أن Functions تعمل
export async function onRequest() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
