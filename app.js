/* =========================================================
   app.js  —  نسخة مستقرة تعتمد على vendor/local فقط
   - HLS: نفس إعداداتك المحافظة + تحسينات الجوع/المزامنة
   - LiveKit: تحميل محلي فقط من /vendor/livekit-client.umd.min.js
   - بدون top-level await، وبدون تكرار أسماء متغيرات حسّاسة
   ========================================================= */

/* ---------------- HLS helpers & config ------------------ */
const SAFETY_EDGE   = 0.80;   // مسافة أمان من حافة البث المباشر
const SHOW_MIN_BUF  = 1.25;   // أقل بافر نريده قبل الإظهار
const STARVED_RESEEK= 0.25;   // إعادة تموضع عند الجوع

const hasUrl = (u) =>
  typeof u === 'string' &&
  /(https?:\/\/[^/]+)?\/hls\/.+\.m3u8(\?.*)?$/i.test(u);

function isAvc(l){ return /avc1/i.test(l?.codecs||l?.codecsVideo||""); }
function pickBestAvc(levels,capHeight=480){
  if(!levels?.length) return -1;
  const avc=levels.map((l,i)=>({i,h:l.height||0,avc:isAvc(l)})).filter(x=>x.avc);
  if(!avc.length) return 0;
  let c=avc.filter(x=>x.h && x.h<=capHeight); if(!c.length) c=avc;
  c.sort((a,b)=>a.h-b.h); return c[c.length-1].i;
}
function highestAvcIndex(levels){ let m=-1; (levels||[]).forEach((l,i)=>{ if(isAvc(l)) m=i; }); return m>=0?m:((levels&&levels.length)?levels.length-1:-1); }

const HLS_CFG = {
  lowLatencyMode:false,
  liveSyncDurationCount:3,
  liveMaxLatencyDurationCount:6,
  maxLiveSyncPlaybackRate:1.0,
  maxBufferLength:18,
  backBufferLength:14,
  maxBufferSize:40*1000*1000,
  capLevelToPlayerSize:true,
  enableWorker:true,
  maxBufferHole:0.15,
  maxSeekHole:0.25,
  nudgeOffset:0.12,
  nudgeMaxRetry:10,
  abrMaxWithRealBitrate:true,
  fragLoadingMaxRetry:6,
  manifestLoadingMaxRetry:6,
  levelLoadingMaxRetry:5,
  fragLoadingRetryDelay:350,
  manifestLoadingRetryDelay:500,
  levelLoadingRetryDelay:500,
  fragLoadingTimeOut:10000,
  manifestLoadingTimeOut:8000,
  levelLoadingTimeOut:8000,
  xhrSetup:(xhr)=>{ try{ xhr.withCredentials=false; }catch(_){ } }
};

function getSeekableRange(v){
  try{
    const r=v.seekable; if(!r||!r.length) return null;
    return { start:r.start(r.length-1), end:r.end(r.length-1) };
  }catch(_){ return null; }
}
function capLiveEdge(v,t){ const m=getSeekableRange(v); if(!m) return t; return Math.min(t, m.end - SAFETY_EDGE); }
function bufferedAhead(v){
  try{
    const b=v.buffered, t=v.currentTime||0;
    for(let i=0;i<b.length;i++){ const s=b.start(i),e=b.end(i); if(t>=s&&t<=e) return Math.max(0,e-t); }
  }catch(_){}
  return 0;
}
function containsTime(v,t){
  try{
    const b=v.buffered;
    for(let i=0;i<b.length;i++){ if(t>=b.start(i)&&t<=b.end(i)) return {start:b.start(i),end:b.end(i)}; }
  }catch(_){}
  return null;
}
function nearestBufferedTime(v,t){
  try{
    const b=v.buffered; let best=null,dm=1e9;
    for(let i=0;i<b.length;i++){
      const s=b.start(i),e=b.end(i);
      const cand=(t<s)?s:(t>e?e:t);
      const d=Math.abs(cand-t);
      if(d<dm){ dm=d; best=cand; }
    }
    return best;
  }catch(_){ return null; }
}
function snapIntoBuffer(v,t){
  t=capLiveEdge(v,t);
  const r=containsTime(v,t); if(r) return t;
  const near=nearestBufferedTime(v,t);
  return (typeof near==='number')?near:t;
}
async function waitBufferedAt(v,t,minAhead=SHOW_MIN_BUF,timeout=6000){
  t=capLiveEdge(v,t); const t0=performance.now();
  return new Promise(res=>{
    (function loop(){
      const r=containsTime(v,t);
      if(r && r.end - t >= minAhead) return res(true);
      if(performance.now()-t0>timeout) return res(false);
      setTimeout(loop,90);
    })();
  });
}

