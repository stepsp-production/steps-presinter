// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(cors());               // يسمح بالوصول من المتصفح
app.use(express.json());

const LIVEKIT_URL       = process.env.LIVEKIT_URL;       // مثال: wss://YOUR.livekit.cloud
const LIVEKIT_API_KEY   = process.env.LIVEKIT_API_KEY;   // من لوحة LiveKit
const LIVEKIT_API_SECRET= process.env.LIVEKIT_API_SECRET;// من لوحة LiveKit

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.warn('⚠️ تأكد من ضبط LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET في Render');
}

// صحيّة بسيطة
app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /token?room=room-1&identity=user123&name=اسم&publish=true&subscribe=true&metadata=...
app.get('/token', async (req, res) => {
  try {
    const {
      room = 'room-1',
      identity,
      name,
      publish = 'true',
      subscribe = 'true',
      metadata,
      ttl = '3600',            // ثانية (ساعة)
    } = req.query;

    if (!identity) {
      return res.status(400).json({ error: 'identity is required' });
    }

    // منح الصلاحيات
    const grant = {
      roomJoin: true,
      room: String(room),
      canPublish: publish !== 'false',
      canPublishData: true,
      canSubscribe: subscribe !== 'false',
    };

    // إنشاء التوكن
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(identity),
      name: name ? String(name) : undefined,
      ttl: Number(ttl),
      metadata: metadata ? String(metadata) : undefined,
    });
    at.addGrant(grant);

    const token = await at.toJwt();

    res.json({
      url: LIVEKIT_URL,   // يجب أن يكون wss://.. من LiveKit
      token,
    });
  } catch (err) {
    console.error('Token error:', err);
    res.status(500).json({ error: 'internal_error', details: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`steps-livekit-api listening on :${PORT}`);
});
