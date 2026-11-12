/* Candoku music: recorded instrumental loops (audio/music/*.mp3), one for the menu and one per world.
   Tracks cross-fade when you move between the map and a level, and duck under the narrator. */
(function (root) {
  const S = root.CandokuSound;
  let enabled = true;
  try { const v = localStorage.getItem('candoku.music'); if (v !== null) enabled = JSON.parse(v); } catch (e) {}
  const FILES = { menu: 'audio/music/menu.mp3', w0: 'audio/music/w0.mp3', w1: 'audio/music/w1.mp3', w2: 'audio/music/w2.mp3', w3: 'audio/music/w3.mp3' };
  const LEVEL = { menu: 1, w0: 0.85, w1: 0.85, w2: 0.85, w3: 0.85 };
  const FADE = 1.2;
  let ctx = null, bus = null, running = false, ducked = false, mood = 'menu', world = 0;
  let playing = null;                         // { key, src, gain }
  const buffers = {}, loading = {};

  const keyNow = () => (mood === 'game' ? 'w' + world : 'menu');
  function load(key) {
    if (buffers[key]) return Promise.resolve(buffers[key]);
    if (loading[key]) return loading[key];
    loading[key] = fetch(FILES[key]).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((b) => (buffers[key] = b)).catch(() => { loading[key] = null; return null; });
    return loading[key];
  }
  function applyGain(sec) { if (bus && ctx) bus.gain.setTargetAtTime(0.55 * (ducked ? 0.3 : 1), ctx.currentTime, sec || 0.2); }
  function fadeOut(p) {
    if (!p) return;
    const t = ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t); p.gain.gain.setValueAtTime(p.gain.gain.value, t); p.gain.gain.linearRampToValueAtTime(0.0001, t + FADE);
    try { p.src.stop(t + FADE + 0.05); } catch (e) {}
  }
  async function play() {
    if (!running || !ctx) return;
    const key = keyNow();
    if (playing && playing.key === key) return;
    const buf = await load(key);
    if (!buf || !running || keyNow() !== key || (playing && playing.key === key)) return;
    const src = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime;
    src.buffer = buf; src.loop = true;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(LEVEL[key], t + FADE);
    src.connect(g); g.connect(bus); src.start(t);
    fadeOut(playing);
    playing = { key, src, gain: g };
  }

  const M = {
    isEnabled() { return enabled; },
    setEnabled(v) { enabled = !!v; try { localStorage.setItem('candoku.music', JSON.stringify(enabled)); } catch (e) {} M.sync(); },
    start(m) {
      if (m) mood = m;
      if (!enabled || !S.isOn()) return;
      ctx = S.ctx(); if (!ctx) return;
      if (!bus) { bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(S.dest()); }
      running = true; applyGain(0.6); play();
    },
    mood(m) { mood = m; play(); },
    world(i) { world = i % 4; if (mood === 'game') play(); },
    stop() {
      running = false;
      if (ctx && playing) { fadeOut(playing); playing = null; }
      if (bus && ctx) bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    },
    duck(on) { ducked = !!on; applyGain(0.15); },
    sync() { if (enabled && S.isOn()) M.start(); else M.stop(); }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ctx && playing) { fadeOut(playing); playing = null; } running = false; }
    else if (enabled && S.isOn() && ctx) M.start();
  });
  root.CandokuMusic = M;
})(window);
