// app.js — مقتطف تشغيل HLS
import Hls from './vendor/hls.min.js';

export function attachHls(videoEl, src) {
  if (!Hls.isSupported()) {
    videoEl.src = src; // Safari
    videoEl.play().catch(() => {});
    return;
  }

  const hls = new Hls({
    // الأفضل تركه مفعّل بعد إصلاح الـCSP
    enableWorker: true,
    lowLatencyMode: true,
    // مهلات معتدلة
    manifestLoadingTimeOut: 15000,
    fragLoadingTimeOut: 20000,
    // تقليل إعادة المحاولة العنيف
    fragLoadingRetryDelay: 1000,
    levelLoadingRetryDelay: 1000,
  });

  hls.on(Hls.Events.ERROR, (_, data) => {
    console.log('[HLS] ERROR', data);

    // إن وصل FragParsingError (0x47) جرّب تعافٍ سريع
    if (data?.type === Hls.ErrorTypes.MEDIA_ERROR) {
      try { hls.recoverMediaError(); } catch {}
    }

    // كحل أخير: أعد تهيئة بدون workers
    if (data?.type === Hls.ErrorTypes.MEDIA_ERROR && data?.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
      try {
        hls.destroy();
        const hls2 = new Hls({ enableWorker: false, lowLatencyMode: true });
        hls2.attachMedia(videoEl);
        hls2.loadSource(src);
      } catch {}
    }
  });

  hls.attachMedia(videoEl);
  hls.loadSource(src);
  videoEl.play().catch(() => {});
}
