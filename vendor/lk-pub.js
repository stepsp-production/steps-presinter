/* مُلحق خفيف لـ LiveKit (اختياري) */
(function (g) {
  if (!g.LKPub) {
    g.LKPub = {
      version: 'shim-1',
      ensure() {
        return !!(g.Livekit || g.LiveKit || g.livekit || g.LiveKitClient);
      }
    };
  }
})(window);