function attachHlsWithAvc(video,srcUrl){
  const hls=new Hls({...HLS_CFG}); video.__hls=hls; hls.attachMedia(video);
  hls.on(Hls.Events.MEDIA_ATTACHED,()=>{ hls.loadSource(srcUrl); });
  hls.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{
    try{
      const lv=data?.levels||[];
      const s=pickBestAvc(lv,480);
      const mx=highestAvcIndex(lv);
      if(s>=0){ hls.startLevel=s; hls.currentLevel=s; hls.nextLevel=s; }
      if(mx>=0){ hls.autoLevelCapping=mx; }
    }catch(_){}
  });
  hls.on(Hls.Events.ERROR,(_,err)=>{
    if(!err?.fatal){ console.debug('[HLS] non-fatal', err?.details||err); return; }
    if(err.type==='mediaError'){
      try{ hls.recoverMediaError(); }
      catch(_){ try{ hls.destroy(); }catch(__){} try{ attachHlsWithAvc(video,srcUrl); }catch(__){} }
    }else{
      try{ hls.destroy(); }catch(_){}
      try{ attachHlsWithAvc(video,srcUrl); }catch(__){}
    }
  });

  // علاج الجوع
  const starve=()=>{ try{
    const m=getSeekableRange(video); if(!m) return;
    const near=Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
    video.currentTime=snapIntoBuffer(video, near);
    video.play().catch(()=>{});
  }catch(_){} };
  video.addEventListener('waiting',()=>{ if(bufferedAhead(video)<0.3) starve(); });
  video.addEventListener('stalled',()=>{ if(bufferedAhead(video)<0.3) starve(); });

  return hls;
}
function createVideoElement(url){
  const wrap=document.createElement('div'); wrap.className='layer'; wrap.style.cssText='position:absolute;inset:0;opacity:0';
  const v=document.createElement('video');
  v.playsInline=true; v.muted=true; v.controls=false; v.preload='auto'; v.crossOrigin='anonymous';
  v.style.cssText='width:100%;height:100%;object-fit:contain';
  wrap.appendChild(v);

  if(hasUrl(url) && window.Hls && Hls.isSupported()){ attachHlsWithAvc(v,url); }
  else if(hasUrl(url) && v.canPlayType('application/vnd.apple.mpegURL')){ v.src=url; }
  else{ v.src=url; }

  return {wrap, video:v};
}

/* ---------------------- DOM refs ------------------------ */
const root=document.getElementById('playerContainer');
const mainContainer=document.getElementById('mainPreview');
const camContainer=document.getElementById('activeCam');
const gatePlay=document.getElementById('gatePlay');
const startBtn=document.getElementById('startBtn');
const btnSplit=document.getElementById('btnSplit');
const btnFill=document.getElementById('btnFill');
const btnSound=document.getElementById('btnSound');
const globalControls=document.getElementById('globalControls');
const gPlay=document.getElementById('gPlay');
const gBack=document.getElementById('gBack');
const gFwd=document.getElementById('gFwd');
const scrub=document.getElementById('scrub');
const timeLabel=document.getElementById('timeLabel');
const streamPanel=document.getElementById('streamPanel');
const streamList=document.getElementById('streamList');

