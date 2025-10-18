/* ===== إعدادات HLS المحافظة ===== */
const SAFETY_EDGE   = 0.80;
const SHOW_MIN_BUF  = 1.25;
const STARVED_RESEEK= 0.25;

const hasUrl=(u)=>typeof u==='string' && /(https?:\/\/[^/]+)?\/hls\/.+\.m3u8(\?.*)?$/i.test(u);
function isAvc(l){return /avc1/i.test(l?.codecs||l?.codecsVideo||"");}
function pickBestAvc(levels,capHeight=480){
  if(!levels?.length) return -1;
  const avc=levels.map((l,i)=>({i,h:l.height||0,avc:isAvc(l)})).filter(x=>x.avc);
  if(!avc.length) return 0;
  let c=avc.filter(x=>x.h && x.h<=capHeight); if(!c.length) c=avc;
  c.sort((a,b)=>a.h-b.h); return c[c.length-1].i;
}
function highestAvcIndex(levels){let m=-1;(levels||[]).forEach((l,i)=>{if(isAvc(l))m=i;});return m>=0?m:((levels&&levels.length)?levels.length-1:-1);}

const HLS_CFG = {
  lowLatencyMode: false,
  // مزامنة وذاكرة
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 6,
  maxLiveSyncPlaybackRate: 1.0,
  maxBufferLength: 18,
  backBufferLength: 14,
  maxBufferSize: 40 * 1000 * 1000,
  capLevelToPlayerSize: true,

  // iOS + CSP: تعطيل العامل لتجنب أي تضارب
  enableWorker: false,

  // ثقوب وت Nudges
  maxBufferHole: 0.2,
  maxSeekHole: 0.3,
  nudgeOffset: 0.15,
  nudgeMaxRetry: 12,

  abrMaxWithRealBitrate: true,

  // مهلات ومحاولات أعلى لأن البروكسي بطيء أحيانًا
  fragLoadingMaxRetry: 8,
  manifestLoadingMaxRetry: 8,
  levelLoadingMaxRetry: 6,

  fragLoadingRetryDelay: 500,       // يبدأ بـ 0.5s
  manifestLoadingRetryDelay: 700,
  levelLoadingRetryDelay: 700,

  fragLoadingTimeOut: 20000,        // 20s بدل 10s
  manifestLoadingTimeOut: 12000,
  levelLoadingTimeOut: 15000,

  // لا ترسل كوكيز
  xhrSetup: (xhr) => { try { xhr.withCredentials = false; } catch(e){} }
};


function getSeekableRange(v){try{const r=v.seekable;if(!r||!r.length)return null;return{start:r.start(r.length-1),end:r.end(r.length-1)};}catch(e){return null;}}
function capLiveEdge(v,t){const m=getSeekableRange(v); if(!m) return t; return Math.min(t, m.end - SAFETY_EDGE);}
function bufferedAhead(v){try{const b=v.buffered;const t=v.currentTime||0;for(let i=0;i<b.length;i++){const s=b.start(i),e=b.end(i);if(t>=s && t<=e) return Math.max(0,e-t);} }catch(e){} return 0;}
function containsTime(v,t){try{const b=v.buffered;for(let i=0;i<b.length;i++){if(t>=b.start(i)&&t<=b.end(i)) return {start:b.start(i),end:b.end(i)};} }catch(e){} return null;}
function nearestBufferedTime(v,t){try{const b=v.buffered;let best=null,dm=1e9;for(let i=0;i<b.length;i++){const s=b.start(i),e=b.end(i);const cand=(t<s)?s:(t>e?e:t);const d=Math.abs(cand-t);if(d<dm){dm=d;best=cand;}} return best;}catch(e){return null;}}
function snapIntoBuffer(v,t){t=capLiveEdge(v,t); const r=containsTime(v,t); if(r) return t; const near=nearestBufferedTime(v,t); return typeof near==='number'?near:t;}

/* ★★★ كانت مفقودة — تُسبب ReferenceError وتوقف السكربت ★★★ */
async function waitBufferedAt(v,t,minAhead=SHOW_MIN_BUF,timeout=6000){
  t=capLiveEdge(v,t); const t0=performance.now();
  return new Promise(res=>{(function loop(){
    const r=containsTime(v,t); if(r && r.end - t >= minAhead) return res(true);
    if(performance.now()-t0>timeout) return res(false);
    setTimeout(loop,90);
  })();});
}

