/* ========= مصادر HLS ========= */
(function () {
  const BASE = (window.HLS_BASE || "").replace(/\/$/, "");
  const build = (p) => (BASE ? `${BASE}${p}` : p);

  window.sources = {
    main: build("/hls/live/playlist.m3u8"),
    cam1: build("/hls/lastone/playlist.m3u8"),
    cam2: build("/hls/live2/playlist.m3u8"),
    cam3: build("/hls/live3/playlist.m3u8"),
    cam4: build("/hls/live4/playlist.m3u8"),
    cam5: build("/hls/live5/playlist.m3u8"),
    cam6: build("/hls/live6/playlist.m3u8"),
    cam7: build("/hls/live7/playlist.m3u8"),
  };

  window.channelMap = [
    { id: "main", label: "MAIN", src: sources.main },
    { id: "cam1", label: "Cam1", src: sources.cam1 },
    { id: "cam2", label: "Cam2", src: sources.cam2 },
    { id: "cam3", label: "Cam3", src: sources.cam3 },
    { id: "cam4", label: "Cam4", src: sources.cam4 },
    { id: "cam5", label: "Cam5", src: sources.cam5 },
    { id: "cam6", label: "Drone", src: sources.cam6 },
    { id: "cam7", label: "Sineflex", src: sources.cam7 },
  ];
})();

/* ========= أدوات صغيرة ========= */
const hasUrl = (u) =>
  typeof u === "string" &&
  /(https?:\/\/[^/]+)?\/hls\/.+\.m3u8(\?.*)?$/i.test(u);
const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const m = String(Math.floor(t / 60)).padStart(2, "0");
  const s = String(t % 60).padStart(2, "0");
  return `${m}:${s}`;
};

/* ========= إعدادات HLS محافظة ========= */
const SAFETY_EDGE = 0.8;
const SHOW_MIN_BUF = 1.25;
const STARVED_RESEEK = 0.25;

function isAvc(l) {
  return /avc1/i.test(l?.codecs || l?.codecsVideo || "");
}
function pickBestAvc(levels, capHeight = 480) {
  if (!levels?.length) return -1;
  const avc = levels
    .map((l, i) => ({ i, h: l.height || 0, avc: isAvc(l) }))
    .filter((x) => x.avc);
  if (!avc.length) return 0;
  let c = avc.filter((x) => x.h && x.h <= capHeight);
  if (!c.length) c = avc;
  c.sort((a, b) => a.h - b.h);
  return c[c.length - 1].i;
}
function highestAvcIndex(levels) {
  let m = -1;
  (levels || []).forEach((l, i) => {
    if (isAvc(l)) m = i;
  });
  return m >= 0 ? m : (levels && levels.length ? levels.length - 1 : -1);
}

const HLS_CFG = {
  lowLatencyMode: false,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 6,
  maxLiveSyncPlaybackRate: 1.0,
  maxBufferLength: 18,
  backBufferLength: 14,
  maxBufferSize: 40 * 1000 * 1000,
  capLevelToPlayerSize: true,
  enableWorker: true,
  maxBufferHole: 0.15,
  maxSeekHole: 0.25,
  nudgeOffset: 0.12,
  nudgeMaxRetry: 10,
  abrMaxWithRealBitrate: true,
  fragLoadingMaxRetry: 6,
  manifestLoadingMaxRetry: 6,
  levelLoadingMaxRetry: 5,
  fragLoadingRetryDelay: 350,
  manifestLoadingRetryDelay: 500,
  levelLoadingRetryDelay: 500,
  fragLoadingTimeOut: 10000,
  manifestLoadingTimeOut: 8000,
  levelLoadingTimeOut: 8000,
  xhrSetup: (xhr) => {
    try {
      xhr.withCredentials = false;
    } catch (_) {}
  },
};

