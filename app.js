/* Candoku app: level map, play logic, hearts, hints, sound hooks, transitions. */
(function () {
  const E = window.CandokuEngine, H = window.CandokuHints, S = window.CandokuSound;
  const SEEDS = window.CandokuSeeds || { hard: {}, veryhard: {} };
  // vivid tiles, one per color region
  const COLORS = ['#22b8ff', '#7ee21f', '#ffd400', '#ff52c8', '#a45cff', '#00dcb0', '#ff8a00', '#ff3d3d', '#3a5cff', '#c98240'];
  const NAMES = ['Lollipop', 'Wrapped Candy', 'Chocolate Bar', 'Glazed Donut', 'Cupcake', 'Choc Chip Cookie', 'Cherries', 'Soft Serve', 'Shortcake', 'Candy Dango'];
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.8 5.8 21l1.4-7L2 9.3l7-.8z"/></svg>';
  const MAX_HEARTS = 3;
  const $ = (id) => document.getElementById(id);
  const M = window.CandokuMusic, V = window.CandokuVoice;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('candoku.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('candoku.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  let level = store.get('level', 1);
  let stars = store.get('stars', {});
  let daily = store.get('daily', { last: '', streak: 0 });
  let cur = null;
  let score = store.get('score', { date: '', points: 0, run: 0, best: 0 });
  const START_HINTS = 3, HINT_EVERY = 5;
  let hintsLeft = store.get('hints', START_HINTS), cleared = store.get('cleared', 0);   // hints in the bag, levels passed for the first time
  const RANKS = [[0, 'Rookie'], [200, 'Candy Fan'], [500, 'Sweet Tooth'], [1000, 'Sugar Pro'], [2000, 'Candy Master'], [4000, 'Candy Legend']];
  function freshScore() {
    const t = today();
    if (score.date !== t) { score = { date: t, points: 0, run: 0, best: score.best || 0 }; store.set('score', score); }   // every day starts at 0
  }
  // Each board solved in a row multiplies the reward: x1, x2, x3 ... up to x10.
  // Reward = 10 points x multiplier, capped by board size (10x10 = 100, 9x9 = 90, 8x8 = 80 ...).
  function pointsFor(n, run) {
    const mult = Math.min(10, Math.max(1, run));
    return { mult, cap: n * 10, gain: Math.min(n * 10, 10 * mult) };
  }
  function renderScore() {
    freshScore();
    let i = 0; for (let k = 0; k < RANKS.length; k++) if (score.points >= RANKS[k][0]) i = k;
    const next = RANKS[i + 1];
    $('rankName').textContent = RANKS[i][1];
    $('ptsToday').textContent = score.points;
    $('rankBar').style.width = (next ? Math.min(100, ((score.points - RANKS[i][0]) / (next[0] - RANKS[i][0])) * 100) : 100) + '%';
    $('scoreSub').textContent = (next ? (next[0] - score.points) + ' pts to ' + next[1] : 'Top rank reached!') + (score.run ? ' · next board ×' + Math.min(10, score.run + 1) : '') + (score.best ? ' · best day ' + score.best : '');
  }

  const sizeFor = (lv) => Math.min(10, 5 + Math.floor((lv - 1) / 4));
  const tierOf = (lv) => (lv % 10 === 0 ? 'veryhard' : lv % 5 === 0 ? 'hard' : 'normal');
  const dailySize = () => [6, 7, 8, 9, 10, 8, 7][new Date().getDay()];
  const tierLabel = { hard: 'Hard', veryhard: 'Very Hard' };

  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function show(id) { ['home', 'game'].forEach((s) => { $(s).hidden = s !== id; }); document.body.classList.toggle('in-game', id === 'game'); if (M) M.mood(id === 'game' ? 'game' : 'menu'); window.scrollTo(0, 0); }

  /* ---------- screen transition: a rainbow wipe with a spinning candy ---------- */
  function transition(mid) {
    return new Promise((resolve) => {
      const w = $('wipe'); w.hidden = false; S.whoosh();
      const a = w.animate([{ clipPath: 'circle(0% at 50% 60%)' }, { clipPath: 'circle(150% at 50% 60%)' }], { duration: 420, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = async () => {
        await sleep(30);
        try { await mid(); } catch (e) { console.error(e); }
        await sleep(160);
        const b = w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' });
        b.onfinish = () => { w.getAnimations().forEach((x) => x.cancel()); w.hidden = true; resolve(); };
      };
    });
  }

  /* ---------- sound button state ---------- */
  function syncSound() {
    document.querySelectorAll('.sndBtn use').forEach((u) => u.setAttribute('href', S.isOn() ? '#snd-on' : '#snd-off'));
  }

  /* ---------- level map ---------- */
  const MAP_STEP = 96;
  function mapGeom() {
    const W = Math.min(window.innerWidth, 460) - 32;
    const count = Math.min(150, Math.max(level + 7, 14));
    const Ht = count * MAP_STEP + 70;
    return { W, count, Ht, pos: (lv) => ({ x: W / 2 + Math.sin((lv - 1) * 0.9) * W * 0.3, y: Ht - 56 - (lv - 1) * MAP_STEP }) };
  }
  /* ---------- illustrated worlds: a new landscape every 10 levels ---------- */
  const ZONES = [
    { name: 'Lollipop Meadow', top: '#8fe3ff', bottom: '#b9f59b', decor: ['d-lolly', 'd-bush', 'd-cane', 'd-cloud', 'd-bush'] },
    { name: 'Chocolate River', top: '#ffe1c2', bottom: '#d4915c', decor: ['d-choco', 'd-house', 'd-bush', 'd-cane', 'd-house'] },
    { name: 'Frosting Mountains', top: '#ffe9f6', bottom: '#ffa8d6', decor: ['d-cone', 'd-cloud', 'd-cone', 'd-lolly', 'd-cane'] },
    { name: 'Cotton Candy Sky', top: '#a99bff', bottom: '#ff94d6', decor: ['d-cloud', 'd-star', 'd-cloud', 'd-lolly', 'd-star'] }
  ];
  const ASPECT = { 'd-lolly': [0.6, 1], 'd-bush': [1, 0.6], 'd-cane': [0.5, 1], 'd-cloud': [2, 1], 'd-house': [1, 1], 'd-cone': [0.85, 1.15], 'd-choco': [0.8, 1], 'd-star': [1, 1] };
  const zoneOf = (lv) => ZONES[Math.floor((lv - 1) / 10) % ZONES.length];
  const hashn = (n) => Math.imul(n + 17, 2654435761) >>> 0;
  function worldHtml(g) {
    let html = '';
    const zones = Math.ceil(g.count / 10);
    for (let k = 0; k < zones; k++) {
      const z = ZONES[k % ZONES.length];
      const top = k === zones - 1 ? 0 : g.pos(k * 10 + 10).y - MAP_STEP / 2;
      const bottom = k === 0 ? g.Ht : g.pos(k * 10 + 1).y + MAP_STEP / 2;
      html += '<div class="zone" style="top:' + top + 'px;height:' + (bottom - top) + 'px;background:linear-gradient(180deg,' + z.top + ',' + z.bottom + ')"></div>';
    }
    for (let lv = 1; lv <= g.count; lv++) {
      const p = g.pos(lv), z = zoneOf(lv), onLeft = p.x < g.W / 2;
      for (let j = 0; j < 2; j++) {
        const h = hashn(lv * 7 + j * 131), type = z.decor[h % z.decor.length], asp = ASPECT[type];
        const size = 44 + ((h >> 4) % 46), w = Math.round(size * asp[0] * (type === 'd-cloud' ? 1.15 : 1.3)), hh = Math.round(size * asp[1] * 1.3);
        const edge = ((h >> 9) % 100) / 100;
        const cx = onLeft ? g.W * (0.78 + 0.16 * edge) : g.W * (0.22 - 0.16 * edge);
        const y = p.y + (j ? -MAP_STEP * 0.45 : 14) + ((h >> 13) % 24) - 12;
        const cloud = type === 'd-cloud', star = type === 'd-star';
        html += '<svg class="decor' + (cloud ? ' cloud' : star ? ' star' : '') + '" style="left:' + Math.round(cx - w / 2) + 'px;top:' + Math.round(y - hh) + 'px;width:' + w + 'px;height:' + hh + 'px;--sw:' + (3 + (h % 30) / 10).toFixed(1) + 's;--dl:-' + ((h >> 5) % 40) / 10 + 's"><use href="#' + type + '" width="100%" height="100%"/></svg>';
      }
    }
    for (let k = 0; k < zones; k++) {
      const z = ZONES[k % ZONES.length], lvTop = Math.min(g.count, k * 10 + 10);
      html += '<div class="ribbon" style="top:' + Math.max(30, Math.round(g.pos(lvTop).y - 84)) + 'px">World ' + (k + 1) + ' · ' + z.name + '</div>';
    }
    return html;
  }

  function renderHome() {
    const t = today();
    $('dailyInfo').textContent = daily.last === t ? 'Solved today ✓ come back tomorrow' : dailySize() + '×' + dailySize() + ' · new board today';
    renderScore();
    $('streak').textContent = daily.streak > 1 ? '🔥 ' + daily.streak + ' day streak' : '';
    const map = $('map'), g = mapGeom();
    map.innerHTML = ''; map.style.height = g.Ht + 'px';
    map.insertAdjacentHTML('beforeend', worldHtml(g));
    // winding trail
    let d = '';
    const pts = [];
    for (let lv = 1; lv <= g.count; lv++) pts.push(g.pos(lv));
    pts.forEach((p, i) => {
      if (i === 0) d += 'M' + p.x + ' ' + p.y;
      else { const q = pts[i - 1], my = (q.y + p.y) / 2; d += ' C' + q.x + ' ' + my + ' ' + p.x + ' ' + my + ' ' + p.x + ' ' + p.y; }
    });
    map.insertAdjacentHTML('beforeend', '<svg class="trail" viewBox="0 0 ' + g.W + ' ' + g.Ht + '"><path d="' + d + '" fill="none" stroke="rgba(40,0,90,.35)" stroke-width="22" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 14" opacity=".9"/></svg>');
    for (let lv = 1; lv <= g.count; lv++) {
      const p = g.pos(lv), tier = tierOf(lv), n = sizeFor(lv);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'node ' + (tier === 'normal' ? '' : tier) + (lv > level ? ' locked' : '') + (lv === level ? ' current' : '');
      b.dataset.lv = lv;
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      if (tier === 'normal') b.style.setProperty('--c', COLORS[(n - 5) % COLORS.length]);
      let html = lv + '<small>' + n + '×' + n + '</small>';
      if (tier !== 'normal') html += '<span class="badge">' + (tier === 'hard' ? 'HARD' : 'VERY HARD') + '</span>';
      if (lv < level && stars[lv]) { html += '<span class="st">'; for (let i = 1; i <= 3; i++) html += STAR.replace('<svg', '<svg class="' + (i <= stars[lv] ? '' : 'off') + '"'); html += '</span>'; }
      b.innerHTML = html;
      b.onclick = () => { S.unlock(); S.tap(); transition(() => startLevel(lv)); };
      map.appendChild(b);
      if (lv === level) map.insertAdjacentHTML('beforeend', '<div class="mascot" style="left:' + p.x + 'px;top:' + (p.y - 30) + 'px"><svg><use href="#gumi"/></svg></div>');
    }
  }
  function scrollToLevel(lv) {
    const g = mapGeom(), map = $('map');
    const y = map.getBoundingClientRect().top + window.scrollY + g.pos(lv).y;
    window.scrollTo(0, Math.max(0, y - window.innerHeight * 0.55));
  }
  async function hopTo(from, to) {
    const g = mapGeom(), a = g.pos(from), b = g.pos(to), map = $('map');
    const h = document.createElement('div'); h.className = 'hopper';
    h.style.left = a.x + 'px'; h.style.top = a.y + 'px'; h.innerHTML = '<svg><use href="#c' + ((from - 1) % 10) + '"/></svg>';
    map.appendChild(h);
    const dx = b.x - a.x, dy = b.y - a.y;
    S.hop();
    const anim = h.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 70) + 'px) scale(1.25) rotate(180deg)', offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1) rotate(360deg)' }
    ], { duration: 800, easing: 'ease-in-out', fill: 'forwards' });
    await anim.finished.catch(() => {});
    S.candy((to - 1) % 10, 3);
    const node = map.querySelector('.node[data-lv="' + to + '"]');
    if (node) node.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 400 });
    await sleep(300);
    h.remove();
  }

  /* ---------- boards ---------- */
  function boardFor(lv) {
    const n = sizeFor(lv), tier = tierOf(lv);
    if (tier !== 'normal') {
      const pool = (SEEDS[tier] || {})[n];
      if (pool && pool.length) return E.generate(n, pool[Math.floor(lv / (tier === 'hard' ? 5 : 10)) % pool.length]);
    }
    // normal levels: skip boards that would need guessing
    let b = null;
    for (let k = 0; k < 6; k++) {
      b = E.generate(n, n * 100000 + lv * 7919 + k * 13);
      if (H.rate(n, b.regions, b.solution).max <= 2) break;
    }
    return b;
  }

  /* ---------- game ---------- */
  function makeGame(board, label, meta, tier) {
    const n = board.n;
    cur = { n, regions: board.regions, solution: board.solution, state: [], history: [], hearts: MAX_HEARTS, done: false, hints: 0, label, meta, tier, maybeMode: false, foundPrev: new Set(), wrongMarks: new Set(), penalized: new Set() };
    updateHintUi();
    for (let y = 0; y < n; y++) cur.state.push(new Array(n).fill(0)); // 0 empty, 1 X, 2 candy, 3 ?
    $('gTitle').textContent = label;
    const t = $('tier');
    t.hidden = tier === 'normal'; t.className = 'tier ' + tier; t.textContent = tierLabel[tier] || '';
    const bd = $('board'); bd.className = 'board ' + (tier === 'normal' ? '' : tier);
    bd.style.setProperty('--n', n);
    $('maybeBtn').setAttribute('aria-pressed', 'false');
    $('lose').hidden = true; $('win').hidden = true; $('toast').classList.remove('show');
    buildBoard(); drawHearts(); drawFound();
  }
  function startLevel(lv) {
    const b = boardFor(lv);
    makeGame(b, 'Level ' + lv, { kind: 'level', level: lv }, tierOf(lv));
    show('game');
    if (V) setTimeout(() => V.start(lv, tierOf(lv)), 700);
    if (lv > 1 && sizeFor(lv) > sizeFor(lv - 1)) {
      const id = sizeFor(lv) - 1;
      $('unlockIcon').innerHTML = '<use href="#c' + id + '"/>'; $('unlockName').textContent = NAMES[id];
      const u = $('unlock'); u.hidden = true; void u.offsetWidth; u.hidden = false;
      setTimeout(() => { u.hidden = true; }, 3300);
    }
  }
  function startDaily() {
    const t = today(), n = dailySize();
    makeGame(E.generate(n, hash('candoku-' + t)), 'Daily Candy', { kind: 'daily', date: t }, 'normal');
    show('game');
  }
  function drawHearts() {
    const h = $('hearts'); h.innerHTML = '';
    for (let i = 0; i < MAX_HEARTS; i++) h.insertAdjacentHTML('beforeend', '<svg class="' + (i < cur.hearts ? '' : 'off') + '"><use href="#heart"/></svg>');
  }
  function drawFound() {
    const f = $('found'), have = new Set();
    for (let y = 0; y < cur.n; y++) for (let x = 0; x < cur.n; x++) if (cur.state[y][x] === 2) have.add(cur.regions[y][x]);
    f.innerHTML = '';
    for (let g = 0; g < cur.n; g++) {
      const on = have.has(g), isNew = on && !cur.foundPrev.has(g);
      f.insertAdjacentHTML('beforeend', '<svg class="' + (on ? 'on' : '') + (isNew ? ' new' : '') + '"><use href="#c' + g + '"/></svg>');
    }
    cur.foundPrev = have;
  }
  function buildBoard() {
    const n = cur.n, el = $('board'); el.innerHTML = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'cell';
      c.style.setProperty('--c', COLORS[cur.regions[y][x]]);
      c.style.setProperty('--d', Math.min(0.5, (y * n + x) * 0.012) + 's');
      c.setAttribute('aria-label', 'Row ' + (y + 1) + ' column ' + (x + 1));
      c.dataset.y = y; c.dataset.x = x;
      c.onclick = (e) => { if (e.detail === 0) tap(y, x, false); };   // keyboard only; touch and mouse go through the board handlers
      c.oncontextmenu = (e) => e.preventDefault();
      el.appendChild(c);
    }
    attachDrag(el);
    paint();
  }

  /* Drag across squares to mark X's. Start on an empty square to add X's, start on an X to wipe X's.
     A plain tap or a long press behaves as before. Candies are never touched by a drag. */
  let drag = null, lastDragSound = 0;
  function cellAt(px, py) {
    const t = document.elementFromPoint(px, py), c = t && t.closest ? t.closest('.cell') : null;
    return c && $('board').contains(c) ? c : null;
  }
  function dragApply(c) {
    if (!c) return false;
    const y = +c.dataset.y, x = +c.dataset.x, s = cur.state[y][x];
    let ns = s;
    if (drag.mode === 'add' && (s === 0 || s === 3)) ns = 1;
    else if (drag.mode === 'remove' && s === 1) ns = 0;
    if (ns === s) return false;
    if (!drag.snap) { snapshot(); drag.snap = true; }
    cur.state[y][x] = ns; cur.wrongMarks.delete(y + ',' + x);
    const now = performance.now();
    if (now - lastDragSound > 55) { lastDragSound = now; if (ns === 1) S.x(); else S.tap(); }
    return true;
  }
  let lastTap = null;
  function attachDrag(board) {
    board.onpointerdown = (e) => {
      if (cur.done) return;
      const c = cellAt(e.clientX, e.clientY);       // by finger position, not by event target
      if (!c) return;
      const y = +c.dataset.y, x = +c.dataset.x;
      drag = { y, x, start: c, mode: cur.state[y][x] === 1 ? 'remove' : 'add', moved: false, long: false, snap: false, px: e.clientX, py: e.clientY };
      try { board.setPointerCapture(e.pointerId); } catch (_) {}
      if (!cur.maybeMode) drag.timer = setTimeout(() => { if (drag && !drag.moved) { drag.long = true; buzz(10); tap(y, x, true); } }, 420);
      e.preventDefault();
    };
    board.onpointermove = (e) => {
      if (!drag || cur.maybeMode) return;
      const here = cellAt(e.clientX, e.clientY);
      if (!drag.moved) {
        if (!here || here === drag.start) return;     // still on the first square: not a drag yet
        drag.moved = true; clearTimeout(drag.timer);
        dragApply(drag.start);
      }
      // walk along the finger path so fast swipes skip no square
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
      let changed = false;
      for (let i = 1; i <= steps; i++) changed = dragApply(cellAt(drag.px + (dx * i) / steps, drag.py + (dy * i) / steps)) || changed;
      drag.px = e.clientX; drag.py = e.clientY;
      if (changed) paint();
    };
    const end = (e) => {
      if (!drag) return;
      clearTimeout(drag.timer);
      const d = drag; drag = null;
      if (e.type === 'pointerup' && !d.moved && !d.long) {
        const now = performance.now();
        if (lastTap && lastTap.y === d.y && lastTap.x === d.x && now - lastTap.t < 330 && cur.history.length) {
          cur.state = cur.history.pop(); lastTap = null;     // undo the first tap, then place the candy
          tap(d.y, d.x, false, true);
        } else { lastTap = { y: d.y, x: d.x, t: now }; tap(d.y, d.x, false); }
      }
      else if (d.moved) paint();
    };
    board.onpointerup = end; board.onpointercancel = end;
  }
  const cellEl = (y, x) => $('board').children[y * cur.n + x];

  // squares already ruled out by placed candies: same row, column, color, or touching
  function blocked() {
    const n = cur.n, b = new Set();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (cur.state[y][x] !== 2) continue;
      const g = cur.regions[y][x];
      for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
        if (yy === y && xx === x) continue;
        if (yy === y || xx === x || cur.regions[yy][xx] === g || (Math.abs(yy - y) <= 1 && Math.abs(xx - x) <= 1)) b.add(yy + ',' + xx);
      }
    }
    return b;
  }
  function placedCount() { let c = 0; for (const r of cur.state) for (const v of r) if (v === 2) c++; return c; }
  function paint() {
    const n = cur.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const el = cellEl(y, x), s = cur.state[y][x];
      const wrongX = s === 1 && cur.wrongMarks.has(y + ',' + x);   // black X: only after a wrong candy attempt
      const key = s === 2 ? 'c' + cur.regions[y][x] : s === 1 ? (wrongX ? 'xw' : 'x') : s === 3 ? 'q' : '';
      el.classList.toggle('has', s === 2);
      if (el.dataset.k === key) continue;      // leave unchanged squares alone so animations don't replay
      el.dataset.k = key;
      if (s === 2) el.innerHTML = '<svg class="candy" style="--idur:' + (3 + Math.random() * 2.5).toFixed(1) + 's;--idelay:' + (0.4 + Math.random() * 1.6).toFixed(1) + 's"><use href="#c' + cur.regions[y][x] + '"/></svg>';
      else if (s === 1) el.innerHTML = '<span class="x' + (wrongX ? ' bad' : '') + '"></span>';
      else if (s === 3) el.innerHTML = '<span class="q">?</span>';
      else el.innerHTML = '';
    }
    drawFound();
  }
  function snapshot() { cur.history.push(cur.state.map((r) => r.slice())); if (cur.history.length > 200) cur.history.shift(); }

  function tap(y, x, maybe, candy) {
    if (cur.done) return;
    S.unlock();
    const s = cur.state[y][x];
    if (maybe || cur.maybeMode) {
      if (s === 2) return;
      snapshot(); cur.state[y][x] = s === 3 ? 0 : 3; S.tap(); paint(); return;
    }
    const k = y + ',' + x;
    let ns;
    if (candy) ns = s === 2 ? 0 : 2;               // double tap: candy (or remove it)
    else if (s === 2 || s === 1) ns = 0;           // single tap on a candy or any X (black too) clears it, never a penalty
    else ns = 1;                                   // empty or ? goes to X
    if (ns === 2 && cur.solution[y] !== x) {
      // wrong candy: the square gets a black X, and the heart is lost only the first time for that square
      snapshot();
      cur.state[y][x] = 1; cur.wrongMarks.add(k);
      paint();
      if (cur.penalized.has(k)) { S.wrong(); buzz([20, 20]); const el = cellEl(y, x); el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
      else { cur.penalized.add(k); mistake(y, x); }
      return;
    }
    cur.wrongMarks.delete(k);
    snapshot();
    cur.state[y][x] = ns;
    if (ns === 2) {
      buzz(14); const pc = placedCount(); S.candy(cur.regions[y][x], pc);
      if (V) { if (pc === 1) V.first(); else if (Math.random() < 0.22) V.praise(); }
    }
    else if (ns === 1) { buzz(5); S.x(); }
    else S.tap();
    paint();
    if (solved()) win();
  }
  function mistake(y, x) {
    cur.hearts--; buzz([40, 30, 40]); S.wrong();
    const el = cellEl(y, x); el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong');
    const h = $('hearts'); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit');
    drawHearts();
    if (cur.hearts <= 0) { cur.done = true; freshScore(); score.run = 0; store.set('score', score); setTimeout(() => { S.lose(); if (V) V.lose(); $('lose').hidden = false; }, 500); }
  }
  function solved() { for (let y = 0; y < cur.n; y++) if (cur.state[y][cur.solution[y]] !== 2) return false; return true; }
  function undo() { if (cur.done || !cur.history.length) return; S.tap(); cur.state = cur.history.pop(); paint(); }

  let toastTimer = null;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }
  function updateHintUi() {
    const b = $('hintBadge'); if (b) b.textContent = hintsLeft;
    $('hintBtn').classList.toggle('empty', hintsLeft <= 0);
  }
  function openHintInfo() {
    if (cur.done) return;
    S.unlock(); S.tap();
    const toNext = HINT_EVERY - (cleared % HINT_EVERY);
    $('hintLeft').textContent = hintsLeft;
    $('hintEarn').textContent = hintsLeft > 0
      ? 'You get 1 free hint for every ' + HINT_EVERY + ' levels you pass. ' + toNext + ' more level' + (toNext > 1 ? 's' : '') + ' until the next one.'
      : 'You have no hints left. Pass ' + toNext + ' more level' + (toNext > 1 ? 's' : '') + ' to win another one. You get 1 for every ' + HINT_EVERY + ' levels.';
    $('hintUse').disabled = hintsLeft <= 0;
    $('hintInfo').hidden = false;
  }
  function hint() {
    if (cur.done || hintsLeft <= 0) return;
    S.unlock();
    const h = H.next(cur.n, cur.regions, cur.state, cur.solution);
    if (!h) { toast("Nothing left to hint. You're almost there!"); return; }   // nothing is spent
    hintsLeft--; store.set('hints', hintsLeft); updateHintUi();
    snapshot(); cur.hints++;
    for (const [y, x] of h.cells) { cur.state[y][x] = h.type === 'candy' ? 2 : 1; cur.wrongMarks.delete(y + ',' + x); }
    paint();
    for (const [y, x] of h.cells) { const el = cellEl(y, x); el.classList.remove('hinted'); void el.offsetWidth; el.classList.add('hinted'); }
    toast(h.text); buzz(15);
    if (h.type === 'candy') { const [y, x] = h.cells[0]; S.candy(cur.regions[y][x], placedCount()); } else S.hint();
    if (solved()) win();
  }
  function restart() { if (cur.done) return; S.tap(); snapshot(); cur.state = cur.state.map((r) => r.map(() => 0)); cur.wrongMarks.clear(); cur.foundPrev = new Set(); paint(); }

  /* ---------- win ---------- */
  function win() {
    cur.done = true; buzz([30, 40, 60]); S.win();
    if (V) setTimeout(() => V.win(cur.hearts), 700);
    const m = cur.meta, earned = Math.max(1, cur.hearts);
    let reward = false;
    freshScore();
    score.run++;
    const pt = pointsFor(cur.n, score.run);
    score.points += pt.gain; score.best = Math.max(score.best || 0, score.points);
    store.set('score', score);
    $('winGain').innerHTML = '+' + pt.gain + ' pts<small>' + '×' + pt.mult + ' in a row · ' + score.points + ' today</small>';
    if (m.kind === 'level') {
      if (!stars[m.level] || stars[m.level] < earned) { stars[m.level] = earned; store.set('stars', stars); }
      if (level === m.level) {
        level = m.level + 1; store.set('level', level);
        cleared++; store.set('cleared', cleared);                       // only a first-time pass counts toward the reward
        if (cleared % HINT_EVERY === 0) { hintsLeft++; store.set('hints', hintsLeft); reward = true; }
      }
    } else if (m.kind === 'daily' && daily.last !== m.date) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yd = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
      daily = { last: m.date, streak: daily.last === yd ? daily.streak + 1 : 1 }; store.set('daily', daily);
    }
    let st = ''; for (let i = 1; i <= 3; i++) st += STAR.replace('<svg', '<svg style="animation-delay:' + (0.2 + i * 0.18) + 's" class="' + (i <= earned ? '' : 'off') + '"');
    $('winStars').innerHTML = st;
    $('winInfo').textContent = cur.n + '×' + cur.n + (cur.tier !== 'normal' ? ' ' + tierLabel[cur.tier] : '') + ' solved' + (cur.hints ? ' · ' + cur.hints + ' hint' + (cur.hints > 1 ? 's' : '') : ' · no hints');
    const wr = $('winReward');
    if (reward) { wr.hidden = false; wr.innerHTML = '🎁 Reward! <b>+1 hint</b> for passing ' + HINT_EVERY + ' levels'; }
    else if (m.kind === 'level') { wr.hidden = false; wr.textContent = (cleared % HINT_EVERY) + ' / ' + HINT_EVERY + ' levels to your next free hint'; }
    else wr.hidden = true;
    updateHintUi();
    $('nextBtn').textContent = m.kind === 'level' ? 'Next level' : 'Back to map';
    setTimeout(() => { $('win').hidden = false; confetti(); }, 450);
  }
  function confetti() {
    const box = $('confetti'); box.innerHTML = '';
    for (let i = 0; i < 80; i++) {
      const b = document.createElement('b');
      b.style.cssText = 'left:' + Math.random() * 100 + '%;background:' + COLORS[i % COLORS.length] + ';animation-duration:' + (2.2 + Math.random() * 2.2) + 's;animation-delay:' + Math.random() * .6 + 's';
      box.appendChild(b);
    }
    setTimeout(() => { box.innerHTML = ''; }, 5200);
  }

  /* ---------- opening story ---------- */
  const PANELS = [
    { text: 'Candy Land was the sweetest place in the world.', scene: 'happy' },
    { text: 'Then came a giant sneeze. Achoo! Every candy got mixed up!', scene: 'sneeze' },
    { text: 'Help Gumi put them back. One candy in every color, and no two candies can touch!', scene: 'mission' }
  ];
  let introStep = 0, rainTimer = null;
  const logoHtml = () => '<div class="logo big" aria-label="Candoku">' + ['#ff5fa2', '#ffb42e', '#ffe14d', '#3dffb0', '#3fd0ff', '#c8a0ff', '#ff6a6a'].map((c, i) => '<span style="--c:' + c + '">' + 'Candoku'[i] + '</span>').join('') + '</div>';
  function sceneHtml(kind) {
    if (kind === 'happy') {
      let o = ''; for (let i = 0; i < 6; i++) o += '<span class="oc" style="--a:' + i * 60 + 'deg"><svg><use href="#c' + i + '"/></svg></span>';
      return '<div class="scene"><div class="orbit">' + o + '</div><svg class="hero-gumi bounce"><use href="#gumi"/></svg></div>';
    }
    if (kind === 'sneeze') {
      let f = ''; const vec = [[-130, -90], [120, -100], [-150, 20], [140, 30], [-70, -130], [70, -125], [-100, 110], [100, 105]];
      vec.forEach((v, i) => { f += '<span class="fly" style="--x:' + v[0] + 'px;--y:' + v[1] + 'px;--r:' + (i % 2 ? 300 : -300) + 'deg;animation-delay:' + (i * 0.12) + 's"><svg><use href="#c' + i + '"/></svg></span>'; });
      return '<div class="scene">' + f + '<svg class="hero-gumi shake"><use href="#gumi"/></svg><div class="bubble">ACHOO!</div></div>';
    }
    const reg = ['AABB', 'AABB', 'CCDD', 'CCDD'], cols = { A: 0, B: 1, C: 2, D: 3 }, cand = { '0,1': 0, '1,3': 1, '2,0': 2, '3,2': 3 };
    let t = '';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const k = y + ',' + x, inner = k in cand ? '<svg><use href="#c' + cand[k] + '"/></svg>' : '<b></b>';
      t += '<span class="tile" style="--c:' + COLORS[cols[reg[y][x]]] + ';animation-delay:' + (y * 4 + x) * 0.05 + 's">' + inner + '</span>';
    }
    return '<div class="scene row"><div class="mini">' + t + '</div><svg class="hero-gumi wave"><use href="#gumi"/></svg></div>';
  }
  function startRain() {
    const box = $('introRain'); box.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('span'); d.className = 'drop';
      d.style.cssText = 'left:' + Math.random() * 100 + '%;--s:' + (28 + Math.random() * 30) + 'px;animation-duration:' + (5 + Math.random() * 5) + 's;animation-delay:-' + Math.random() * 8 + 's';
      d.innerHTML = '<svg><use href="#c' + (i % 10) + '"/></svg>'; box.appendChild(d);
    }
  }
  function renderIntro() {
    const body = $('introBody'), ctl = $('introCtl');
    if (introStep === 0) {
      body.innerHTML = '<div class="splash">' + logoHtml() + '<svg class="hero-gumi bounce"><use href="#gumi"/></svg><button id="introStart" class="play" type="button">Tap to start</button></div>';
      ctl.hidden = true;
      $('introStart').onclick = () => {
        S.unlock(); S.tap(); if (M) M.start('menu');
        if (V) V.say('Welcome to Candoku!', true);
        setTimeout(() => { introStep = 1; renderIntro(); }, 1500);
        $('introStart').disabled = true;
      };
      return;
    }
    const p = PANELS[introStep - 1];
    body.innerHTML = '<div class="panel">' + sceneHtml(p.scene) + '<p class="cap">' + p.text + '</p></div>';
    ctl.hidden = false;
    $('introNext').textContent = introStep === PANELS.length ? "Let's play!" : 'Next';
    $('introDots').innerHTML = PANELS.map((_, i) => '<i class="' + (i === introStep - 1 ? 'on' : '') + '"></i>').join('');
    if (V) V.say(p.text, true);
  }
  function showIntro() { introStep = 0; $('intro').hidden = false; document.body.classList.add('in-game'); startRain(); renderIntro(); }
  function endIntro() {
    store.set('seenIntro', true); store.set('seenHow', true);
    if (V) V.cancel();
    $('intro').hidden = true; $('introRain').innerHTML = '';
    document.body.classList.toggle('in-game', !$('game').hidden);
    if (M) M.start('menu');
    scrollToLevel(level);
    setTimeout(() => scrollToLevel(level), 80);
  }
  function syncOpts() {
    const set = (id, on) => $(id).setAttribute('aria-checked', String(!!on));
    set('optMusic', M && M.isEnabled()); set('optVoice', V && V.isEnabled()); set('optAll', S.isOn());
  }

  /* ---------- navigation ---------- */
  async function toMap() {
    await transition(() => { renderHome(); show('home'); scrollToLevel(level); });
  }
  async function nextLevel() {
    $('win').hidden = true;
    if (cur.meta.kind !== 'level') { await toMap(); return; }
    const from = cur.meta.level, to = level;
    await transition(() => { renderHome(); show('home'); scrollToLevel(to); });
    await sleep(200);
    await hopTo(from, to);
    if (V && to > 1 && (to - 1) % 10 === 0) V.say('Welcome to ' + zoneOf(to).name + '!', true);
    await sleep(250);
    await transition(() => startLevel(to));
  }

  /* ---------- wiring ---------- */
  $('daily').onclick = () => { S.unlock(); S.tap(); transition(() => startDaily()); };
  $('backBtn').onclick = () => { S.tap(); toMap(); };
  $('undoBtn').onclick = undo;
  $('hintBtn').onclick = openHintInfo;
  $('hintUse').onclick = () => { $('hintInfo').hidden = true; hint(); };
  $('hintCancel').onclick = () => { S.tap(); $('hintInfo').hidden = true; };
  $('clearBtn').onclick = restart;
  $('maybeBtn').onclick = () => { cur.maybeMode = !cur.maybeMode; $('maybeBtn').setAttribute('aria-pressed', String(cur.maybeMode)); S.tap(); };
  const openHow = () => { S.tap(); syncOpts(); $('how').hidden = false; };
  $('gearBtn').onclick = openHow; $('howBtn').onclick = openHow;
  $('howClose').onclick = () => { S.tap(); $('how').hidden = true; store.set('seenHow', true); };
  const toggleSound = () => { S.toggle(); syncSound(); if (M) M.sync(); if (!S.isOn() && V) V.cancel(); syncOpts(); };
  $('optMusic').onclick = () => { S.unlock(); M.setEnabled(!M.isEnabled()); syncOpts(); };
  $('optVoice').onclick = () => { V.setEnabled(!V.isEnabled()); syncOpts(); if (V.isEnabled()) V.say('Sweet!', true); };
  $('optAll').onclick = toggleSound;
  $('replayIntro').onclick = () => { $('how').hidden = true; showIntro(); };
  $('introNext').onclick = () => { S.tap(); if (introStep >= PANELS.length) { if (V) V.say("Let's play!", true); endIntro(); } else { introStep++; renderIntro(); } };
  $('introSkip').onclick = () => { S.tap(); endIntro(); };
  document.addEventListener('pointerdown', () => { S.unlock(); if (M && $('intro').hidden) M.sync(); }, { once: true });
  $('sndHome').onclick = toggleSound; $('sndGame').onclick = toggleSound;
  $('homeBtn').onclick = () => { $('win').hidden = true; toMap(); };
  $('loseHome').onclick = () => { $('lose').hidden = true; toMap(); };
  $('retryBtn').onclick = () => { S.tap(); $('lose').hidden = true; const m = cur.meta; transition(() => (m.kind === 'level' ? startLevel(m.level) : startDaily())); };
  $('nextBtn').onclick = () => { S.tap(); nextLevel(); };
  $('shareBtn').onclick = async () => {
    const text = 'Candoku 🍬 ' + cur.label + ' ' + cur.n + '×' + cur.n + ' solved' + (cur.hints ? '' : ' with no hints');
    try {
      if (navigator.share) await navigator.share({ text, url: location.href });
      else { await navigator.clipboard.writeText(text + ' ' + location.href); $('shareBtn').textContent = 'Copied!'; setTimeout(() => { $('shareBtn').textContent = 'Share'; }, 1500); }
    } catch (e) {}
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) return; });

  syncSound();
  renderHome();
  scrollToLevel(level);
  if (!store.get('seenIntro', false)) showIntro();
  else if (!store.get('seenHow', false)) $('how').hidden = false;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