function attachHlsWithAvc(video,url){
  const hls=new Hls({...HLS_CFG}); video.__hls=hls; hls.attachMedia(video);
  hls.on(Hls.Events.MEDIA_ATTACHED,()=>{hls.loadSource(url);});
  hls.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{try{
    const lv=data?.levels||[];const s=pickBestAvc(lv,480);const mx=highestAvcIndex(lv);
    if(s>=0){hls.startLevel=s;hls.currentLevel=s;hls.nextLevel=s;}
    if(mx>=0){hls.autoLevelCapping=mx;}
  }catch(e){}});
hls.on(Hls.Events.ERROR, (_, err) => {
  if (!err) return;
  // سجّل لتتبعّك
  console.error('[HLS] ERROR', err.type, err.details || err.reason || err);

  // أخطاء الشبكة/المهلة: بدّل المستوى وأعد التحميل برفق
  if (err.type === 'networkError' || err.details === 'fragLoadTimeOut' || err.details === 'fragLoadError') {
    try {
      const levels = hls.levels || [];
      if (levels.length) {
        // جرّب مستوى آخر مؤقتًا
        const next = (hls.currentLevel + 1) % levels.length;
        hls.nextLevel = next;
      }
      hls.stopLoad();
      setTimeout(() => hls.startLoad(), 800);
    } catch (_) {}
    return; // لا تعتبرها قاتلة
  }

  // أخطاء ميديا: معالجة الاستشفاء
  if (err.fatal && err.type === 'mediaError') {
    try { hls.recoverMediaError(); }
    catch (e) {
      try { hls.destroy(); } catch (_){}
      try { attachHlsWithAvc(video, url); } catch (_){}
    }
    return;
  }

  // أخطاء قاتلة أخرى: أعد إنشاء المشغّل
  if (err.fatal) {
    try { hls.destroy(); } catch (_){}
    try { attachHlsWithAvc(video, url); } catch (_){}
  }
});

  const starve=()=>{try{
    const m=getSeekableRange(video); if(!m) return;
    const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
    video.currentTime = snapIntoBuffer(video, near);
    video.play().catch(()=>{});
  }catch(e){}};
  video.addEventListener('waiting',()=>{ if(bufferedAhead(video)<0.3) starve(); });
  video.addEventListener('stalled',()=>{ if(bufferedAhead(video)< 0.3) starve(); });
  return hls;
}

function createVideoElement(url){
  const wrap=document.createElement('div'); wrap.className='layer'; wrap.style.cssText='position:absolute;inset:0;opacity:0';
  const v=document.createElement('video');
  v.playsInline=true; v.muted=true; v.controls=false; v.preload='auto'; v.crossOrigin='anonymous';
  v.style.cssText='width:100%;height:100%;object-fit:contain';
  wrap.appendChild(v);

  if(hasUrl(url) && window.Hls && Hls.isSupported()){attachHlsWithAvc(v,url);}
  else if(hasUrl(url) && v.canPlayType('application/vnd.apple.mpegURL')){v.src=url;}
  else {v.src=url;}
  return {wrap, video:v};
}

/* ===== DOM ===== */
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

let started=false, splitMode=0, isMainFull=false;
let mainPlayer, activePlayer, currentCam='cam2';
let ticker=null, isScrubbing=false;
const playersCache=new Map();
const fmt=(t)=>{t=Math.max(0,Math.floor(t||0));const m=String(Math.floor(t/60)).padStart(2,'0');const s=String(t%60).padStart(2,'0');return `${m}:${s}`;};
const mountTo=(container, node)=>container.appendChild(node);

/* ===== init ===== */
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
  video.addEventListener('canplay',()=>{rec.ready=true;},{once:true});
  playersCache.set(id,rec);
  return rec;
}
function buildStreamList(){
  streamList.innerHTML='';
  (window.channelMap||[]).filter(ch=>hasUrl(ch.src)).forEach(ch=>{
    const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam=ch.id;
    const name=document.createElement('div'); name.className='stream-name'; name.textContent=ch.label;
    li.appendChild(name);
    li.addEventListener('click',()=>{ setActiveCamSmooth(ch.id).catch(console.error); });
    streamList.appendChild(li);
  });
  document.addEventListener('keydown',(e)=>{
    if(e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    const items=[...document.querySelectorAll('.stream-item')];
    const n=Number(e.key); if(n>=1 && n<=items.length) items[n-1].click();
  });
}
function markActiveList(){document.querySelectorAll('.stream-item').forEach(el=>{el.classList.toggle('active',el.dataset.cam===currentCam);});}

function initOnce(){
  try{
    initMain();
    const first=getOrCreateCam(currentCam);
    first.wrap.style.opacity='1';
    activePlayer=first.video;
    buildStreamList();
    markActiveList();
  }catch(err){
    console.error('initOnce error:', err);
  }
}
/* تأكد من الاستدعاء دائمًا حتى لو كان DOM محمّلاً مسبقًا */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnce);
} else {
  initOnce();
}

