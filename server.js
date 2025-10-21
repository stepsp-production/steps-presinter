// server.js — Token server for LiveKit Cloud (Node 20.x)
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();

// ====== Env ======
const {
  LIVEKIT_URL,         // wss://presinter-stream-gjthpz2z.livekit.cloud
  LIVEKIT_API_KEY,     // من لوحة LiveKit
  LIVEKIT_API_SECRET,  // من لوحة LiveKit
  PORT = 3000,
  DEBUG_TOKEN = '',
} = process.env;

// ====== CORS (اسمح للجميع مؤقتًا) ======
// هذا يزيل أي مشاكل preflight من iOS/Safari و تغيّر الدومين (presinter-cam.pages.dev)
app.use(cors({ origin: true, credentials: false }));
app.options('*', cors()); // ردّ على كل preflight

// لا كاش على الـAPI
app.use((_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// صحة
app.get('/health', (_req, res) => {
  res.json({ ok: true, LIVEKIT_URL: !!LIVEKIT_URL });
});

// GET /token?room=room-1&identity=steps&name=Steps
app.get('/token', async (req, res) => {
  try {
    let { room, identity, name } = req.query;

    if (typeof room !== 'string' || !room.trim()) {
      return res.status(400).json({ error: 'room parameter is required' });
    }
    room = room.trim();

    if (typeof identity !== 'string' || !identity.trim()) {
      identity = 'user-' + Math.random().toString(36).slice(2, 10);
    } else identity = identity.trim();

    if (typeof name !== 'string' || !name.trim()) name = identity;
    else name = name.trim();

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 10; // 10 دقائق

    // Payload وفق مخطط LiveKit
    const payload = {
      iss: LIVEKIT_API_KEY,
      sub: identity,
      name,
      iat: now,
      exp,
      metadata: JSON.stringify({ displayName: name }),
      video: {
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    };

    if (DEBUG_TOKEN) {
      console.log('[TOKEN] origin=%s room=%s identity=%s exp=%s',
        req.headers.origin, room, identity, exp);
    }

    const token = jwt.sign(payload, LIVEKIT_API_SECRET, { algorithm: 'HS256' });

    // الرد كما يتوقع الكلاينت
    return res.json({ url: LIVEKIT_URL, token });
  } catch (err) {
    console.error('[TOKEN] error:', err);
    return res.status(500).json({ error: 'failed to generate token' });
  }
});

// تشغيل
app.listen(Number(PORT), () => {
  console.log(`[token-server] running on :${PORT}`);
});
