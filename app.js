/* ========================================================================
   app.js  —  نسخة كاملة بعد الإصلاحات (HLS + LiveKit UMD fallback)
   - بدون import/ESM نهائياً (كل شيء UMD عبر /vendor أو CDN)
   - المحافظة على كل مزاياك السابقة + إصلاح مشاكل LiveKit و HLS
   ======================================================================== */

/* ===================== إعدادات HLS المحافظة ===================== */
const SAFETY_EDGE    = 0.80;
const SHOW_MIN_BUF   = 1.25;
const STARVED_RESEEK = 0.25;

const hasUrl = (u) =>
  typeof u === 'string' &&
  /(https?:\/\/[^/]+)?\/hls\/.+\.m3u8(\?.*)?$/i.test(u);

function isAvc(l) {
  return /avc1/i.test(l?.codecs || l?.codecsVideo || '');
}
function pickBestAvc(levels, capHeight = 480) {
  if (!levels?.length) return -1;
  const avc = levels.map((l, i) => ({ i, h: l.height || 0, avc: isAvc(l) }))
                   .filter((x) => x.avc);
  if (!avc.length) return 0;
  let c = avc.filter((x) => x.h && x.h <= capHeight);
  if (!c.length) c = avc;
  c.sort((a, b) => a.h - b.h);
  return c[c.length - 1].i;
}
function highestAvcIndex(levels) {
  let m = -1;
  (levels || []).forEach((l, i) => { if (isAvc(l)) m = i; });
  return m >= 0 ? m : ((levels && levels.length) ? levels.length - 1 : -1);
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

  xhrSetup: (xhr) => { try { xhr.withCredentials = false; } catch (_) {} },
};

function getSeekableRange(v) {
  try {
    const r = v.seekable;
    if (!r || !r.length) return null;
    return { start: r.start(r.length - 1), end: r.end(r.length - 1) };
  } catch (e) { return null; }
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
      const s = b.start(i), e = b.end(i);
      if (t >= s && t <= e) return Math.max(0, e - t);
    }
  } catch (e) {}
  return 0;
}
function containsTime(v, t) {
  try {
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t <= b.end(i))
        return { start: b.start(i), end: b.end(i) };
    }
  } catch (e) {}
  return null;
}
function nearestBufferedTime(v, t) {
  try {
    const b = v.buffered;
    let best = null, dm = 1e9;
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i), e = b.end(i);
      const cand = (t < s) ? s : (t > e ? e : t);
      const d = Math.abs(cand - t);
      if (d < dm) { dm = d; best = cand; }
    }
    return best;
  } catch (e) { return null; }
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
  return typeof near === 'number' ? near : t;
}

function attachHlsWithAvc(video, srcUrl) {
  const hls = new Hls({ ...HLS_CFG });
  video.__hls = hls;
  hls.attachMedia(video);

  hls.on(Hls.Events.MEDIA_ATTACHED, () => { hls.loadSource(srcUrl); });

  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    try {
      const lv = data?.levels || [];
      const s  = pickBestAvc(lv, 480);
      const mx = highestAvcIndex(lv);
      if (s >= 0) { hls.startLevel = s; hls.currentLevel = s; hls.nextLevel = s; }
      if (mx >= 0) { hls.autoLevelCapping = mx; }
    } catch (e) {}
  });

  hls.on(Hls.Events.ERROR, (_, err) => {
    // تقليل إزعاج fragParsingError غير القاتلة
    if (err?.details === 'fragParsingError' && !err.fatal) {
      try {
        const cur = hls.currentLevel;
        const next = (typeof cur === 'number' && cur > 0) ? cur - 1 : cur;
        if (typeof next === 'number') hls.currentLevel = next;
      } catch (_) {}
      console.debug('[HLS] soft-recover from fragParsingError');
      return;
    }

    if (!err?.fatal) {
      console.debug('[HLS] non-fatal', err?.details || err);
      return;
    }

    if (err.type === 'mediaError') {
      try { hls.recoverMediaError(); }
      catch {
        try { hls.destroy(); } catch (_) {}
        try { attachHlsWithAvc(video, srcUrl); } catch (_) {}
      }
    } else {
      try { hls.destroy(); } catch (_) {}
      try { attachHlsWithAvc(video, srcUrl); } catch (_) {}
    }
  });

  // مُعالج الجوع
  const starve = () => {
    try {
      const m = getSeekableRange(video); if (!m) return;
      const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
      video.currentTime = snapIntoBuffer(video, near);
      video.play().catch(() => {});
    } catch (e) {}
  };
  video.addEventListener('waiting', () => { if (bufferedAhead(video) < 0.3) starve(); });
  video.addEventListener('stalled', () => { if (bufferedAhead(video) < 0.3) starve(); });

  return hls;
}

