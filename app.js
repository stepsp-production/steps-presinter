/* ========= تكوين مصادر HLS ========= */
(function initSources(){
  const BASE = (document.body.getAttribute('data-hls-base') || '').replace(/\/$/,'');
  const build = (p)=>BASE ? `${BASE}${p}` : p;

  window.sources = {
    main: build("/hls/live/playlist.m3u8"),        // الكاميرا الرئيسية
    cam1: build("/hls/lastone/playlist.m3u8"),
    cam2: build("/hls/live2/playlist.m3u8"),
    cam3: build("/hls/live3/playlist.m3u8"),
    cam4: build("/hls/live4/playlist.m3u8"),
    cam5: build("/hls/live5/playlist.m3u8"),
    cam6: build("/hls/live6/playlist.m3u8"),
    cam7: build("/hls/live7/playlist.m3u8"),
  };

  window.channelMap = [
    {id:'main',label:'MAIN',   src:sources.main},
    {id:'cam1',label:'Cam1',   src:sources.cam1},
    {id:'cam2',label:'Cam2',   src:sources.cam2},
    {id:'cam3',label:'Cam3',   src:sources.cam3},
    {id:'cam4',label:'Cam4',   src:sources.cam4},
    {id:'cam5',label:'Cam5',   src:sources.cam5},
    {id:'cam6',label:'Drone',  src:sources.cam6},
    {id:'cam7',label:'Sineflex',src:sources.cam7},
  ];
})();

/* ========= أدوات مساعدة ========= */
const $ = (sel)=>document.querySelector(sel);

/* ========= إعدادات تشغيل HLS (محافظة) ========= */
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

const HLS_CFG={
  lowLatencyMode:false,
  liveSyncDurationCount:3, liveMaxLatencyDurationCount:6, maxLiveSyncPlaybackRate:1.0,
  maxBufferLength:18, backBufferLength:14, maxBufferSize:40*1000*1000,
  capLevelToPlayerSize:true, enableWorker:true,
  maxBufferHole:0.15, maxSeekHole:0.25, nudgeOffset:0.12, nudgeMaxRetry:10,
  abrMaxWithRealBitrate:true,
  fragLoadingMaxRetry:6, manifestLoadingMaxRetry:6, levelLoadingMaxRetry:5,
  fragLoadingRetryDelay:350, manifestLoadingRetryDelay:500, levelLoadingRetryDelay:500,
  fragLoadingTimeOut:10000, manifestLoadingTimeOut:8000, levelLoadingTimeOut:8000,
  xhrSetup:(xhr)=>{try{xhr.withCredentials=false;}catch(e){}}
};

function getSeekableRange(v){try{const r=v.seekable;if(!r||!r.length)return null;return{start:r.start(r.length-1),end:r.end(r.length-1)};}catch(e){return null;}}
function capLiveEdge(v,t){const m=getSeekableRange(v); if(!m) return t; return Math.min(t, m.end - SAFETY_EDGE);}
function bufferedAhead(v){try{const b=v.buffered;const t=v.currentTime||0;for(let i=0;i<b.length;i++){const s=b.start(i),e=b.end(i);if(t>=s && t<=e) return Math.max(0,e-t);} }catch(e){} return 0;}
function containsTime(v,t){try{const b=v.buffered;for(let i=0;i<b.length;i++){if(t>=b.start(i)&&t<=b.end(i)) return {start:b.start(i),end:b.end(i)};} }catch(e){} return null;}
function nearestBufferedTime(v,t){try{const b=v.buffered;let best=null,dm=1e9;for(let i=0;i<b.length;i++){const s=b.start(i),e=b.end(i);const cand=(t<s)?s:(t>e?e:t);const d=Math.abs(cand-t);if(d<dm){dm=d;best=cand;}} return best;}catch(e){return null;}}
async function waitBufferedAt(v,t,minAhead=SHOW_MIN_BUF,timeout=6000){
  t=capLiveEdge(v,t); const t0=performance.now();
  return new Promise(res=>{(function loop(){
    const r=containsTime(v,t); if(r && r.end - t >= minAhead) return res(true);
    if(performance.now()-t0>timeout) return res(false);
    setTimeout(loop,90);
  })();});
}
function snapIntoBuffer(v,t){t=capLiveEdge(v,t); const r=containsTime(v,t); if(r) return t; const near=nearestBufferedTime(v,t); return typeof near==='number'?near:t;}

