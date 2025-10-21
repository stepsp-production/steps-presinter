/* لا تستخدم import؛ كل شيء UMD من /vendor */

/* ===== مُحمّل LiveKit قوي (محلي ثم CDN) ===== */
(function ensureLiveKit(){
  const version = '2.5.0';
  const LOCAL = '/vendor/livekit-client.umd.js';
  const CDN   = `https://cdn.jsdelivr.net/npm/livekit-client@${version}/dist/livekit-client.umd.js`;

  function pickGlobal(){
    const g = window;
    const candidates = [
      ['livekit', g.livekit],
      ['Livekit', g.Livekit],
      ['LiveKit', g.LiveKit],
      ['LiveKitClient', g.LiveKitClient],
      ['LivekitClient', g.LivekitClient],
      ['livekitClient', g.livekitClient],
    ];
    for (const [name,val] of candidates){ if (val) return {name,val}; }
    return null;
  }
  function inject(src){
    return new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src=src; s.async=true; s.crossOrigin='anonymous';
      s.onload=()=>res(true); s.onerror=(e)=>rej(e);
      document.head.appendChild(s);
    });
  }

  (async ()=>{
    for (let i=0;i<12;i++){
      const found = pickGlobal(); if (found){ console.log('[LK-LOADER] found global =', found.name); return; }
      await new Promise(r=>setTimeout(r,120));
    }
    try{
      console.log('[LK-LOADER] injecting local', LOCAL);
      await inject(LOCAL);
      for (let i=0;i<10;i++){
        const found = pickGlobal(); if (found){ console.log('[LK-LOADER] loaded local as', found.name); return; }
        await new Promise(r=>setTimeout(r,100));
      }
    }catch(e){ console.warn('[LK-LOADER] local inject failed', e); }
    try{
      console.log('[LK-LOADER] injecting CDN', CDN);
      await inject(CDN);
      for (let i=0;i<10;i++){
        const found = pickGlobal(); if (found){ console.log('[LK-LOADER] loaded CDN as', found.name); return; }
        await new Promise(r=>setTimeout(r,100));
      }
    }catch(e){ console.warn('[LK-LOADER] cdn inject failed', e); }
    if (!pickGlobal()){
      alert('LiveKit SDK غير مُحمَّل — تأكد من /vendor/livekit-client.umd.js أو السماح بالـCDN.');
    }
  })();
})();

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
    const lv=data?.levels||[];const s=pickBestAvc(lv,480);const mx=highestAvcIndex(lv);
    if(s>=0){hls.startLevel=s;hls.currentLevel=s;hls.nextLevel=s;}
    if(mx>=0){hls.autoLevelCapping=mx;}
  }catch(e){}});
  hls.on(Hls.Events.ERROR,(_,err)=>{
    if(!err?.fatal){ console.debug('[HLS] non-fatal', err?.details||err); return; }
    if(err.type==='mediaError'){ try{hls.recoverMediaError();}catch(e){ try{hls.destroy();}catch(_){} try{attachHlsWithAvc(video,url);}catch(__){} } }
    else { try{hls.destroy();}catch(e){} try{attachHlsWithAvc(video,url);}catch(_){ } }
  });
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

/* عناصر LiveKit (الرصيف السفلي) */
const roomSel = document.getElementById('roomSel');
const displayName = document.getElementById('displayName');
const pairBtn = document.getElementById('pairBtn');
const publishBtn = document.getElementById('publishBtn');
const stopBtn = document.getElementById('stopBtn');
const lkStatus = document.getElementById('lkStatus');

/* حالة */
let started=false, splitMode=0, isMainFull=false;
let mainPlayer, activePlayer, currentCam='cam2';
let ticker=null, isScrubbing=false;
const playersCache=new Map();
const fmt=(t)=>{t=Math.max(0,Math.floor(t||0));const m=String(Math.floor(t/60)).padStart(2,'0');const s=String(t%60).padStart(2,'0');return `${m}:${s}`;};
function mountTo(container, node){container.appendChild(node);}

/* ====== دعم المُعاينة المحلية + صوت المايك عند اختيار LOCAL ====== */
let lkRoom=null;
let localTracks=[];        // مسارات LiveKit
let localVideoTrack=null;  // LK.LocalVideoTrack
let localAudioTrack=null;  // LK.LocalAudioTrack
let localAudioEl=null;     // <audio> لمراقبة صوت المايك عند اختيار LOCAL