function createVideoElement(url) {
  const wrap = document.createElement('div');
  wrap.className = 'layer';
  wrap.style.cssText = 'position:absolute;inset:0;opacity:0';

  const v = document.createElement('video');
  v.playsInline = true; v.muted = true; v.controls = false; v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.style.cssText = 'width:100%;height:100%;object-fit:contain';
  wrap.appendChild(v);

  if (hasUrl(url) && window.Hls && Hls.isSupported()) { attachHlsWithAvc(v, url); }
  else if (hasUrl(url) && v.canPlayType('application/vnd.apple.mpegURL')) { v.src = url; }
  else { v.src = url; }

  return { wrap, video: v };
}

// ===== LiveKit SDK robust loader (لا يغيّر ميزاتك) =====
(function setupLiveKitLoader(){
  const LK_GLOBALS = ['livekit','LiveKit','Livekit','LiveKitClient'];

  function pickLK(){
    for (const k of LK_GLOBALS) {
      if (window[k]) return window[k];
    }
    return null;
  }

  // تحقّق سريع
  if (pickLK()) { window.__LK_READY__ = true; return; }

  // مصادر احتياطية (تفعّل فقط إذا لم يوجد الملف المحلي)
  const FALLBACKS = [
    'https://cdn.jsdelivr.net/npm/livekit-client@2.5.0/dist/livekit-client.umd.js',
    'https://unpkg.com/livekit-client@2.5.0/dist/livekit-client.umd.js'
  ];

  function injectOnce(src, timeoutMs=9000){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src; s.defer = true; s.crossOrigin = 'anonymous';
      s.onload = ()=> resolve(true);
      s.onerror = ()=> reject(new Error('load-failed:'+src));
      document.head.appendChild(s);
      // مهلة أمان
      setTimeout(()=> reject(new Error('timeout:'+src)), timeoutMs);
    });
  }


  async function ensureLK(){
    // لو الملف المحلي موجود كوسم سكربت عادي سيلتقطه defer تلقائيًا؛ ننتظر DOM ready
    if (document.readyState === 'loading') {
      await new Promise(r=>document.addEventListener('DOMContentLoaded', r, {once:true}));
    }

    // بعد DOM: جرّب الالتقاط مرة أخرى
    if (pickLK()) { window.__LK_READY__ = true; return true; }

    // fallback: جرب CDN بالتسلسل
    for (const url of FALLBACKS){
      try { 
        await injectOnce(url);
        if (pickLK()) { window.__LK_READY__ = true; return true; }
      } catch (e) { /* جرّب التالي */ }
    }

    // فشل نهائي
    window.__LK_READY__ = false;
    return false;
  }

  // واجهة عامة لملفاتك الأخرى
  window.__ensureLiveKit = ensureLK;
  window.__getLiveKit    = () => pickLK();
})();


/* ===================== DOM & حالة ===================== */
const root            = document.getElementById('playerContainer');
const mainContainer   = document.getElementById('mainPreview');
const camContainer    = document.getElementById('activeCam');
const gatePlay        = document.getElementById('gatePlay');
const startBtn        = document.getElementById('startBtn');
const btnSplit        = document.getElementById('btnSplit');
const btnFill         = document.getElementById('btnFill');
const btnSound        = document.getElementById('btnSound');
const globalControls  = document.getElementById('globalControls');
const gPlay           = document.getElementById('gPlay');
const gBack           = document.getElementById('gBack');
const gFwd            = document.getElementById('gFwd');
const scrub           = document.getElementById('scrub');
const timeLabel       = document.getElementById('timeLabel');
const streamPanel     = document.getElementById('streamPanel');
const streamList      = document.getElementById('streamList');

