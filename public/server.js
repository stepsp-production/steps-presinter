// server.js  — خادم توكن LiveKit بدون @livekit/server-sdk
// يعمل مع Node 20+ و Type=module

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();

// متغيرات البيئة المطلوبة على Render:
// LIVEKIT_URL=wss://<your-instance>.livekit.cloud
// LIVEKIT_API_KEY=<api key>
// LIVEKIT_API_SECRET=<api secret>
// (اختياري) CORS_ORIGIN=https://your-frontend.domain
const LIVEKIT_URL     = process.env.LIVEKIT_URL;
const API_KEY         = process.env.LIVEKIT_API_KEY;
const API_SECRET      = process.env.LIVEKIT_API_SECRET;
const CORS_ORIGIN     = process.env.CORS_ORIGIN || '*';
const PORT            = process.env.PORT || 3000;

if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
  console.error('❌ Missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET env vars');
}

app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.get('/', (_, res) => {
  res.type('text/plain').send('steps-presinter: OK');
});

// /token?room=room-1&identity=alice
app.get('/token', (req, res) => {
  try {
    const room = (req.query.room || 'room-1').toString();
    const identity = (req.query.identity || 'user-' + Math.random().toString(36).slice(2, 8)).toString();

    // صلاحيات/منح LiveKit ضمن claim "video"
    const grants = {
      video: {
        room,                 // اسم الغرفة
        roomJoin: true,       // السماح بالانضمام
        canPublish: true,     // نشر الصوت/الفيديو
        canPublishData: true, // نشر بيانات
        canSubscribe: true    // الاشتراك بالبث
      }
    };

    // مطالِب الـJWT حسب LiveKit:
    // iss: api key
    // sub: identity (من سيستخدم التوكن)
    // nbf/exp: نافذة زمنية
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: API_KEY,
      sub: identity,
      nbf: now - 10,
      exp: now + 60 * 60, // صلاحية 60 دقيقة
      ...grants
    };

    const token = jwt.sign(payload, API_SECRET, { algorithm: 'HS256' });

    res.json({ url: LIVEKIT_URL, token });
  } catch (e) {
    console.error('token error:', e);
    res.status(500).json({ error: 'token_generation_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ steps-livekit-api listening on :${PORT}`);
});
