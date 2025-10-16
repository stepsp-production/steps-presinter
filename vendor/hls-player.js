// /vendor/hls-player.js
(function () {
  function attachHlsTo(videoEl, src) {
    if (!window.Hls || !window.Hls.isSupported()) {
      // Safari والأنظمة التي تدعم HLS أصلاً
      videoEl.src = src;
      videoEl.play().catch(() => {});
      return () => {};
    }

    let hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true,
      manifestLoadingTimeOut: 15000,
      fragLoadingTimeOut: 20000,
      fragLoadingRetryDelay: 1000,
      levelLoadingRetryDelay: 1000,
    });

    function onError(_, data) {
      console.log('[HLS] ERROR', data);
      if (data?.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch (e) {}
        if (data?.details === window.Hls.ErrorDetails.FRAG_PARSING_ERROR) {
          // إعادة التهيئة بدون Workers كحل أخير
          try {
            hls.destroy();
            hls = new window.Hls({ enableWorker: false, lowLatencyMode: true });
            hls.on(window.Hls.Events.ERROR, onError);
            hls.attachMedia(videoEl);
            hls.loadSource(src);
          } catch (e) {}
        }
      }
    }

    hls.on(window.Hls.Events.ERROR, onError);

    hls.attachMedia(videoEl);
    hls.loadSource(src);
    videoEl.play().catch(() => {});

    return () => { try { hls.destroy(); } catch (e) {} };
  }

  window.attachHlsTo = attachHlsTo;
})();
