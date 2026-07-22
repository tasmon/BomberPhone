(function () {
  'use strict';
  const content = document.getElementById('content');

  function scrollBy(dy) { content.scrollTop += dy; }
  function goBack() { window.location.href = 'index.html'; }

  KeypadInput.init({
    onUpDown: () => scrollBy(-28),
    onDownDown: () => scrollBy(28),
    onLSK: goBack,
    onRSK: goBack,
  });
})();
