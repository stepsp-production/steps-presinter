import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();

const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  ALLOWED_ORIGINS = '',
  DEBUG_TOKEN = '',
  PORT = 3000,
} = process.env;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('[FATAL] Missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET envs');
}

const allowlist = ALLOWED_ORIGINS
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowlist.includes(origin)) return cb(null, true);
    if (/^https:\/\/.*\.pages\.dev$/.test(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: false,
}));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, LIVEKIT_URL: !!LIVEKIT_URL });
});

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
      console.log('[TOKEN] room=%s identity=%s name=%s exp=%s', room, identity, name, exp);
    }

    const token = jwt.sign(payload, LIVEKIT_API_SECRET, { algorithm: 'HS256' });

    return res.json({
      url: LIVEKIT_URL,
      token,
    });
  } catch (err) {
    console.error('[TOKEN] error:', err);
    return res.status(500).json({ error: 'failed to generate token' });
  }
});

app.listen(Number(PORT), () => {
  console.log(`[token-server] running on :${PORT}`);
});