function getSeekableRange(v) {
  try {
    const r = v.seekable;
    if (!r || !r.length) return null;
    return { start: r.start(r.length - 1), end: r.end(r.length - 1) };
  } catch {
    return null;
  }
}
function capLiveEdge(v, t) {
  const m = getSeekableRange(v);
  if (!m) return t;
  return Math.min(t, m.end - SAFETY_EDGE);
}
function bufferedAhead(v) {
  try {
    const b = v.buffered;
    const t = v.currentTime || 0;
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i),
        e = b.end(i);
      if (t >= s && t <= e) return Math.max(0, e - t);
    }
  } catch {}
  return 0;
}
function containsTime(v, t) {
  try {
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t <= b.end(i))
        return { start: b.start(i), end: b.end(i) };
    }
  } catch {}
  return null;
}
function nearestBufferedTime(v, t) {
  try {
    const b = v.buffered;
    let best = null,
      dm = 1e9;
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i),
        e = b.end(i);
      const cand = t < s ? s : t > e ? e : t;
      const d = Math.abs(cand - t);
      if (d < dm) {
        dm = d;
        best = cand;
      }
    }
    return best;
  } catch {
    return null;
  }
}
async function waitBufferedAt(v, t, minAhead = SHOW_MIN_BUF, timeout = 6000) {
  t = capLiveEdge(v, t);
  const t0 = performance.now();
  return new Promise((res) => {
    (function loop() {
      const r = containsTime(v, t);
      if (r && r.end - t >= minAhead) return res(true);
      if (performance.now() - t0 > timeout) return res(false);
      setTimeout(loop, 90);
    })();
  });
}
function snapIntoBuffer(v, t) {
  t = capLiveEdge(v, t);
  const r = containsTime(v, t);
  if (r) return t;
  const near = nearestBufferedTime(v, t);
  return typeof near === "number" ? near : t;
}

function attachHlsWithAvc(video, url) {
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ ...HLS_CFG });
    video.__hls = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(url);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      try {
        const lv = data?.levels || [];
        const s = pickBestAvc(lv, 480);
        const mx = highestAvcIndex(lv);
        if (s >= 0) {
          hls.startLevel = s;
          hls.currentLevel = s;
          hls.nextLevel = s;
        }
        if (mx >= 0) {
          hls.autoLevelCapping = mx;
        }
      } catch {}
    });
    hls.on(Hls.Events.ERROR, (_, err) => {
      if (err?.fatal) {
        if (err.type === "mediaError") {
          try {
            hls.recoverMediaError();
          } catch {
            try {
              hls.destroy();
            } catch {}
            try {
              attachHlsWithAvc(video, url);
            } catch {}
          }
        } else {
          try {
            hls.destroy();
          } catch {}
          try {
            attachHlsWithAvc(video, url);
          } catch {}
        }
      } else {
        // خفّض الضجيج
        // console.warn('[HLS]', err?.details || err?.type, err);
      }
    });
    const starve = () => {
      try {
        const m = getSeekableRange(video);
        if (!m) return;
        const near = Math.max(
          m.start,
          m.end - SAFETY_EDGE - STARVED_RESEEK
        );
        video.currentTime = snapIntoBuffer(video, near);
        video.play().catch(() => {});
      } catch {}
    };
    video.addEventListener("waiting", () => {
      if (bufferedAhead(video) < 0.3) starve();
    });
    video.addEventListener("stalled", () => {
      if (bufferedAhead(video) < 0.3) starve();
    });
    return hls;
  }
  if (video && video.canPlayType("application/vnd.apple.mpegURL")) {
    video.src = url;
    return null;
  }
  console.warn("Hls.js غير متوفر");
  return null;
}

function createVideoElement(url) {
  const wrap = document.createElement("div");
  wrap.className = "layer";
  wrap.style.cssText = "position:absolute;inset:0;opacity:0";
  const v = document.createElement("video");
  v.playsInline = true;
  v.muted = true;
  v.controls = false;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.style.cssText = "width:100%;height:100%;object-fit:contain";
  wrap.appendChild(v);

  if (hasUrl(url) && window.Hls && Hls.isSupported()) {
    attachHlsWithAvc(v, url);
  } else if (hasUrl(url) && v.canPlayType("application/vnd.apple.mpegURL")) {
    v.src = url;
  } else {
    v.src = url;
  }
  return { wrap, video: v };
}

