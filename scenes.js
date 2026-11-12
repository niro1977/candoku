/* Candoku painted worlds: one full-screen illustrated scene per world, drawn as SVG (original art).
   CandokuScenes.html(worldIndex) returns the SVG markup; the game puts it behind the board. */
(function (root) {
  const W = 400, H = 800;
  const f = (n) => Math.round(n * 10) / 10;

  // soft rolling hills: a closed path across the screen
  function hills(fill, base, amp, phase, extra) {
    let d = 'M-20 ' + (H + 20) + ' L-20 ' + f(base);
    const step = 80;
    for (let x = -20; x < W + 60; x += step) {
      const y1 = base - amp * Math.sin(phase + x / 90), y2 = base + amp * Math.sin(phase + (x + step) / 70);
      d += ' Q' + f(x + step / 2) + ' ' + f(y1 - amp * 0.6) + ' ' + f(x + step) + ' ' + f(y2);
    }
    return '<path d="' + d + ' L' + (W + 60) + ' ' + (H + 20) + ' Z" fill="' + fill + '"' + (extra || '') + '/>';
  }
  const cloud = (x, y, s, fill, cls) =>
    '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><g class="' + (cls || 'drift') + '" style="--dx:' + (18 + (x % 25)) + 'px;--dur:' + (26 + (y % 14)) + 's">' +
    '<ellipse cx="0" cy="12" rx="62" ry="17" fill="' + fill + '"/><circle cx="-26" cy="2" r="19" fill="' + fill + '"/><circle cx="6" cy="-8" r="25" fill="' + fill + '"/><circle cx="34" cy="3" r="17" fill="' + fill + '"/>' +
    '<ellipse cx="0" cy="22" rx="52" ry="7" fill="rgba(120,80,190,.12)"/></g></g>';
  const star = (x, y, r, fill, d) => {
    let p = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; p += f(x + Math.cos(a) * rr) + ',' + f(y + Math.sin(a) * rr) + ' '; }
    return '<polygon class="tw" style="animation-delay:-' + (d || 0) + 's" points="' + p + '" fill="' + fill + '"/>';
  };
  function lolly(x, y, r, c1, c2, stick) {
    let g = '<g>';
    g += '<rect x="' + (x - 3.5) + '" y="' + y + '" width="7" height="' + (stick || 90) + '" rx="3.5" fill="#fff6ea"/><rect x="' + (x - 3.5) + '" y="' + y + '" width="3" height="' + (stick || 90) + '" rx="1.5" fill="rgba(0,0,0,.1)"/>';
    g += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c1 + '"/>';
    for (let k = 1; k <= 3; k++) g += '<circle cx="' + x + '" cy="' + y + '" r="' + f(r * (1 - k * 0.24)) + '" fill="none" stroke="' + c2 + '" stroke-width="' + f(r * 0.13) + '"/>';
    g += '<circle cx="' + x + '" cy="' + y + '" r="' + f(r * 0.1) + '" fill="' + c2 + '"/><ellipse cx="' + f(x - r * 0.35) + '" cy="' + f(y - r * 0.4) + '" rx="' + f(r * 0.26) + '" ry="' + f(r * 0.14) + '" fill="rgba(255,255,255,.7)" transform="rotate(-35 ' + f(x - r * 0.35) + ' ' + f(y - r * 0.4) + ')"/>';
    return g + '</g>';
  }
  function cane(x, y, h, a) {
    const r = 14, d = 'M' + x + ' ' + (y + h) + ' V' + (y + r) + ' a' + r + ' ' + r + ' 0 0 1 ' + 2 * r + ' 0';
    return '<g transform="rotate(' + (a || 0) + ' ' + x + ' ' + (y + h) + ')"><path d="' + d + '" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#ff3f66" stroke-width="10" stroke-linecap="round" stroke-dasharray="9 11"/></g>';
  }
  function gumdrop(x, y, w, h, fill, hi) {
    return '<g><path d="M' + (x - w / 2) + ' ' + y + ' Q' + (x - w / 2) + ' ' + (y - h) + ' ' + x + ' ' + (y - h) + ' Q' + (x + w / 2) + ' ' + (y - h) + ' ' + (x + w / 2) + ' ' + y + ' Z" fill="' + fill + '"/>' +
      '<ellipse cx="' + f(x - w * 0.18) + '" cy="' + f(y - h * 0.68) + '" rx="' + f(w * 0.12) + '" ry="' + f(h * 0.08) + '" fill="' + (hi || 'rgba(255,255,255,.6)') + '" transform="rotate(-30 ' + f(x - w * 0.18) + ' ' + f(y - h * 0.68) + ')"/></g>';
  }
  function sprinkles(n, seed, cols, y0, y1) {
    let s = '', a = seed;
    for (let i = 0; i < n; i++) {
      a = (a * 1103515245 + 12345) & 0x7fffffff; const x = a % W;
      a = (a * 1103515245 + 12345) & 0x7fffffff; const y = y0 + (a % (y1 - y0));
      a = (a * 1103515245 + 12345) & 0x7fffffff; const rot = a % 180;
      s += '<rect x="' + x + '" y="' + y + '" width="9" height="3.4" rx="1.7" fill="' + cols[i % cols.length] + '" transform="rotate(' + rot + ' ' + x + ' ' + y + ')" opacity=".85"/>';
    }
    return s;
  }
  const grad = (id, top, bot, x2, y2) => '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (x2 || 0) + '" y2="' + (y2 || 1) + '"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bot + '"/></linearGradient>';

  /* ---- 0: Lollipop Meadow ---- */
  function meadow() {
    return grad('s0', '#4cc9ff', '#c9f7ff') +
      '|' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#s0)"/>' +
      '<circle cx="320" cy="118" r="70" fill="#fff6b0" opacity=".45"/><circle cx="320" cy="118" r="44" fill="#ffe14d"/>' +
      cloud(70, 120, 1, '#fff') + cloud(250, 250, .8, '#fff', 'drift d2') + cloud(120, 380, .65, 'rgba(255,255,255,.9)') + '|' +
      hills('#7be37a', 470, 22, 0.5) + lolly(90, 380, 38, '#ff5fa8', '#fff', 100) + lolly(330, 420, 30, '#ffa52e', '#fff3c4', 80) +
      hills('#3fcf6a', 560, 26, 2) + cane(40, 480, 70, -6) + cane(366, 500, 60, 8) + lolly(215, 470, 46, '#a45cff', '#e9d2ff', 120) +
      hills('#23b85c', 660, 30, 4) + gumdrop(70, 680, 90, 55, '#ff4f6d') + gumdrop(340, 690, 100, 62, '#ffd13a') + gumdrop(205, 720, 70, 44, '#45d0ff') +
      hills('#169c4a', 760, 22, 1) + sprinkles(26, 11, ['#ff5fa8', '#ffe14d', '#45d0ff', '#fff'], 520, 780);
  }
  /* ---- 1: Chocolate River ---- */
  function chocolate() {
    let river = '<path d="M-20 560 C90 520 170 600 260 560 S400 520 430 560 V830 H-20 Z" fill="#6b3418"/>';
    river += '<path class="flow" d="M-20 600 C90 560 170 640 260 600 S400 560 430 600" fill="none" stroke="#a65a2a" stroke-width="8" stroke-linecap="round" opacity=".8"/>';
    river += '<path class="flow f2" d="M-20 650 C100 615 190 690 280 650 S400 625 430 655" fill="none" stroke="#c47a3d" stroke-width="6" stroke-linecap="round" opacity=".7"/>';
    river += '<path class="flow f3" d="M-20 705 C90 680 180 735 270 705 S390 690 430 710" fill="none" stroke="#8a4a22" stroke-width="7" stroke-linecap="round" opacity=".8"/>';
    return grad('s1', '#ffb36b', '#ffe9c9') + grad('h1', '#a05a2c', '#7a3f1d') +
      '|' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#s1)"/>' +
      '<circle cx="80" cy="130" r="60" fill="#fff0c2" opacity=".5"/><circle cx="80" cy="130" r="38" fill="#ffd66b"/>' +
      cloud(280, 150, 1, '#fff2e2') + cloud(170, 300, .75, '#fff6ea', 'drift d2') + '|' +
      hills('url(#h1)', 440, 28, 1.2) +
      // wafer / cookie houses
      '<g><rect x="40" y="395" width="74" height="60" rx="8" fill="#e9b377"/><path d="M30 400 L77 360 L124 400 Z" fill="#ff8fb8"/><rect x="62" y="418" width="22" height="37" rx="5" fill="#8a4a22"/><circle cx="102" cy="425" r="6" fill="#ffe14d"/></g>' +
      '<g><rect x="290" y="385" width="66" height="54" rx="8" fill="#f2c28a"/><path d="M282 390 L323 354 L364 390 Z" fill="#7be0ff"/><rect x="310" y="408" width="20" height="31" rx="5" fill="#8a4a22"/></g>' +
      hills('#8a4a22', 500, 24, 3) + river +
      '<path d="M-20 470 q20 36 42 0 q22 44 46 0 q20 30 40 0 q24 40 48 0 q22 34 44 0 q22 42 46 0 q24 30 44 0 q22 38 44 0 q24 34 46 0 V440 H-20 Z" fill="#6b3418"/>' +
      lolly(60, 600, 26, '#ff5fa8', '#fff', 70) + lolly(346, 610, 24, '#ffd13a', '#fff3c4', 70) +
      sprinkles(34, 23, ['#ff5fa8', '#ffe14d', '#45d0ff', '#fff', '#8cff8c'], 470, 790);
  }
  /* ---- 2: Frosting Mountains ---- */
  function frosting() {
    const mtn = (x, base, w, h, body, icing) =>
      '<g><path d="M' + (x - w / 2) + ' ' + base + ' Q' + (x - w * 0.12) + ' ' + (base - h * 0.95) + ' ' + x + ' ' + (base - h) + ' Q' + (x + w * 0.12) + ' ' + (base - h * 0.95) + ' ' + (x + w / 2) + ' ' + base + ' Z" fill="' + body + '"/>' +
      '<path d="M' + f(x - w * 0.2) + ' ' + f(base - h * 0.62) + ' Q' + x + ' ' + f(base - h * 1.04) + ' ' + f(x + w * 0.2) + ' ' + f(base - h * 0.62) + ' q-8 22 -16 0 q-8 30 -18 2 q-6 24 -16 0 q-9 22 -18 0 q-8 18 -17 0 Z" fill="' + icing + '"/>' +
      '<circle cx="' + x + '" cy="' + f(base - h - 4) + '" r="9" fill="#ff2e5b"/><circle cx="' + f(x - 3) + '" cy="' + f(base - h - 7) + '" r="2.6" fill="rgba(255,255,255,.8)"/><path d="M' + x + ' ' + f(base - h - 12) + ' q8 -14 16 -16" stroke="#3e9a3c" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
    return grad('s2', '#ff9ad7', '#fff0fa') +
      '|' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#s2)"/>' +
      '<circle cx="300" cy="120" r="64" fill="#fff" opacity=".5"/><circle cx="300" cy="120" r="40" fill="#fff7b8"/>' +
      cloud(90, 170, 1, '#fff') + cloud(250, 300, .7, '#fff', 'drift d2') + '|' +
      mtn(100, 520, 230, 230, '#b46bff', '#fff') + mtn(300, 540, 260, 280, '#ff6fb5', '#fff7fd') + mtn(200, 580, 210, 170, '#7ec8ff', '#fff') +
      hills('#ffc1e3', 600, 22, 0.8) +
      // cupcakes
      '<g><path d="M52 690 L66 650 H114 L128 690 Z" fill="#ffb347"/><path d="M60 652 q30 -50 60 0 Z" fill="#fff"/><path d="M68 640 q22 -42 44 0 Z" fill="#ff7ab8"/><circle cx="90" cy="606" r="7" fill="#ff2e5b"/></g>' +
      '<g><path d="M290 700 L304 660 H352 L366 700 Z" fill="#9b5de5"/><path d="M298 662 q30 -50 60 0 Z" fill="#fff3a0"/><path d="M306 650 q22 -42 44 0 Z" fill="#7be0ff"/><circle cx="328" cy="616" r="7" fill="#ff2e5b"/></g>' +
      hills('#ff8fc9', 720, 20, 3) + hills('#ff5fae', 780, 14, 5) +
      sprinkles(40, 31, ['#fff', '#ffe14d', '#45d0ff', '#9b5de5', '#8cff8c'], 440, 790);
  }
  /* ---- 3: Cotton Candy Sky ---- */
  function sky() {
    let stars = ''; const sp = [[40, 70, 9], [150, 40, 6], [340, 90, 8], [260, 180, 6], [60, 260, 7], [370, 300, 6], [190, 330, 5], [110, 560, 7], [330, 620, 8], [235, 740, 6]];
    sp.forEach((s, i) => { stars += star(s[0], s[1], s[2], i % 2 ? '#fff6a8' : '#fff', i * 0.7); });
    const arc = (r, c) => '<path d="M' + (200 - r) + ' 560 a' + r + ' ' + r + ' 0 0 1 ' + 2 * r + ' 0" fill="none" stroke="' + c + '" stroke-width="12" opacity=".75"/>';
    return grad('s3', '#4a2fd8', '#ff8be0') +
      '|' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#s3)"/>' + stars +
      '<circle cx="70" cy="150" r="46" fill="#fff6c8" opacity=".9"/><circle cx="86" cy="140" r="40" fill="#6a46ee"/>' +
      arc(170, '#ff5f6f') + arc(156, '#ffb347') + arc(142, '#ffe14d') + arc(128, '#7be37a') + arc(114, '#45d0ff') + arc(100, '#b07bff') +
      cloud(90, 230, 1.1, '#ffd9f4') + cloud(300, 340, 1, '#ffffff', 'drift d2') + cloud(120, 470, 1.2, '#ffc2ec') +
      lolly(330, 230, 24, '#ffa52e', '#fff3c4', 0) + lolly(40, 380, 20, '#45d0ff', '#fff', 0) + '|' +
      cloud(300, 500, 1.3, '#ffe3f7') + cloud(60, 560, 1.7, '#fff') + cloud(230, 600, 1.9, '#ffd9f4', 'drift d2') + cloud(400, 560, 1.4, '#fff') +
      lolly(120, 500, 22, '#ff5fa8', '#fff', 0) + lolly(330, 600, 20, '#7be37a', '#eaffea', 0);
  }
  const SCENES = [meadow, chocolate, frosting, sky];
  root.CandokuScenes = {
    count: SCENES.length,
    html(i) {
      const parts = SCENES[((i % SCENES.length) + SCENES.length) % SCENES.length]().split('|');
      // sky stays put; the landscape sits lower so it shows below the board
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs>' + parts[0] + '</defs>' + parts[1] + (parts[2] ? '<g transform="translate(0 130)">' + parts[2] + '</g>' : '') + '</svg>';
    }
  };
})(window);
