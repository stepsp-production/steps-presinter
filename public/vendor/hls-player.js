/* مُغلِّف صغير لـ hls.min.js */
(function (g) {
  g.createHls = function (video, url, cfg) {
    if (g.Hls && g.Hls.isSupported()) {
      const h = new g.Hls(cfg || {});
      h.attachMedia(video);
      h.on(g.Hls.Events.MEDIA_ATTACHED, () => h.loadSource(url));
      return h;
    }
    // أجهزة Apple
    if (video && video.canPlayType && video.canPlayType('application/vnd.apple.mpegURL')) {
      video.src = url;
      return null;
    }
    console.warn('Hls.js غير متوفر أو غير مدعوم على هذا المتصفح.');
    return null;
  };
})(window);