let started     = false, splitMode = 0, isMainFull = false;
let mainPlayer  = null, activePlayer = null, currentCam = 'cam2';
let ticker      = null, isScrubbing = false;

const playersCache = new Map(); // id -> {wrap, video, ready}
const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return `${m}:${s}`;
};
function mountTo(container, node) { container.appendChild(node); }

function initMain() {
  const { wrap, video } = createVideoElement(window.sources.main);
  mountTo(mainContainer, wrap);
  wrap.style.opacity = '1';
  mainPlayer = video;
}
function getOrCreateCam(id) {
  let ent = playersCache.get(id);
  if (ent) return ent;
  const { wrap, video } = createVideoElement(window.sources[id]);
  mountTo(camContainer, wrap);
  const rec = { wrap, video, ready: false };
  video.addEventListener('canplay', () => { rec.ready = true; }, { once: true });
  playersCache.set(id, rec);
  return rec;
}

/* القائمة */
function buildStreamList() {
  streamList.innerHTML = '';
  (window.channelMap || []).filter(ch => hasUrl(ch.src)).forEach((ch) => {
    const li = document.createElement('li'); li.className = 'stream-item'; li.dataset.cam = ch.id;
    const name = document.createElement('div'); name.className = 'stream-name'; name.textContent = ch.label;
    li.appendChild(name);
    li.addEventListener('click', () => setActiveCamSmooth(ch.id));
    streamList.appendChild(li);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const items = [...document.querySelectorAll('.stream-item')];
    const n = Number(e.key); if (n >= 1 && n <= items.length) items[n - 1].click();
  });
}
function markActiveList() {
  document.querySelectorAll('.stream-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.cam === currentCam);
  });
}

function initOnce() {
  initMain();
  const first = getOrCreateCam(currentCam);
  first.wrap.style.opacity = '1';
  activePlayer = first.video;
  buildStreamList();
  markActiveList();
}
initOnce();

/* تبديل الكاميرا بسلاسة */
async function setActiveCamSmooth(id) {
  if (!window.sources[id] || id === currentCam) return;
  currentCam = id; markActiveList();

  const target = getOrCreateCam(id);
  const v = target.video, w = target.wrap;

  if (!target.ready) {
    await new Promise((r) => v.addEventListener('canplay', r, { once: true }));
  }

  let T = capLiveEdge(v, (mainPlayer.currentTime || 0));
  await waitBufferedAt(v, T, SHOW_MIN_BUF, 6000);
  v.currentTime = snapIntoBuffer(v, T);
  try { await v.play(); } catch (_) {}

  w.className = 'layer fade-in'; w.style.opacity = '1';
  const old = activePlayer, oldWrap = old ? old.parentElement : null;
  setTimeout(() => {
    if (oldWrap) { oldWrap.className = 'layer fade-out'; oldWrap.style.opacity = '0'; }
    activePlayer = v;
  }, 180);
}

/* واجهة مخفية تلقائيًا */
let uiTimer = null;
function showUI() {
  root.classList.remove('ui-hidden'); root.classList.add('ui-visible');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => { root.classList.add('ui-hidden'); root.classList.remove('ui-visible'); }, 2500);
}
['mousemove', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, showUI, { passive: true }));
[streamPanel, globalControls, document.getElementById('utilityControls')].forEach((el) => {
  el.addEventListener('mouseenter', () => { clearTimeout(uiTimer); root.classList.remove('ui-hidden'); root.classList.add('ui-visible'); });
  el.addEventListener('mouseleave', showUI);
});
setTimeout(showUI, 1000);