/* ========= عناصر DOM ========= */
const root = document.getElementById("playerContainer");
const mainContainer = document.getElementById("mainPreview");
const camContainer = document.getElementById("activeCam");
const gatePlay = document.getElementById("gatePlay");
const startBtn = document.getElementById("startBtn");
const btnSplit = document.getElementById("btnSplit");
const btnFill = document.getElementById("btnFill");
const btnSound = document.getElementById("btnSound");
const globalControls = document.getElementById("globalControls");
const gPlay = document.getElementById("gPlay");
const gBack = document.getElementById("gBack");
const gFwd = document.getElementById("gFwd");
const scrub = document.getElementById("scrub");
const timeLabel = document.getElementById("timeLabel");

const streamPanel = document.getElementById("streamPanel");
const streamList = document.getElementById("streamList");

let started = false,
  splitMode = 0,
  isMainFull = false;
let mainPlayer,
  activePlayer,
  currentCam = "cam2";
let ticker = null,
  isScrubbing = false;
const playersCache = new Map();

/* ========= تهيئة الفيديو ========= */
function mountTo(container, node) {
  container.appendChild(node);
}
function initMain() {
  const { wrap, video } = createVideoElement(sources.main);
  mountTo(mainContainer, wrap);
  wrap.style.opacity = "1";
  mainPlayer = video;
}
function getOrCreateCam(id) {
  let ent = playersCache.get(id);
  if (ent) return ent;
  const { wrap, video } = createVideoElement(sources[id]);
  mountTo(camContainer, wrap);
  const rec = { wrap, video, ready: false };
  video.addEventListener(
    "canplay",
    () => {
      rec.ready = true;
    },
    { once: true }
  );
  playersCache.set(id, rec);
  return rec;
}
function buildStreamList() {
  streamList.innerHTML = "";
  (window.channelMap || [])
    .filter((ch) => hasUrl(ch.src))
    .forEach((ch) => {
      const li = document.createElement("li");
      li.className = "stream-item";
      li.dataset.cam = ch.id;
      const name = document.createElement("div");
      name.className = "stream-name";
      name.textContent = ch.label;
      li.appendChild(name);
      li.addEventListener("click", () => setActiveCamSmooth(ch.id));
      streamList.appendChild(li);
    });
  document.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const items = [...document.querySelectorAll(".stream-item")];
    const n = Number(e.key);
    if (n >= 1 && n <= items.length) items[n - 1].click();
  });
}
function markActiveList() {
  document.querySelectorAll(".stream-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.cam === currentCam);
  });
}

function initOnce() {
  initMain();
  const first = getOrCreateCam(currentCam);
  first.wrap.style.opacity = "1";
  activePlayer = first.video;

  buildStreamList();
  markActiveList();
}
initOnce();

/* ========= تبديل الكاميرا الناعم ========= */
async function setActiveCamSmooth(id) {
  if (!sources[id] || id === currentCam) return;
  currentCam = id;
  markActiveList();
  const target = getOrCreateCam(id);
  const v = target.video,
    w = target.wrap;

  if (!target.ready)
    await new Promise((r) => v.addEventListener("canplay", r, { once: true }));

  let T = capLiveEdge(v, mainPlayer.currentTime || 0);
  await waitBufferedAt(v, T, SHOW_MIN_BUF, 6000);
  v.currentTime = snapIntoBuffer(v, T);
  try {
    await v.play();
  } catch {}

  w.className = "layer fade-in";
  w.style.opacity = "1";
  const old = activePlayer,
    oldWrap = old ? old.parentElement : null;
  setTimeout(() => {
    if (oldWrap) {
      oldWrap.className = "layer fade-out";
      oldWrap.style.opacity = "0";
    }
    activePlayer = v;
  }, 180);
}

