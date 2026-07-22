/*
 * fit.js — scales the fixed 240x320 #screenWrap to fill the current
 * viewport (letterboxed, aspect ratio preserved) so the game/pages
 * always render full-screen on the device instead of a small fixed box.
 */
(function () {
  function fit() {
    const wrap = document.getElementById('screenWrap');
    if (!wrap) return;
    const scale = Math.min(window.innerWidth / 240, window.innerHeight / 320);
    wrap.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  document.addEventListener('DOMContentLoaded', fit);
  fit();
})();