/* تشغيل أولي & ساعة */
async function startPlayback() {
  if (started) return; started = true;
  gatePlay.classList.add('hidden'); globalControls.classList.remove('hidden');

  try { await mainPlayer.play(); } catch (_) {}
  try { await activePlayer.play(); } catch (_) {}

  setTimeout(async () => {
    const m = getSeekableRange(mainPlayer);
    if (m) { mainPlayer.currentTime = Math.max(m.start, m.end - SAFETY_EDGE); }
  }, 300);

  startTimeTicker();
}
function startTimeTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (isScrubbing) return;

    let d = 0, ct = mainPlayer.currentTime || 0;
    const r = mainPlayer.seekable; if (r && r.length) d = r.end(r.length - 1);
    if (d && isFinite(d)) scrub.max = d;

    scrub.value = ct || 0;
    timeLabel.textContent = `${fmt(ct)} / ${fmt(d || 0)}`;

    if (activePlayer && bufferedAhead(activePlayer) < 0.30) {
      const m = getSeekableRange(activePlayer);
      if (m) {
        const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
        activePlayer.currentTime = snapIntoBuffer(activePlayer, near);
      }
    }
  }, 250);
}

/* تحكمات واجهة */
startBtn.addEventListener('click', startPlayback);

btnSplit.addEventListener('click', () => {
  splitMode = (splitMode + 1) % 4;
  root.classList.toggle('split', splitMode !== 0);
  root.classList.remove('mode1', 'mode2', 'mode3');
  if (splitMode === 1) root.classList.add('mode1');
  if (splitMode === 2) root.classList.add('mode2');
  if (splitMode === 3) root.classList.add('mode3');
});
btnFill.addEventListener('click', () => {
  if (splitMode === 0) {
    isMainFull = !isMainFull;
    root.classList.toggle('main-full', isMainFull);
    root.classList.toggle('cover-one', isMainFull);
  } else {
    splitMode = (splitMode === 2) ? 3 : 2;
    root.classList.remove('mode1', 'mode2', 'mode3');
    root.classList.add(splitMode === 2 ? 'mode2' : 'mode3');
    root.classList.add('split');
  }
});
btnSound.addEventListener('click', () => {
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
gBack.addEventListener('click', () => gSeek(-5));
gFwd .addEventListener('click', () => gSeek( 5));
gPlay.addEventListener('click', async () => {
  if (!started) return;
  if (mainPlayer.paused) { try { await mainPlayer.play(); } catch (e) {} }
  else mainPlayer.pause();
});
scrub.addEventListener('input', () => { if (started) isScrubbing = true; });
scrub.addEventListener('change', () => {
  if (!started) return;
  const nt = capLiveEdge(mainPlayer, parseFloat(scrub.value) || 0);
  mainPlayer.currentTime = nt;
  if (activePlayer) activePlayer.currentTime = snapIntoBuffer(activePlayer, nt);
  isScrubbing = false;
});
document.getElementById('mainPreview').addEventListener('click', () => {
  if (splitMode !== 0) return;
  isMainFull = !isMainFull;
  root.classList.toggle('main-full', isMainFull);
  root.classList.toggle('cover-one', isMainFull);
});
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startPlayback(); }
  if (e.key === 'S' || e.key === 's') { btnSplit.click(); }
  if (e.key === 'F' || e.key === 'f') { btnFill.click(); }
  if (e.key === 'M' || e.key === 'm') { btnSound.click(); }
  if (e.key === 'ArrowLeft')  { gBack.click(); }
  if (e.key === 'ArrowRight') { gFwd .click(); }
});

/* ===================== LiveKit: تحميل UMD + اقتران/نشر ===================== */
// داخل app.js لديك:
const roomSel     = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn     = document.getElementById('pairBtn');
const publishBtn  = document.getElementById('publishBtn');
const stopBtn     = document.getElementById('stopBtn');
const lkStatus    = document.getElementById('lkStatus');

function setLKStatus(t){ lkStatus.textContent = t; }

