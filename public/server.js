// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(cors());
app.use(express.json());

// بيئة التشغيل
const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY    || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_HOST       = process.env.LIVEKIT_HOST       || ''; // مثل: wss://your-instance.livekit.cloud

// صحة التهيئة
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_HOST) {
  console.warn('[WARN] LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_HOST غير مضبوطة. اضبطها كمتغيرات بيئة.');
}

// راوت صحيّة
app.get('/health', (req, res) => {
  res.json({ ok: true, host: LIVEKIT_HOST || null });
});

// راوت إصدار التوكن: GET /token?room=room-1&identity=test123
app.get('/token', async (req, res) => {
  try {
    const roomName  = req.query.room;
    const identity  = req.query.identity;

    if (!roomName || !identity) {
      return res.status(400).json({ error: 'Missing room or identity query params' });
    }
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_HOST) {
      return res.status(500).json({ error: 'Server not configured: set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST' });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      // لو تريد السماح بالمشاركة من المتصفح:
      canPublishData: true,
    });

    const token = await at.toJwt();

    // واجهة الـFrontend تتوقع url + token
    res.json({
      url: LIVEKIT_HOST, // مثال: wss://your-instance.livekit.cloud
      token,
    });
  } catch (e) {
    console.error('token error:', e);
    res.status(500).json({ error: 'failed to create token' });
  }
});

// تشغيل
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LiveKit token server listening on :${PORT}`);
});
