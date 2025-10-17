/* Utils (خفيف) */
(function (g) {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, cb, opt) => el && el.addEventListener(ev, cb, opt||false);
  const once = (el, ev, cb) => on(el, ev, function h(e){ el.removeEventListener(ev, h); cb(e); });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fmtTime = (t)=>{ t=Math.max(0,Math.floor(t||0)); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); return `${m}:${s}`; };

  g.Utils = { $, $$, on, once, sleep, fmtTime };
})(window);