/* --------------------- State ---------------------------- */
let started=false, splitMode=0, isMainFull=false;
let mainPlayer, activePlayer, currentCam='cam2';
let ticker=null, isScrubbing=false;
const playersCache=new Map(); // id -> {wrap, video, ready}
const fmt=(t)=>{ t=Math.max(0,Math.floor(t||0)); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); return `${m}:${s}`; };
function mountTo(container,node){ container.appendChild(node); }

function initMain(){
  const {wrap,video}=createVideoElement(window.sources.main);
  mountTo(mainContainer,wrap);
  wrap.style.opacity='1';
  mainPlayer=video;
}
function getOrCreateCam(id){
  let ent=playersCache.get(id);
  if(ent) return ent;
  const {wrap,video}=createVideoElement(window.sources[id]);
  mountTo(camContainer,wrap);
  const rec={wrap,video,ready:false};
  video.addEventListener('canplay',()=>{ rec.ready=true; },{once:true});
  playersCache.set(id,rec);
  return rec;
}

/* ----------------- Streams sidebar ---------------------- */
function buildStreamList(){
  streamList.innerHTML='';
  (window.channelMap||[]).filter(ch=>hasUrl(ch.src)).forEach(ch=>{
    const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam=ch.id;
    const name=document.createElement('div'); name.className='stream-name'; name.textContent=ch.label;
    li.appendChild(name);
    li.addEventListener('click',()=>setActiveCamSmooth(ch.id));
    streamList.appendChild(li);
  });
  document.addEventListener('keydown',(e)=>{
    if(e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    const items=[...document.querySelectorAll('.stream-item')];
    const n=Number(e.key); if(n>=1 && n<=items.length) items[n-1].click();
  });
}
function markActiveList(){
  document.querySelectorAll('.stream-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.cam===currentCam);
  });
}

function initOnce(){
  initMain();
  const first=getOrCreateCam(currentCam);
  first.wrap.style.opacity='1';
  activePlayer=first.video;
  buildStreamList();
  markActiveList();
}
initOnce();

/* ------- Smooth camera switch (buffer-aware) ------------ */
async function setActiveCamSmooth(id){
  if(!window.sources[id] || id===currentCam) return;
  currentCam=id; markActiveList();
  const target=getOrCreateCam(id);
  const v=target.video, w=target.wrap;

  if(!target.ready) await new Promise(r=>v.addEventListener('canplay',r,{once:true}));

  let T = capLiveEdge(v, (mainPlayer.currentTime||0));
  await waitBufferedAt(v, T, SHOW_MIN_BUF, 6000);
  v.currentTime = snapIntoBuffer(v, T);
  try{ await v.play(); }catch(_){}

  w.className='layer fade-in'; w.style.opacity='1';
  const old=activePlayer, oldWrap=old?old.parentElement:null;
  setTimeout(()=>{ if(oldWrap){ oldWrap.className='layer fade-out'; oldWrap.style.opacity='0'; } activePlayer=v; },180);
}