/* ===== تبديل الكاميرا بسلاسة ===== */
async function setActiveCamSmooth(id){
  try{
    if(!window.sources[id] || id===currentCam) return;
    currentCam=id; markActiveList();
    const target=getOrCreateCam(id);
    const v=target.video, w=target.wrap;

    if(!target.ready) await new Promise(r => v.addEventListener('canplay', r, {once:true}));

    let T = capLiveEdge(v, (mainPlayer.currentTime||0));
    const ok = await waitBufferedAt(v, T, SHOW_MIN_BUF, 6000);
    v.currentTime = snapIntoBuffer(v, ok?T:(v.currentTime||0));
    try{ await v.play(); }catch(_){}

    w.className='layer fade-in'; w.style.opacity='1';
    const old = activePlayer, oldWrap = old ? old.parentElement : null;
    setTimeout(()=>{ if(oldWrap){ oldWrap.className='layer fade-out'; oldWrap.style.opacity='0'; } activePlayer=v; }, 180);
  }catch(err){
    console.error('switch error:', err);
  }
}

/* ===== UI hide/show ===== */
let uiTimer=null;
function showUI(){root.classList.remove('ui-hidden');root.classList.add('ui-visible');clearTimeout(uiTimer);uiTimer=setTimeout(()=>{root.classList.add('ui-hidden');root.classList.remove('ui-visible');},2500);}
['mousemove','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,showUI,{passive:true}));
[streamPanel,globalControls,document.getElementById('utilityControls')].forEach(el=>{
  el.addEventListener('mouseenter',()=>{clearTimeout(uiTimer);root.classList.remove('ui-hidden');root.classList.add('ui-visible');});
  el.addEventListener('mouseleave',showUI);
});
setTimeout(showUI,1000);

/* ===== تشغيل أولي & ساعة ===== */
async function startPlayback(){
  if(started) return; started=true;
  gatePlay.classList.add('hidden'); globalControls.classList.remove('hidden');
  try{ await mainPlayer.play(); }catch(_){}
  try{ await activePlayer.play(); }catch(_){}
  setTimeout(()=>{ const m=getSeekableRange(mainPlayer); if(m){ mainPlayer.currentTime=Math.max(m.start,m.end-SAFETY_EDGE); }},300);
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
        const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
        activePlayer.currentTime = snapIntoBuffer(activePlayer, near);
      }
    }
  },250);
}

/* ===== تحكمات ===== */
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
    isMainFull=!isMainFull; root.classList.toggle('main-full',isMainFull); root.classList.toggle('cover-one',isMainFull);
  }else{
    splitMode = (splitMode===2)?3:2;
    root.classList.remove('mode1','mode2','mode3');
    root.classList.add(splitMode===2?'mode2':'mode3');
    root.classList.add('split');
  }
});
btnSound.addEventListener('click',()=>{ if(!started) return; mainPlayer.muted=!mainPlayer.muted; if(!mainPlayer.muted) mainPlayer.play().catch(()=>{}); });
const gSeek=(ofs)=>{ if(!started) return; const t=capLiveEdge(mainPlayer,(mainPlayer.currentTime||0)+ofs); mainPlayer.currentTime=t; if(activePlayer) activePlayer.currentTime=snapIntoBuffer(activePlayer,t); };
gBack.addEventListener('click',()=>gSeek(-5));
gFwd .addEventListener('click',()=>gSeek( 5));
gPlay.addEventListener('click',async()=>{ if(!started) return; if(mainPlayer.paused){try{await mainPlayer.play();}catch(e){}} else mainPlayer.pause(); });
scrub.addEventListener('input',()=>{ if(started) isScrubbing=true; });
scrub.addEventListener('change',()=>{ if(!started) return; const nt=capLiveEdge(mainPlayer, parseFloat(scrub.value)||0); mainPlayer.currentTime=nt; if(activePlayer) activePlayer.currentTime=snapIntoBuffer(activePlayer,nt); isScrubbing=false; });
document.getElementById('mainPreview').addEventListener('click',()=>{ if(splitMode!==0) return; isMainFull=!isMainFull; root.classList.toggle('main-full',isMainFull); root.classList.toggle('cover-one',isMainFull); });