function attachHlsWithAvc(video,url){
  const hls=new Hls({...HLS_CFG}); video.__hls=hls; hls.attachMedia(video);
  hls.on(Hls.Events.MEDIA_ATTACHED,()=>{hls.loadSource(url);});
  hls.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{try{
    const lv=data?.levels||[];
    const s=pickBestAvc(lv,480); const mx=highestAvcIndex(lv);
    if(s>=0){hls.startLevel=s;hls.currentLevel=s;hls.nextLevel=s;}
    if(mx>=0){hls.autoLevelCapping=mx;}
  }catch(e){}});
  hls.on(Hls.Events.ERROR,(_,err)=>{
    if(err?.fatal){
      if(err.type==='mediaError'){ try{hls.recoverMediaError();}catch(e){ try{hls.destroy();}catch(_){} try{attachHlsWithAvc(video,url);}catch(__){} } }
      else { try{hls.destroy();}catch(e){} try{attachHlsWithAvc(video,url);}catch(_){ } }
    }
  });

  // جوع البافر
  const starve=()=>{try{
    const m=getSeekableRange(video); if(!m) return;
    const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
    video.currentTime = snapIntoBuffer(video, near);
    video.play().catch(()=>{});
  }catch(e){}};
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

  if(hasUrl(url) && window.Hls && Hls.isSupported()){attachHlsWithAvc(v,url);}
  else if(hasUrl(url) && v.canPlayType('application/vnd.apple.mpegURL')){v.src=url;}
  else {v.src=url;}
  return {wrap, video:v};
}

/* ========= DOM & حالة ========= */
const root = $('#playerContainer');
const mainContainer = $('#mainPreview');
const camContainer  = $('#activeCam');
const gatePlay = $('#gatePlay');
const startBtn = $('#startBtn');
const btnSplit = $('#btnSplit');
const btnFill  = $('#btnFill');
const btnSound = $('#btnSound');
const globalControls = $('#globalControls');
const gPlay = $('#gPlay'), gBack=$('#gBack'), gFwd=$('#gFwd');
const scrub = $('#scrub'), timeLabel=$('#timeLabel');

const streamPanel = $('#streamPanel');
const streamList  = $('#streamList');

const fmt=(t)=>{t=Math.max(0,Math.floor(t||0));const m=String(Math.floor(t/60)).padStart(2,'0');const s=String(t%60).padStart(2,'0');return `${m}:${s}`;};

let started=false, splitMode=0, isMainFull=false;
let mainPlayer, activePlayer, currentCam='cam2';
let ticker=null, isScrubbing=false;
const playersCache=new Map(); // id -> {wrap, video, ready}

function mountTo(container, node){container.appendChild(node);}

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

/* القائمة */
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
function markActiveList(){document.querySelectorAll('.stream-item').forEach(el=>{el.classList.toggle('active',el.dataset.cam===currentCam);});}

function initOnce(){
  initMain();
  const first=getOrCreateCam(currentCam);
  first.wrap.style.opacity='1';
  activePlayer=first.video;

  buildStreamList();
  markActiveList();
}
initOnce();

/* تبديل الكاميرا بدون تقطّع */
async function setActiveCamSmooth(id){
  if(!window.sources[id] || id===currentCam) return;
  currentCam=id; markActiveList();
  const target=getOrCreateCam(id);
  const v=target.video, w=target.wrap;

  if(!target.ready) await new Promise(r => v.addEventListener('canplay', r, {once:true}));

  let T = capLiveEdge(v, (mainPlayer.currentTime||0));
  await waitBufferedAt(v, T, SHOW_MIN_BUF, 6000);
  v.currentTime = snapIntoBuffer(v, T);
  try{ await v.play(); }catch(_){}

  w.className='layer fade-in'; w.style.opacity='1';
  const old = activePlayer, oldWrap = old ? old.parentElement : null;
  setTimeout(()=>{ if(oldWrap){ oldWrap.className='layer fade-out'; oldWrap.style.opacity='0'; } activePlayer=v; }, 180);
}

/* إخفاء واجهة التحكم تلقائيًا (تشمل شريط الغرف .chrome) */
let uiTimer=null;
function showUI(){
  root.classList.remove('ui-hidden'); root.classList.add('ui-visible');
  clearTimeout(uiTimer);
  uiTimer=setTimeout(()=>{root.classList.add('ui-hidden');root.classList.remove('ui-visible');},2500);
}
['mousemove','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,showUI,{passive:true}));
[streamPanel,globalControls,$('#utilityControls'),$('#chrome')].forEach(el=>{
  el.addEventListener('mouseenter',()=>{clearTimeout(uiTimer);root.classList.remove('ui-hidden');root.classList.add('ui-visible');});
  el.addEventListener('mouseleave',showUI);
});
setTimeout(showUI,1000);

/* تشغيل أولي & ساعة */
async function startPlayback(){
  if(started) return; started=true;
  gatePlay.classList.add('hidden'); globalControls.classList.remove('hidden');

  try{ await mainPlayer.play(); }catch(_){}
  try{ await activePlayer.play(); }catch(_){}
  setTimeout(async()=>{
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
        const near = Math.max(m.start, m.end - SAFETY_EDGE - STARVED_RESEEK);
        activePlayer.currentTime = snapIntoBuffer(activePlayer, near);
      }
    }
  },250);
}

