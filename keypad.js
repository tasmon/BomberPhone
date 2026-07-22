/*
 * KeypadInput — shared Cloud Phone input wiring.
 * Wires the on-screen T9 keypad (#keypad .key), the LSK/RSK softkey
 * buttons (#lskBtn / #rskBtn), and the physical keyboard, then routes
 * everything through a small set of named callbacks so each page only
 * has to say what SHOULD happen, not how the input got there.
 *
 * Usage:
 *   KeypadInput.init({
 *     onUpDown, onUpUp, onDownDown, onDownUp,
 *     onLeftDown, onLeftUp, onRightDown, onRightUp,
 *     onFire,   // key 5 — fires once per press (auto-repeat safe)
 *     onZero,   // key 0 — fires once per press
 *     onLSK, onRSK
 *   });
 */
const KeypadInput = (function () {
  let handlers = {};
  let fireHeld = false;
  let zeroHeld = false;

  function call(name, ...args) {
    if (handlers[name]) handlers[name](...args);
  }

  function keyDown(k) {
    switch (k) {
      case '2': call('onUpDown'); break;
      case '8': call('onDownDown'); break;
      case '4': call('onLeftDown'); break;
      case '6': call('onRightDown'); break;
      case '5': if (!fireHeld) { fireHeld = true; call('onFire'); } break;
      case '0': if (!zeroHeld) { zeroHeld = true; call('onZero'); } break;
    }
  }

  function keyUp(k) {
    switch (k) {
      case '2': call('onUpUp'); break;
      case '8': call('onDownUp'); break;
      case '4': call('onLeftUp'); break;
      case '6': call('onRightUp'); break;
      case '5': fireHeld = false; break;
      case '0': zeroHeld = false; break;
    }
  }

  function wireDom() {
    const lsk = document.getElementById('lskBtn');
    const rsk = document.getElementById('rskBtn');
    if (lsk) lsk.addEventListener('click', () => call('onLSK'));
    if (rsk) rsk.addEventListener('click', () => call('onRSK'));

    document.querySelectorAll('.key').forEach((btn) => {
      const k = btn.dataset.k;
      const down = (e) => { e.preventDefault(); btn.classList.add('active'); keyDown(k); };
      const up = (e) => { e.preventDefault(); btn.classList.remove('active'); keyUp(k); };
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
    });
  }

  const KEYMAP = {
    ArrowUp: '2', 2: '2',
    ArrowDown: '8', 8: '8',
    ArrowLeft: '4', 4: '4',
    ArrowRight: '6', 6: '6',
    ' ': '5', Enter: '5', 5: '5',
    0: '0',
  };

  function wireKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (KEYMAP[e.key] !== undefined) {
        e.preventDefault();
        keyDown(KEYMAP[e.key]);
      } else if (e.key === 'SoftLeft' || e.key === 'F1') {
        e.preventDefault(); call('onLSK');
      } else if (e.key === 'SoftRight' || e.key === 'Escape' || e.key === 'F2') {
        e.preventDefault(); call('onRSK');
      }
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.key] !== undefined) {
        e.preventDefault();
        keyUp(KEYMAP[e.key]);
      }
    });
  }

  return {
    init(h) {
      handlers = h || {};
      wireDom();
      wireKeyboard();
    },
  };
})();
