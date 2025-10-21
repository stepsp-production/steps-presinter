// server.js
// Minimal token server for LiveKit Cloud
// Node 20.x — uses: express, cors, jsonwebtoken (مطابقة لما هو في package.json)

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();

// ====== الإعدادات من المتغيرات البيئية ======
// ضع هذه في Render Dashboard → Environment:
// LIVEKIT_URL = wss://presinter-stream-gjthpz2z.livekit.cloud
// LIVEKIT_API_KEY = <Project API Key>
// LIVEKIT_API_SECRET = <Project API Secret>
// ALLOWED_ORIGINS = https://steps-presinter-cam.pages.dev, http://localhost:5173, http://localhost:8080
const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  ALLOWED_ORIGINS = '',
  PORT = 3000,
} = process.env;

// تحقق مبكرًا:
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('[FATAL] Missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET envs');
}

// CORS: اسمح لواجهة Cloudflare Pages وللتطوير المحلي
const allowlist = ALLOWED_ORIGINS
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl / local
    if (allowlist.includes(origin)) return cb(null, true);
    // اسمح بشكل آمن لأصل steps-presinter-cam.pages.dev الفرعي (لو تغيّر)
    if (/^https:\/\/.*\.pages\.dev$/.test(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
}));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// صحّة
app.get('/health', (_req, res) => {
  res.json({ ok: true, LIVEKIT_URL: !!LIVEKIT_URL });
});

// مولّد التوكن
// GET /token?room=room-1&identity=steps&name=Steps
app.get('/token', async (req, res) => {
  try {
    let { room, identity, name } = req.query;

    // تحقق من المُدخلات
    if (typeof room !== 'string' || !room.trim()) {
      return res.status(400).json({ error: 'room parameter is required' });
    }
    room = room.trim();

    if (typeof identity !== 'string' || !identity.trim()) {
      // هوية احتياطية
      identity = 'user-' + Math.random().toString(36).slice(2, 10);
    } else {
      identity = identity.trim();
    }

    // اسم العرض اختياري
    if (typeof name !== 'string' || !name.trim()) {
      name = identity;
    } else {
      name = name.trim();
    }

    // مدة صلاحية قصيرة وآمنة (10 دقائق تكفي للانضمام)
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 10;

    // بناء الـ JWT يدويًا وفقًا لمخطط LiveKit:
    // - iss = LIVEKIT_API_KEY
    // - sub = identity
    // - video grant يحتوي صلاحيات الانضمام والنشر/الاشتراك لنفس الغرفة
    // مراجع: docs.livekit.io (Generating tokens / Authentication)
    const payload = {
      iss: LIVEKIT_API_KEY,
      sub: identity,
      name,            // اسم العرض يظهر في الـ Participant
      iat: now,
      exp,
      // يمكن تمرير ميتاداتا اختيارية كنص JSON:
      metadata: JSON.stringify({ displayName: name }),
      video: {
        roomJoin: true,
        room,                 // اسم الغرفة
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    };

    const token = jwt.sign(payload, LIVEKIT_API_SECRET, { algorithm: 'HS256' });

    // أعد الاستجابة بالشكل الذي يتوقعه الكلاينت لديك
    return res.json({
      url: LIVEKIT_URL,
      token,
    });
  } catch (err) {
    console.error('[TOKEN] error:', err);
    return res.status(500).json({ error: 'failed to generate token' });
  }
});

// تشغيل
app.listen(Number(PORT), () => {
  console.log(`[token-server] running on :${PORT}`);
});