/* تحكّمات */
startBtn.addEventListener('click',startPlayback);

// زر التقسيم — 0 عادي → 1 contain → 2 نصف حواف → 3 ملء كامل
btnSplit.addEventListener('click',()=>{
  splitMode=(splitMode+1)%4;
  root.classList.toggle('split', splitMode!==0);
  root.classList.remove('mode1','mode2','mode3');
  if(splitMode===1) root.classList.add('mode1');
  if(splitMode===2) root.classList.add('mode2');
  if(splitMode===3) root.classList.add('mode3');
});

// زر الملء
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

$('#mainPreview').addEventListener('click',()=>{ if(splitMode!==0) return; isMainFull=!isMainFull; root.classList.toggle('main-full',isMainFull); root.classList.toggle('cover-one',isMainFull); });

document.addEventListener('keydown',(e)=>{
  if(e.key===' '||e.key==='Enter'){ e.preventDefault(); startPlayback(); }
  if(e.key==='S'||e.key==='s'){ btnSplit.click(); }
  if(e.key==='F'||e.key==='f'){ btnFill.click(); }
  if(e.key==='M'||e.key==='m'){ btnSound.click(); }
  if(e.key==='ArrowLeft'){ gBack.click(); }
  if(e.key==='ArrowRight'){ gFwd.click(); }
});

/* ========= Debug (اختياري) ========= */
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

/* ========= LiveKit: سماح & نشر ========= */
/* يعتمد على vendor/livekit-client.umd.min.js (واجهة UMD: window.Livekit) */
const roomSel = $('#roomSel');
const displayName = $('#displayName');
const pairBtn = $('#pairBtn');
const publishBtn = $('#publishBtn');
const stopBtn = $('#stopBtn');
const lkStatus = $('#lkStatus');

let lk = {
  room: null,
  tracks: [],   // local audio/video tracks
  connected: false,
  publishing: false,
};

async function getToken(room, identity){
  const url = `https://steps-livekit-api.onrender.com/token?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}`;
  const res = await fetch(url, {credentials:'omit'});
  if(!res.ok){
    throw new Error(`Token fetch failed: ${res.status}`);
  }
  const j = await res.json();
  if(!j || !j.url || !j.token) throw new Error('Invalid token payload');
  return j; // {url, token}
}

function setLKStatus(txt){ lkStatus.textContent = txt; }

pairBtn.addEventListener('click', async ()=>{
  try{
    // اطلب أذونات المايك والكاميرا (اقتران)
    lk.tracks = await Livekit.createLocalTracks({audio:true, video:true});
    setLKStatus('LiveKit: تم الاقتران (محلي)');
    publishBtn.disabled = false;
    stopBtn.disabled = false;
  }catch(e){
    console.error('Pair error:', e);
    alert('تعذر الوصول للكاميرا/الميكروفون. امنح الإذن ثم أعد المحاولة.');
  }
});

publishBtn.addEventListener('click', async ()=>{
  const roomName = roomSel.value || 'room-1';
  const identity = (displayName.value || '').trim() || `user-${Math.random().toString(36).slice(2,7)}`;

  try{
    const {url, token} = await getToken(roomName, identity);

    if(!lk.room){
      lk.room = new Livekit.Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { videoSimulcastLayers: [Livekit.VideoPresets.h540.layers?.[0] || {}] }
      });
      lk.room.on('connected', ()=>{ lk.connected=true; setLKStatus(`LiveKit: متصل (${roomName})`); });
      lk.room.on('disconnected', ()=>{ lk.connected=false; lk.publishing=false; setLKStatus('LiveKit: غير متصل'); publishBtn.disabled=false; });
    }

    await lk.room.connect(url, token);
    // نشر التراكس
    for(const t of lk.tracks){
      try{ await lk.room.localParticipant.publishTrack(t); }catch(e){ console.warn('publishTrack failed', e); }
    }
    lk.publishing = true;
    setLKStatus(`LiveKit: ينشر الآن (${roomName})`);
    publishBtn.disabled = true;
    stopBtn.disabled = false;

  }catch(e){
    console.error('Publish error:', e);
    alert('تعذر نشر الكاميرا/المايك. تحقّق من خدمة التوكن والـCSP والاتصال.');
  }
});

stopBtn.addEventListener('click', async ()=>{
  try{
    if(lk.room){
      // إلغاء النشر
      for(const pub of lk.room.localParticipant.trackPublications.values()){
        try{ await lk.room.localParticipant.unpublishTrack(pub.track, {stop:true}); }catch(_){}
      }
      await lk.room.disconnect();
    }
  }catch(e){ console.warn(e); }
  finally{
    lk.connected=false; lk.publishing=false; setLKStatus('LiveKit: غير متصل');
    publishBtn.disabled=false; stopBtn.disabled=true;
  }
});
