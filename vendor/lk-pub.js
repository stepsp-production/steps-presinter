// /vendor/lk-pub.js
(function () {
  const TokenURL = 'https://steps-livekit-api.onrender.com/token';

  let room = null;
  let localTracks = [];

  async function pairDevices() {
    const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    stream.getTracks().forEach(t => t.stop()); // إثبات الإذن فقط
  }

  async function ensureTracks() {
    const { createLocalTracks } = (window.LivekitClient || {});
    if (!createLocalTracks) throw new Error('LiveKit not ready');
    if (localTracks.length) return localTracks;
    localTracks = await createLocalTracks({ audio:true, video:{ facingMode:'user' } });
    return localTracks;
  }

  async function fetchToken(identity, roomName) {
    const u = `${TokenURL}?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error('Token endpoint error: '+r.status);
    const j = await r.json();
    if (!j?.url || !j?.token) throw new Error('Invalid token response');
    return j;
  }

  async function publish(roomName) {
    const { Room, RoomEvent } = (window.LivekitClient || {});
    if (!Room) throw new Error('LiveKit not ready');
    const identity = 'web-' + Math.random().toString(36).slice(2,8);
    const { url, token } = await fetchToken(identity, roomName);

    if (room) { try { await room.disconnect(); } catch(e){} room = null; }
    room = new Room();
    await room.connect(url, token);

    const tracks = await ensureTracks();
    for (const t of tracks) await room.localParticipant.publishTrack(t);

    room.on(RoomEvent.Disconnected, ()=> console.log('[LK] disconnected'));
  }

  async function stopPublish() {
    if (!room) return;
    try {
      room.localParticipant.tracks.forEach(pub => {
        try { pub.track?.stop(); } catch(e){}
        try { pub.unpublish(); } catch(e){}
      });
      await room.disconnect();
    } finally {
      room = null;
      localTracks.forEach(t => { try { t.stop(); } catch(e){} });
      localTracks = [];
    }
  }

  // حافظ على نفس الأسماء التي تستدعيها واجهتك
  window.pairDevices = pairDevices;
  window.publish = publish;
  window.stopPublish = stopPublish;
})();
