// hls-player.js
// غلاف صغير يربط hls.js مع <video> ويعرض حالة مختصرة
(function(){
  function HlsPlayer(videoEl, stateEl){
    this.video = videoEl;
    this.stateEl = stateEl;
    this.hls = null;
  }
  HlsPlayer.prototype._set = function (txt){ if (this.stateEl) this.stateEl.textContent = 'HLS: ' + txt; };
  HlsPlayer.prototype.attach = function (manifestUrl){
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
      // Safari / iOS
      v.src = manifestUrl;
      v.addEventListener('loadedmetadata', ()=> self._set('ready'));
    } else {
      self._set('unsupported');
    }
  };

  window.HlsPlayer = HlsPlayer;
})();