/* ========= إظهار/إخفاء تلقائي ========= */
let uiTimer = null;
function showUI() {
  root.classList.remove("ui-hidden");
  root.classList.add("ui-visible");
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    root.classList.add("ui-hidden");
    root.classList.remove("ui-visible");
  }, 2500);
}
["mousemove", "touchstart", "keydown"].forEach((ev) =>
  document.addEventListener(ev, showUI, { passive: true })
);
[streamPanel, globalControls, document.getElementById("utilityControls")].forEach(
  (el) => {
    el.addEventListener("mouseenter", () => {
      clearTimeout(uiTimer);
      root.classList.remove("ui-hidden");
      root.classList.add("ui-visible");
    });
    el.addEventListener("mouseleave", showUI);
  }
);
setTimeout(showUI, 1000);

/* ========= التشغيل الأولي والساعة ========= */
async function startPlayback() {
  if (started) return;
  started = true;
  gatePlay.classList.add("hidden");
  globalControls.classList.remove("hidden");

  try { await mainPlayer.play(); } catch {}
  try { await activePlayer.play(); } catch {}
  setTimeout(async () => {
    const m = getSeekableRange(mainPlayer);
    if (m) mainPlayer.currentTime = Math.max(m.start, m.end - SAFETY_EDGE);
  }, 300);

  startTimeTicker();
}
function startTimeTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (isScrubbing) return;
    let d = 0,
      ct = mainPlayer.currentTime || 0;
    const r = mainPlayer.seekable;
    if (r && r.length) d = r.end(r.length - 1);
    if (d && isFinite(d)) scrub.max = d;
    scrub.value = ct || 0;
    timeLabel.textContent = `${fmt(ct)} / ${fmt(d || 0)}`;

    if (activePlayer && bufferedAhead(activePlayer) < 0.3) {
      const m = getSeekableRange(activePlayer);
      if (m) {
        const near = Math.max(
          m.start,
          m.end - SAFETY_EDGE - STARVED_RESEEK
        );
        activePlayer.currentTime = snapIntoBuffer(activePlayer, near);
      }
    }
  }, 250);
}

/* ========= تحكّمات المشغل ========= */
startBtn.addEventListener("click", startPlayback);

btnSplit.addEventListener("click", () => {
  splitMode = (splitMode + 1) % 4;
  root.classList.toggle("split", splitMode !== 0);
  root.classList.remove("mode1", "mode2", "mode3");
  if (splitMode === 1) root.classList.add("mode1");
  if (splitMode === 2) root.classList.add("mode2");
  if (splitMode === 3) root.classList.add("mode3");
});
btnFill.addEventListener("click", () => {
  if (splitMode === 0) {
    isMainFull = !isMainFull;
    root.classList.toggle("main-full", isMainFull);
    root.classList.toggle("cover-one", isMainFull);
  } else {
    splitMode = splitMode === 2 ? 3 : 2;
    root.classList.remove("mode1", "mode2", "mode3");
    root.classList.add(splitMode === 2 ? "mode2" : "mode3");
    root.classList.add("split");
  }
});
btnSound.addEventListener("click", () => {
  if (!started) return;
  mainPlayer.muted = !mainPlayer.muted;
  if (!mainPlayer.muted) mainPlayer.play().catch(() => {});
});

