# Steps Presinter (Pages)

## بنية الملفات
- `index.html` واجهة المشغل (أنت تملكها مسبقًا).
- `functions/vendor/[[name]].js` يخدم الملفات:  
  - `/vendor/hls.min.js`  
  - `/vendor/livekit-client.umd.min.js`  
  - `/vendor/ping.js`
- `functions/hls/[[path]].js` بروكسي HLS يعيد كتابة المسارات.
- `_headers` سياسة الأمان والـCSP.

## متغيرات البيئة (Pages → Settings → Environment Variables)
- `ORIGIN_BASE` = عنوان المصدر (Tunnel/Origin) مثل:  
  `https://fan-receiving-infinite-thus.trycloudflare.com`
- `UPSTREAM_PREFIX` = مسار المصدر، غالبًا `/hls` أو `/` حسب مزودك.

> جرّب:  
> - `https://<site>.pages.dev/vendor/ping.js` → يجب أن يظهر console.log  
> - `https://<site>.pages.dev/vendor/hls.min.js` → يجب أن يعود JavaScript  
> - `https://<site>.pages.dev/hls/live/playlist.m3u8` → يجب أن يبدأ بـ `#EXTM3U`

## ملاحظات
- إن رأيت `NOT_M3U8_TEXT` من مسار `/hls/...` فهذا يعني أن ORIGIN يعيد HTML بدل manifest. صحّح `ORIGIN_BASE` و `UPSTREAM_PREFIX`.
- لا حاجة لإضافة CDNs في CSP لأن كل السكربتات من نفس النطاق عبر `/vendor`.
