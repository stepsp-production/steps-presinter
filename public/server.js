// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(express.json());

// اسمح للفرونت (pages.dev أو أي دومين) بالاتصال:
app.use(cors({
  origin: true, // يسمح لأي Origin (أو ضع الدومين الصريح)
  methods: ['GET','POST','OPTIONS'],
}));

// بيئات التشغيل — ضَع هذه في Render Dashboard > Environment
const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
// مثال: wss://your-instance.livekit.cloud
const LIVEKIT_URL        = process.env.LIVEKIT_URL;

// فحص سريع للصحة
app.get('/health', (_req, res) => res.json({ ok: true }));

// /token يدعم GET و POST
app.all('/token', async (req, res) => {
  try {
    const room     = (req.query.room || req.body?.room || '').toString();
    const identity = (req.query.identity || req.body?.identity || '').toString();

    if (!room || !identity) {
      return res.status(400).json({ error: 'missing room or identity' });
    }
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return res.status(500).json({ error: 'server missing LIVEKIT_* envs' });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      // name ليس ضروري لكنه مفيد لعرض الاسم
      name: identity,
    });

    // صلاحيات الانضمام/النشر
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // canPublishData: true,
    });

    const token = await at.toJwt();
    return res.json({ url: LIVEKIT_URL, token });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('steps-livekit-api listening on :' + PORT);
});