const gSeek = (ofs) => {
  if (!started) return;
  const t = capLiveEdge(mainPlayer, (mainPlayer.currentTime || 0) + ofs);
  mainPlayer.currentTime = t;
  if (activePlayer) activePlayer.currentTime = snapIntoBuffer(activePlayer, t);
};
gBack.addEventListener("click", () => gSeek(-5));
gFwd.addEventListener("click", () => gSeek(5));
gPlay.addEventListener("click", async () => {
  if (!started) return;
  if (mainPlayer.paused) {
    try { await mainPlayer.play(); } catch {}
  } else {
    mainPlayer.pause();
  }
});
scrub.addEventListener("input", () => { if (started) isScrubbing = true; });
scrub.addEventListener("change", () => {
  if (!started) return;
  const nt = capLiveEdge(mainPlayer, parseFloat(scrub.value) || 0);
  mainPlayer.currentTime = nt;
  if (activePlayer) activePlayer.currentTime = snapIntoBuffer(activePlayer, nt);
  isScrubbing = false;
});
mainContainer.addEventListener("click", () => {
  if (splitMode !== 0) return;
  isMainFull = !isMainFull;
  root.classList.toggle("main-full", isMainFull);
  root.classList.toggle("cover-one", isMainFull);
});
document.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); startPlayback(); }
  if (e.key === "S" || e.key === "s") btnSplit.click();
  if (e.key === "F" || e.key === "f") btnFill.click();
  if (e.key === "M" || e.key === "m") btnSound.click();
  if (e.key === "ArrowLeft") gBack.click();
  if (e.key === "ArrowRight") gFwd.click();
});

/* ========= LiveKit: اقتران/نشر ========= */
const roomSel = document.getElementById("roomSel");
const displayName = document.getElementById("displayName");
const pairBtn = document.getElementById("pairBtn");
const publishBtn = document.getElementById("publishBtn");
const stopBtn = document.getElementById("stopBtn");
const lkStatus = document.getElementById("lkStatus");

let mediaStream = null;
let room = null;
let localCam = null;
let localMic = null;

function setLKStatus(txt) { lkStatus.textContent = `LiveKit: ${txt}`; }

function ensureLivekitGlobal() {
  const g = window.Livekit || window.livekit || window.LiveKit;
  if (!g) {
    alert("LiveKit SDK غير محمّل، تأكد من توفر CDN.");
    return null;
  }
  return g;
}

pairBtn.addEventListener("click", async () => {
  try {
    const g = ensureLivekitGlobal();
    if (!g) return;

    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const tracks = mediaStream.getTracks();
    const v = tracks.find((t) => t.kind === "video");
    const a = tracks.find((t) => t.kind === "audio");
    localCam = await g.createLocalVideoTrack({ deviceId: v?.getSettings?.().deviceId }, { stream: mediaStream });
    localMic = await g.createLocalAudioTrack({ deviceId: a?.getSettings?.().deviceId }, { stream: mediaStream });

    publishBtn.disabled = false;
    stopBtn.disabled = false;
    setLKStatus("مقترن (جاهز للنشر)");
    alert("تم منح سماح للكاميرا والمايك.");
  } catch (e) {
    console.error(e);
    alert("تعذّر الوصول إلى الكاميرا/المايك. امنح الإذن من المتصفح.");
  }
});

publishBtn.addEventListener("click", async () => {
  try {
    const g = ensureLivekitGlobal();
    if (!g) return;

    const roomName = roomSel.value || "room-1";
    const identity = (displayName.value || "guest").trim();
    const url = `/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`;

    // ملاحظة: إن كنت على صفحات ثابتة، اجعل المسار كاملاً:
    // const url = 'https://steps-livekit-api.onrender.com/token?...';

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Token API ${resp.status}`);
    const data = await resp.json();
    if (!data?.token || !data?.url) throw new Error("استجابة التوكن غير صحيحة");

    room = new g.Room();
    await room.connect(data.url, data.token);

    if (localCam) await room.localParticipant.publishTrack(localCam);
    if (localMic) await room.localParticipant.publishTrack(localMic);

    setLKStatus("متصل");
    alert("تم النشر!");
  } catch (e) {
    console.error("نشر فشل:", e);
    alert("تعذّر النشر: تحقّق من سيرفر التوكن والـCSP / الاتصال.");
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    if (room) {
      await room.disconnect();
      room = null;
    }
  } catch {}
  try { localCam && localCam.stop(); } catch {}
  try { localMic && localMic.stop(); } catch {}
  try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
  publishBtn.disabled = true;
  stopBtn.disabled = true;
  setLKStatus("غير متصل");
});
