/* إعدادات عامة */
const HLS_PROXY_BASE = 'https://hls-proxy.it-f2c.workers.dev';
const LK_TOKEN_API   = 'https://steps-livekit-api.onrender.com/token';

const SOURCES = [
  { key: 'live',    title: 'Main (live)' },
  { key: 'live2',   title: 'Cam 2' },
  { key: 'live3',   title: 'Cam 3' },
  { key: 'live4',   title: 'Cam 4' },
  { key: 'live5',   title: 'Cam 5' },
  { key: 'live6',   title: 'Cam 6' },
  { key: 'live7',   title: 'Cam 7' },
  { key: 'lastone', title: 'Sineflex' },
];

/* ===== utils ===== */
function fmtErr(e){
  if (!e) return 'unknown';
  if (e.userMessage) return e.userMessage;
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

/* ===== HLS Player Wrapper ===== */
class HlsPlayer {
  constructor(videoEl, stateEl){
    this.video = videoEl;
    this.stateEl = stateEl;
    this.hls = null;
  }
  _set(t){ if (this.stateEl) this.stateEl.textContent = 'HLS: ' + t; }
  attach(manifestUrl){
    const v = this.video;
    const self = this;

    if (window.Hls && window.Hls.isSupported()) {
      const hls = this.hls = new window.Hls({
        liveSyncDurationCount: 3,
        backBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: true,
        maxLiveSyncPlaybackRate: 1.5,
      });
      hls.on(window.Hls.Events.ERROR, (_, data)=>{
        console.warn('[HLS] ERROR', data);
        if (data?.fatal) self._set((data.details || 'fatal'));
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, ()=> self._set('ready'));
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MEDIA_ATTACHED, ()=>{
        hls.loadSource(manifestUrl);
        self._set('loading');
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = manifestUrl; // iOS/Safari
      v.addEventListener('loadedmetadata', ()=> self._set('ready'));
    } else {
      self._set('unsupported');
    }
  }
}

/* ===== LiveKit Publisher ===== */
class LiveKitPublisher {
  constructor({ statusEl, tokenApi }){
    const lk = window.livekitClient || {};
    this.Room = lk.Room;
    this.RoomEvent = lk.RoomEvent;
    this.createLocalTracks = lk.createLocalTracks;
    this.setLogLevel = lk.setLogLevel;
    this.LogLevel = lk.LogLevel;
    this.setLogLevel?.(this.LogLevel?.warn ?? 'warn');

    this.statusEl = statusEl;
    this.tokenApi = tokenApi;
    this.room = null;
    this.localTracks = [];
    this.devicesPaired = false;
    this._set('LiveKit: غير متصل');
  }
  _set(t){ if (this.statusEl) this.statusEl.textContent = t; }
  async _fetchToken(room, identity){
    const u = new URL(this.tokenApi);
    u.searchParams.set('room', room);
    u.searchParams.set('identity', identity);
    const r = await fetch(u.toString(), { cache:'no-store' });
    if (!r.ok) throw new Error('فشل طلب التوكن ('+r.status+')');
    return r.json(); // { url, token }
  }
  async pairDevices(){
    try {
      this.localTracks = await this.createLocalTracks({
        audio: { echoCancellation:true, noiseSuppression:true },
        video: { facingMode:'user', resolution:{ width:1280, height:720 } }
      });
      this.devicesPaired = true;
      this._set('LiveKit: الأجهزة مُقترنة');
    } catch (e) {
      const err = new Error('تعذّر الوصول إلى الكاميرا/المايك. امنح الإذن ثم أعد المحاولة.');
      err.userMessage = err.message;
      throw err;
    }
  }
  async joinAndPublish({ room, identity }){
    if (!this.devicesPaired) { const e=new Error('يجب الاقتران أولاً قبل النشر.'); e.userMessage=e.message; throw e; }
    if (!room) { const e=new Error('لم يتم اختيار الغرفة.'); e.userMessage=e.message; throw e; }
    if (!identity) { const e=new Error('مطلوب اسم الهوية.'); e.userMessage=e.message; throw e; }

    const { url, token } = await this._fetchToken(room, identity);
    if (!url || !token){ const e=new Error('الاستجابة لا تحتوي url/token.'); e.userMessage=e.message; throw e; }

    this.room = new this.Room({
      adaptiveStream:true, dynacast:true, stopLocalTrackOnUnpublish:true,
      publishDefaults:{ simulcast:true, videoCodec:'vp9' }
    });

    this.room.on(this.RoomEvent.Disconnected, ()=> this._set('LiveKit: غير متصل'));
    this.room.on(this.RoomEvent.Connected,   ()=> this._set('LiveKit: متصل'));

    await this.room.connect(url, token);
    for (const t of this.localTracks) await this.room.localParticipant.publishTrack(t);
    this._set('LiveKit: تم النشر');
  }
  async stop(){
    try { if (this.room) await this.room.disconnect(); }
    finally {
      this.room = null;
      for (const t of this.localTracks){ try{ t.stop(); }catch{} }
      this.localTracks = []; this.devicesPaired=false;
      this._set('LiveKit: غير متصل');
    }
  }
}

/* ===== DOM & UI ===== */
const cardsEl = document.getElementById('cards');
const lkStatusEl = document.getElementById('lkStatus');
const roomSel = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn = document.getElementById('pairBtn');
const publishBtn = document.getElementById('publishBtn');
const stopBtn = document.getElementById('stopBtn');
const uiChrome = document.getElementById('chrome'); // كان اسمها chrome => سبب الخطأ

function makeCard(src) {
  const id = `card-${src.key}`;
  const url = `${HLS_PROXY_BASE}/hls/${src.key}/playlist.m3u8`;
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <header>
      <div class="name"><span class="dot live"></span><strong>${src.title}</strong></div>
      <small class="mono">${url}</small>
    </header>
    <video id="${id}" playsinline muted controls></video>
    <footer>
      <button class="btn" data-act="play">تشغيل</button>
      <button class="btn" data-act="pause">إيقاف</button>
      <span class="pill mono" data-role="state">HLS: idle</span>
    </footer>`;
  cardsEl.appendChild(el);

  const video = el.querySelector('video');
  const state = el.querySelector('[data-role=state]');
  const hp = new HlsPlayer(video, state);
  hp.attach(url);

  el.querySelector('[data-act=play]').onclick  = () => video.play();
  el.querySelector('[data-act=pause]').onclick = () => video.pause();
}
SOURCES.forEach(makeCard);

/* LiveKit controls */
const lk = new LiveKitPublisher({ statusEl: lkStatusEl, tokenApi: LK_TOKEN_API });

pairBtn.onclick = async () => {
  try {
    await lk.pairDevices();
    publishBtn.disabled = false;
    pairBtn.classList.add('primary');
  } catch (e) {
    alert(fmtErr(e));
  }
};

publishBtn.onclick = async () => {
  publishBtn.disabled = true;
  try {
    await lk.joinAndPublish({
      room: roomSel.value,
      identity: displayName.value || ('user-' + crypto.randomUUID().slice(0,8)),
    });
    stopBtn.disabled = false;
    alert('تم النشر بنجاح ✅');
  } catch (e) {
    console.error(e);
    alert('تعذّر نشر الصوت/الفيديو:\n' + fmtErr(e));
    publishBtn.disabled = false;
  }
};

stopBtn.onclick = async () => {
  try { await lk.stop(); } finally {
    stopBtn.disabled = true;
    publishBtn.disabled = false;
  }
};

/* إخفاء/إظهار شريط الأدوات تلقائيًا */
let hideTimer=null;
function scheduleHide(){
  clearTimeout(hideTimer);
  uiChrome.classList.remove('hidden');
  hideTimer = setTimeout(()=> uiChrome.classList.add('hidden'), 2200);
}
['mousemove','touchstart','keydown'].forEach(evt=>{
  window.addEventListener(evt, scheduleHide, {passive:true});
});
scheduleHide();

/* ملء الشاشة بالحرف F */
window.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
});
