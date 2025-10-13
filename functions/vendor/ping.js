// functions/vendor/ping.js
export async function onRequest() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}
