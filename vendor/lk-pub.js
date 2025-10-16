// /vendor/lk-pub.js
(function () {
  const TokenURL = 'https://steps-livekit-api.onrender.com/token';

  let room = null;
  let localTracks = [];

  async function requestPermissions() {
    // اطلب صلاحيات الكاميرا والميك
    await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      .then(stream => {
        // أغلق التراكات فورًا — الهدف إثبات الإذن فقط
        stream.getTracks().forEach(t => t.stop());
      });
  }

  async function ensureLocalTracks() {
    if (localTracks.length) return localTracks;
    const { createLocalTracks } = window.LivekitClient || window.livekitClient || window.LiveKitClient || {};
    const tracks = await createLocalTracks({ audio: true, video: { facingMode: 'user' } });
    localTracks = tracks;
    return tracks;
  }

  async function fetchToken(identity, roomName) {
    const url = `${TokenURL}?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      throw new Error('Token endpoint error: ' + res.status);
    }
    const json = await res.json();
    if (!json?.url || !json?.token) throw new Error('Invalid token response');
    return json;
  }

  async function publishToRoom(roomName) {
    const { Room, RoomEvent } = window.LivekitClient || window.livekitClient || window.LiveKitClient || {};
    if (!Room) throw new Error('LiveKit client not loaded yet');

    const identity = 'web-' + Math.random().toString(36).slice(2, 8);
    const { url, token } = await fetchToken(identity, roomName);

    // أوقف أي جلسة سابقة
    if (room) {
      try { await room.disconnect(); } catch (e) {}
      room = null;
    }

    // أنشئ غرفة واتصل
    room = new Room();
    await room.connect(url, token);

    // أنشئ التراكات المحلية وانشرها
    const tracks = await ensureLocalTracks();
    for (const t of tracks) {
      await room.localParticipant.publishTrack(t);
    }

    // مراقبة الأحداث
    room.on(RoomEvent.Disconnected, () => {
      console.log('[LK] Disconnected');
    });
  }

  async function stopPublishing() {
    if (!room) return;
    try {
      // إلغاء نشر التراكات
      room.localParticipant.tracks.forEach(pub => {
        try { pub.track?.stop(); } catch (e) {}
        try { pub.unpublish(); } catch (e) {}
      });
      await room.disconnect();
    } finally {
      room = null;
      localTracks.forEach(t => { try { t.stop(); } catch (e) {} });
      localTracks = [];
    }
  }

  window.LK = {
    requestPermissions,
    publishToRoom,
    stopPublishing,
  };
})();