/* ------------- Auto-hide chrome / controls -------------- */
let uiTimer=null;
function showUI(){
  root.classList.remove('ui-hidden'); root.classList.add('ui-visible');
  clearTimeout(uiTimer);
  uiTimer=setTimeout(()=>{ root.classList.add('ui-hidden'); root.classList.remove('ui-visible'); },2500);
}
['mousemove','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,showUI,{passive:true}));
[streamPanel,globalControls,document.getElementById('utilityControls')].forEach(el=>{
  el.addEventListener('mouseenter',()=>{ clearTimeout(uiTimer); root.classList.remove('ui-hidden'); root.classList.add('ui-visible'); });
  el.addEventListener('mouseleave',showUI);
});
setTimeout(showUI,1000);

/* ----------------- Startup & time ticker ---------------- */
async function startPlayback(){
  if(started) return; started=true;
  gatePlay.classList.add('hidden'); globalControls.classList.remove('hidden');
  try{ await mainPlayer.play(); }catch(_){}
  try{ await activePlayer.play(); }catch(_){}
  setTimeout(()=>{
    const m=getSeekableRange(mainPlayer);
    if(m){ mainPlayer.currentTime = Math.max(m.start, m.end - SAFETY_EDGE); }
  },300);
  startTimeTicker();
}
function startTimeTicker(){
  if(ticker) return;
  ticker=setInterval(()=>{
    if(isScrubbing) return;
    let d=0, ct=mainPlayer.currentTime||0;
    const r=mainPlayer.seekable; if(r&&r.length) d=r.end(r.length-1);
    if(d&&isFinite(d)) scrub.max=d;
    scrub.value=ct||0; timeLabel.textContent=`${fmt(ct)} / ${fmt(d||0)}`;
    if(activePlayer && bufferedAhead(activePlayer) < 0.30){
      const m=getSeekableRange(activePlayer);
      if(m){
        const near=Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
        activePlayer.currentTime=snapIntoBuffer(activePlayer, near);
      }
    }
  },250);
}

/* -------------------- Controls -------------------------- */
startBtn.addEventListener('click',startPlayback);

btnSplit.addEventListener('click',()=>{
  splitMode=(splitMode+1)%4;
  root.classList.toggle('split', splitMode!==0);
  root.classList.remove('mode1','mode2','mode3');
  if(splitMode===1) root.classList.add('mode1');
  if(splitMode===2) root.classList.add('mode2');
  if(splitMode===3) root.classList.add('mode3');
});
btnFill.addEventListener('click',()=>{
  if(splitMode===0){
    isMainFull=!isMainFull;
    root.classList.toggle('main-full',isMainFull);
    root.classList.toggle('cover-one',isMainFull);
  }else{
    splitMode=(splitMode===2)?3:2;
    root.classList.remove('mode1','mode2','mode3');
    root.classList.add(splitMode===2?'mode2':'mode3');
    root.classList.add('split');
  }
});
btnSound.addEventListener('click',()=>{
  if(!started) return;
  mainPlayer.muted=!mainPlayer.muted;
  if(!mainPlayer.muted) mainPlayer.play().catch(()=>{});
});
const gSeek=(ofs)=>{
  if(!started) return;
  const t=capLiveEdge(mainPlayer,(mainPlayer.currentTime||0)+ofs);
  mainPlayer.currentTime=t;
  if(activePlayer) activePlayer.currentTime=snapIntoBuffer(activePlayer,t);
};
gBack.addEventListener('click',()=>gSeek(-5));
gFwd .addEventListener('click',()=>gSeek( 5));
gPlay.addEventListener('click',async()=>{
  if(!started) return;
  if(mainPlayer.paused){ try{ await mainPlayer.play(); }catch(_){ } }
  else mainPlayer.pause();
});
scrub.addEventListener('input',()=>{ if(started) isScrubbing=true; });
scrub.addEventListener('change',()=>{
  if(!started) return;
  const nt=capLiveEdge(mainPlayer, parseFloat(scrub.value)||0);
  mainPlayer.currentTime=nt;
  if(activePlayer) activePlayer.currentTime=snapIntoBuffer(activePlayer,nt);
  isScrubbing=false;
});
document.getElementById('mainPreview').addEventListener('click',()=>{
  if(splitMode!==0) return;
  isMainFull=!isMainFull;
  root.classList.toggle('main-full',isMainFull);
  root.classList.toggle('cover-one',isMainFull);
});
document.addEventListener('keydown',(e)=>{
  if(e.key===' '||e.key==='Enter'){ e.preventDefault(); startPlayback(); }
  if(e.key==='S'||e.key==='s'){ btnSplit.click(); }
  if(e.key==='F'||e.key==='f'){ btnFill.click(); }
  if(e.key==='M'||e.key==='m'){ btnSound.click(); }
  if(e.key==='ArrowLeft'){ gBack.click(); }
  if(e.key==='ArrowRight'){ gFwd.click(); }
});

/* =================== LiveKit section ==================== */
/** تحميل مكتبة LiveKit من المسار المحلي فقط */
async function loadLiveKit(){
  // إن كانت مُحمّلة مسبقًا
  if(window.livekitClient || window.LiveKitClient || window.LiveKit) return true;

  // حمّل الملف المحلي
  try{
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='/vendor/livekit-client.umd.min.js?v='+Date.now().toString(36);
      s.defer=true;
      s.onload=resolve;
      s.onerror=reject;
      document.head.appendChild(s);
    });
  }catch(e){
    console.error('فشل تحميل LiveKit المحلي:', e);
    alert('LiveKit SDK غير مُحمَّل — تأكد من وجود /vendor/livekit-client.umd.min.js');
    return false;
  }

  // تحقق من توفّر الكائن
  const LK = window.livekitClient || window.LiveKitClient || window.LiveKit;
  if(!LK){
    console.error('LiveKit object not found after local load');
    alert('LiveKit SDK غير مُحمَّل — ملف vendor لم يُفعّل.');
    return false;
  }
  return true;
}

