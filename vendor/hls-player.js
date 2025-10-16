(function(global){
  'use strict';
  function attach(video, url, cfg){
    if(!global.Hls || !global.Hls.isSupported()){
      // iOS Safari أو تشغيل مباشر
      if(video && url) video.src = url;
      return null;
    }
    const hls = new global.Hls(cfg||{});
    hls.attachMedia(video);
    hls.on(global.Hls.Events.MEDIA_ATTACHED, ()=> hls.loadSource(url));
    return hls;
  }
  global.HlsPlayer = { attach };
})(window);
