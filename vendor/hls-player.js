// /vendor/hls-player.js
(function () {
  window.HlsPlayer = {
    attach(videoEl, src) {
      if (!window.Hls || !window.Hls.isSupported()) {
        videoEl.src = src;
        videoEl.play?.().catch(()=>{});
        return () => {};
      }
      let hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
      function onErr(_, data){
        console.log('[HLS] ERROR', data);
        if (data?.type === window.Hls.ErrorTypes.MEDIA_ERROR &&
            data?.details === window.Hls.ErrorDetails.FRAG_PARSING_ERROR) {
          try {
            hls.destroy();
            hls = new window.Hls({ enableWorker: false, lowLatencyMode: true });
            hls.on(window.Hls.Events.ERROR, onErr);
            hls.attachMedia(videoEl);
            hls.loadSource(src);
          } catch(e){}
        }
      }
      hls.on(window.Hls.Events.ERROR, onErr);
      hls.attachMedia(videoEl);
      hls.loadSource(src);
      videoEl.play?.().catch(()=>{});
      return () => { try { hls.destroy(); } catch(e){} };
    }
  };
})();
