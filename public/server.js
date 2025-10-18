import express from 'express';
import cors from 'cors';
import { AccessToken } from '@livekit/server-sdk';

const app = express();
app.use(cors());

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

app.get('/', (_req, res) => res.type('text/plain').send('steps-presinter OK'));

app.get('/token', async (req, res) => {
  try {
    const { room, identity } = req.query;
    if (!room || !identity) return res.status(400).json({ error: 'missing room or identity' });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: String(identity) });
    at.addGrant({
      room: String(room),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return res.json({ url: LIVEKIT_URL, token });
  } catch (err) {
    console.error('[token] error:', err);
    return res.status(500).json({ error: 'token-error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`steps-livekit-api listening on :${PORT}`));
