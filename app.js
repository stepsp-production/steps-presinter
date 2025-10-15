// ===== إعدادات =====
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

// عناصر DOM
const cardsEl = document.getElementById('cards');
const lkStatusEl = document.getElementById('lkStatus');
const roomSel = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn = document.getElementById('pairBtn');
const publishBtn = document.getElementById('publishBtn');
const stopBtn = document.getElementById('stopBtn');
const chrome = document.getElementById('chrome');

// توليد بطاقات الفيديو + ربط HLS
function makeCard(src) {
  const id = `card-${src.key}`;
  const url = `${HLS_PROXY_BASE}/hls/${src.key}/playlist.m3u8`;
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <header>
      <div class="name">
        <span class="dot live"></span>
        <strong>${src.title}</strong>
      </div>
      <small class="mono">${url}</small>
    </header>
    <video id="${id}" playsinline muted controls></video>
    <footer>
      <button class="btn" data-act="play">تشغيل</button>
      <button class="btn" data-act="pause">إيقاف</button>
      <span class="pill mono" data-role="state">HLS: idle</span>
    </footer>
  `;
  cardsEl.appendChild(el);

  const video = el.querySelector('video');
  const state = el.querySelector('[data-role=state]');
  const hp = new HlsPlayer(video, state);
  hp.attach(url);

  el.querySelector('[data-act=play]').onclick  = () => video.play();
  el.querySelector('[data-act=pause]').onclick = () => video.pause();
}
SOURCES.forEach(makeCard);

// LiveKit: اقتران/نشر/إيقاف
const lk = new LiveKitPublisher({
  statusEl: lkStatusEl,
  Livekit: window.livekitClient,
  tokenApi: LK_TOKEN_API,
});

pairBtn.onclick = async () => {
  try {
    await lk.pairDevices();
    publishBtn.disabled = false;
    pairBtn.classList.add('primary');
  } catch (e) {
    alert('تعذّر الوصول للكاميرا/المايك: ' + (e.userMessage || e.message || e));
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
    alert('تعذّر نشر الصوت/الفيديو:\n' + (e.userMessage || e.message || e));
    publishBtn.disabled = false;
  }
};

stopBtn.onclick = async () => {
  try { await lk.stop(); } finally {
    stopBtn.disabled = true;
    publishBtn.disabled = false;
  }
};

// إخفاء/إظهار الشريط والقائمة تلقائياً
let hideTimer = null;
function scheduleHide(){
  clearTimeout(hideTimer);
  chrome.classList.remove('hidden');
  hideTimer = setTimeout(()=> chrome.classList.add('hidden'), 2200);
}
['mousemove','touchstart','keydown'].forEach(evt=>{
  window.addEventListener(evt, scheduleHide, {passive:true});
});
scheduleHide();

// ملء الشاشة بالحرف F
window.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
});