/* ===== LiveKit: اقتران/نشر ===== */
// في app.js (قبل استخدام LiveKit)
const LK =
  (window.livekit) ||
  (window.LiveKit) ||
  (window.Livekit) ||
  (window.LiveKitClient);

function ensureSDK(){
  if (!LK || !LK.Room || !LK.createLocalTracks) {
    alert('LiveKit SDK غير مُحمَّل — تأكد من وسم الـ CDN في index.html أو وجود /vendor/local.');
    return false;
  }
  return true;
}
const roomSel = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn = document.getElementById('pairBtn');
const publishBtn = document.getElementById('publishBtn');
const stopBtn = document.getElementById('stopBtn');
const lkStatus = document.getElementById('lkStatus');

let lkRoom=null;
let localTracks=[];

function setLKStatus(txt){ lkStatus.textContent = txt; }
pairBtn.addEventListener('click', async () => {
  try{
    if(!ensureSDK()) return;
    setLKStatus('طلب أذونات…');
    localTracks.forEach(t=>{try{t.stop();}catch(_){}}); localTracks=[];
    const tracks = await LK.createLocalTracks({
      audio: true,
      video: { facingMode: 'user', resolution: LK.VideoPresets.h720 }
    });
    localTracks = tracks;
    setLKStatus('جاهز للنشر');
    publishBtn.disabled = false;
    stopBtn.disabled = false;
  }catch(err){
    console.error('Pair error:', err);
    alert('تعذر الوصول للكاميرا/المايك — امنح الإذن ثم أعد المحاولة.');
    setLKStatus('فشل الاقتران');
  }
});

publishBtn.addEventListener('click', async () => {
  if(!ensureSDK()) return;
  try{
    publishBtn.disabled = true;
    const roomName = roomSel.value || 'room-1';
    const identity = (displayName.value || '').trim() || ('user-' + Math.random().toString(36).slice(2,8));
    setLKStatus('جلب توكن…');
    const res = await fetch(`https://steps-livekit-api.onrender.com/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`);
    if(!res.ok){ publishBtn.disabled = false; alert('فشل طلب التوكن (تحقق من السيرفر/الراوت).'); setLKStatus('فشل جلب التوكن'); return; }
    const { url, token } = await res.json();
    if(!url || !token){ publishBtn.disabled = false; alert('استجابة غير صحيحة: يجب { url, token }'); setLKStatus('توكن غير صالح'); return; }

    setLKStatus('الاتصال بالغرفة…');
    lkRoom = new LK.Room({ adaptiveStream: true, dynacast: true });
    lkRoom.on(LK.RoomEvent.Disconnected, () => setLKStatus('LiveKit: غير متصل'));
    await lkRoom.connect(url, token);

    setLKStatus('نشر المسارات…');
    for (const tr of localTracks){ await lkRoom.localParticipant.publishTrack(tr); }
    setLKStatus(`LiveKit: متصل (${roomName})`);
  }catch(err){
    console.error('Publish error:', err);
    alert('تعذر نشر الصوت/الفيديو — تأكد من التوكن/الشبكة.');
    setLKStatus('فشل النشر');
    publishBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', () => {
  try{
    if(lkRoom){ lkRoom.disconnect(); lkRoom = null; }
    localTracks.forEach(t=>{try{t.stop();}catch(_){}}); localTracks=[];
    setLKStatus('LiveKit: غير متصل');
    publishBtn.disabled = true;
    stopBtn.disabled = true;
  }catch(e){}
});

/* ===== Debug HLS (اختياري) ===== */
(function addHlsDebug(){
  function wireDebug(video){
    const h=video && video.__hls; if(!h) return;
    h.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{console.log('[HLS] MANIFEST_PARSED levels=',(data&&data.levels||[]).map(l=>({h:l.height,codecs:l.codecs})));});
    h.on(Hls.Events.LEVEL_LOADED,(_,data)=>{console.log('[HLS] LEVEL_LOADED targetduration=',data?.details?.targetduration,'frags=',data?.details?.fragments?.length);});
    h.on(Hls.Events.ERROR,(_,err)=>{console.error('[HLS] ERROR',err?.type,err?.details,err);});
  }
  const mo=new MutationObserver(()=>{document.querySelectorAll('video').forEach(v=>{if(!v.__debugWired && v.__hls){v.__debugWired=true;wireDebug(v);}});});
  mo.observe(document.body,{childList:true,subtree:true});
})();
