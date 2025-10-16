// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(cors());
app.get('/token', async (req, res) => {
  try {
    const { room, identity } = req.query;
    if (!room || !identity) return res.status(400).json({ error: 'room & identity required' });

    // ضع مفاتيح LiveKit الخاصة بك
    const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
    const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
    const LIVEKIT_URL = process.env.LIVEKIT_URL; // مثل: wss://<your>.livekit.cloud

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return res.status(500).json({ error: 'Missing LiveKit envs' });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    res.json({ url: LIVEKIT_URL, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'token error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Token server on :' + port));