// عناصر شريط LiveKit
const roomSel     = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn     = document.getElementById('pairBtn');
const publishBtn  = document.getElementById('publishBtn');
const stopBtn     = document.getElementById('stopBtn');
const lkStatus    = document.getElementById('lkStatus');

let lkRoom=null;
let localTracks=[]; // [videoTrack, audioTrack]
function setLKStatus(txt){ lkStatus.textContent = txt; }

/** يضمن توفر SDK */
// ضع هذا بدلاً من loadLiveKit() و getLK() السابقين

function getLK() {
  return (
    window.livekitClient ||
    window.LiveKitClient ||
    window.LiveKit ||
    window.livekit ||
    window.Livekit || null
  );
}

function waitForLK(timeoutMs=2000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function loop() {
      const LK = getLK();
      if (LK) return resolve(LK);
      if (performance.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(loop, 40);
    })();
  });
}

async function loadScriptOnce(src) {
  // لا تكرر تحميل نفس المصدر
  if ([...document.scripts].some(s => s.src.endsWith(src))) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function loadLiveKit() {
  // إن كان جاهزاً بالفعل
  if (getLK()) return true;

  // 1) جرّب الملف المحلي
  try {
    await loadScriptOnce('/vendor/livekit-client.umd.min.js?v=' + Date.now().toString(36));
  } catch(e) {
    console.warn('فشل تحميل الملف المحلي LiveKit UMD:', e);
  }
  if (await waitForLK(1500)) return true;

  // 2) خطة بديلة: CDN (اسم النتيجة UMD أيضاً)
  // ملاحظة: تأكّد أن script-src يسمح jsDelivr (أنت أضفته في CSP).
  try {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js');
  } catch(e) {
    console.warn('فشل تحميل CDN:', e);
  }
  if (await waitForLK(2000)) return true;

  alert('LiveKit SDK غير مُحمَّل — تأكد من وجود /vendor/livekit-client.umd.min.js أو السماح بالـCDN.');
  console.error('LiveKit object not found after local/CDN load');
  return false;
}


/** اقتران (سماح) */
pairBtn.addEventListener('click', async ()=>{
  try{
    const loaded = await loadLiveKit();
    if(!loaded) return;

    setLKStatus('فحص الأجهزة…');
    const check=await assertDevices();
    if(!check.ok){
      alert('لا توجد كاميرا أو ميكروفون متاحين على هذا الجهاز.');
      setLKStatus('الجهاز بلا كاميرا/مايك');
      return;
    }

    const LK = getLK(); if(!LK){
      alert('LiveKit SDK غير محمّل محليًا.');
      return;
    }

    // أذونات ومسارات محلية
    setLKStatus('طلب الأذونات…');
    // أوقف أي مسارات قديمة
    localTracks.forEach(t=>{ try{t.stop();}catch(_){ } }); localTracks=[];

    const tracks = await LK.createLocalTracks({
      audio: true,
      video: { facingMode: 'user', resolution: LK.VideoPresets.h720 }
    });

    localTracks = tracks;
    publishBtn.disabled = false;
    stopBtn.disabled = false;
    setLKStatus('جاهز للنشر');
  }catch(err){
    console.error('Pair error:', err);
    if(err && (err.name==='NotFoundError' || err.message?.includes('Requested device not found'))){
      alert('تعذّر إيجاد كاميرا/مايك. تأكد من توصيل الأجهزة ومنح الإذن للمتصفح/النطاق.');
    }else if(err && (err.name==='NotAllowedError' || err.message?.includes('Permission'))){
      alert('تم رفض الإذن للكاميرا/المايك. افتح إعدادات الموقع ومنح الأذونات ثم أعد المحاولة.');
    }else{
      alert('تعذر الوصول للكاميرا/المايك — امنح الإذن ثم أعد المحاولة.');
    }
    setLKStatus('فشل الاقتران');
  }
});

/** نشر */
publishBtn.addEventListener('click', async ()=>{
  const LK = getLK();
  if(!LK){ alert('LiveKit SDK غير مُحمَّل.'); return; }

  try{
    publishBtn.disabled = true;

    const roomName = roomSel.value || 'room-1';
    const identity = (displayName.value||'').trim() || ('user-'+Math.random().toString(36).slice(2,8));

    setLKStatus('جلب التوكن…');
    const tokenRes = await fetch(`https://steps-presinter.onrender.com/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`);
    if(!tokenRes.ok){
      publishBtn.disabled=false;
      setLKStatus('فشل جلب التوكن');
      alert('فشل طلب التوكن (تحقق من خدمة Render/الإذن CORS).');
      return;
    }
    const tokenJson = await tokenRes.json();
    const lkUrl  = tokenJson.url;   // ← لا تستخدم اسم url لتفادي التعارضات
    const lkTok  = tokenJson.token;

    if(!lkUrl || !lkTok){
      publishBtn.disabled=false;
      setLKStatus('توكن غير صالح');
      alert('استجابة التوكن غير صحيحة. الصيغة المتوقعة: { url, token }');
      return;
    }

    setLKStatus('الاتصال بالغرفة…');
    lkRoom = new LK.Room({ adaptiveStream:true, dynacast:true });
    lkRoom.on(LK.RoomEvent.Disconnected, ()=> setLKStatus('LiveKit: غير متصل'));
    await lkRoom.connect(lkUrl, lkTok);

    setLKStatus('نشر المسارات…');
    for(const tr of localTracks){ await lkRoom.localParticipant.publishTrack(tr); }
    setLKStatus(`LiveKit: متصل (${roomName})`);
  }catch(err){
    console.error('Publish error:', err);
    alert('تعذر نشر الصوت/الفيديو — تحقق من التوكن والاتصال بالشبكة.');
    setLKStatus('فشل النشر');
    publishBtn.disabled=false;
  }
});

/** إيقاف */
stopBtn.addEventListener('click',()=>{
  try{
    if(lkRoom){ lkRoom.disconnect(); lkRoom=null; }
    localTracks.forEach(t=>{ try{t.stop();}catch(_){ } }); localTracks=[];
    setLKStatus('LiveKit: غير متصل');
    publishBtn.disabled=true;
    stopBtn.disabled=true;
  }catch(_){}
});

/* ----------------- HLS debug wiring (اختياري) ----------- */
(function addHlsDebug(){
  function wire(video){
    const h=video && video.__hls; if(!h) return;
    h.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{
      try{
        const lv=(data&&data.levels||[]).map(l=>({h:l.height,codecs:l.codecs}));
        console.log('[HLS] MANIFEST_PARSED levels=', lv);
      }catch(_){}
    });
    h.on(Hls.Events.LEVEL_LOADED,(_,data)=>{
      console.log('[HLS] LEVEL_LOADED targetduration=', data?.details?.targetduration, 'frags=', data?.details?.fragments?.length);
    });
    h.on(Hls.Events.ERROR,(_,err)=>{ console.error('[HLS] ERROR', err?.type, err?.details, err); });
  }
  const mo=new MutationObserver(()=>{ document.querySelectorAll('video').forEach(v=>{ if(!v.__debugWired && v.__hls){ v.__debugWired=true; wire(v); } }); });
  mo.observe(document.body,{childList:true,subtree:true});
})();
