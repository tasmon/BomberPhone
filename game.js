(function () {
  'use strict';

  // ---------- Canvas / grid setup ----------
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const W = 240, H = 320;
  const TILE = 16, COLS = 15, ROWS = 17;
  const TOP = 18;                    // status bar height
  const FIELD_H = ROWS * TILE;       // 272
  const BOTTOM = H - TOP - FIELD_H;  // 30, softkey label bar

  function tileX(c) { return c * TILE; }
  function tileY(r) { return TOP + r * TILE; }

  // ---------- Audio (tiny beeps, best-effort) ----------
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, type) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.value = 0.06;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* audio not available, ignore */ }
  }

  // ---------- Game state ----------
  let screenState = 'title'; // title, playing, paused, menu, levelclear, gameover
  let walls, blocks, powerups;
  let player, enemies, bombs, explosions;
  let score = 0, lives = 3, level = 1;
  let bombCapacity = 1, blastRadius = 1;
  let menuIndex = 0, titleIndex = 0;
  let flashTimer = 0;

  const pauseOptions = ['Resume', 'Restart Level', 'Sound: On', 'Help', 'Exit to Title'];
  const titleOptions = ['Start Game', 'Help', 'About'];

  const keys = { up: false, down: false, left: false, right: false };

  function solid(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
    if (walls[r][c]) return true;
    if (blocks[r][c]) return true;
    for (const b of bombs) {
      if (b.c === c && b.r === r && b.armed) return true;
    }
    return false;
  }

  function newPlayer() {
    return {
      x: tileX(1) + 2, y: tileY(1) + 2, w: 12, h: 12,
      dir: 'down', moving: false, alive: true, invuln: 0,
    };
  }

  function generateLevel(lv) {
    walls = []; blocks = []; powerups = [];
    for (let r = 0; r < ROWS; r++) {
      walls.push([]); blocks.push([]); powerups.push([]);
      for (let c = 0; c < COLS; c++) {
        const hard = (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) ||
          (r % 2 === 0 && c % 2 === 0);
        walls[r].push(hard);
        blocks[r].push(false);
        powerups[r].push(null);
      }
    }
    const reserved = new Set(['1,1', '2,1', '1,2']);
    const corners = [[COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 4], [4, ROWS - 2], [COLS - 4, 1]];
    const enemyCount = Math.min(2 + lv, 7);
    const spawnSpots = [];
    for (let i = 0; i < enemyCount; i++) {
      const s = corners[i % corners.length];
      spawnSpots.push(s);
      reserved.add(s[0] + ',' + s[1]);
    }
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (walls[r][c]) continue;
        if (reserved.has(c + ',' + r)) continue;
        if (Math.random() < 0.68) blocks[r][c] = true;
      }
    }
    enemies = spawnSpots.map((s, i) => ({
      x: tileX(s[0]) + 2, y: tileY(s[1]) + 2, w: 12, h: 12,
      dir: ['up', 'down', 'left', 'right'][i % 4],
      speed: 0.5 + Math.min(lv * 0.05, 0.6),
      changeT: 0, alive: true, kind: i % 3,
    }));
    bombs = [];
    explosions = [];
    player = newPlayer();
  }

  function startGame() {
    score = 0; lives = 3; level = 1; bombCapacity = 1; blastRadius = 1;
    generateLevel(level);
    screenState = 'playing';
  }

  function nextLevel() {
    level++;
    generateLevel(level);
    screenState = 'playing';
  }

  function respawnPlayer() {
    player = newPlayer();
    player.invuln = 1500;
  }

  // ---------- Movement helpers ----------
  function canMoveTo(x, y, w, h) {
    const pts = [[x + 1, y + 1], [x + w - 1, y + 1], [x + 1, y + h - 1], [x + w - 1, y + h - 1]];
    for (const [px, py] of pts) {
      const c = Math.floor(px / TILE);
      const r = Math.floor((py - TOP) / TILE);
      if (solid(c, r)) return false;
    }
    return true;
  }

  function moveEntity(e, dx, dy, spd) {
    if (dx !== 0) {
      const nx = e.x + dx * spd;
      if (canMoveTo(nx, e.y, e.w, e.h)) e.x = nx;
    }
    if (dy !== 0) {
      const ny = e.y + dy * spd;
      if (canMoveTo(e.x, ny, e.w, e.h)) e.y = ny;
    }
  }

  // Full-rectangle overlap test — used to decide when a bomb is safe to
  // arm. Using the entity's centre point alone lets the player's box end
  // up straddling the bomb's tile the instant it becomes solid, which
  // permanently traps them (their box overlaps a "solid" tile, and since
  // a blocked move never advances position, the trap can't resolve on its
  // own). Requiring zero overlap before arming avoids that entirely.
  function overlapsTile(entity, c, r) {
    const tx = tileX(c), ty = tileY(r);
    return entity.x < tx + TILE && entity.x + entity.w > tx &&
      entity.y < ty + TILE && entity.y + entity.h > ty;
  }

  // ---------- Bombs & explosions ----------
  function placeBomb() {
    if (screenState !== 'playing') return;
    const c = Math.floor((player.x + player.w / 2) / TILE);
    const r = Math.floor((player.y + player.h / 2 - TOP) / TILE);
    if (bombs.some((b) => b.c === c && b.r === r)) return;
    if (bombs.length >= bombCapacity) return;
    bombs.push({ c, r, t: 2000, armed: false });
    beep(180, 0.08, 'square');
  }

  function explodeBomb(b) {
    const cells = [{ c: b.c, r: b.r }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
      for (let i = 1; i <= blastRadius; i++) {
        const c = b.c + dc * i, r = b.r + dr * i;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) break;
        if (walls[r][c]) break;
        cells.push({ c, r });
        if (blocks[r][c]) {
          blocks[r][c] = false;
          score += 10;
          if (Math.random() < 0.28) {
            const roll = Math.random();
            powerups[r][c] = roll < 0.4 ? 'bomb' : roll < 0.8 ? 'blast' : 'life';
          }
          break;
        }
      }
    }
    explosions.push({ cells, t: 400 });
    beep(90, 0.15, 'sawtooth');
    for (const other of bombs) {
      if (other === b) continue;
      if (cells.some((cc) => cc.c === other.c && cc.r === other.r)) {
        other.t = Math.min(other.t, 1);
      }
    }
  }

  // ---------- Update ----------
  function update(dt) {
    if (screenState !== 'playing') return;

    let dx = 0, dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    const spd = 1.4;
    if (dx !== 0 || dy !== 0) {
      player.moving = true;
      if (Math.abs(dx) > Math.abs(dy)) player.dir = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) player.dir = dy > 0 ? 'down' : 'up';
      moveEntity(player, dx, 0, spd);
      moveEntity(player, 0, dy, spd);
    } else {
      player.moving = false;
    }

    if (player.invuln > 0) player.invuln -= dt;

    // powerup pickup
    {
      const c = Math.floor((player.x + player.w / 2) / TILE);
      const r = Math.floor((player.y + player.h / 2 - TOP) / TILE);
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && powerups[r][c]) {
        const p = powerups[r][c];
        if (p === 'bomb') bombCapacity++;
        else if (p === 'blast') blastRadius++;
        else if (p === 'life') lives++;
        powerups[r][c] = null;
        score += 25;
        beep(660, 0.1, 'sine');
      }
    }

    // arm bombs only once the player's box has fully left the tile
    for (const b of bombs) {
      if (!b.armed && !overlapsTile(player, b.c, b.r)) b.armed = true;
    }

    for (const b of bombs) b.t -= dt;
    const exploding = bombs.filter((b) => b.t <= 0);
    if (exploding.length) {
      bombs = bombs.filter((b) => b.t > 0);
      for (const b of exploding) explodeBomb(b);
    }

    for (const ex of explosions) ex.t -= dt;
    explosions = explosions.filter((ex) => ex.t > 0);

    const dangerTiles = new Set();
    for (const ex of explosions) for (const cc of ex.cells) dangerTiles.add(cc.c + ',' + cc.r);

    for (const en of enemies) {
      if (!en.alive) continue;
      en.changeT -= dt;
      const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      const [ddx, ddy] = dirs[en.dir];
      const before = { x: en.x, y: en.y };
      moveEntity(en, ddx, ddy, en.speed);
      const stuck = Math.abs(en.x - before.x) < 0.01 && Math.abs(en.y - before.y) < 0.01;
      if (stuck || en.changeT <= 0) {
        const opts = Object.keys(dirs);
        en.dir = opts[Math.floor(Math.random() * opts.length)];
        en.changeT = 700 + Math.random() * 900;
      }
    }

    if (player.invuln <= 0 && player.alive) {
      const pc = Math.floor((player.x + player.w / 2) / TILE);
      const pr = Math.floor((player.y + player.h / 2 - TOP) / TILE);
      let hit = dangerTiles.has(pc + ',' + pr);
      if (!hit) {
        for (const en of enemies) {
          if (!en.alive) continue;
          if (aabb(player, en)) { hit = true; break; }
        }
      }
      if (hit) hurtPlayer();
    }

    for (const en of enemies) {
      if (!en.alive) continue;
      const ec = Math.floor((en.x + en.w / 2) / TILE);
      const er = Math.floor((en.y + en.h / 2 - TOP) / TILE);
      if (dangerTiles.has(ec + ',' + er)) {
        en.alive = false;
        score += 100;
      }
    }

    if (enemies.every((e) => !e.alive)) {
      screenState = 'levelclear';
      flashTimer = 1800;
      beep(500, 0.1, 'sine'); beep(700, 0.12, 'sine');
    }
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function hurtPlayer() {
    lives--;
    beep(120, 0.3, 'sawtooth');
    if (lives <= 0) screenState = 'gameover';
    else respawnPlayer();
  }

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);

    if (screenState === 'title') { drawTitle(); return; }

    drawStatusBar();
    drawField();
    drawEntities();
    drawSoftkeyBar();

    if (screenState === 'paused') drawOverlay('PAUSED', 'Press 0 or Menu');
    if (screenState === 'menu') drawListOverlay('MENU', pauseOptions, menuIndex, '2/8 move   5 select');
    if (screenState === 'levelclear') drawOverlay('LEVEL ' + level + ' CLEAR!', 'Get ready...');
    if (screenState === 'gameover') drawGameOver();
  }

  function drawTitle() {
    ctx.fillStyle = '#243018';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 2 ? '#2c3a1e' : '#25321a';
      ctx.fillRect((i * 23) % W, (i * 37) % H, 6, 6);
    }
    ctx.fillStyle = '#f4c145';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BOMBER', W / 2, 60);
    ctx.fillText('PHONE', W / 2, 84);
    ctx.fillStyle = '#e86b3a';
    drawBombIcon(W / 2 - 8, 96, 16);

    ctx.font = '11px monospace';
    titleOptions.forEach((opt, i) => {
      const y = 150 + i * 30;
      if (i === titleIndex) {
        ctx.fillStyle = '#3a5220';
        ctx.fillRect(30, y - 14, W - 60, 22);
      }
      ctx.fillStyle = i === titleIndex ? '#ffffff' : '#cfe0b8';
      ctx.fillText(opt, W / 2, y);
    });
    ctx.fillStyle = '#8fa07a';
    ctx.font = '9px monospace';
    ctx.fillText('2/8 move   5 select', W / 2, 150 + titleOptions.length * 30 + 14);

    drawSoftkeyBarRaw('Select', '');
  }

  function drawBombIcon(x, y, s) {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2 + 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e86b3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y - 2);
    ctx.lineTo(x + s / 2 + 4, y - 6);
    ctx.stroke();
  }

  function drawStatusBar() {
    ctx.fillStyle = '#1e2b12';
    ctx.fillRect(0, 0, W, TOP);
    ctx.fillStyle = '#e8f0da';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + score, 4, 13);
    ctx.textAlign = 'center';
    ctx.fillText('Lv' + level, W / 2, 13);
    ctx.textAlign = 'right';
    let hearts = '';
    for (let i = 0; i < lives; i++) hearts += '\u2665';
    ctx.fillStyle = '#e0455a';
    ctx.fillText(hearts || '-', W - 4, 13);
  }

  function drawField() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = tileX(c), y = tileY(r);
        if (walls[r][c]) {
          ctx.fillStyle = '#5f6a52';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#4a5340';
          ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        } else {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#bcd39a' : '#b3cb8e';
          ctx.fillRect(x, y, TILE, TILE);
          if (powerups[r][c]) drawPowerup(x, y, powerups[r][c]);
          if (blocks[r][c]) {
            ctx.fillStyle = '#a06a3a';
            ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
            ctx.fillStyle = '#8a5830';
            ctx.fillRect(x + 1, y + 6, TILE - 2, 2);
            ctx.fillRect(x + 1, y + 11, TILE - 2, 2);
            ctx.strokeStyle = '#5c3a1e';
            ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          }
        }
      }
    }
  }

  function drawPowerup(x, y, kind) {
    ctx.fillStyle = kind === 'bomb' ? '#333' : kind === 'blast' ? '#e8622a' : '#e0455a';
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + TILE / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(kind === 'bomb' ? 'B' : kind === 'blast' ? 'F' : '+', x + TILE / 2, y + TILE / 2 + 3);
  }

  function drawEntities() {
    for (const b of bombs) {
      const x = tileX(b.c), y = tileY(b.r);
      const pulse = Math.sin(Date.now() / 100) * 1.5;
      ctx.fillStyle = '#20201f';
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2 + 2, 6 + pulse * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8622a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + TILE / 2, y + 3);
      ctx.lineTo(x + TILE / 2 + 4, y - 2);
      ctx.stroke();
    }
    for (const ex of explosions) {
      ctx.fillStyle = ex.t > 200 ? '#ffdd55' : '#ff8a3a';
      for (const cc of ex.cells) {
        const x = tileX(cc.c), y = tileY(cc.r);
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      }
    }
    for (const en of enemies) {
      if (!en.alive) continue;
      const palette = ['#7a4fc9', '#2a9d8f', '#d64550'];
      ctx.fillStyle = palette[en.kind % palette.length];
      ctx.beginPath();
      ctx.ellipse(en.x + en.w / 2, en.y + en.h / 2, en.w / 2, en.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      const eox = en.dir === 'left' ? -2 : en.dir === 'right' ? 2 : 0;
      const eoy = en.dir === 'up' ? -2 : en.dir === 'down' ? 2 : 0;
      ctx.beginPath(); ctx.arc(en.x + en.w / 2 - 3 + eox, en.y + en.h / 2 - 1 + eoy, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(en.x + en.w / 2 + 3 + eox, en.y + en.h / 2 - 1 + eoy, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (player.invuln <= 0 || Math.floor(Date.now() / 100) % 2 === 0) {
      ctx.fillStyle = '#2f6fd6';
      ctx.fillRect(player.x, player.y, player.w, player.h);
      ctx.fillStyle = '#f2c48a';
      ctx.fillRect(player.x + 2, player.y - 3, player.w - 4, 5);
      ctx.fillStyle = '#173a73';
      let hx = player.x + player.w / 2 - 1, hy = player.y + player.h / 2 - 1;
      if (player.dir === 'left') hx -= 3; if (player.dir === 'right') hx += 3;
      if (player.dir === 'up') hy -= 3; if (player.dir === 'down') hy += 3;
      ctx.fillRect(hx, hy, 2, 2);
    }
  }

  function drawSoftkeyBar() { drawSoftkeyBarRaw(lskLabel(), rskLabel()); }
  function lskLabel() {
    if (screenState === 'playing') return 'Menu';
    if (screenState === 'paused') return 'Resume';
    if (screenState === 'menu') return 'Select';
    if (screenState === 'levelclear') return ' ';
    if (screenState === 'gameover') return 'Retry';
    return 'Menu';
  }
  function rskLabel() { return screenState === 'menu' ? 'Close' : 'Back'; }

  function drawSoftkeyBarRaw(l, r) {
    const y = H - BOTTOM;
    ctx.fillStyle = '#16210d';
    ctx.fillRect(0, y, W, BOTTOM);
    ctx.strokeStyle = '#33421f';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = '#cfe0b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(l, 6, y + 19);
    ctx.textAlign = 'right';
    ctx.fillText(r, W - 6, y + 19);
  }

  function drawOverlay(title, sub) {
    ctx.fillStyle = 'rgba(10,15,5,0.72)';
    ctx.fillRect(0, 0, W, H - BOTTOM);
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, H / 2 - 10);
    ctx.fillStyle = '#e8f0da';
    ctx.font = '10px monospace';
    ctx.fillText(sub, W / 2, H / 2 + 10);
  }

  function drawListOverlay(title, options, index, hint) {
    ctx.fillStyle = 'rgba(10,15,5,0.82)';
    ctx.fillRect(0, 0, W, H - BOTTOM);
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 44);
    ctx.font = '11px monospace';
    options.forEach((opt, i) => {
      const y = 76 + i * 26;
      if (i === index) {
        ctx.fillStyle = '#3a5220';
        ctx.fillRect(24, y - 14, W - 48, 20);
      }
      ctx.fillStyle = i === index ? '#ffffff' : '#cfe0b8';
      ctx.fillText(opt === 'Sound: On' ? 'Sound: ' + (soundOn ? 'On' : 'Off') : opt, W / 2, y);
    });
    ctx.fillStyle = '#8fa07a';
    ctx.font = '9px monospace';
    ctx.fillText(hint, W / 2, 76 + options.length * 26 + 14);
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(30,5,5,0.8)';
    ctx.fillRect(0, 0, W, H - BOTTOM);
    ctx.fillStyle = '#ff6b5a';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
    ctx.fillStyle = '#e8f0da';
    ctx.font = '11px monospace';
    ctx.fillText('Score: ' + score, W / 2, H / 2 + 4);
    ctx.fillText('Reached Level ' + level, W / 2, H / 2 + 20);
    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#ffd479';
      ctx.font = '10px monospace';
      ctx.fillText('Press Menu to retry', W / 2, H / 2 + 42);
    }
  }

  // ---------- Input routing ----------
  function selectPauseMenu() {
    const opt = pauseOptions[menuIndex];
    beep(500, 0.06);
    if (opt === 'Resume') screenState = 'playing';
    else if (opt === 'Restart Level') { generateLevel(level); screenState = 'playing'; }
    else if (opt.startsWith('Sound')) soundOn = !soundOn;
    else if (opt === 'Help') window.location.href = 'help.html';
    else if (opt === 'Exit to Title') screenState = 'title';
  }

  function selectTitleMenu() {
    const opt = titleOptions[titleIndex];
    beep(500, 0.06);
    if (opt === 'Start Game') startGame();
    else if (opt === 'Help') window.location.href = 'help.html';
    else if (opt === 'About') window.location.href = 'about.html';
  }

  KeypadInput.init({
    onUpDown: () => {
      if (screenState === 'menu') { menuIndex = (menuIndex + pauseOptions.length - 1) % pauseOptions.length; beep(300, 0.05); }
      else if (screenState === 'title') { titleIndex = (titleIndex + titleOptions.length - 1) % titleOptions.length; beep(300, 0.05); }
      else keys.up = true;
    },
    onUpUp: () => { keys.up = false; },
    onDownDown: () => {
      if (screenState === 'menu') { menuIndex = (menuIndex + 1) % pauseOptions.length; beep(300, 0.05); }
      else if (screenState === 'title') { titleIndex = (titleIndex + 1) % titleOptions.length; beep(300, 0.05); }
      else keys.down = true;
    },
    onDownUp: () => { keys.down = false; },
    onLeftDown: () => { if (screenState === 'playing') keys.left = true; },
    onLeftUp: () => { keys.left = false; },
    onRightDown: () => { if (screenState === 'playing') keys.right = true; },
    onRightUp: () => { keys.right = false; },
    onFire: () => {
      if (screenState === 'title') selectTitleMenu();
      else if (screenState === 'playing') placeBomb();
      else if (screenState === 'menu') selectPauseMenu();
      else if (screenState === 'gameover') startGame();
    },
    onZero: () => {
      if (screenState === 'playing') { screenState = 'paused'; beep(400, 0.06); }
      else if (screenState === 'paused') screenState = 'playing';
    },
    onLSK: () => {
      if (screenState === 'title') selectTitleMenu();
      else if (screenState === 'playing') { menuIndex = 0; screenState = 'menu'; }
      else if (screenState === 'paused') screenState = 'playing';
      else if (screenState === 'menu') selectPauseMenu();
      else if (screenState === 'gameover') startGame();
    },
    onRSK: () => {
      if (screenState === 'menu') screenState = 'playing';
      else if (screenState === 'paused') screenState = 'playing';
      else if (screenState === 'playing') { menuIndex = pauseOptions.length - 1; screenState = 'menu'; }
    },
  });

  // ---------- Main loop ----------
  let lastTime = 0;
  function tick(ts) {
    if (!lastTime) lastTime = ts;
    let dt = ts - lastTime;
    lastTime = ts;
    if (dt > 50) dt = 50;

    if (screenState === 'levelclear') {
      flashTimer -= dt;
      if (flashTimer <= 0) nextLevel();
    }

    update(dt);
    draw();
    requestAnimationFrame(tick);
  }

  generateLevel(1);
  requestAnimationFrame(tick);
})();
