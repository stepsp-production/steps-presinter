// Cloudflare Worker: يولّد JWT LiveKit بدون @livekit/server-sdk
// أضف الأسرار في wrangler.toml أو Dashboard: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
import { SignJWT } from 'jose';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      const room = url.searchParams.get('room') || (await request.json().catch(()=>({})) ).room;
      const identity = url.searchParams.get('identity') || (await request.json().catch(()=>({})) ).identity;
      if (!room || !identity) return new Response(JSON.stringify({error:'missing room/identity'}), {status:400});

      const apiKey = env.LIVEKIT_API_KEY;
      const apiSecret = env.LIVEKIT_API_SECRET;
      const lkUrl = env.LIVEKIT_URL; // مثل: wss://your-instance.livekit.cloud
      if(!apiKey || !apiSecret || !lkUrl) return new Response(JSON.stringify({error:'missing env'}), {status:500});

      // Video grant لــ LiveKit
      const videoGrant = {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true
      };

      const now = Math.floor(Date.now()/1000);
      const payload = {
        vid: videoGrant, // claim خاص LiveKit
        sub: identity,
        name: identity,
        iat: now,
        exp: now + 60 * 60, // صالح ساعة
        iss: apiKey
      };

      const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(new TextEncoder().encode(apiSecret));

      return new Response(JSON.stringify({ url: lkUrl, token }), {headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify({ok:true}), {headers:{'content-type':'application/json'}});
  }
}
