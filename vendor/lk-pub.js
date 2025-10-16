(function(g){
  'use strict';
  function need(){ const LK=g.Livekit; if(!LK) throw new Error('LiveKit UMD not loaded'); return LK; }

  async function createLocalTracks(){ return need().createLocalTracks({audio:true, video:true}); }

  async function connectAndPublish({room, identity, tokenEndpoint, tracks}){
    const res = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}`);
    if(!res.ok) throw new Error('token fetch failed');
    const {url, token} = await res.json();
    const LK = need();
    const roomObj = new LK.Room({adaptiveStream:true, dynacast:true});
    await roomObj.connect(url, token);
    for(const t of (tracks||[])){ try{ await roomObj.localParticipant.publishTrack(t); }catch(_){ } }
    return roomObj;
  }
  g.LKPub = { createLocalTracks, connectAndPublish };
})(window);
