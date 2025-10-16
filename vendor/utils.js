// /vendor/utils.js
(function () {
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.$utils = { qs, qsa, wait };
})();