/* ==== NEW: حاويات لعناصر LiveKit الخاصة بالمشاركين الآخرين ==== */
const remoteAudioEls = new Map();    // participantSid -> <audio>
function remoteKey(participant){ return `lk:${participant?.sid || 'unknown'}`; }

/* أدوات ديكود JWT بسيطة (تشخيص فقط) */
function b64urlToUtf8(str){
  try{
    const pad = '='.repeat((4 - (str.length % 4)) % 4);
    const b64 = (str + pad).replace(/-/g,'+').replace(/_/g,'/');
    const binStr = atob(b64);
    const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }catch(_){ return null; }
}
function decodeJWT(t){
  try{
    const parts = String(t||'').split('.');
    if(parts.length < 2) return null;
    const payload = b64urlToUtf8(parts[1]);
    return payload ? JSON.parse(payload) : null;
  }catch(_){ return null; }
}

/* إنشاء عنصر في القائمة */
function addListItem(id,label){
  if(document.querySelector(`.stream-item[data-cam="${id}"]`)) return;
  const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam=id;
  const name=document.createElement('div'); name.className='stream-name'; name.textContent=label;
  li.appendChild(name);
  li.addEventListener('click',()=>setActiveCamSmooth(id));
  streamList.prepend(li);
}

/* إزالة عنصر من القائمة */
function removeListItem(id){
  const li=document.querySelector(`.stream-item[data-cam="${id}"]`);
  if(li && li.parentNode) li.parentNode.removeChild(li);
}

/* ==== NEW: إنشاء/إزالة بلاطة فيديو لمشارك بعيد ==== */
function addRemoteVideoTile(participant, videoTrack){
  const key = remoteKey(participant);
  let ent = playersCache.get(key);
  if(!ent){
    const wrap=document.createElement('div'); wrap.className='layer'; wrap.style.cssText='position:absolute;inset:0;opacity:0';
    const v=document.createElement('video');
    v.playsInline=true; v.autoplay=true; v.controls=false; v.muted=false;
    v.style.cssText='width:100%;height:100%;object-fit:contain';
    wrap.appendChild(v);
    mountTo(camContainer,wrap);
    ent = {wrap, video:v, ready:true, kind:'remote', identity: participant?.identity || '', sid: participant?.sid || ''};
    playersCache.set(key, ent);
  }
  try{ videoTrack.attach(ent.video); }catch(_){}
  const label = `LK:${(participant?.identity || participant?.sid || 'GUEST').toString().toUpperCase()}`;
  addListItem(key, label);
}

function removeRemoteVideoTileByParticipant(participant){
  const key = remoteKey(participant);
  const ent = playersCache.get(key);
  if(ent && ent.wrap && ent.wrap.parentNode) ent.wrap.parentNode.removeChild(ent.wrap);
  playersCache.delete(key);
  removeListItem(key);
}

/* ==== NEW: إرفاق/إزالة الصوت البعيد ==== */
function attachRemoteAudio(participant, audioTrack){
  const sid = participant?.sid; if(!sid) return;
  if(remoteAudioEls.has(sid)) return;
  const el = audioTrack.attach(); // يُنشئ <audio> ويُعيده
  el.style.display='none';
  document.body.appendChild(el);
  try{ el.play().catch(()=>{}); }catch(_){}
  remoteAudioEls.set(sid, el);
}
function detachRemoteAudio(participant){
  const sid = participant?.sid; if(!sid) return;
  const el = remoteAudioEls.get(sid);
  if(el){
    try{ el.pause(); }catch(_){}
    try{ el.remove(); }catch(_){}
  }
  remoteAudioEls.delete(sid);
}

