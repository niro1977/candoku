/* Candoku music: an original upbeat loop synthesized live with Web Audio (no audio files).
   Two moods: 'menu' (full groove with drums and melody) and 'game' (soft, so it never distracts). */
(function (root) {
  const S = root.CandokuSound;
  let enabled = true;
  try { const v = localStorage.getItem('candoku.music'); if (v !== null) enabled = JSON.parse(v); } catch (e) {}
  let running = false, mood = 'menu', timer = null, step = 0, nextT = 0, bus = null, ducked = false, ctx = null, noiseBuf = null;
  const BPM = 112, SPS = 60 / BPM / 4;                       // seconds per 16th note
  const ROOTS = [0, -3, -7, -5];                             // C, A, F, G  (semitones from C4)
  const CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
  const SEQ = [0, 1, 2, 3, 0, 1, 2, 3, 0, 3, 1, 2];          // 12 bars, then it loops
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16];
  const hz = (semi) => 261.63 * Math.pow(2, semi / 12);

  // fixed melody, generated once from a seed so the loop is always the same
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const MELODY = (() => {
    const r = seeded(20261111), out = [];
    for (let bar = 0; bar < SEQ.length; bar++) {
      const chord = CHORDS[SEQ[bar]], row = new Array(16).fill(null);
      let last = 4;
      for (let st = 0; st < 16; st += 2) {
        const strong = st % 8 === 0;
        if (r() < (strong ? 0.9 : 0.5)) {
          let idx;
          if (strong) {
            idx = PENT.findIndex((p) => chord.some((c) => (((p - c) % 12) + 12) % 12 === 0));
            idx = Math.max(2, idx + Math.floor(r() * 3));
          } else idx = Math.min(PENT.length - 1, Math.max(1, last + Math.floor(r() * 3) - 1));
          idx = Math.min(PENT.length - 1, idx);
          row[st] = PENT[idx]; last = idx;
        }
      }
      out.push(row);
    }
    return out;
  })();

  function osc(type, f, t, dur, peak, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, peak, f, hp) {
    const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; flt.type = hp ? 'highpass' : 'bandpass'; flt.frequency.value = f; flt.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.03);
  }

  function schedule(i, t) {
    const bar = Math.floor(i / 16) % SEQ.length, st = i % 16, ci = SEQ[bar], chord = CHORDS[ci];
    const rootNote = (((ROOTS[ci] % 12) + 12) % 12) - 24;
    const full = mood !== 'game';
    // bass: bouncy root and octave
    if (st === 0 || st === 6 || st === 8 || st === 14) osc('triangle', hz(rootNote + (st === 6 || st === 14 ? 12 : 0)), t, SPS * 1.8, full ? 0.34 : 0.2);
    // arpeggio pluck on 8ths
    if (st % 2 === 0) {
      const tone = chord[(st / 2) % 3] + (st % 8 === 6 ? 24 : 12);
      osc('triangle', hz(tone), t, SPS * 2.2, full ? 0.13 : 0.1); osc('sine', hz(tone + 12), t, SPS * 1.2, 0.04);
    }
    // soft pad at the start of each bar
    if (st === 0) chord.forEach((c) => osc('sine', hz(c), t, SPS * 15, full ? 0.07 : 0.09));
    const m = MELODY[bar][st];
    if (full) {
      if (st === 0 || st === 8 || (st === 10 && bar % 2)) osc('sine', 120, t, 0.16, 0.5, 42);                               // kick
      if (st === 4 || st === 12) { noise(t, 0.12, 0.2, 1800, false); osc('triangle', 200, t, 0.08, 0.12, 120); }          // clap
      if (st % 2 === 0) noise(t, st % 4 === 2 ? 0.07 : 0.03, st % 4 === 2 ? 0.1 : 0.05, 7500, true);                      // hats
      if (m !== null && m !== undefined) { osc('sine', hz(m + 12), t, SPS * 3, 0.17); osc('triangle', hz(m + 24), t, SPS * 1.4, 0.05); }   // bell melody
    } else if (m !== null && m !== undefined && st % 4 === 0) osc('sine', hz(m + 12), t, SPS * 4, 0.07);
  }
  function tick() {
    if (!running || !ctx) return;
    while (nextT < ctx.currentTime + 0.15) { schedule(step, nextT); nextT += SPS; step++; }
  }
  function applyGain(sec) { if (bus && ctx) bus.gain.setTargetAtTime(0.5 * (ducked ? 0.35 : 1), ctx.currentTime, sec || 0.2); }

  const M = {
    isEnabled() { return enabled; },
    setEnabled(v) { enabled = !!v; try { localStorage.setItem('candoku.music', JSON.stringify(enabled)); } catch (e) {} M.sync(); },
    start(m) {
      if (m) mood = m;
      if (!enabled || !S.isOn()) return;
      ctx = S.ctx(); if (!ctx) return;
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      if (!bus) { bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(S.dest()); }
      if (!running) { running = true; step = 0; nextT = ctx.currentTime + 0.08; timer = setInterval(tick, 30); }
      applyGain(0.6);
    },
    mood(m) { mood = m; },
    stop() { running = false; clearInterval(timer); timer = null; if (bus && ctx) bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1); },
    duck(on) { ducked = !!on; applyGain(0.15); },
    sync() { if (enabled && S.isOn()) M.start(); else M.stop(); }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; clearInterval(timer); timer = null; }
    else if (enabled && S.isOn() && ctx) M.start();
  });
  root.CandokuMusic = M;
})(window);
