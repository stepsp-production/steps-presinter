// server.js
import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_URL    = process.env.LIVEKIT_URL;    // wss://xxx.livekit.cloud
const LIVEKIT_APIKEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_URL || !LIVEKIT_APIKEY || !LIVEKIT_SECRET) {
  console.warn('⚠️  LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET غير مهيأة');
}

// /token?room=room-1&identity=test123
app.get('/token', async (req, res) => {
  try {
    const roomName = (req.query.room || 'room-1').toString();
    const identity = (req.query.identity || 'guest-' + Math.random().toString(36).slice(2,8)).toString();

    // منح صلاحيات النشر والاشتراك
    const at = new AccessToken(LIVEKIT_APIKEY, LIVEKIT_SECRET, {
      identity,
      ttl: '1h',
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    res.json({ url: LIVEKIT_URL, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_issue_token' });
  }
});

app.get('/', (_, res) => res.send('steps-livekit-api OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('server listening on :' + port);
});