/* إدارة LOCAL */
function ensureLocalTile(){
  if(!localVideoTrack) return;

  // عنصر الفيديو المحلي (بدون صوت — الصوت يُدار عبر localAudioEl)
  let ent = playersCache.get('local');
  if(!ent){
    const wrap=document.createElement('div'); wrap.className='layer'; wrap.style.cssText='position:absolute;inset:0;opacity:0';
    const v=document.createElement('video');
    v.playsInline=true; v.muted=true; v.autoplay=true; v.controls=false;
    v.style.cssText='width:100%;height:100%;object-fit:contain';
    wrap.appendChild(v);

    const ms = new MediaStream();
    const raw = localVideoTrack.mediaStreamTrack || localVideoTrack.track || localVideoTrack;
    if (raw) ms.addTrack(raw);
    v.srcObject = ms;

    mountTo(camContainer,wrap);
    ent = {wrap, video:v, ready:true, kind:'local'};
    playersCache.set('local', ent);
  }

  if(!document.querySelector('.stream-item[data-cam="local"]')){
    const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam='local';
    const label = (displayName.value||'LOCAL').toUpperCase();
    const name=document.createElement('div'); name.className='stream-name'; name.textContent=label;
    li.appendChild(name);
    li.addEventListener('click',()=>setActiveCamSmooth('local'));
    streamList.prepend(li);
  }
}

function removeLocalTile(){
  const li = document.querySelector('.stream-item[data-cam="local"]');
  if(li && li.parentNode) li.parentNode.removeChild(li);
  const ent = playersCache.get('local');
  if(ent && ent.wrap && ent.wrap.parentNode) ent.wrap.parentNode.removeChild(ent.wrap);
  playersCache.delete('local');
  stopLocalAudioMonitor();
}

/* إنشاء/إيقاف صوت المراقبة للمايك عند اختيار LOCAL فقط */
function startLocalAudioMonitor(){
  if(!localAudioTrack) return;
  if(localAudioEl) return;

  const rawA = localAudioTrack.mediaStreamTrack || localAudioTrack.track || localAudioTrack;
  if(!rawA) return;

  localAudioEl = document.createElement('audio');
  localAudioEl.autoplay = true;
  localAudioEl.controls = false;
  localAudioEl.muted = false;
  localAudioEl.volume = 1.0;
  localAudioEl.style.display = 'none';

  const aStream = new MediaStream();
  aStream.addTrack(rawA);
  localAudioEl.srcObject = aStream;

  document.body.appendChild(localAudioEl);
  localAudioEl.play().catch(()=>{});
}

function stopLocalAudioMonitor(){
  if(localAudioEl){
    try{ localAudioEl.pause(); }catch(_){}
    try{
      const ms = localAudioEl.srcObject;
      if(ms && ms.getTracks) ms.getTracks().forEach(t=>t.stop?.());
    }catch(_){}
    try{ localAudioEl.srcObject=null; }catch(_){}
    if(localAudioEl.parentNode) localAudioEl.parentNode.removeChild(localAudioEl);
    localAudioEl=null;
  }
}

