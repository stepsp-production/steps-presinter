import express from "express";
import cors from "cors";
import { AccessToken } from "@livekit/server-sdk";

/**
 * المتغيرات المطلوبة في Render:
 * LIVEKIT_URL      = wss://presinter-stream-gjthpz2z.livekit.cloud  (أو عنوانك)
 * LIVEKIT_API_KEY  = <apiKey من LiveKit Cloud>
 * LIVEKIT_API_SECRET = <apiSecret من LiveKit Cloud>
 *
 * اختياري:
 * PORT (سيضبطه Render تلقائياً)
 */

const app = express();
app.use(cors({ origin: "*"}));
app.use(express.json());

const LK_URL   = process.env.LIVEKIT_URL;
const LK_KEY   = process.env.LIVEKIT_API_KEY;
const LK_SECRET= process.env.LIVEKIT_API_SECRET;

if (!LK_URL || !LK_KEY || !LK_SECRET) {
  console.error("❌ تأكد من ضبط LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET");
}

function buildToken(room, identity) {
  const at = new AccessToken(LK_KEY, LK_SECRET, { identity });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });
  return at.toJwt();
}

// نفس المسارات التي يجربها الـfront
const routes = ["/api/token", "/token", "/api/rtoken", "/api/get-token"];

for (const path of routes) {
  app.get(path, (req, res) => {
    try {
      const room = (req.query.room || "studio-1").toString();
      const identity = (req.query.identity || ("guest-" + Math.random().toString(36).slice(2,7))).toString();

      if (!LK_URL) return res.status(500).json({ error: "LIVEKIT_URL not set" });

      const token = buildToken(room, identity);
      res.setHeader("Cache-Control", "no-store");
      res.json({ token, url: LK_URL });
    } catch (e) {
      console.error("token error", e);
      res.status(500).json({ error: "token generation failed" });
    }
  });
}

// صحة الخدمة
app.get("/", (_req, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Token API running on :${port}`));
