// lk-pub.js
// منطق الاقتران + الانضمام + النشر باستخدام LiveKit UMD (window.livekitClient)

(function(){
  const { Room, createLocalTracks, RoomEvent, setLogLevel, LogLevel } = window.livekitClient || {};
  setLogLevel?.(LogLevel?.warn ?? 'warn');

  function errUser(message){ const e = new Error(message); e.userMessage = message; return e; }

  async function fetchToken(tokenApi, room, identity){
    const u = new URL(tokenApi);
    u.searchParams.set('room', room);
    u.searchParams.set('identity', identity);
    const res = await fetch(u.toString(), { cache: 'no-store' });
    if (!res.ok) throw errUser('فشل طلب التوكن من الخادم ('+res.status+')');
    return res.json(); // { url, token }
  }

  function LiveKitPublisher({ statusEl, Livekit, tokenApi }){
    this.statusEl = statusEl;
    this.Livekit = Livekit;
    this.tokenApi = tokenApi;
    this.room = null;
    this.localTracks = [];
    this.devicesPaired = false;
    this._set('LiveKit: غير متصل');
  }

  LiveKitPublisher.prototype._set = function(txt){ if (this.statusEl) this.statusEl.textContent = txt; };

  LiveKitPublisher.prototype.pairDevices = async function(){
    // طلب الصلاحية وإنشاء مسارات محلية لكن لا ننشرها بعد
    try {
      this.localTracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: 'user', resolution: { width: 1280, height: 720 } }
      });
      this.devicesPaired = true;
      this._set('LiveKit: الأجهزة مُقترنة');
    } catch (e) {
      throw errUser('تعذّر الوصول إلى الكاميرا/المايك. يرجى منح الإذن ثم إعادة المحاولة.');
    }
  };

  LiveKitPublisher.prototype.joinAndPublish = async function({ room, identity }){
    if (!this.devicesPaired) throw errUser('يجب الاقتران أولاً قبل النشر.');
    if (!room) throw errUser('لم يتم اختيار الغرفة.');
    if (!identity) throw errUser('مطلوب اسم الهوية.');

    // اجلب التوكن وعنوان السيرفر
    const { url, token } = await fetchToken(this.tokenApi, room, identity);
    if (!url || !token) throw errUser('الاستجابة لا تحتوي url/token.');

    // أنشئ الغرفة وانضم
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: true,
      publishDefaults: { simulcast: true, videoCodec: 'vp9' }
    });

    this.room.on(RoomEvent.Disconnected, ()=> this._set('LiveKit: غير متصل'));
    this.room.on(RoomEvent.Connected,   ()=> this._set('LiveKit: متصل'));
    await this.room.connect(url, token);

    // انشر المسارات
    for (const t of this.localTracks) {
      await this.room.localParticipant.publishTrack(t);
    }
    this._set('LiveKit: تم النشر');
  };

  LiveKitPublisher.prototype.stop = async function(){
    try {
      if (this.room) {
        await this.room.disconnect();
      }
    } finally {
      this.room = null;
      for (const t of this.localTracks) { try { t.stop(); } catch{} }
      this.localTracks = [];
      this.devicesPaired = false;
      this._set('LiveKit: غير متصل');
    }
  };

  window.LiveKitPublisher = LiveKitPublisher;
})();