/* تهيئة */
function initMain(){
  const {wrap,video}=createVideoElement(window.sources.main);
  mountTo(mainContainer,wrap);
  wrap.style.opacity='1';
  mainPlayer=video;
}
function getOrCreateCam(id){
  if(id==='local'){
    const ent=playersCache.get('local');
    return ent || null;
  }
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
  if(localVideoTrack){
    const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam='local';
    const label = (displayName.value||'LOCAL').toUpperCase();
    const name=document.createElement('div'); name.className='stream-name'; name.textContent=label;
    li.appendChild(name);
    li.addEventListener('click',()=>setActiveCamSmooth('local'));
    streamList.appendChild(li);
  }
  (window.channelMap||[]).filter(ch=>hasUrl(ch.src)).forEach(ch=>{
    const li=document.createElement('li'); li.className='stream-item'; li.dataset.cam=ch.id;
    li.appendChild(Object.assign(document.createElement('div'),{className:'stream-name',textContent:ch.label}));
    li.addEventListener('click',()=>setActiveCamSmooth(ch.id));
    streamList.appendChild(li);
  });

  // إعادة إدراج المشاركين البعيدين الموجودين مسبقًا (لو موجودين في الكاش)
  playersCache.forEach((ent, key)=>{
    if(key.startsWith('lk:')){
      const label = `LK:${(ent.identity || ent.sid || 'GUEST').toString().toUpperCase()}`;
      addListItem(key, label);
    }
  });

  document.addEventListener('keydown',(e)=>{
    if(e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    const items=[...document.querySelectorAll('.stream-item')];
    const n=Number(e.key); if(n>=1 && n<=items.length) items[n-1].click();
  });
}
function markActiveList(){document.querySelectorAll('.stream-item').forEach(el=>{el.classList.toggle('active',el.dataset.cam===currentCam);});}
function initOnce(){ initMain(); const first=getOrCreateCam(currentCam); if(first){first.wrap.style.opacity='1'; activePlayer=first.video;} buildStreamList(); markActiveList(); }
initOnce();

/* تبديل الكاميرا */
async function setActiveCamSmooth(id){
  if(id==='local'){
    if(!localVideoTrack) return;
    const target=playersCache.get('local'); if(!target) return;
    const v=target.video, w=target.wrap;
    try{ await v.play(); }catch(_){}
    w.className='layer fade-in'; w.style.opacity='1';
    const old = activePlayer, oldWrap = old ? old.parentElement : null;
    setTimeout(()=>{
      if(oldWrap){ oldWrap.className='layer fade-out'; oldWrap.style.opacity='0'; }
      activePlayer=v; currentCam='local'; markActiveList();
      startLocalAudioMonitor();
    }, 180);
    return;
  }

  if(id && id.startsWith('lk:')){
    stopLocalAudioMonitor(); // إن انتقلنا بعيدًا عن LOCAL
    const target = playersCache.get(id);
    if(!target) return;
    const v=target.video, w=target.wrap;
    try{ await v.play(); }catch(_){}
    w.className='layer fade-in'; w.style.opacity='1';
    const old = activePlayer, oldWrap = old ? old.parentElement : null;
    setTimeout(()=>{
      if(oldWrap){ oldWrap.className='layer fade-out'; oldWrap.style.opacity='0'; }
      activePlayer=v; currentCam=id; markActiveList();
    }, 180);
    return;
  }

  // HLS
  stopLocalAudioMonitor();
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

/* إخفاء/إظهار واجهة */
let uiTimer=null;
function showUI(){root.classList.remove('ui-hidden');root.classList.add('ui-visible');clearTimeout(uiTimer);uiTimer=setTimeout(()=>{root.classList.add('ui-hidden');root.classList.remove('ui-visible');},2500);}
['mousemove','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,showUI,{passive:true}));
[streamPanel,globalControls,document.getElementById('utilityControls'),document.getElementById('lkDock')].forEach(el=>{
  if(!el) return;
  el.addEventListener('mouseenter',()=>{clearTimeout(uiTimer);root.classList.remove('ui-hidden');root.classList.add('ui-visible');});
  el.addEventListener('mouseleave',showUI);
});
setTimeout(showUI,1000);

/* تشغيل & ساعة */
async function startPlayback(){
  if(started) return; started=true;
  gatePlay.classList.add('hidden'); globalControls.classList.remove('hidden');
  try{ await mainPlayer.play(); }catch(_){}
  const firstCam = playersCache.get(currentCam);
  try{ if(firstCam && firstCam.video) await firstCam.video.play(); }catch(_){}
  setTimeout(()=>{ const m=getSeekableRange(mainPlayer); if(m){ mainPlayer.currentTime=Math.max(m.start,m.end-0.80);} },300);
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
    if(activePlayer && bufferedAhead(activePlayer)<0.30){
      const m=getSeekableRange(activePlayer);
      if(m){
        const near=Math.max(m.start,m.end-0.80-0.25);
        activePlayer.currentTime=snapIntoBuffer(activePlayer,near);
      }
    }
  },250);
}

/* أزرار */
startBtn.addEventListener('click',startPlayback);
btnSplit.addEventListener('click',()=>{splitMode=(splitMode+1)%4;root.classList.toggle('split',splitMode!==0);root.classList.remove('mode1','mode2','mode3');if(splitMode===1)root.classList.add('mode1');if(splitMode===2)root.classList.add('mode2');if(splitMode===3)root.classList.add('mode3');});
btnFill.addEventListener('click',()=>{if(splitMode===0){isMainFull=!isMainFull;root.classList.toggle('main-full',isMainFull);root.classList.toggle('cover-one',isMainFull);}else{splitMode=(splitMode===2)?3:2;root.classList.remove('analysis')
::contentReference[oaicite:0]{index=0}