pairBtn.addEventListener('click', async () => {
  // تأكيد تحميل SDK قبل أي استدعاء
  const ok = await window.__ensureLiveKit();
  // التقط LiveKit بعد التحميل
const LK =
  window.livekit ||
  window.Livekit ||
  window.LiveKit ||
  window.LiveKitClient;

function ensureSDK() {
  if (!LK || !LK.Room || !LK.createLocalTracks) {
    console.error('LiveKit UMD not found on window.*', { keys: Object.keys(window) });
    alert('LiveKit SDK غير محمّل. تحقق من /vendor/livekit-client.umd.js');
    return false;
  }
  return true;
}
   
  try {
    setLKStatus('طلب أذونات…');
    // تلميحات iOS/Safari: إن لم توجد أجهزة سيُرمى NotFoundError
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCam  = devices.some(d=>d.kind==='videoinput');
    const hasMic  = devices.some(d=>d.kind==='audioinput');

    const tracks = await LK.createLocalTracks({
      audio: hasMic  ? true : false,
      video: hasCam  ? { facingMode: 'user', resolution: LK.VideoPresets.h720 } : false
    });

    window.__localTracks = tracks;
    publishBtn.disabled = false;
    stopBtn.disabled    = false;
    setLKStatus('جاهز للنشر');
  } catch (err) {
    console.error('Pair error:', err);
    if (err && err.name === 'NotFoundError') {
      alert('لم يتم العثور على كاميرا/مايك. تأكد من وجود أجهزة، أو من تفعيل الأذونات في إعدادات المتصفح/النظام.');
    } else if (err && err.name === 'NotAllowedError') {
      alert('تم رفض الإذن. افتح إعدادات الموقع ومنح إذن الكاميرا والميكروفون.');
    } else {
      alert('تعذر الوصول للكاميرا/المايك — تحقق من الأذونات ثم أعد المحاولة.');
    }
    setLKStatus('فشل الاقتران');
  }
});

publishBtn.addEventListener('click', async () => {
  const ok = await window.__ensureLiveKit();
  const LK  = window.__getLiveKit();
  if (!ok || !LK || !LK.Room) {
    alert('LiveKit SDK غير مُحمّل — تأكد من الوسم أو ال-CDN/الـCSP.');
    setLKStatus('فشل تحميل SDK');
    return;
  }

  try {
    publishBtn.disabled = true;

    const roomName = roomSel.value || 'room-1';
    const identity = (displayName.value || '').trim() || ('user-' + Math.random().toString(36).slice(2,8));

    setLKStatus('جلب توكن…');
    const res = await fetch(`https://steps-presinter.onrender.com/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`, { mode:'cors' });
    if (!res.ok) throw new Error('token-http-'+res.status);
    const data = await res.json();
    const url   = data.url;
    const token = data.token;
    if (!url || !token) throw new Error('token-shape');

    setLKStatus('الاتصال بالغرفة…');
    window.__lkRoom = new LK.Room({ adaptiveStream:true, dynacast:true });
    window.__lkRoom.on(LK.RoomEvent.Disconnected, () => setLKStatus('LiveKit: غير متصل'));
    await window.__lkRoom.connect(url, token);

    setLKStatus('نشر المسارات…');
    for (const tr of (window.__localTracks || [])) {
      await window.__lkRoom.localParticipant.publishTrack(tr);
    }
    setLKStatus(`LiveKit: متصل (${roomName})`);
  } catch (err) {
    console.error('Publish error:', err);
    alert('تعذر نشر الصوت/الفيديو — تحقق من التوكن والاتصال.');
    setLKStatus('فشل النشر');
    publishBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', () => {
  try {
    if (window.__lkRoom) { window.__lkRoom.disconnect(); window.__lkRoom = null; }
    (window.__localTracks || []).forEach(t=>{try{t.stop();}catch(_){}}); window.__localTracks = [];
    setLKStatus('LiveKit: غير متصل');
    publishBtn.disabled = true;
    stopBtn.disabled    = true;
  } catch(_){}
});

/* ===================== Debug اختياري لـ HLS ===================== */
(function addHlsDebug() {
  function wireDebug(video) {
    const h = video && video.__hls; if (!h) return;
    h.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      console.log('[HLS] MANIFEST_PARSED levels=',
        (data && data.levels || []).map((l) => ({ h: l.height, codecs: l.codecs }))
      );
    });
    h.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      console.log('[HLS] LEVEL_LOADED targetduration=', data?.details?.targetduration,
                  'frags=', data?.details?.fragments?.length);
    });
    h.on(Hls.Events.ERROR, (_, err) => { console.error('[HLS] ERROR', err?.type, err?.details, err); });
  }
  const mo = new MutationObserver(() => {
    document.querySelectorAll('video').forEach((v) => {
      if (!v.__debugWired && v.__hls) { v.__debugWired = true; wireDebug(v); }
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
