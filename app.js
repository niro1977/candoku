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
  let coins = store.get('coins', 30), wands = store.get('wands', 1), bonus = store.get('bonus', { last: '', streak: 0 });
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
  /* ---------- daily ranking (Cloudflare Worker) ---------- */
  const RANK_URL = 'https://candoku-ranking.niriangelo.workers.dev';
  let pid = store.get('pid', ''), pname = store.get('pname', '');
  if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2, 10)); store.set('pid', pid); }
  if (!pname) { pname = 'Player' + Math.floor(1000 + Math.random() * 9000); store.set('pname', pname); }
  function postScore() {
    if (!score.points) return Promise.resolve(null);
    return fetch(RANK_URL + '/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid, name: pname, points: score.points }) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  function renderBoard(d) {
    const box = $('rankList'); box.innerHTML = '';
    if (!d || !d.top) { box.innerHTML = '<p class="small">Cannot reach the ranking. Check your connection and try again.</p>'; $('rankMine').textContent = ''; return; }
    if (!d.top.length) box.innerHTML = '<p class="small">No one has scored yet today. Be the first!</p>';
    for (const r of d.top) {
      const row = document.createElement('div'); row.className = 'rrow' + (r.me ? ' me' : '');
      const n = document.createElement('b'); n.textContent = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank;
      const nm = document.createElement('span'); nm.textContent = r.name;
      const pt = document.createElement('em'); pt.textContent = r.points;
      row.append(n, nm, pt); box.appendChild(row);
    }
    $('rankMine').textContent = d.mine ? 'You are #' + d.mine.rank + ' of ' + d.mine.players + ' today with ' + d.mine.points + ' pts' : (score.points ? '' : 'Solve a board to join the ranking today');
  }
  async function openRanking() {
    S.unlock(); S.tap();
    freshScore();
    $('rankName2').value = pname;
    $('rankList').innerHTML = '<p class="small">Loading…</p>'; $('rankMine').textContent = '';
    $('ranking').hidden = false;
    const posted = await postScore();     // also refreshes my row
    if (posted) return renderBoard(posted);
    try { const r = await fetch(RANK_URL + '/top?id=' + encodeURIComponent(pid)); renderBoard(r.ok ? await r.json() : null); } catch (e) { renderBoard(null); }
  }
  function saveName() {
    const v = $('rankName2').value.replace(/[<>&"'`]/g, '').trim().slice(0, 16);
    if (v && v !== pname) { pname = v; store.set('pname', pname); postScore().then((d) => { if (d && !$('ranking').hidden) renderBoard(d); }); }
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
    { name: 'Lollipop Meadow' }, { name: 'Chocolate River' }, { name: 'Frosting Mountains' },
    { name: 'Cotton Candy Sky' }, { name: 'Ice Cream Beach' }, { name: 'Gingerbread Winter' },
    { name: 'Donut Lake' }, { name: 'Cookie Canyon' }, { name: 'Crystal Caves' }
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
      html += '<div class="zone" style="top:' + top + 'px;height:' + (bottom - top) + 'px;background:#2a1450 url(art/bg_' + (k % ZONES.length) + '.jpg) center/cover"></div>';
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
    renderScore(); updateHintUi(); updateSides();
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
  const worldIdx = (lv) => Math.floor((lv - 1) / 10) % ZONES.length;
  function setScene(i) {
    const box = $('scene');
    if (box) { box.style.backgroundImage = 'url(art/bg_' + i + '.jpg)'; box.dataset.world = i; }
    if (M) M.world(i);
  }
  function startLevel(lv) {
    setScene(worldIdx(lv));
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
    setScene(new Date().getDate() % ZONES.length);
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
  /* ---------- wallet: coins, hints, wands ---------- */
  const coinSvg = '<svg class="ico"><use href="#coin"/></svg>';
  function saveWallet() { store.set('coins', coins); store.set('wands', wands); store.set('hints', hintsLeft); }
  function updateHintUi() {
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('hintBadge', hintsLeft); set('wandBadge', wands); set('coinN', coins); set('hintN', hintsLeft); set('wandN', wands);
    $('hintBtn').classList.toggle('empty', hintsLeft <= 0); $('wandBtn').classList.toggle('empty', wands <= 0);
  }
  const ITEMS = {
    hint: { name: 'Hint', icon: 'bulb', price: 30,
      desc: 'A hint finds a square where an X surely belongs and marks it for you, and tells you why. It places a candy only when that is the last choice left.',
      count: () => hintsLeft, add: (n) => { hintsLeft += n; }, run: () => hint(),
      earn: () => { const t = HINT_EVERY - (cleared % HINT_EVERY); return 'You win 1 free hint for every ' + HINT_EVERY + ' levels you pass (' + t + ' more to go), and in the Daily Bonus.'; } },
    wand: { name: 'Magic Wand', icon: 'wand', price: 60,
      desc: 'The wand puts one correct candy on the board for you, with no risk. Use it when you are really stuck.',
      count: () => wands, add: (n) => { wands += n; }, run: () => useWand(),
      earn: () => 'Wands are won in the Daily Bonus, or bought with coins.' }
  };
  let itemKind = 'hint';
  function openItemInfo(kind) {
    if (!cur || cur.done) return;
    S.unlock(); S.tap(); itemKind = kind;
    const it = ITEMS[kind], n = it.count();
    $('itemIcon').innerHTML = '<use href="#' + it.icon + '"/>'; $('itemIcon').setAttribute('class', it.icon === 'bulb' ? 'stroke' : '');
    $('hintLeft').textContent = n; $('itemTitle').textContent = it.name; $('itemDesc').textContent = it.desc; $('hintEarn').textContent = it.earn();
    const b = $('hintUse');
    if (n > 0) { b.textContent = 'Use 1 ' + it.name.toLowerCase(); b.disabled = false; }
    else if (coins >= it.price) { b.innerHTML = 'Buy for ' + it.price + ' ' + coinSvg; b.disabled = false; }
    else { b.innerHTML = 'Need ' + it.price + ' ' + coinSvg; b.disabled = true; }
    $('hintInfo').hidden = false;
  }
  function onItemButton() {
    const it = ITEMS[itemKind];
    if (it.count() > 0) { $('hintInfo').hidden = true; it.run(); }
    else if (coins >= it.price) { coins -= it.price; it.add(1); saveWallet(); updateHintUi(); S.hint(); openItemInfo(itemKind); }
  }
  function hint() {
    if (!cur || cur.done || hintsLeft <= 0) return;
    S.unlock();
    const h = H.next(cur.n, cur.regions, cur.state, cur.solution);
    if (!h) { toast("Nothing left to hint. You're almost there!"); return; }   // nothing is spent
    hintsLeft--; saveWallet(); updateHintUi();
    snapshot(); cur.hints++;
    for (const [y, x] of h.cells) { cur.state[y][x] = h.type === 'candy' ? 2 : 1; cur.wrongMarks.delete(y + ',' + x); }
    paint();
    for (const [y, x] of h.cells) { const el = cellEl(y, x); el.classList.remove('hinted'); void el.offsetWidth; el.classList.add('hinted'); }
    toast(h.text); buzz(15);
    if (h.type === 'candy') { const [y, x] = h.cells[0]; S.candy(cur.regions[y][x], placedCount()); } else S.hint();
    if (solved()) win();
  }
  function useWand() {
    if (!cur || cur.done || wands <= 0) return;
    const rows = []; for (let y = 0; y < cur.n; y++) if (cur.state[y][cur.solution[y]] !== 2) rows.push(y);
    if (!rows.length) { toast('Every candy is already placed!'); return; }   // nothing is spent
    const y = rows[Math.floor(Math.random() * rows.length)], x = cur.solution[y];
    wands--; saveWallet(); updateHintUi();
    snapshot(); cur.hints++;
    cur.state[y][x] = 2; cur.wrongMarks.delete(y + ',' + x);
    paint();
    const el = cellEl(y, x); el.classList.remove('hinted'); void el.offsetWidth; el.classList.add('hinted');
    toast('✨ The wand placed a candy for you!'); buzz(20); S.candy(cur.regions[y][x], placedCount());
    if (solved()) win();
  }
  /* ---------- daily bonus: pick one of nine cards ---------- */
  const PRIZES = [
    { id: 'c10', w: 30, coins: 10 }, { id: 'c25', w: 20, coins: 25 }, { id: 'c50', w: 9, coins: 50, rare: 1 }, { id: 'c100', w: 2, coins: 100, rare: 1 },
    { id: 'h1', w: 22, hints: 1 }, { id: 'h2', w: 8, hints: 2, rare: 1 }, { id: 'w1', w: 9, wands: 1, rare: 1 }
  ];
  function rollPrize(streak, onlyRare) {
    const list = PRIZES.filter((p) => !onlyRare || p.rare);
    const wt = list.map((p) => p.w * (p.rare ? 1 + Math.min(streak, 10) * 0.12 : 1));
    let r = Math.random() * wt.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= wt[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  function prizeHtml(p) {
    if (p.coins) return '<svg class="pico"><use href="#coin"/></svg><b>+' + p.coins + '</b>';
    if (p.hints) return '<svg class="pico stroke"><use href="#bulb"/></svg><b>+' + p.hints + '</b>';
    return '<svg class="pico"><use href="#wand"/></svg><b>+' + p.wands + '</b>';
  }
  function prizeText(p) { return p.coins ? p.coins + ' coins' : p.hints ? p.hints + ' hint' + (p.hints > 1 ? 's' : '') : '1 magic wand'; }
  function openBonus() {
    const grid = $('bonusGrid'); grid.innerHTML = ''; $('bonusClaim').hidden = true; $('bonusStreak').textContent = '';
    $('bonusMsg').textContent = 'Pick a card to get your reward!';
    let picked = false;
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bcard'; b.innerHTML = '<span class="front">?</span><span class="back"></span>';
      b.onclick = () => {
        if (picked) return; picked = true; S.unlock();
        const t = today(), y = new Date(); y.setDate(y.getDate() - 1);
        const yd = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
        const streak = bonus.last === yd ? bonus.streak + 1 : 1;
        const prize = rollPrize(streak, streak % 7 === 0);
        bonus = { last: t, streak }; store.set('bonus', bonus);
        coins += prize.coins || 0; hintsLeft += prize.hints || 0; wands += prize.wands || 0; saveWallet(); updateHintUi();
        b.querySelector('.back').innerHTML = prizeHtml(prize); b.classList.add('open', 'mine'); S.win(); buzz([20, 30, 40]);
        $('bonusMsg').textContent = 'You won ' + prizeText(prize) + '!';
        $('bonusStreak').textContent = '🔥 Day ' + streak + (streak % 7 === 0 ? ' · big prize day!' : ' · come back tomorrow for more');
        // the other cards show what they hid
        [...grid.children].forEach((c, k) => { if (c === b) return; setTimeout(() => { c.querySelector('.back').innerHTML = prizeHtml(rollPrize(streak, false)); c.classList.add('open', 'dim'); S.tap(); }, 450 + k * 90); });
        setTimeout(() => { $('bonusClaim').hidden = false; }, 1400);
      };
      grid.appendChild(b);
    }
    S.tap(); $('bonus').hidden = false;
  }
  function maybeBonus() { if (bonus.last !== today() && $('intro').hidden && $('bonus').hidden) setTimeout(openBonus, 600); }
  /* ---------- profile ---------- */
  function openProfile() {
    S.unlock(); S.tap(); freshScore();
    const best = Math.max(score.best || 0, score.points);
    let i = 0; for (let k = 0; k < RANKS.length; k++) if (best >= RANKS[k][0]) i = k;
    const next = RANKS[i + 1];
    $('pfName').value = pname; $('pfRank').textContent = RANKS[i][1];
    $('pfBar').style.width = (next ? Math.min(100, ((best - RANKS[i][0]) / (next[0] - RANKS[i][0])) * 100) : 100) + '%';
    $('pfNext').textContent = next ? (next[0] - best) + ' pts to ' + next[1] : 'Top rank reached!';
    const totalStars = Object.values(stars).reduce((x, y) => x + (y || 0), 0);
    const rows = [
      ['Levels passed', Math.max(0, level - 1)], ['Stars', totalStars], ['Best day', best + ' pts'],
      ['Today', score.points + ' pts'], ['Daily bonus streak', bonus.streak ? bonus.streak + ' days' : '-'], ['Daily Candy streak', daily.streak ? daily.streak + ' days' : '-']
    ];
    $('pfGrid').innerHTML = rows.map((r) => '<div><b>' + r[1] + '</b><small>' + r[0] + '</small></div>').join('')
      + '<div><b><svg class="ico"><use href="#coin"/></svg> ' + coins + '</b><small>Coins</small></div>'
      + '<div><b>' + hintsLeft + ' · ' + wands + '</b><small>Hints · Wands</small></div>';
    $('profile').hidden = false;
  }
  function saveProfileName() {
    const v = $('pfName').value.replace(/[<>&"'`]/g, '').trim().slice(0, 16);
    if (v && v !== pname) { pname = v; store.set('pname', pname); postScore(); }
  }
  /* ---------- shop ---------- */
  function openShop() {
    S.unlock(); S.tap();
    $('shopCoins').textContent = coins;
    const list = $('shopList'); list.innerHTML = '';
    for (const k of ['hint', 'wand']) {
      const it = ITEMS[k], row = document.createElement('div'); row.className = 'shoprow';
      row.innerHTML = '<svg class="pico' + (k === 'hint' ? ' stroke' : '') + '"><use href="#' + it.icon + '"/></svg><span><b>' + it.name + '</b><small>you have ' + it.count() + '</small></span>';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy'; b.innerHTML = it.price + ' ' + coinSvg; b.disabled = coins < it.price;
      b.onclick = () => { if (coins < it.price) return; coins -= it.price; it.add(1); saveWallet(); updateHintUi(); S.hint(); openShop(); };
      row.appendChild(b); list.appendChild(row);
    }
    $('shop').hidden = false;
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
    store.set('score', score); postScore();
    const earnedCoins = cur.n * 2 + (cur.hearts >= 3 ? 4 : 0);
    coins += earnedCoins; saveWallet(); updateHintUi();
    onSolved();
    $('winCoins').hidden = false; $('winCoins').innerHTML = '+' + earnedCoins + ' ' + coinSvg + ' coins';
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
    maybeBonus();
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
  document.querySelectorAll('.card').forEach((card) => {
    const x = document.createElement('button'); x.type = 'button'; x.className = 'xclose'; x.setAttribute('aria-label', 'Close');
    x.onclick = () => { for (const id of ['#howClose', '#wheelClose', '#chestClose', '#questClose', '#giftClose', '#gamesClose', '#memClose', '#tossClose', '#rankClose', '#hintCancel', '#shopClose', '#pfClose', '#bonusClaim', '#homeBtn', '#loseHome']) { const b = card.querySelector(id); if (b) { b.click(); return; } } };
    card.appendChild(x);
  });
  $('rankBtn').onclick = openRanking;
  $('pfClose').onclick = () => { saveProfileName(); S.tap(); $('profile').hidden = true; };
  $('pfName').onchange = saveProfileName;
  $('rankClose').onclick = () => { saveName(); S.tap(); $('ranking').hidden = true; };
  $('rankName2').onchange = saveName;
  $('hintBtn').onclick = () => openItemInfo('hint');
  $('wandBtn').onclick = () => openItemInfo('wand');
  $('hintUse').onclick = onItemButton;
  $('walletCoins').onclick = openShop;
  $('shopClose').onclick = () => { S.tap(); $('shop').hidden = true; };
  $('bonusClaim').onclick = () => { S.tap(); $('bonus').hidden = true; updateHintUi(); };
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

  /* ---------- extras: gifts, daily quests, chest, lucky wheel, mini-games ---------- */
  const HOUR = 3600e3, MAX_PLAYS = 2, CHEST_AT = 10;
  let quests = store.get('quests', null), chest = store.get('chest', { n: 0 }), wheel = store.get('wheel', { date: '', extra: 0 });
  let gifts = store.get('gifts', { daily: '', free: 0 }), plays = store.get('plays', { date: '', memory: 0, toss: 0 });
  const give = (p) => { coins += p.coins || 0; hintsLeft += p.hints || 0; wands += p.wands || 0; saveWallet(); updateHintUi(); };
  const closeAll = () => { ['wheel', 'chest', 'quests', 'gifts', 'games', 'memory', 'toss'].forEach((id) => { $(id).hidden = true; }); };
  const QDEF = [
    { id: 'solved', text: 'Solve 3 levels', goal: 3, coins: 25 },
    { id: 'nohint', text: 'Solve a level with no hints', goal: 1, coins: 30 },
    { id: 'flawless', text: 'Solve a level without losing a heart', goal: 1, coins: 30 }
  ];
  function freshDay() {
    const t = today();
    if (!quests || quests.date !== t) { quests = { date: t, p: { solved: 0, nohint: 0, flawless: 0 }, claimed: {}, bonus: false }; store.set('quests', quests); }
    if (plays.date !== t) { plays = { date: t, memory: 0, toss: 0 }; store.set('plays', plays); }
  }
  const dailyGiftReady = () => gifts.daily !== today();
  const freeGiftReady = () => Date.now() - gifts.free >= 6 * HOUR;
  const questReady = () => QDEF.some((q) => quests.p[q.id] >= q.goal && !quests.claimed[q.id]);
  function onSolved() {
    freshDay();
    quests.p.solved++; if (!cur.hints) quests.p.nohint++; if (cur.hearts >= MAX_HEARTS) quests.p.flawless++;
    store.set('quests', quests);
    chest.n = Math.min(CHEST_AT, chest.n + 1); store.set('chest', chest);
    updateSides();
  }
  function updateSides() {
    freshDay();
    const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    set('medDailyTag', daily.last === today() ? '✓' : 'Play');
    const free = wheel.date !== today() || wheel.extra > 0;
    set('medWheelTag', free ? 'FREE' : 'Tomorrow'); $('medWheel').classList.toggle('ready', free);
    set('medChestTag', chest.n >= CHEST_AT ? 'OPEN' : chest.n + '/' + CHEST_AT); $('medChest').classList.toggle('ready', chest.n >= CHEST_AT);
    const left = (MAX_PLAYS - plays.memory) + (MAX_PLAYS - plays.toss);
    set('medGamesTag', left + '/' + MAX_PLAYS * 2); $('medGames').classList.toggle('ready', left > 0);
    $('navQuests').classList.toggle('dot', questReady()); $('navGifts').classList.toggle('dot', dailyGiftReady() || freeGiftReady());
  }
  function rewardRow(p) { return '<div class="rwd">' + prizeHtml(p) + '</div>'; }

  /* gifts */
  function openGifts() {
    S.unlock(); S.tap(); closeAll();
    const list = $('giftList'); list.innerHTML = '';
    const rows = [
      { name: 'Daily gift', sub: dailyGiftReady() ? 'Ready to collect!' : 'Come back tomorrow', ready: dailyGiftReady(), prize: { coins: 20 }, claim: () => { gifts.daily = today(); } },
      { name: 'Free hint', sub: freeGiftReady() ? 'Ready to collect!' : 'Ready in ' + (() => { const ms = 6 * HOUR - (Date.now() - gifts.free), h = Math.floor(ms / HOUR), m = Math.ceil((ms % HOUR) / 60000); return h + 'h ' + m + 'm'; })(), ready: freeGiftReady(), prize: { hints: 1 }, claim: () => { gifts.free = Date.now(); } }
    ];
    rows.forEach((r) => {
      const d = document.createElement('div'); d.className = 'shoprow';
      d.innerHTML = '<span><b>' + r.name + '</b><small>' + r.sub + '</small></span>' + rewardRow(r.prize);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy'; b.textContent = 'Get'; b.disabled = !r.ready;
      b.onclick = () => { if (!r.ready) return; r.claim(); store.set('gifts', gifts); give(r.prize); S.win(); updateSides(); openGifts(); };
      d.appendChild(b); list.appendChild(d);
    });
    $('gifts').hidden = false;
  }
  /* quests */
  function openQuests() {
    S.unlock(); S.tap(); closeAll(); freshDay();
    const list = $('questList'); list.innerHTML = '';
    QDEF.forEach((q) => {
      const v = Math.min(q.goal, quests.p[q.id]), done = v >= q.goal, got = quests.claimed[q.id];
      const d = document.createElement('div'); d.className = 'shoprow quest';
      d.innerHTML = '<span><b>' + q.text + '</b><small>' + v + ' / ' + q.goal + '</small><i class="qbar"><u style="width:' + (v / q.goal) * 100 + '%"></u></i></span>';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy'; b.disabled = !done || got;
      b.innerHTML = got ? '✓' : q.coins + ' ' + coinSvg;
      b.onclick = () => {
        if (!done || got) return; quests.claimed[q.id] = true; give({ coins: q.coins }); S.win();
        if (QDEF.every((x) => quests.claimed[x.id]) && !quests.bonus) { quests.bonus = true; wheel.extra++; store.set('wheel', wheel); }
        store.set('quests', quests); updateSides(); openQuests();
      };
      d.appendChild(b); list.appendChild(d);
    });
    $('questBonus').textContent = quests.bonus ? '🎡 Bonus won: 1 extra wheel spin!' : 'Finish all three for a free wheel spin';
    $('quests').hidden = false;
  }
  /* chest */
  function openChest() {
    S.unlock(); S.tap(); closeAll();
    const full = chest.n >= CHEST_AT;
    $('chestMsg').textContent = full ? 'Your chest is ready!' : 'Solve ' + (CHEST_AT - chest.n) + ' more level' + (CHEST_AT - chest.n > 1 ? 's' : '') + ' to open it';
    $('chestBar').style.width = (chest.n / CHEST_AT) * 100 + '%'; $('chestPrize').innerHTML = '';
    const b = $('chestOpen'); b.disabled = !full; b.hidden = false; b.textContent = 'Open chest';
    $('chest').hidden = false;
  }
  function openChestNow() {
    if (chest.n < CHEST_AT) return;
    chest.n -= CHEST_AT; store.set('chest', chest);
    const p = rollPrize(5, true), bonus = { coins: 30 };
    give(p); give(bonus); S.win(); buzz([30, 40, 60]);
    $('chestPrize').innerHTML = '<div class="rwd big">' + prizeHtml(p) + '</div><div class="rwd">' + prizeHtml(bonus) + '</div>';
    $('chestMsg').textContent = 'You found ' + prizeText(p) + ' and 30 coins!';
    $('chestOpen').hidden = true; $('chestBar').style.width = (chest.n / CHEST_AT) * 100 + '%'; updateSides();
  }
  /* lucky wheel */
  const WSEG = [{ c: 10 }, { h: 1 }, { c: 25 }, { c: 15 }, { w: 1 }, { c: 20 }, { h: 2 }, { c: 50 }], WW = [24, 16, 14, 18, 8, 14, 4, 2], WCOL = ['#ff5fa8', '#ffb347', '#7be37a', '#45d0ff', '#b07bff', '#ffe14d', '#ff7a5c', '#5fd8ff'];
  let wheelRot = 0, spinning = false;
  function buildWheel() {
    let s = '<g id="wheelRot">';
    for (let i = 0; i < 8; i++) {
      const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180, R = 100;
      s += '<path d="M110 110 L' + (110 + R * Math.cos(a0)).toFixed(1) + ' ' + (110 + R * Math.sin(a0)).toFixed(1) + ' A' + R + ' ' + R + ' 0 0 1 ' + (110 + R * Math.cos(a1)).toFixed(1) + ' ' + (110 + R * Math.sin(a1)).toFixed(1) + ' Z" fill="' + WCOL[i] + '" stroke="#fff" stroke-width="3"/>';
      const am = (i * 45 + 22.5 - 90) * Math.PI / 180, x = 110 + 66 * Math.cos(am), y = 110 + 66 * Math.sin(am), g = WSEG[i];
      const label = g.c ? g.c : g.h ? '💡×' + g.h : '🪄';
      s += '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (g.c ? 22 : 18) + '" font-weight="800" fill="#4a1a8f" transform="rotate(' + (i * 45 + 22.5) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')">' + label + '</text>';
    }
    s += '</g><circle cx="110" cy="110" r="16" fill="#ffc247" stroke="#fff" stroke-width="4"/><path d="M110 4 L100 26 L120 26 Z" fill="#ff3f66" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>';
    $('wheelSvg').innerHTML = s;
  }
  function openWheel() {
    S.unlock(); S.tap(); closeAll(); if (!$('wheelRot')) buildWheel();
    const free = wheel.date !== today(), extra = wheel.extra;
    $('wheelBtn').disabled = spinning || !(free || extra > 0);
    $('wheelBtn').textContent = free ? 'Spin (free!)' : extra > 0 ? 'Spin (' + extra + ' bonus)' : 'Come back tomorrow';
    $('wheelMsg').textContent = free || extra > 0 ? 'Spin the wheel for a prize!' : 'Finish the daily quests for an extra spin.';
    $('wheel').hidden = false;
  }
  function spinWheel() {
    freshDay();
    const free = wheel.date !== today();
    if (spinning || !(free || wheel.extra > 0)) return;
    if (free) wheel.date = today(); else wheel.extra--;
    store.set('wheel', wheel);
    let r = Math.random() * WW.reduce((x, y) => x + y, 0), idx = 0;
    for (let i = 0; i < 8; i++) { r -= WW[i]; if (r <= 0) { idx = i; break; } }
    const g = WSEG[idx], prize = { coins: g.c, hints: g.h, wands: g.w };
    give(prize); updateSides();
    const target = (360 - (idx * 45 + 22.5) + 360) % 360, cur0 = wheelRot % 360;
    wheelRot += 360 * 5 + ((target - cur0 + 360) % 360);
    spinning = true; $('wheelBtn').disabled = true; $('wheelMsg').textContent = 'Good luck…';
    const el = $('wheelRot'); el.style.transition = 'transform 4s cubic-bezier(.15,.7,.1,1)'; el.style.transformOrigin = '110px 110px'; el.style.transform = 'rotate(' + wheelRot + 'deg)';
    let ticks = 0; const tick = setInterval(() => { S.tap(); if (++ticks > 16) clearInterval(tick); }, 220);
    setTimeout(() => { spinning = false; $('wheelMsg').textContent = 'You won ' + prizeText(prize) + '!'; S.win(); buzz([30, 40, 60]); openWheelState(); }, 4200);
  }
  function openWheelState() {
    const free = wheel.date !== today(), extra = wheel.extra;
    $('wheelBtn').disabled = !(free || extra > 0);
    $('wheelBtn').textContent = free ? 'Spin (free!)' : extra > 0 ? 'Spin (' + extra + ' bonus)' : 'Come back tomorrow';
  }
  /* mini-games hub */
  function openGames() {
    S.unlock(); S.tap(); closeAll(); freshDay();
    const list = $('gameList'); list.innerHTML = '';
    [['memory', 'Memory Match', 'Find all the pairs in 14 moves', 'm-game'], ['toss', 'Candy Toss', 'Toss 5 candies into the jar', 'm-toss']].forEach((g) => {
      const left = MAX_PLAYS - plays[g[0]], d = document.createElement('div'); d.className = 'shoprow';
      d.innerHTML = '<svg class="pico"><use href="#' + g[3] + '"/></svg><span><b>' + g[1] + '</b><small>' + g[2] + ' · ' + left + '/' + MAX_PLAYS + ' today</small></span>';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy'; b.textContent = 'Play'; b.disabled = left <= 0;
      b.onclick = () => { if (g[0] === 'memory') startMemory(); else startToss(); };
      d.appendChild(b); list.appendChild(d);
    });
    $('games').hidden = false;
  }
  /* memory match */
  function startMemory() {
    freshDay(); if (plays.memory >= MAX_PLAYS) return;
    plays.memory++; store.set('plays', plays); updateSides(); closeAll();
    const deck = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]; for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const grid = $('memGrid'); grid.innerHTML = ''; let first = null, lock = false, found = 0, moves = 14;
    $('memMoves').textContent = 'Moves left: ' + moves; $('memMsg').textContent = ''; $('memClose').textContent = 'Give up';
    const finish = (win) => {
      const reward = win ? 15 + moves * 3 : 5; give({ coins: reward }); S.win(); updateSides();
      $('memMsg').innerHTML = (win ? 'Great memory! +' : 'Out of moves. +') + reward + ' ' + coinSvg; $('memClose').textContent = 'Done'; lock = true;
    };
    deck.forEach((id) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mcard'; b.dataset.id = id;
      b.innerHTML = '<span class="front">?</span><span class="back"><svg><use href="#c' + id + '"/></svg></span>';
      b.onclick = () => {
        if (lock || b.classList.contains('open') || b.classList.contains('done')) return;
        b.classList.add('open'); S.tap();
        if (!first) { first = b; return; }
        moves--; $('memMoves').textContent = 'Moves left: ' + moves;
        const a = first; first = null;
        if (a.dataset.id === b.dataset.id) {
          a.classList.add('done'); b.classList.add('done'); found++; S.candy(+b.dataset.id, found);
          if (found === 6) setTimeout(() => finish(true), 500); else if (moves <= 0) setTimeout(() => finish(false), 500);
        } else {
          lock = true;
          setTimeout(() => { a.classList.remove('open'); b.classList.remove('open'); lock = false; if (moves <= 0) finish(false); }, 750);
        }
      };
      grid.appendChild(b);
    });
    $('memory').hidden = false;
  }
  /* candy toss */
  let tossRaf = 0;
  function stopToss() { cancelAnimationFrame(tossRaf); tossRaf = 0; }
  function startToss() {
    freshDay(); if (plays.toss >= MAX_PLAYS) return;
    plays.toss++; store.set('plays', plays); updateSides(); closeAll();
    $('tossMsg').textContent = 'Tap to toss when the jar is above the candy!'; $('tossClose').textContent = 'Give up'; $('toss').hidden = false;
    const cv = $('tossCv'), g = cv.getContext('2d'), W = cv.width = 270, H = cv.height = 330, img = new Image(); img.src = 'icons/candy.png';
    const JY = 64, JW = 64, SX = W / 2, SY = H - 46;
    let shot = 0, hits = 0, perfect = 0, flying = null, note = '', noteT = 0, over = false, t0 = performance.now(), lastT = t0, jx = W / 2;
    const jarPos = (t) => W / 2 + Math.sin(t / 1000 * (1.5 + shot * 0.5)) * (W / 2 - JW / 2 - 8);
    const end = () => {
      over = true; const reward = hits * 8 + perfect * 6; give({ coins: reward }); S.win(); updateSides();
      $('tossMsg').innerHTML = hits + ' in the jar! +' + reward + ' ' + coinSvg; $('tossClose').textContent = 'Done';
    };
    cv.onpointerdown = (e) => { e.preventDefault(); S.unlock(); if (over || flying) return; flying = { y: SY }; };
    function frame(now) {
      const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; if (!over) jx = jarPos(now - t0);
      if (flying) {
        flying.y -= 560 * dt;
        if (flying.y <= JY + 6) {
          const d = Math.abs(jx - SX);
          if (d <= JW / 2 - 6) { hits++; if (d <= 9) { perfect++; note = 'Perfect!'; } else note = 'Nice!'; S.candy(shot % 6, hits); buzz(15); } else { note = 'Miss'; S.tap(); }
          noteT = now; flying = null; shot++; if (shot >= 5) end();
        }
      }
      g.clearRect(0, 0, W, H);
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#9fe3ff'); bg.addColorStop(1, '#ffe3f4'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // jar
      g.fillStyle = 'rgba(255,255,255,.55)'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.moveTo(jx - JW / 2, JY - 16); g.lineTo(jx - JW / 2 + 6, JY + 34); g.quadraticCurveTo(jx, JY + 46, jx + JW / 2 - 6, JY + 34); g.lineTo(jx + JW / 2, JY - 16); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff5fa8'; g.fillRect(jx - JW / 2 - 4, JY - 22, JW + 8, 8);
      for (let i = 0; i < hits; i++) { g.fillStyle = ['#ffb347', '#7be37a', '#45d0ff', '#b07bff', '#ffe14d'][i % 5]; g.beginPath(); g.arc(jx - 18 + (i % 3) * 18, JY + 24 - Math.floor(i / 3) * 12, 8, 0, 7); g.fill(); }
      // candy and ground
      const cy = flying ? flying.y : SY; if (img.complete && img.naturalWidth) g.drawImage(img, SX - 18, cy - 18, 36, 36); else { g.fillStyle = '#ff5fa8'; g.beginPath(); g.arc(SX, cy, 14, 0, 7); g.fill(); }
      g.fillStyle = '#7be37a'; g.fillRect(0, H - 18, W, 18);
      g.fillStyle = '#4a1a8f'; g.font = '800 15px Baloo 2, sans-serif'; g.textAlign = 'left'; g.fillText('Candy ' + Math.min(shot + (flying ? 1 : 0), 5) + ' / 5', 10, H - 26);
      if (note && now - noteT < 900) { g.textAlign = 'center'; g.font = '800 26px Baloo 2, sans-serif'; g.fillStyle = '#ff3f66'; g.fillText(note, W / 2, H / 2); }
      tossRaf = requestAnimationFrame(frame);
    }
    stopToss(); tossRaf = requestAnimationFrame(frame);
  }
  function wireExtras() {
    $('medDaily').onclick = () => { S.unlock(); S.tap(); if (daily.last === today()) { alert('Daily Candy is done for today. Come back tomorrow!'); return; } transition(() => startDaily()); };
    $('medWheel').onclick = openWheel; $('medChest').onclick = openChest; $('medGames').onclick = openGames;
    $('navGifts').onclick = openGifts; $('navQuests').onclick = openQuests;
    $('navHome').onclick = () => { S.tap(); closeAll(); scrollToLevel(level); }; $('navShop').onclick = openShop; $('navRank').onclick = openRanking;
    $('walletMe').onclick = openProfile;
    $('wheelBtn').onclick = spinWheel; $('chestOpen').onclick = openChestNow;
    $('wheelClose').onclick = () => { S.tap(); if (!spinning) $('wheel').hidden = true; };
    $('chestClose').onclick = () => { S.tap(); $('chest').hidden = true; };
    $('questClose').onclick = () => { S.tap(); $('quests').hidden = true; };
    $('giftClose').onclick = () => { S.tap(); $('gifts').hidden = true; };
    $('gamesClose').onclick = () => { S.tap(); $('games').hidden = true; };
    $('memClose').onclick = () => { S.tap(); $('memory').hidden = true; updateSides(); };
    $('tossClose').onclick = () => { S.tap(); stopToss(); $('toss').hidden = true; updateSides(); };
  }
  wireExtras();
  syncSound();
  renderHome();
  scrollToLevel(level);
  if (!store.get('seenIntro', false)) showIntro();
  else if (!store.get('seenHow', false)) $('how').hidden = false;
  else maybeBonus();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
