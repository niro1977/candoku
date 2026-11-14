/* Candoku app: level map, play logic, hearts, hints, sound hooks, transitions. */
(function () {
  const E = window.CandokuEngine, H = window.CandokuHints, S = window.CandokuSound;
  const SEEDS = window.CandokuSeeds || { hard: {}, veryhard: {} };
  // vivid tiles, one per color region
  const COLORS = ['#22b8ff', '#7ee21f', '#ffd400', '#ff52c8', '#a45cff', '#00dcb0', '#ff8a00', '#ff3d3d', '#3a5cff', '#c98240'];
  const NAMES = ['Lollipop', 'Wrapped Candy', 'Chocolate Bar', 'Glazed Donut', 'Cupcake', 'Choc Chip Cookie', 'Cherries', 'Soft Serve', 'Shortcake', 'Candy Dango'];
  const starSvg = (on) => '<img class="star ' + (on ? '' : 'off') + '" src="art/star_' + (on ? 'gold' : 'grey') + '.webp" alt="" draggable="false">';
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
  const START_HINTS = 3, HINT_EVERY = 5, WAND_EVERY = 20;
  let items = Object.assign({ shield: 1, double: 0, sweeper: 1, lens: 1 }, store.get('items', {}));
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
  const tierOf = (lv) => (lv % 50 === 0 ? 'extreme' : lv % 10 === 0 ? 'veryhard' : lv % 5 === 0 ? 'hard' : 'normal');
  const dailySize = () => [6, 7, 8, 9, 10, 8, 7][new Date().getDay()];
  const tierLabel = { hard: 'Hard', veryhard: '👑 Very Hard', extreme: '💀 Extremely Hard' };

  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  let hapticOn = store.get('haptic', true);
  function buzz(p) { try { if (hapticOn && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  document.addEventListener('pointerdown', (e) => { if (hapticOn && e.target.closest && e.target.closest('button,.cell,.node,.bcard,.mcard,.med,.chip,.colcell,.bst')) { try { if (navigator.vibrate) navigator.vibrate(7); } catch (_) {} } }, true);
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
  const WORLD_HUES = [178, 330, 270, 140, 215, 8, 300, 45, 100, 195];   // same colors as the world ribbons
  const MAP_STEP = 96, WORLD_GAP = 96;
  function mapGeom() {
    const W = Math.min(window.innerWidth, 460) - 32;
    const count = ZONES.length * 10;   // every level of every world is on the map from the start
    const Ht = count * MAP_STEP + (count / 10) * WORLD_GAP + 150;   // a clear band between worlds holds the title ribbon
    return { W, count, Ht, pos: (lv) => ({ x: W / 2 + Math.sin((lv - 1) * 0.9) * W * 0.2, y: Ht - 140 - (lv - 1) * MAP_STEP - Math.floor((lv - 1) / 10) * WORLD_GAP }) };
  }
  /* ---------- illustrated worlds: a new landscape every 10 levels ---------- */
  const ZONES = [
    { name: 'Lollipop Meadow' },
    { name: 'Chocolate River' },
    { name: 'Frosting Mountains' },
    { name: 'Cotton Candy Sky' },
    { name: 'Ice Cream Beach' },
    { name: 'Gingerbread Winter' },
    { name: 'Donut Lake' },
    { name: 'Cookie Canyon' },
    { name: 'Crystal Caves' },
    { name: 'Jelly Jungle' },
    { name: 'Cupcake Village' },
    { name: 'Candy Cane Forest' },
    { name: 'Caramel Falls' },
    { name: 'Carnival Fairground' },
    { name: 'Macaron Mesa' },
    { name: 'Waffle Castle' },
    { name: 'Soda Springs' },
    { name: 'Honey Hive Hills' },
    { name: 'Berry Bog' },
    { name: 'Mint Mountain' },
    { name: 'Licorice Night Market' },
    { name: 'Sugar Dunes Oasis' },
    { name: 'Pudding Pools' },
    { name: 'Cinnamon Autumn Forest' },
    { name: 'Starlight Sprinkle Galaxy' },
    { name: 'Toffee Treehouse Village' },
    { name: 'Gumdrop Garden' },
    { name: 'Royal Cake Palace' },
    { name: 'Rainbow Sherbet Glacier' },
    { name: 'Sweet Kingdom Gate' }
  ];
  const ASPECT = { 'd-lolly': [0.6, 1], 'd-bush': [1, 0.6], 'd-cane': [0.5, 1], 'd-cloud': [2, 1], 'd-house': [1, 1], 'd-cone': [0.85, 1.15], 'd-choco': [0.8, 1], 'd-star': [1, 1] };
  const zoneOf = (lv) => ZONES[Math.floor((lv - 1) / 10) % ZONES.length];
  const hashn = (n) => Math.imul(n + 17, 2654435761) >>> 0;
  function worldHtml(g) {
    let html = '';
    const zones = Math.ceil(g.count / 10);
    const edge = (k) => (k <= 0 ? g.Ht : k >= zones ? 0 : g.pos(k * 10 + 1).y + (MAP_STEP + WORLD_GAP) / 2);   // where world k begins
    for (let k = 0; k < zones; k++) {
      const top = edge(k + 1), bottom = edge(k);
      html += '<div class="zone" style="top:' + top + 'px;height:' + (bottom - top) + 'px;background:#2a1450 center/cover no-repeat" data-bg="art/bg_' + (k % ZONES.length) + '.jpg"></div>';
    }
    for (let k = 0; k < zones; k++) {
      const z = ZONES[k % ZONES.length], cy = g.pos(k * 10 + 1).y + (MAP_STEP + WORLD_GAP) / 2;
      html += '<div class="ribbon" style="background-image:url(art/ribbon_' + (k % 10) + '.webp);top:' + Math.round(cy) + 'px"><span><small>WORLD ' + (k + 1) + '</small><b>' + z.name + '</b></span></div>';
    }
    return html;
  }

  let zoneObs = null;
  function lazyZones() {   // a world's painting is fetched only when it is about to scroll into view
    const els = document.querySelectorAll('.zone[data-bg]');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => { e.style.backgroundImage = 'url(' + e.dataset.bg + ')'; }); return; }
    if (zoneObs) zoneObs.disconnect();
    zoneObs = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.style.backgroundImage = 'url(' + en.target.dataset.bg + ')'; zoneObs.unobserve(en.target); } }), { rootMargin: '900px 0px' });
    els.forEach((e) => zoneObs.observe(e));
  }
  function renderHome() {
    const t = today();
    $('dailyInfo').textContent = daily.last === t ? 'Solved today ✓ come back tomorrow' : dailySize() + '×' + dailySize() + ' · new board today';
    renderScore(); updateHintUi(); updateSides();
    $('streak').textContent = daily.streak > 1 ? '🔥 ' + daily.streak + ' day streak' : '';
    const map = $('map'), g = mapGeom();
    map.innerHTML = ''; map.style.height = g.Ht + 'px';
    map.insertAdjacentHTML('beforeend', worldHtml(g)); lazyZones();
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
      if (tier === 'normal') { const hue = WORLD_HUES[Math.floor((lv - 1) / 10) % 10]; b.style.setProperty('--c', 'hsl(' + hue + ',78%,50%)'); b.style.setProperty('--cb', 'hsl(' + hue + ',85%,88%)'); }
      let html = lv + '<small>' + n + '×' + n + '</small>';
      if (tier !== 'normal') html += '<span class="badge">' + (tier === 'hard' ? 'HARD' : tier === 'extreme' ? 'EXTREME' : 'VERY HARD') + '</span>';
      if (lv < level && stars[lv]) { html += '<span class="st">'; for (let i = 1; i <= 3; i++) html += starSvg(i <= stars[lv]); html += '</span>'; }
      b.innerHTML = html;
      b.onclick = () => { S.unlock(); S.tap(); openPrelevel(lv); };
      map.appendChild(b);
      if (lv === (mascotAt || level)) map.insertAdjacentHTML('beforeend', '<div class="mascot" style="left:' + p.x + 'px;top:' + (p.y - 30) + 'px"><svg><use href="#gumi"/></svg></div>');
    }
  }
  function scrollToLevel(lv) {
    const g = mapGeom(), map = $('map');
    const y = map.getBoundingClientRect().top + window.scrollY + g.pos(lv).y;
    window.scrollTo(0, Math.max(0, y - window.innerHeight * 0.55));
  }
  let pendingHop = null;   // set when a win moves you on, played the next time the map is shown
  let mascotAt = 0;   // while set, the bear is drawn on this level instead of the current one
  async function hopTo(from, to) {
    // our bear jumps from the level you just passed to the next one and stands there
    const g = mapGeom(), a = g.pos(from), b = g.pos(to), map = $('map'), still = map.querySelector('.mascot');
    if (still) still.style.visibility = 'hidden';
    const h = document.createElement('div'); h.className = 'hopper gumi';
    h.style.left = a.x + 'px'; h.style.top = (a.y - 30) + 'px'; h.innerHTML = '<svg><use href="#gumi"/></svg>';
    map.appendChild(h);
    const dx = b.x - a.x, dy = b.y - a.y;
    S.hop();
    const anim = h.animate([
      { transform: 'translate(0,0) scale(1,1)' },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 90) + 'px) scale(1.08,1.16)', offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.16,.84)', offset: 0.88 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1,1)' }
    ], { duration: 900, easing: 'cubic-bezier(.35,.1,.3,1)', fill: 'forwards' });
    await anim.finished.catch(() => {});
    S.candy((to - 1) % 10, 3); buzz(15);
    const node = map.querySelector('.node[data-lv="' + to + '"]');
    if (node) node.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 400 });
    if (still) still.style.visibility = '';
    h.remove();
    mascotAt = 0; await sleep(260);
  }

  /* ---------- boards ---------- */
  function boardFor(lv) {
    const n = sizeFor(lv), tier = tierOf(lv);
    if (tier !== 'normal') {
      const pool = (SEEDS[tier] || {})[n];
      if (pool && pool.length) return E.generate(n, pool[Math.floor(lv / (tier === 'hard' ? 5 : tier === 'extreme' ? 50 : 10)) % pool.length]);
    }
    // normal levels: skip boards that would need guessing
    let b = null;
    for (let k = 0, tries = n >= 9 ? 2 : 6; k < tries; k++) {
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
    bd.classList.toggle('n10', n >= 9); bd.parentElement.classList.toggle('n10', n >= 9); $('game').classList.toggle('n10', n >= 9);
    $('maybeBtn').setAttribute('aria-pressed', 'false');
    $('lose').hidden = true; $('win').hidden = true; $('toast').classList.remove('show');
    buildBoard(); drawHearts(); drawFound();
  }
  const worldIdx = (lv) => Math.floor((lv - 1) / 10) % ZONES.length;
  function sparkField(box, n) {
    if (!box || box.querySelector('.sparkfield')) return;
    const f = document.createElement('div'); f.className = 'sparkfield';
    for (let k = 0; k < n; k++) { const e = document.createElement('i'); e.style.cssText = '--x:' + Math.round(Math.random() * 100) + '%;--d:' + (9 + Math.random() * 11).toFixed(1) + 's;--dx:' + Math.round(Math.random() * 80 - 40) + 'px;--s:' + (3 + Math.random() * 5).toFixed(1) + 'px;animation-delay:-' + (Math.random() * 18).toFixed(1) + 's'; f.appendChild(e); }
    box.appendChild(f);
  }
  function setScene(i, tier) {
    const box = $('scene');
    if (box) {
      box.style.setProperty('--bgimg', 'url(art/bg_' + i + '.jpg)'); box.dataset.world = i;
      box.classList.toggle('dark', !!tier && tier !== 'normal');   // special levels play on black
      sparkField(box, 22);
    }
    if (M) M.world(i);
  }
  /* ---------- keep the game in progress: leaving at any moment returns to the exact same board ---------- */
  function saveGame() {
    try {
      if (!cur || cur.done || !cur.meta) { store.set('game', null); return; }
      store.set('game', { shield: !!cur.shield, double: !!cur.double, meta: cur.meta, tier: cur.tier, label: cur.label, n: cur.n, state: cur.state, hearts: cur.hearts, hints: cur.hints,
        wrong: [...cur.wrongMarks], pen: [...cur.penalized], saved: Date.now() });
    } catch (e) {}
  }
  function applySaved(g) {
    if (!g || g.n !== cur.n || !Array.isArray(g.state) || g.state.length !== cur.n) return false;
    cur.shield = !!g.shield; cur.double = !!g.double;
    cur.state = g.state.map((r) => r.slice()); cur.hearts = g.hearts; cur.hints = g.hints || 0;
    cur.wrongMarks = new Set(g.wrong || []); cur.penalized = new Set(g.pen || []);
    cur.foundPrev = new Set(); for (let y = 0; y < cur.n; y++) for (let x = 0; x < cur.n; x++) if (cur.state[y][x] === 2) cur.foundPrev.add(cur.regions[y][x]);
    drawHearts(); paint(); drawFound();
    return true;
  }
  const savedFor = (meta) => { const g = store.get('game', null); if (!g || !g.meta || g.meta.kind !== meta.kind) return null; return (meta.kind === 'level' ? g.meta.level === meta.level : g.meta.date === meta.date) ? g : null; };
  /* ---------- the card shown before a level ---------- */
  let pendingBoost = null, preSpoken = false;
  function openPrelevel(lv, after) {
    const n = sizeFor(lv), tier = tierOf(lv), best = stars[lv] || 0, resume = !!savedFor({ kind: 'level', level: lv });
    $('plTitle').textContent = 'Level ' + lv;
    const t = $('plTier'); t.hidden = tier === 'normal'; t.className = 'pl-tier ' + tier; t.textContent = tierLabel[tier] || '';
    $('plStars').innerHTML = [1, 2, 3].map((i) => '<span class="slot"><img class="star ' + (i <= best ? '' : 'off') + '" src="art/star_' + (i <= best ? 'gold' : 'grey') + '.webp" alt="" draggable="false"></span>').join('');
    $('plInfo').textContent = n + '×' + n + ' board · ' + n + ' candies to find' + (best ? '' : ' · first time!');
    $('plRow').innerHTML = '<span class="chip"><img src="art/ic_heart.webp" alt="" draggable="false"><b>' + MAX_HEARTS + '</b></span><span class="chip"><img src="art/ic_hint.webp" alt="" draggable="false"><b>' + hintsLeft + '</b></span><span class="chip"><img src="art/ic_wand.webp" alt="" draggable="false"><b>' + wands + '</b></span>';
    $('plPlay').textContent = resume ? 'Continue' : 'Play';
    const pick = { shield: false, double: false }, bx = $('plBoost');
    const drawBoost = () => { bx.innerHTML = resume ? '' : ['shield', 'double'].map((k) => '<button type="button" class="bst' + (pick[k] ? ' on' : '') + (items[k] > 0 ? '' : ' none') + '" data-k="' + k + '"><img src="art/ic_' + k + '.webp" alt="" draggable="false"><span>' + (k === 'shield' ? 'Shield' : 'x2 Points') + '</span><i>' + items[k] + '</i></button>').join('');
      bx.querySelectorAll('.bst').forEach((b) => { b.onclick = () => { const k = b.dataset.k; if (items[k] <= 0) { toast('You have none. Buy one in the shop!'); return; } pick[k] = !pick[k]; S.tap(); drawBoost(); }; }); };
    drawBoost();
    $('plPlay').onclick = () => { S.unlock(); S.tap(); $('prelevel').hidden = true; preSpoken = true; pendingBoost = { shield: pick.shield && items.shield > 0, double: pick.double && items.double > 0 }; if (after) after(); else transition(() => startLevel(lv)); };
    $('prelevel').hidden = false;
    if (V) setTimeout(() => V.say(tier === 'normal' ? 'ready' : tier === 'extreme' ? 'veryhard' : tier, true), 350);
  }
  function startLevel(lv) {
    setScene(worldIdx(lv), tierOf(lv));
    const b = boardFor(lv);
    makeGame(b, 'Level ' + lv, { kind: 'level', level: lv }, tierOf(lv));
    const resumed = applySaved(savedFor(cur.meta));
    if (!resumed && pendingBoost) { if (pendingBoost.shield) { items.shield--; cur.shield = true; } if (pendingBoost.double) { items.double--; cur.double = true; } saveWallet(); updateHintUi(); }
    pendingBoost = null;
    show('game');
    if (resumed) setTimeout(() => toast('Welcome back! Continuing where you left off.'), 500);
    if (cur.shield) setTimeout(() => toast('🛡 Heart Shield is on!'), 900);
    if (V && !preSpoken) setTimeout(() => V.start(lv, tierOf(lv)), 700);
    preSpoken = false;
    if (lv % 10 === 0) setTimeout(() => toast('👑 Boss level! Beat it for a big prize.'), 1200);
    if (lv === 1 && (forceCoach || !store.get('seenCoach', false))) setTimeout(startCoach, 1000);
    if (lv > 1 && sizeFor(lv) > sizeFor(lv - 1)) {
      const id = sizeFor(lv) - 1;
      $('unlockIcon').innerHTML = '<use href="#c' + id + '"/>'; $('unlockName').textContent = NAMES[id];
      const u = $('unlock'); u.hidden = true; void u.offsetWidth; u.hidden = false;
      setTimeout(() => { u.hidden = true; }, 3300);
    }
  }
  function startDaily() {
    const t = today(), n = dailySize();
    setScene(new Date().getDate() % ZONES.length, 'normal');
    makeGame(E.generate(n, hash('candoku-' + t)), 'Daily Candy', { kind: 'daily', date: t }, 'normal');
    const resumed = applySaved(savedFor(cur.meta));
    show('game');
    if (resumed) setTimeout(() => toast('Welcome back! Continuing where you left off.'), 500);
  }
  function drawHearts() {
    const h = $('hearts'); h.innerHTML = '';
    for (let i = 0; i < MAX_HEARTS; i++) h.insertAdjacentHTML('beforeend', '<img class="' + (i < cur.hearts ? '' : 'off') + '" src="art/ic_' + (i < cur.hearts ? 'heart' : 'heart_off') + '.webp" alt="" draggable="false">');
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
    const n = cur.n; setTimeout(saveGame, 0);
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

  /* ---------- effects ---------- */
  const PRAISE = ['Sweet!', 'Yummy!', 'Tasty!', 'Nice!', 'Delicious!', 'Super!', 'Great!'];
  let praiseN = 0;
  function fxLayer() { let l = $('fx'); if (!l) { l = document.createElement('div'); l.id = 'fx'; document.body.appendChild(l); } return l; }
  function burstAt(el, strong) {
    if (!el) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, L = fxLayer();
    const col = getComputedStyle(el).backgroundColor || '#fff';
    const ring = document.createElement('i'); ring.className = 'fx-ring'; ring.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;border-color:' + col; L.appendChild(ring); setTimeout(() => ring.remove(), 700);
    const cols = ['#ffffff', '#ffe14d', col, '#ff8fd0', '#7fe3ff'], n = strong ? 22 : 12;
    for (let k = 0; k < n; k++) {
      const p = document.createElement('i'), ang = (k / n) * 6.283 + Math.random() * 0.5, dist = (strong ? 70 : 46) + Math.random() * 40, sz = 5 + Math.random() * 6;
      p.className = 'fx-p'; p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:' + sz + 'px;height:' + sz + 'px;background:' + cols[k % cols.length] + ';--dx:' + Math.cos(ang) * dist + 'px;--dy:' + (Math.sin(ang) * dist - 10) + 'px';
      L.appendChild(p); setTimeout(() => p.remove(), 850);
    }
  }
  function praiseWord(text, big) {
    const bd = $('board'); if (!bd) return;
    const r = bd.getBoundingClientRect(), L = fxLayer(), w = document.createElement('div');
    w.className = 'fx-word' + (big ? ' big' : ''); w.textContent = text; w.style.left = (r.left + r.width / 2) + 'px'; w.style.top = (r.top + r.height * 0.42) + 'px';
    L.appendChild(w); setTimeout(() => w.remove(), 1200);
  }
  function bearReact(kind) {
    const g = $('hearts'), t = g && g.parentElement; if (!t) return;
    t.classList.remove('react-happy', 'react-sad'); void t.offsetWidth; t.classList.add(kind === 'sad' ? 'react-sad' : 'react-happy');
  }
  function placedFx(y, x, pc) {
    const el = cellEl(y, x), last = pc === cur.n;
    burstAt(el, last); S.place(pc); bearReact('happy');
    if (last) { praiseWord('Perfect!', true); S.praise(2); }
    else if (pc === 1 || pc % 2 === 0) { praiseWord(PRAISE[praiseN++ % PRAISE.length]); S.praise(Math.floor(pc / 3)); }
  }
  function tap(y, x, maybe, candy) {
    if (cur.done) return;
    if (cur.lensArmed) { lensPeek(y, x); return; }
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
      bearReact('sad');
      if (cur.penalized.has(k)) { S.wrong(); buzz([20, 20]); const el = cellEl(y, x); el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
      else { cur.penalized.add(k); mistake(y, x); }
      return;
    }
    cur.wrongMarks.delete(k);
    snapshot();
    cur.state[y][x] = ns;
    if (ns === 2) {
      buzz(14); const pc = placedCount(); S.candy(cur.regions[y][x], pc); placedFx(y, x, pc);
      if (V) { if (pc === 1) V.first(); else if (Math.random() < 0.22) V.praise(); }
    }
    else if (ns === 1) { buzz(5); S.x(); }
    else S.tap();
    paint();
    if (solved()) win();
  }
  function mistake(y, x) {
    if (cur.shield) { cur.shield = false; toast('🛡 The shield saved your heart!'); S.hint(); buzz([20, 20]); bearReact('happy'); saveGame(); return; }
    cur.hearts--; buzz([40, 30, 40]); S.wrong();
    const el = cellEl(y, x); el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong');
    const h = $('hearts'); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit');
    drawHearts(); saveGame();
    if (cur.hearts <= 0) { cur.done = true; saveGame(); freshScore(); score.run = 0; store.set('score', score); setTimeout(() => { S.lose(); if (V) V.lose(); $('lose').hidden = false; }, 500); }
  }
  function solved() {
    const n = cur.n, pos = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cur.state[y][x] === 2) pos.push([y, x]);
    if (pos.length !== n) return false;
    if (new Set(pos.map((p) => p[0])).size !== n || new Set(pos.map((p) => p[1])).size !== n || new Set(pos.map((p) => cur.regions[p[0]][p[1]])).size !== n) return false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(pos[i][0] - pos[j][0]) <= 1 && Math.abs(pos[i][1] - pos[j][1]) <= 1) return false;
    return true;
  }
  function undo() { if (cur.done || !cur.history.length) return; S.tap(); cur.state = cur.history.pop(); paint(); }

  let toastTimer = null;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }
  /* ---------- wallet: coins, hints, wands, helpers ---------- */
  function give(p) { coins += p.coins || 0; hintsLeft += p.hints || 0; wands += p.wands || 0; ['shield', 'double', 'sweeper', 'lens'].forEach((k) => { items[k] += p[k] || 0; }); saveWallet(); updateHintUi(); }
  const coinSvg = '<img class="ico" src="art/ic_coin.webp" alt="" draggable="false">';
  function saveWallet() { store.set('coins', coins); store.set('wands', wands); store.set('hints', hintsLeft); store.set('items', items); }
  function updateHintUi() {
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('heartN', MAX_HEARTS); set('hintBadge', hintsLeft); set('wandBadge', wands); set('coinN', coins); set('hintN', hintsLeft); set('wandN', wands);
    $('hintBtn').classList.toggle('empty', hintsLeft <= 0); $('wandBtn').classList.toggle('empty', wands <= 0);
    set('sweepBtnBadge', items.sweeper); set('lensBtnBadge', items.lens); $('sweepBtn').classList.toggle('empty', items.sweeper <= 0); $('lensBtn').classList.toggle('empty', items.lens <= 0);
  }
  const ITEMS = {
    hint: { name: 'Hint', icon: 'hint', price: 30,
      desc: 'A hint finds a square where an X surely belongs and marks it for you, and tells you why. It places a candy only when that is the last choice left.',
      count: () => hintsLeft, add: (n) => { hintsLeft += n; }, run: () => hint(),
      earn: () => { const t = HINT_EVERY - (cleared % HINT_EVERY); return 'You win 1 free hint for every ' + HINT_EVERY + ' levels you pass (' + t + ' more to go), and in the Daily Bonus.'; } },
    wand: { name: 'Magic Wand', icon: 'wand', price: 60,
      desc: 'The wand puts one correct candy on the board for you, with no risk. Use it when you are really stuck.',
      count: () => wands, add: (n) => { wands += n; }, run: () => useWand(),
      earn: () => { const t = WAND_EVERY - (cleared % WAND_EVERY); return 'You win a free wand every ' + WAND_EVERY + ' levels you pass (' + t + ' more to go), in the Daily Bonus, or buy one with coins.'; } }
  };
  ITEMS.shield = { name: 'Heart Shield', icon: 'shield', price: 45, count: () => items.shield, add: (n) => { items.shield += n; },
    desc: 'Pick it before a level starts. The first mistake of that level will not cost you a heart.', run: () => toast('Pick the shield on the screen before a level starts.'),
    earn: () => 'Won in the Daily Bonus, the lucky wheel, chests and boss levels, or buy one with coins.' };
  ITEMS.double = { name: 'Double Points', icon: 'double', price: 50, count: () => items.double, add: (n) => { items.double += n; },
    desc: 'Pick it before a level starts. That level gives you double points for the daily ranking.', run: () => toast('Pick the x2 on the screen before a level starts.'),
    earn: () => 'Won in the lucky wheel and chests, or buy one with coins.' };
  ITEMS.sweeper = { name: 'Sweeper', icon: 'sweeper', price: 40, count: () => items.sweeper, add: (n) => { items.sweeper += n; }, run: () => useSweeper(),
    desc: 'The sweeper marks an X on every square that cannot hold a candy because of the candies you already placed: same row, same column, same color and the squares around them.',
    earn: () => 'Won in the Daily Bonus, quests and chests, or buy one with coins.' };
  ITEMS.lens = { name: 'Magnifier', icon: 'lens', price: 35, count: () => items.lens, add: (n) => { items.lens += n; }, run: () => armLens(),
    desc: 'Tap the magnifier, then tap any square. It tells you the truth: a candy goes there, or it gets an X.',
    earn: () => 'Won in the Daily Bonus, the lucky wheel and boss levels, or buy one with coins.' };
  let itemKind = 'hint';
  function openItemInfo(kind) {
    if (!cur || cur.done) return;
    S.unlock(); S.tap(); itemKind = kind;
    const it = ITEMS[kind], n = it.count();
    $('itemIcon').src = 'art/ic_' + it.icon + '.webp';
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
    else if (coins >= it.price) { coins -= it.price; it.add(1); saveWallet(); updateHintUi(); S.ui('buy', 1, 1); S.ui('coin', 1, 0.9); openItemInfo(itemKind); }
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
    if (h.type === 'candy') { const [y, x] = h.cells[0]; S.candy(cur.regions[y][x], placedCount()); placedFx(y, x, placedCount()); } else S.hint();
    if (solved()) win();
  }
  /* ---------- sweeper and magnifier ---------- */
  function useSweeper() {
    if (!cur || cur.done || items.sweeper <= 0) return;
    const n = cur.n, mark = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cur.state[y][x] === 2) {
      const reg = cur.regions[y][x];
      for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
        if (cur.state[yy][xx] !== 0 && cur.state[yy][xx] !== 3) continue;
        if (yy === y || xx === x || cur.regions[yy][xx] === reg || (Math.abs(yy - y) <= 1 && Math.abs(xx - x) <= 1)) mark.push([yy, xx]);
      }
    }
    if (!mark.length) { toast('Place a candy first, then sweep!'); return; }   // nothing is spent
    items.sweeper--; saveWallet(); updateHintUi(); snapshot();
    mark.forEach(([yy, xx], k) => { cur.state[yy][xx] = 1; cur.wrongMarks.delete(yy + ',' + xx); setTimeout(() => { const el = cellEl(yy, xx); el.classList.remove('hinted'); void el.offsetWidth; el.classList.add('hinted'); }, Math.min(k * 14, 500)); });
    paint(); toast('🧹 Swept ' + mark.length + ' square' + (mark.length > 1 ? 's' : '') + '!'); buzz(18); S.hint(); S.praise(1);
  }
  function armLens() {
    if (!cur || cur.done || items.lens <= 0) return;
    cur.lensArmed = true; $('board').classList.add('lens'); toast('🔍 Tap a square to peek at the truth');
  }
  function lensPeek(y, x) {
    cur.lensArmed = false; $('board').classList.remove('lens');
    items.lens--; saveWallet(); updateHintUi(); snapshot(); const k = y + ',' + x;
    if (cur.solution[y] === x) { cur.state[y][x] = 2; cur.wrongMarks.delete(k); paint(); toast('✅ Yes! A candy goes right here'); const pc = placedCount(); S.candy(cur.regions[y][x], pc); placedFx(y, x, pc); if (solved()) win(); }
    else { cur.state[y][x] = 1; cur.wrongMarks.delete(k); paint(); toast('❌ Not here. Marked with an X'); S.x(); }
    buzz(16);
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
    toast('✨ The wand placed a candy for you!'); buzz(20); S.candy(cur.regions[y][x], placedCount()); placedFx(y, x, placedCount());
    if (solved()) win();
  }
  /* ---------- daily bonus: pick one of nine cards ---------- */
  const PRIZES = [
    { id: 'c10', w: 30, coins: 10 }, { id: 'c25', w: 20, coins: 25 }, { id: 'c50', w: 9, coins: 50, rare: 1 }, { id: 'c100', w: 2, coins: 100, rare: 1 },
    { id: 'h1', w: 22, hints: 1 }, { id: 'h2', w: 8, hints: 2, rare: 1 }, { id: 'w1', w: 9, wands: 1, rare: 1 },
    { id: 's1', w: 10, shield: 1 }, { id: 'k1', w: 10, sweeper: 1 }, { id: 'l1', w: 10, lens: 1 }, { id: 'd1', w: 5, double: 1, rare: 1 }
  ];
  function rollPrize(streak, onlyRare) {
    const list = PRIZES.filter((p) => !onlyRare || p.rare);
    const wt = list.map((p) => p.w * (p.rare ? 1 + Math.min(streak, 10) * 0.12 : 1));
    let r = Math.random() * wt.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= wt[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  const PICO = { coins: 'coin', hints: 'hint', wands: 'wand', shield: 'shield', double: 'double', sweeper: 'sweeper', lens: 'lens' };
  const PNAME = { coins: 'coin', hints: 'hint', wands: 'magic wand', shield: 'heart shield', double: 'double-points booster', sweeper: 'sweeper', lens: 'magnifier' };
  const prizeKeys = (p) => Object.keys(PICO).filter((k) => p[k]);
  function prizeHtml(p) {
    return prizeKeys(p).map((k) => '<img class="pico" src="art/ic_' + PICO[k] + '.webp" alt="" draggable="false"><b>+' + p[k] + '</b>').join('');
  }
  function prizeText(p) { return prizeKeys(p).map((k) => p[k] + ' ' + PNAME[k] + (p[k] > 1 && k !== 'coins' ? 's' : '') + (k === 'coins' && p[k] > 1 ? 's' : '')).join(' and '); }
  /* every prize pops up with a message and the narrator, one after another */
  const rewardQueue = []; let rewardOpen = false;
  function announce(p, title, big, html) {
    rewardQueue.push({ p, title, big, html }); if (!rewardOpen) nextReward();
  }
  function nextReward() {
    const r = rewardQueue.shift(); if (!r) { rewardOpen = false; return; }
    rewardOpen = true;
    $('rwTitle').textContent = r.title || 'You got a prize!';
    const kk = prizeKeys(r.p);
    $('rwItems').innerHTML = (r.html || '') + kk.map((k, n) => '<div class="rw-it" style="animation-delay:' + (0.25 + n * 0.18) + 's"><img src="art/ic_' + PICO[k] + '.webp" alt="" draggable="false"><b>+' + r.p[k] + '</b></div>').join('');
    $('rwText').textContent = kk.length ? 'Your ' + prizeText(r.p) + ' will be added to your bag.' : (r.html ? 'Find it in My Collection (Profile).' : '');
    $('reward').hidden = false; S.win(); buzz([25, 30, 45]);
    if (V) setTimeout(() => V.say(r.big ? 'bigreward' : r.p.wands ? 'wandget' : ['reward1', 'reward2', 'reward3'][Math.floor(Math.random() * 3)], true), 350);
  }
  function giveReward(p, title, big) { give(p); announce(p, title, big); }
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
        give(prize);
        b.querySelector('.back').innerHTML = prizeHtml(prize); b.classList.add('open', 'mine'); S.ui('flip', 1, 1); S.win(); buzz([20, 30, 40]);
        $('bonusMsg').textContent = 'You won ' + prizeText(prize) + '!';
        $('bonusStreak').textContent = '🔥 Day ' + streak + (streak % 7 === 0 ? ' · big prize day!' : ' · come back tomorrow for more');
        // the other cards show what they hid
        [...grid.children].forEach((c, k) => { if (c === b) return; setTimeout(() => { c.querySelector('.back').innerHTML = prizeHtml(rollPrize(streak, false)); c.classList.add('open', 'dim'); S.ui('flip', 0.9 + (k % 4) * 0.08, 0.7); }, 450 + k * 90); });
        setTimeout(() => { $('bonusClaim').hidden = false; announce(prize, streak % 7 === 0 ? 'Big prize day!' : 'Daily Bonus!', streak % 7 === 0); }, 1500);
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
      + '<div><b>' + coinSvg + ' ' + coins + '</b><small>Coins</small></div>'
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
    for (const k of ['hint', 'wand', 'shield', 'double', 'sweeper', 'lens']) {
      const it = ITEMS[k], row = document.createElement('div'); row.className = 'shoprow';
      row.innerHTML = '<img class="pico" src="art/ic_' + it.icon + '.webp" alt="" draggable="false"><span><b>' + it.name + '</b><small>you have ' + it.count() + '</small></span>';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy'; b.innerHTML = it.price + ' ' + coinSvg; b.disabled = coins < it.price;
      b.onclick = () => { if (coins < it.price) return; coins -= it.price; it.add(1); saveWallet(); updateHintUi(); S.ui('buy', 1, 1); S.ui('coin', 1, 0.9); openShop(); };
      row.appendChild(b); list.appendChild(row);
    }
    $('shop').hidden = false;
  }
  function restart() { if (cur.done) return; S.tap(); snapshot(); cur.state = cur.state.map((r) => r.map(() => 0)); cur.wrongMarks.clear(); cur.foundPrev = new Set(); paint(); }

  /* ---------- win ---------- */
  function win() {
    cur.done = true; saveGame(); buzz([30, 40, 60]); S.win();
    if (V) setTimeout(() => V.win(cur.hearts), 3100);   // after the three stars have landed
    const m = cur.meta, earned = Math.max(1, cur.hearts);
    let reward = false, wandReward = false;
    freshScore();
    score.run++;
    const pt = pointsFor(cur.n, score.run); if (cur.double) { pt.gain *= 2; pt.mult = pt.mult + '×2 booster'; }
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
        level = m.level + 1; store.set('level', level); pendingHop = { from: m.level, to: level };
        cleared++; store.set('cleared', cleared);                       // only a first-time pass counts toward the reward
        if (cleared % HINT_EVERY === 0) { give({ hints: 1 }); reward = true; setTimeout(() => announce({ hints: 1 }, 'Level reward!'), 3600); }
        checkUnlocks(m);
        if (cleared % WAND_EVERY === 0) { give({ wands: 1 }); wandReward = true; setTimeout(() => announce({ wands: 1 }, 'Big level reward!', true), 4200); }
      }
    } else if (m.kind === 'daily' && daily.last !== m.date) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yd = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
      daily = { last: m.date, streak: daily.last === yd ? daily.streak + 1 : 1 }; store.set('daily', daily);
    }
    let st = ''; for (let i = 1; i <= 3; i++) st += starSvg(i <= earned);
    $('winStars').innerHTML = st;
    $('winInfo').textContent = cur.n + '×' + cur.n + (cur.tier !== 'normal' ? ' ' + tierLabel[cur.tier] : '') + ' solved' + (cur.hints ? ' · ' + cur.hints + ' hint' + (cur.hints > 1 ? 's' : '') : ' · no hints');
    const wr = $('winReward');
    if (wandReward) { wr.hidden = false; wr.innerHTML = '🪄 Big reward! <b>+1 magic wand</b> for passing ' + WAND_EVERY + ' levels' + (reward ? '<br>🎁 and +1 hint' : ''); }
    else if (reward) { wr.hidden = false; wr.innerHTML = '🎁 Reward! <b>+1 hint</b> for passing ' + HINT_EVERY + ' levels · wand in ' + (WAND_EVERY - (cleared % WAND_EVERY)) + ' more'; }
    else if (m.kind === 'level') { wr.hidden = false; wr.textContent = (cleared % HINT_EVERY) + ' / ' + HINT_EVERY + ' levels to a free hint · wand in ' + (WAND_EVERY - (cleared % WAND_EVERY)) + ' more'; }
    else wr.hidden = true;
    if (m.kind === 'level' && m.level % 10 === 0) {
      const flawless = cur.hearts >= MAX_HEARTS, bp = { coins: flawless ? 100 : 60, wands: 1, hints: flawless ? 2 : 0, shield: 1, lens: flawless ? 1 : 0 };
      give(bp); setTimeout(() => announce(bp, '👑 Boss defeated!', true), 3600); wr.hidden = false;
      wr.innerHTML = '👑 Boss defeated! Prizes: ' + prizeText(bp) + (flawless ? '' : '<br><small>No hearts lost = an even bigger prize!</small>');
    }
    updateHintUi();
    $('nextBtn').textContent = m.kind === 'level' ? 'Next level' : 'Back to map';
    setTimeout(() => {
      $('win').hidden = false; confetti();
      const els = $('winStars').querySelectorAll('img.star');
      const box = $('winStars'), card = document.querySelector('#win .card');
      const burst = (el, good) => {
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), cx = r.left - b.left + r.width / 2, cy = r.top - b.top + r.height / 2;
        const cols = ['#ffe14d', '#ffffff', '#ffb347', '#ff8fd0', '#7fe3ff'];
        for (let n = 0; n < (good ? 14 : 4); n++) {
          const p = document.createElement('i'), ang = Math.random() * 6.283, dist = 34 + Math.random() * 40;
          p.className = 'spark'; p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = cols[n % cols.length];
          p.style.setProperty('--dx', Math.cos(ang) * dist + 'px'); p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
          box.appendChild(p); setTimeout(() => p.remove(), 800);
        }
      };
      els.forEach((el, k) => {
        const t0 = 500 + k * 640, good = k + 1 <= earned;
        setTimeout(() => { el.classList.add('show'); S.starIn(); }, t0);
        setTimeout(() => {
          S.star(k + 1, good); buzz(good ? 18 : 8); burst(el, good);
          if (card && card.animate) card.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(6px)' }, { transform: 'translateY(0)' }], { duration: 190, easing: 'ease-out' });
          if (k === 2 && earned === 3) setTimeout(() => S.fanfare(), 160);
        }, t0 + 420);
      });
    }, 450);
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
  const logoHtml = () => '<div class="logo big" aria-label="Candoku"><img src="art/logo.webp" alt="Candoku" draggable="false"></div>';
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
    set('optHaptic', hapticOn); set('optMusic', M && M.isEnabled()); set('optVoice', V && V.isEnabled()); set('optAll', S.isOn());
  }

  /* ---------- navigation ---------- */
  async function toMap() {
    const p = pendingHop; pendingHop = null;
    if (p) mascotAt = p.from;
    await transition(() => { renderHome(); show('home'); scrollToLevel(level); });
    if (p) { await sleep(120); await hopTo(p.from, p.to); }
  }
  async function nextLevel() {
    $('win').hidden = true;
    if (cur.meta.kind !== 'level') { await toMap(); return; }
    const from = cur.meta.level, to = level; pendingHop = null;
    try {
      mascotAt = from;
      await transition(() => { renderHome(); show('home'); scrollToLevel(to); });
      await sleep(100);
      await Promise.race([hopTo(from, to), sleep(2500)]); mascotAt = 0;
      if (V && to > 1 && (to - 1) % 10 === 0) V.say('Welcome to ' + zoneOf(to).name + '!', true);
      await sleep(120);
      await new Promise((res) => openPrelevel(to, () => transition(() => startLevel(to)).then(res)));
    } catch (e) {
      console.error(e);
      try { $('wipe').hidden = true; startLevel(to); } catch (e2) { renderHome(); show('home'); }
    }
  }

  /* ---------- wiring ---------- */
  $('daily').onclick = () => { S.unlock(); S.tap(); transition(() => startDaily()); };
  $('backBtn').onclick = () => { S.ui('back', 1, 1); toMap(); };
  $('undoBtn').onclick = undo;
  document.querySelectorAll('.card').forEach((card) => {
    const x = document.createElement('button'); x.type = 'button'; x.className = 'xclose'; x.setAttribute('aria-label', 'Close');
    x.onclick = (e) => {
      e.stopPropagation(); S.tap();
      const ov = card.closest('.overlay'); if (!ov) return;
      const ids = ['#rwOk', '#howClose', '#wheelClose', '#chestClose', '#questClose', '#giftClose', '#gamesClose', '#memClose', '#tossClose', '#rankClose', '#hintCancel', '#shopClose', '#colClose', '#pfClose', '#homeBtn', '#loseHome', '#bonusClaim'];
      for (const id of ids) { const b = card.querySelector(id); if (b) { b.click(); if (ov.hidden) return; break; } }
      ov.hidden = true;                                   // any popup without its own button just closes
    };
    card.appendChild(x);
  });
  $('rankBtn').onclick = openRanking;
  $('pfCollection').onclick = openCollection;
  $('colClose').onclick = () => { S.tap(); $('collection').hidden = true; };
  document.querySelectorAll('#colTabs button').forEach((b) => { b.onclick = () => { colTab = b.dataset.t; S.tap(); renderCollection(); }; });
  document.querySelectorAll('#qTabs button').forEach((b) => { b.onclick = () => { qTab = b.dataset.t; S.tap(); renderQuests(); }; });
  $('gearMap').onclick = () => { S.tap(); syncOpts(); $('how').hidden = false; };
  $('pfClose').onclick = () => { saveProfileName(); S.tap(); $('profile').hidden = true; };
  $('pfName').onchange = saveProfileName;
  $('rankClose').onclick = () => { saveName(); S.tap(); $('ranking').hidden = true; };
  $('rankName2').onchange = saveName;
  $('hintBtn').onclick = () => openItemInfo('hint');
  $('wandBtn').onclick = () => openItemInfo('wand');
  $('sweepBtn').onclick = () => openItemInfo('sweeper');
  $('lensBtn').onclick = () => openItemInfo('lens');
  $('rwOk').onclick = () => { S.tap(); $('reward').hidden = true; setTimeout(nextReward, 220); };
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
  $('optHaptic').onclick = () => { hapticOn = !hapticOn; store.set('haptic', hapticOn); syncOpts(); if (hapticOn) { try { navigator.vibrate && navigator.vibrate(25); } catch (_) {} } };
  $('replayIntro').onclick = () => { $('how').hidden = true; showIntro(); };
  $('introNext').onclick = () => { S.tap(); if (introStep >= PANELS.length) { if (V) V.say("Let's play!", true); endIntro(); } else { introStep++; renderIntro(); } };
  $('introSkip').onclick = () => { S.tap(); endIntro(); };
  document.addEventListener('pointerdown', () => { S.unlock(); if (M && $('intro').hidden) M.sync(); }, { once: true });
  $('sndHome').onclick = toggleSound; $('sndGame').onclick = () => { S.tap(); syncOpts(); $('how').hidden = false; };
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

  /* ---------- tutorial coach (first level) ---------- */
  let forceCoach = false, coachStep = 0;
  const COACH = [
    { sel: 'found', text: 'Welcome! Your goal: put exactly ONE candy in every color. The row up here shows which candies you still need.', at: 'bottom' },
    { sel: 'board', text: 'Tap a square to mark an X, a square that cannot hold a candy. Tap the X again to remove it. Drag across squares to mark many.', at: 'bottom' },
    { sel: 'board', text: 'Double-tap a square to place a candy. Only ONE candy in each row and each column, and candies can never touch, not even diagonally.', at: 'bottom' },
    { sel: 'board', text: '✅ Do: one candy in every row, column and color.  ❌ Never: two candies in the same row, column or color, or touching each other, even diagonally.', at: 'bottom' },
    { sel: 'hearts', text: 'Careful! A wrong candy costs a heart. Lose all three hearts and you try the level again.', at: 'bottom' },
    { sel: 'hintBtn', text: 'Stuck? The light bulb gives a hint, and the wand places a correct candy for you. You start with a few of each.', at: 'top' },
    { sel: 'found', text: 'Place all the candies to win! You earn stars, coins and prizes. Good luck!', at: 'bottom' }
  ];
  function coachPlace() {
    const st = COACH[coachStep], el = $(st.sel), r = el.getBoundingClientRect(), ring = $('coachRing'), b = $('coachBubble');
    ring.style.left = (r.left - 6) + 'px'; ring.style.top = (r.top - 6) + 'px'; ring.style.width = (r.width + 12) + 'px'; ring.style.height = (r.height + 12) + 'px';
    b.style.top = st.at === 'top' ? '84px' : 'auto'; b.style.bottom = st.at === 'top' ? 'auto' : '14px';
    $('coachText').textContent = st.text; $('coachStep').textContent = 'Tutorial ' + (coachStep + 1) + ' / ' + COACH.length;
    $('coachNext').textContent = coachStep === COACH.length - 1 ? "Let's play!" : 'Next';
  }
  function startCoach() { if (!cur || $('game').hidden) return; forceCoach = false; coachStep = 0; $('coach').hidden = false; coachPlace(); }
  function endCoach() { store.set('seenCoach', true); $('coach').hidden = true; S.tap(); }
  $('coachNext').onclick = () => { S.tap(); if (coachStep >= COACH.length - 1) endCoach(); else { coachStep++; coachPlace(); } };
  $('coachSkip').onclick = endCoach;
  window.addEventListener('resize', () => { if (!$('coach').hidden) coachPlace(); });
  $('replayCoach').onclick = () => { $('how').hidden = true; forceCoach = true; transition(() => startLevel(1)); };

  /* ---------- collection: outfits, board frames, stickers ---------- */
  const OUTFITS = [{ id: 'hero', name: 'Gumi', img: 'gumi_hero', at: 0 }];
  const FRAMES = [{ id: 'cream', name: 'Cream', bg: '#f7f1e5', at: 0 }, { id: 'mint', name: 'Mint', bg: 'linear-gradient(160deg,#e6fff0,#b9f0d2)', at: 10 }, { id: 'sky', name: 'Sky', bg: 'linear-gradient(160deg,#e6f4ff,#bcdcfb)', at: 25 },
    { id: 'rose', name: 'Rose', bg: 'linear-gradient(160deg,#fff0f6,#ffcfe0)', at: 40 }, { id: 'gold', name: 'Gold', bg: 'linear-gradient(160deg,#fff7c9,#ffd96a)', at: 70 }, { id: 'night', name: 'Night', bg: 'linear-gradient(160deg,#5c4fd0,#2a2470)', at: 100 }];
  const WORLD_NAMES = ['Lollipop Meadow', 'Chocolate River', 'Frosting Mountains', 'Cotton Candy Sky', 'Ice Cream Beach', 'Gingerbread Winter', 'Donut Lake', 'Cookie Canyon', 'Crystal Caves', 'Jelly Jungle', 'Cupcake Village', 'Candy Cane Forest', 'Caramel Falls', 'Carnival Fairground', 'Macaron Mesa', 'Waffle Castle', 'Soda Springs', 'Honey Hive Hills', 'Berry Bog', 'Mint Mountain', 'Licorice Night Market', 'Sugar Dunes Oasis', 'Pudding Pools', 'Cinnamon Autumn Forest', 'Starlight Sprinkle Galaxy', 'Toffee Treehouse Village', 'Gumdrop Garden', 'Royal Cake Palace', 'Rainbow Sherbet Glacier', 'Sweet Kingdom Gate'];
  const passed = () => Math.max(0, level - 1);
  let outfit = store.get('outfit', 'hero'), frame = store.get('frame', 'cream');
  const outfitOf = (id) => OUTFITS.find((o) => o.id === id) || OUTFITS[0], frameOf = (id) => FRAMES.find((f) => f.id === id) || FRAMES[0];
  function applyLook() {
    if (passed() < outfitOf(outfit).at) outfit = 'hero'; if (passed() < frameOf(frame).at) frame = 'cream';
    const im = document.querySelector('#gumi image'); if (im) im.setAttribute('href', 'art/' + outfitOf(outfit).img + '.webp');
    const g = $('game'); if (g) g.style.setProperty('--fbg', frameOf(frame).bg);
    document.documentElement.style.setProperty('--fbg', frameOf(frame).bg);
  }
  const stickerCount = () => Math.min(WORLD_NAMES.length, Math.floor(passed() / 10));
  let colTab = 'outfits';
  function openCollection() {
    S.unlock(); S.tap(); $('profile').hidden = true; renderCollection(); $('collection').hidden = false;
  }
  function renderCollection() {
    const grid = $('colGrid'), note = $('colNote'); grid.innerHTML = '';
    document.querySelectorAll('#colTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === colTab));
    if (colTab === 'outfits') {
      OUTFITS.forEach((o) => {
        const open = passed() >= o.at, b = document.createElement('button'); b.type = 'button'; b.className = 'colcell' + (outfit === o.id ? ' sel' : '') + (open ? '' : ' lock');
        b.innerHTML = '<img src="art/' + o.img + '.webp" alt="" draggable="false"><span>' + o.name + '</span>' + (open ? '' : '<i>Level ' + o.at + '</i>');
        b.onclick = () => { if (!open) { toast('Pass ' + o.at + ' levels to unlock ' + o.name); return; } outfit = o.id; store.set('outfit', outfit); applyLook(); S.tap(); renderCollection(); };
        grid.appendChild(b);
      });
      note.textContent = 'New outfits for your bear as you pass levels.';
    } else if (colTab === 'frames') {
      FRAMES.forEach((f) => {
        const open = passed() >= f.at, b = document.createElement('button'); b.type = 'button'; b.className = 'colcell frm' + (frame === f.id ? ' sel' : '') + (open ? '' : ' lock');
        b.innerHTML = '<div class="swatch" style="background:' + f.bg + '"><u></u><u></u><u></u><u></u></div><span>' + f.name + '</span>' + (open ? '' : '<i>Level ' + f.at + '</i>');
        b.onclick = () => { if (!open) { toast('Pass ' + f.at + ' levels to unlock the ' + f.name + ' frame'); return; } frame = f.id; store.set('frame', frame); applyLook(); S.tap(); renderCollection(); };
        grid.appendChild(b);
      });
      note.textContent = 'Your board frame, used in every level.';
    } else {
      WORLD_NAMES.forEach((w, i) => {
        const open = i < stickerCount(), b = document.createElement('div'); b.className = 'colcell stk' + (open ? '' : ' lock');
        b.innerHTML = '<div class="sticker" style="background-image:url(art/bg_' + i + '.jpg)"></div><span>' + (open ? w : '?') + '</span>';
        grid.appendChild(b);
      });
      note.textContent = stickerCount() + ' / ' + WORLD_NAMES.length + ' stickers · a prize at 5, 10, 20 and 30';
    }
  }
  /* unlocks and sticker prizes announced the moment you earn them */
  function checkUnlocks(m) {
    const lv = m.level, extra = [];
    OUTFITS.filter((o) => o.at === lv && o.at > 0).forEach((o) => extra.push({ t: 'New outfit!', html: '<div class="rw-it"><img src="art/' + o.img + '.webp" alt="" draggable="false"><b>' + o.name + '</b></div>', big: true }));
    FRAMES.filter((f) => f.at === lv && f.at > 0).forEach((f) => extra.push({ t: 'New board frame!', html: '<div class="rw-it"><div class="swatch big" style="background:' + f.bg + '"><u></u><u></u><u></u><u></u></div><b>' + f.name + '</b></div>' }));
    if (lv % 10 === 0 && lv / 10 <= WORLD_NAMES.length) {
      const i = lv / 10 - 1; extra.push({ t: 'New sticker!', html: '<div class="rw-it"><div class="sticker big" style="background-image:url(art/bg_' + i + '.jpg)"></div><b>' + WORLD_NAMES[i] + '</b></div>' });
      const n = lv / 10, prizes = { 5: { coins: 150, lens: 1 }, 10: { coins: 300, wands: 1, shield: 1 }, 20: { coins: 600, wands: 2, double: 1 }, 30: { coins: 1000, wands: 3, shield: 2, lens: 2 } };
      if (prizes[n]) { give(prizes[n]); extra.push({ p: prizes[n], t: 'Album prize! ' + n + ' stickers', big: true }); }
    }
    extra.forEach((e, k) => setTimeout(() => announce(e.p || {}, e.t, e.big, e.html), 5200 + k * 100));
  }

  /* ---------- challenges: daily, weekly, trophies ---------- */
  const weekKey = () => { const d = new Date(); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + Math.ceil(((t - y0) / 864e5 + 1) / 7); };
  let stats = Object.assign({ solved: 0, flawless: 0, nohint: 0, bosses: 0, run: 0, maxRun: 0 }, store.get('stats', {}));
  let weekly = store.get('weekly', null), achClaimed = store.get('achClaimed', {});
  const WDEF = [{ id: 'w1', text: 'Solve 15 levels this week', goal: 15, key: 'solved', prize: { coins: 100, double: 1 } },
    { id: 'w2', text: 'Win 3 Hard (or harder) levels', goal: 3, key: 'hard', prize: { lens: 1, shield: 1 } },
    { id: 'w3', text: 'Win 5 levels without losing a heart', goal: 5, key: 'flawless', prize: { wands: 1, coins: 60 } }];
  const ADEF = [{ id: 'a1', text: 'Pass 10 levels', goal: 10, get: () => stats.solved, prize: { coins: 50 } },
    { id: 'a2', text: 'Pass 50 levels', goal: 50, get: () => stats.solved, prize: { coins: 120, shield: 1 } },
    { id: 'a3', text: 'Pass 100 levels', goal: 100, get: () => stats.solved, prize: { coins: 250, lens: 2 } },
    { id: 'a4', text: 'Pass 200 levels', goal: 200, get: () => stats.solved, prize: { coins: 500, wands: 2, double: 1 } },
    { id: 'a5', text: 'Win 10 levels without losing a heart', goal: 10, get: () => stats.flawless, prize: { sweeper: 2 } },
    { id: 'a6', text: 'Win 50 levels without losing a heart', goal: 50, get: () => stats.flawless, prize: { coins: 200, shield: 2 } },
    { id: 'a7', text: 'Win 10 levels with no hints', goal: 10, get: () => stats.nohint, prize: { coins: 80 } },
    { id: 'a8', text: 'Defeat 3 bosses', goal: 3, get: () => stats.bosses, prize: { wands: 1, coins: 100 } },
    { id: 'a9', text: 'Sky Path: 5 flawless levels in a row', goal: 5, get: () => stats.maxRun, prize: { coins: 100, lens: 1 } },
    { id: 'a10', text: 'Daily Bonus streak of 7 days', goal: 7, get: () => Math.max(bonus.streak || 0, 0), prize: { wands: 1, coins: 100 } }];
  function freshWeek() { const k = weekKey(); if (!weekly || weekly.week !== k) { weekly = { week: k, solved: 0, hard: 0, flawless: 0, claimed: {} }; store.set('weekly', weekly); } }
  function trackSolved() {
    freshWeek(); const flawless = cur.hearts >= MAX_HEARTS;
    stats.solved++; if (flawless) { stats.flawless++; stats.run++; stats.maxRun = Math.max(stats.maxRun, stats.run); } else stats.run = 0; if (!cur.hints) stats.nohint++;
    if (cur.meta && cur.meta.kind === 'level' && cur.meta.level % 10 === 0) stats.bosses++;
    weekly.solved++; if (cur.tier !== 'normal') weekly.hard++; if (flawless) weekly.flawless++;
    store.set('stats', stats); store.set('weekly', weekly);
  }
  const ready = (cur0, goal, claimed) => cur0 >= goal && !claimed;
  const anyChallengeReady = () => { freshWeek(); return WDEF.some((w) => ready(weekly[w.key], w.goal, weekly.claimed[w.id])) || ADEF.some((x) => ready(x.get(), x.goal, achClaimed[x.id])); };
  let qTab = 'daily';
  function prizeChips(p) { return prizeKeys(p).map((k) => '<img src="art/ic_' + PICO[k] + '.webp" alt="" draggable="false"><em>' + p[k] + '</em>').join(''); }
  const tabReady = () => ({ daily: QDEF.some((q) => quests.p[q.id] >= q.goal && !quests.claimed[q.id]), weekly: WDEF.some((w) => ready(weekly[w.key], w.goal, weekly.claimed[w.id])), trophies: ADEF.some((x) => ready(x.get(), x.goal, achClaimed[x.id])) });
  function renderQuests() {
    const list = $('questList'); list.innerHTML = ''; freshDay(); freshWeek();
    const tr = tabReady();
    document.querySelectorAll('#qTabs button').forEach((b) => { b.classList.toggle('on', b.dataset.t === qTab); b.classList.toggle('dot', !!tr[b.dataset.t]); });
    const row = (text, v, goal, claimed, prizeHtmlStr, claim) => {
      const val = Math.min(goal, v), done = val >= goal, d = document.createElement('div'); d.className = 'shoprow quest';
      d.innerHTML = '<span><b>' + text + '</b><small>' + val + ' / ' + goal + '</small><i class="qbar"><u style="width:' + (val / goal) * 100 + '%"></u></i></span>';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn main buy chips'; b.disabled = !done || claimed; b.innerHTML = claimed ? '✓' : prizeHtmlStr;
      b.onclick = () => { if (!done || claimed) return; claim(); }; d.appendChild(b); list.appendChild(d);
    };
    if (qTab === 'daily') {
      QDEF.forEach((q) => row(q.text, quests.p[q.id], q.goal, quests.claimed[q.id], q.coins + ' ' + coinSvg, () => {
        quests.claimed[q.id] = true; giveReward({ coins: q.coins }, 'Quest complete!');
        if (QDEF.every((x) => quests.claimed[x.id]) && !quests.bonus) { quests.bonus = true; wheel.extra++; store.set('wheel', wheel); }
        store.set('quests', quests); updateSides(); renderQuests();
      }));
      $('questBonus').textContent = quests.bonus ? '🎡 Bonus won: 1 extra wheel spin!' : 'Finish all three for a free wheel spin';
    } else if (qTab === 'weekly') {
      WDEF.forEach((w) => row(w.text, weekly[w.key], w.goal, weekly.claimed[w.id], prizeChips(w.prize), () => { weekly.claimed[w.id] = true; store.set('weekly', weekly); giveReward(w.prize, 'Weekly challenge!', true); updateSides(); renderQuests(); }));
      $('questBonus').textContent = 'Weekly challenges restart every Monday';
    } else {
      ADEF.forEach((x) => row(x.text, x.get(), x.goal, achClaimed[x.id], prizeChips(x.prize), () => { achClaimed[x.id] = true; store.set('achClaimed', achClaimed); giveReward(x.prize, 'Trophy won!', true); updateSides(); renderQuests(); }));
      $('questBonus').textContent = 'Trophies are earned once, for good';
    }
  }
  /* ---------- extras: gifts, daily quests, chest, lucky wheel, mini-games ---------- */
  const HOUR = 3600e3, MAX_PLAYS = 2, CHEST_AT = 10;
  let quests = store.get('quests', null), chest = store.get('chest', { n: 0 }), wheel = store.get('wheel', { date: '', extra: 0 });
  let gifts = store.get('gifts', { daily: '', free: 0 }), plays = store.get('plays', { date: '', memory: 0, toss: 0 });

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
  const questReady = () => QDEF.some((q) => quests.p[q.id] >= q.goal && !quests.claimed[q.id]) || anyChallengeReady();
  function onSolved() {
    freshDay(); trackSolved();
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
      b.onclick = () => { if (!r.ready) return; r.claim(); store.set('gifts', gifts); giveReward(r.prize, 'A gift for you!'); updateSides(); openGifts(); };
      d.appendChild(b); list.appendChild(d);
    });
    $('gifts').hidden = false;
  }
  /* quests */
  function openQuests() {
    S.unlock(); S.tap(); closeAll(); freshDay(); freshWeek(); { const tr = tabReady(); if (!tr[qTab]) qTab = tr.daily ? 'daily' : tr.weekly ? 'weekly' : tr.trophies ? 'trophies' : qTab; } renderQuests(); $('quests').hidden = false;
  }
  /* chest */
  function openChest() {
    S.unlock(); S.tap(); closeAll();
    const full = chest.n >= CHEST_AT;
    $('chestMsg').textContent = full ? 'Your chest is ready!' : 'Solve ' + (CHEST_AT - chest.n) + ' more level' + (CHEST_AT - chest.n > 1 ? 's' : '') + ' to open it';
    $('chestBar').style.width = (chest.n / CHEST_AT) * 100 + '%'; $('chestPrize').innerHTML = '';
    document.querySelector('#chest .chest-art').classList.remove('opening', 'opened');
    const b = $('chestOpen'); b.disabled = !full; b.hidden = false; b.textContent = 'Open chest';
    $('chest').hidden = false;
  }
  function coinBurst(el) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.35, L = fxLayer();
    for (let k = 0; k < 22; k++) {
      const p = document.createElement('img'); p.src = k % 4 === 0 ? 'art/ic_double.webp' : 'art/ic_coin.webp'; p.className = 'fx-coin'; p.draggable = false;
      p.style.left = cx + 'px'; p.style.top = cy + 'px'; L.appendChild(p);
      const dx = (Math.random() - 0.5) * 260, up = 120 + Math.random() * 150, fall = 160 + Math.random() * 120;
      const an = p.animate([{ transform: 'translate(-50%,-50%) scale(.3) rotate(0)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + dx * 0.6 + 'px),' + (-up) + 'px) scale(1) rotate(200deg)', opacity: 1, offset: 0.45 }, { transform: 'translate(calc(-50% + ' + dx + 'px),' + fall + 'px) scale(.8) rotate(420deg)', opacity: 0 }], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'forwards' });
      an.onfinish = () => p.remove();
    }
  }
  function openChestNow() {
    if (chest.n < CHEST_AT) return;
    chest.n -= CHEST_AT; store.set('chest', chest);
    const p = rollPrize(5, true), bonus = { coins: 30 };
    give(p); give(bonus);
    const art = document.querySelector('#chest .chest-art'), btn = $('chestOpen'); btn.hidden = true; $('chestMsg').textContent = 'Opening…';
    art.classList.remove('opened'); void art.offsetWidth; art.classList.add('opening'); S.tap();
    [0, 220, 440, 660].forEach((t) => setTimeout(() => { S.tap(); buzz(14); }, t));
    setTimeout(() => {
      art.classList.remove('opening'); art.classList.add('opened'); coinBurst(art); S.win(); buzz([30, 40, 60]);
      $('chestPrize').innerHTML = '<div class="rwd big">' + prizeHtml(p) + '</div><div class="rwd">' + prizeHtml(bonus) + '</div>';
      $('chestMsg').textContent = 'You found ' + prizeText(p) + ' and 30 coins!';
      $('chestBar').style.width = (chest.n / CHEST_AT) * 100 + '%'; updateSides();
      setTimeout(() => announce(Object.assign({}, p, { coins: (p.coins || 0) + 30 }), 'Candy Chest!', true), 1300);
    }, 950);
  }
  /* lucky wheel */
  const WSEG = [{ c: 10 }, { h: 1 }, { s: 1 }, { k: 1 }, { w: 1 }, { l: 1 }, { d: 1 }, { c: 50 }], WW = [24, 16, 12, 12, 8, 12, 5, 3], WCOL = ['#ff5fa8', '#ffb347', '#7be37a', '#45d0ff', '#b07bff', '#ffe14d', '#ff7a5c', '#5fd8ff'];
  let wheelRot = 0, spinning = false;
  function buildWheel() {
    const ICON = (g) => (g.c ? 'ic_coin' : g.h ? 'ic_hint' : g.w ? 'ic_wand' : g.s ? 'ic_shield' : g.k ? 'ic_sweeper' : g.l ? 'ic_lens' : 'ic_double');
    let defs = '<defs><radialGradient id="wgloss" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient></defs>';
    let s = defs + '<g id="wheelRot">';
    const R = 90;
    for (let i = 0; i < 8; i++) {
      const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180;
      s += '<path d="M110 110 L' + (110 + R * Math.cos(a0)).toFixed(1) + ' ' + (110 + R * Math.sin(a0)).toFixed(1) + ' A' + R + ' ' + R + ' 0 0 1 ' + (110 + R * Math.cos(a1)).toFixed(1) + ' ' + (110 + R * Math.sin(a1)).toFixed(1) + ' Z" fill="' + WCOL[i] + '" stroke="#fff" stroke-width="2"/>';
      const am = (i * 45 + 22.5 - 90) * Math.PI / 180, g = WSEG[i], rr = 60, x = 110 + rr * Math.cos(am), y = 110 + rr * Math.sin(am), rot = i * 45 + 22.5;
      s += '<g transform="rotate(' + rot + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"><image href="art/' + ICON(g) + '.webp" x="' + (x - 14).toFixed(1) + '" y="' + (y - 21).toFixed(1) + '" width="28" height="28"/>' +
        (g.c ? '<text x="' + x.toFixed(1) + '" y="' + (y + 14).toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="900" fill="#fff" stroke="#3a0a4a" stroke-width="2.6" paint-order="stroke" style="font-family:Nunito,sans-serif">' + g.c + '</text>' : '') + '</g>';
    }
    s += '<circle cx="110" cy="110" r="' + R + '" fill="url(#wgloss)"/></g>';
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
    const g = WSEG[idx], prize = { coins: g.c, hints: g.h, wands: g.w, shield: g.s, sweeper: g.k, lens: g.l, double: g.d };
    give(prize); updateSides();
    const target = (360 - (idx * 45 + 22.5) + 360) % 360, cur0 = wheelRot % 360;
    wheelRot += 360 * 5 + ((target - cur0 + 360) % 360);
    spinning = true; $('wheelBtn').disabled = true; $('wheelMsg').textContent = 'Good luck…';
    const el = $('wheelRot'); el.style.transition = 'transform 4s cubic-bezier(.15,.7,.1,1)'; el.style.transformOrigin = '110px 110px'; el.style.transformBox = 'view-box'; el.style.transform = 'rotate(' + wheelRot + 'deg)';
    let ticks = 0; const tick = setInterval(() => { S.tap(); if (++ticks > 16) clearInterval(tick); }, 220);
    setTimeout(() => { spinning = false; $('wheelMsg').textContent = 'You won ' + prizeText(prize) + '!'; buzz([30, 40, 60]); openWheelState(); announce(prize, 'Lucky Wheel!', !!(prize.wands || prize.double || prize.coins >= 50)); }, 4200);
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
    [['memory', 'Memory Match', 'Find all the pairs in 14 moves', 'games'], ['toss', 'Candy Toss', 'Toss 5 candies into the jar', 'games']].forEach((g) => {
      const left = MAX_PLAYS - plays[g[0]], d = document.createElement('div'); d.className = 'shoprow';
      d.innerHTML = '<img class="pico" src="art/ic_' + g[3] + '.webp" alt="" draggable="false"><span><b>' + g[1] + '</b><small>' + g[2] + ' · ' + left + '/' + MAX_PLAYS + ' today</small></span>';
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
    const cv = $('tossCv'), g = cv.getContext('2d'), W = cv.width = 270, H = cv.height = 330, img = new Image(); img.src = 'art/cd_candy.webp';
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
  // every popup opens and closes with a sound, found automatically
  (function popupSounds() {
    const seen = new Set(); let t0 = 0;
    new MutationObserver((ms) => ms.forEach((m) => {
      const el = m.target; if (!el.classList || !el.classList.contains('overlay') || m.attributeName !== 'hidden') return;
      const now = performance.now(); if (now - t0 < 120) return; t0 = now;
      if (el.hidden) S.ui('close', 1, 0.8); else if (el.id !== 'intro') S.ui('open', 1, 0.9);
    })).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  })();
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  window.addEventListener('pagehide', saveGame);
  applyLook();
  (function () { const f = document.createElement('div'); f.id = 'mapfx'; document.body.appendChild(f); sparkField(f, 26); })();
  syncSound();
  renderHome();
  scrollToLevel(level);
  if (!store.get('seenIntro', false)) showIntro();
  else if (!store.get('seenHow', false)) $('how').hidden = false;
  else {
    const g = store.get('game', null);
    if (g && g.meta && ((g.meta.kind === 'level' && g.meta.level <= level) || (g.meta.kind === 'daily' && g.meta.date === today()))) {
      if (g.meta.kind === 'level') startLevel(g.meta.level); else startDaily();
    } else maybeBonus();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
