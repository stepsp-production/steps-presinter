// /vendor/utils.js

  (function(g){
  'use strict';
  function qs(s,root){return (root||document).querySelector(s);}
  function qsa(s,root){return Array.from((root||document).querySelectorAll(s));}
  function on(el,ev,fn,opt){el && el.addEventListener(ev,fn,opt||false); return ()=>el&&el.removeEventListener(ev,fn,opt||false);}
  function fmtTime(t){t=Math.max(0,Math.floor(t||0));const m=String(Math.floor(t/60)).padStart(2,'0');const s=String(t%60).padStart(2,'0');return `${m}:${s}`;}
  g.Utils = {qs,qsa,on,fmtTime};
})(window);
