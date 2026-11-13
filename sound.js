/* Candoku sound: everything is synthesized with Web Audio, so there are no audio files to load.
   Each candy has its own voice; its pitch climbs a pentatonic scale as more candies are placed. */
(function (root) {
  let ctx = null, master = null, noiseBuf = null, on = true;
  try { const v = localStorage.getItem('candoku.sound'); if (v !== null) on = JSON.parse(v); } catch (e) {}
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const hz = (semi) => 261.63 * Math.pow(2, semi / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    setTimeout(preloadSamples, 0);
    master = ctx.createGain(); master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function ready() { return on && init(); }

  /* ---- studio-style polish: a short plate reverb, FM bells and plucked marimba ---- */
  let wet = null;
  function reverb() {
    if (wet) return wet;
    const len = Math.floor(ctx.sampleRate * 1.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    wet = ctx.createGain(); wet.gain.value = 0.55; wet.connect(hp); hp.connect(conv); conv.connect(master);
    return wet;
  }
  // a glass/crystal bell: FM with a decaying modulator plus two inharmonic partials; part of it goes to the reverb
  function bell(f, t, dur, vel, send) {
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    car.type = 'sine'; mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.02, t + dur * 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g); g.connect(master); if (send !== 0) { const s = ctx.createGain(); s.gain.value = send == null ? 0.45 : send; g.connect(s); s.connect(reverb()); }
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    [[2.76, 0.35, 0.5], [5.4, 0.18, 0.22]].forEach(([r, v, d]) => osc('sine', f * r, t, dur * d, vel * v));
  }
  // soft marimba-like pluck (body of the sound)
  function pluck(f, t, dur, vel) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 4;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 7, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function sparkle(t, vel) {   // a quick upward shimmer
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; hp.type = 'bandpass'; hp.Q.value = 1.4; hp.frequency.setValueAtTime(4500, t); hp.frequency.exponentialRampToValueAtTime(11000, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    s.connect(hp); hp.connect(g); g.connect(master); const r = ctx.createGain(); r.gain.value = 0.5; g.connect(r); r.connect(reverb()); s.start(t); s.stop(t + 0.3);
  }

  /* Recorded UI sounds (Kenney, CC0) in audio/sfx. Each one falls back to the synthesized sound until it has loaded. */
  const bufs = {}, pending = {};
  function loadSample(name) {
    if (bufs[name] !== undefined || pending[name] || !ctx) return;
    pending[name] = fetch('audio/sfx/' + name + '.mp3').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))).then((b) => { bufs[name] = b; }).catch(() => { bufs[name] = null; });
  }
  function preloadSamples() { ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'fanfare', 'stars'].forEach(loadSample); }
  // plays a recorded sample; returns false (so the caller can use the synth) when it is not loaded yet
  function sample(name, rate, gain, when) {
    const b = bufs[name]; if (!b || !ctx) return false;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate || 1; g.gain.value = gain == null ? 1 : gain;
    src.connect(g); g.connect(master); src.start(when || ctx.currentTime);
    return true;
  }
  // semitone steps -> playback rate
  const rt = (semi) => Math.pow(2, semi / 12);

  function osc(type, f, t, dur, peak, slideTo, detune) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, peak, f, q) {
    const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }

  // one voice per candy id
  const voices = [
    (f, t) => { osc('sine', f * 2, t, 0.5, 0.32); osc('sine', f * 4, t, 0.3, 0.12); osc('sine', f * 5.99, t, 0.18, 0.05); },        // 0 lollipop: glass bell
    (f, t) => { noise(t, 0.12, 0.35, 5200, 0.8); noise(t + 0.05, 0.1, 0.25, 3800, 1); osc('triangle', f * 2, t + 0.04, 0.22, 0.22); }, // 1 wrapper: crinkle + blip
    (f, t) => { osc('triangle', f, t, 0.35, 0.5); osc('sine', f * 0.5, t, 0.22, 0.4); },                                              // 2 chocolate: marimba thunk
    (f, t) => { osc('sine', f * 0.7, t, 0.3, 0.45, f * 1.8); osc('sine', f * 1.4, t + 0.08, 0.2, 0.15); },                            // 3 donut: boing
    (f, t) => { osc('triangle', f * 4, t, 0.35, 0.22); osc('sine', f * 8, t, 0.2, 0.09); },                                          // 4 cane: ting
    (f, t) => { noise(t, 0.08, 0.5, 1800, 0.7); noise(t + 0.04, 0.08, 0.4, 1200, 0.7); osc('triangle', f, t + 0.05, 0.22, 0.3); },     // 5 cookie: crunch
    (f, t) => { osc('sine', f * 3, t, 0.12, 0.5, f * 0.8); osc('sine', f * 2, t + 0.07, 0.25, 0.2); },                               // 6 cherry: pop
    (f, t) => { osc('triangle', f * 2, t, 0.4, 0.3); osc('triangle', f * 3.01, t, 0.25, 0.14); },                                     // 7 cupcake: soft pluck
    (f, t) => { osc('sine', f * 1.5, t, 0.45, 0.28, f * 3); osc('sine', f * 3, t + 0.1, 0.25, 0.12); },                              // 8 ice cream: whistle slide
    (f, t) => { osc('square', f * 2, t, 0.18, 0.1); osc('sine', f * 4, t, 0.3, 0.2); osc('sine', f * 3, t + 0.05, 0.3, 0.14); }       // 9 macaron: squeaky chime
  ];

  const S = {
    unlock() { ready(); },
    ctx() { return on ? init() : null; },
    dest() { return master; },
    isOn() { return on; },
    toggle() { on = !on; try { localStorage.setItem('candoku.sound', JSON.stringify(on)); } catch (e) {} if (on) { init(); S.tap(); } return on; },
    // a candy is revealed: warm pluck, a three-note crystal arpeggio that climbs with progress, a shimmer and a soft low thump
    candy(id, step) {
      if (!ready()) return;
      const t = ctx.currentTime, k = Math.max(1, step) - 1, root = SCALE[k % SCALE.length] + (k >= SCALE.length ? 12 : 0);
      reverb();
      osc('sine', 110, t, 0.18, 0.3, 48);
      pluck(hz(root), t, 0.35, 0.34);
      [0, 4, 7].forEach((x, n) => bell(hz(root + 12 + x), t + 0.018 + n * 0.055, 0.9 - n * 0.1, 0.16 - n * 0.02));
      sparkle(t + 0.02, 0.07);
    },
    x() { if (!ready()) return; const t = ctx.currentTime; pluck(520, t, 0.07, 0.16); noise(t, 0.035, 0.12, 3200, 2); },
    tap() { if (!ready()) return; const t = ctx.currentTime; pluck(780, t, 0.1, 0.22); bell(1560, t, 0.28, 0.07, 0.25); },
    wrong() { if (!ready()) return; const t = ctx.currentTime; osc('sine', 220, t, 0.34, 0.34, 110); pluck(196, t, 0.28, 0.22); pluck(147, t + 0.09, 0.3, 0.2); },
    hint() { if (!ready()) return; const t = ctx.currentTime; reverb(); [0, 4, 7, 12, 16].forEach((s, i) => bell(hz(s + 12), t + i * 0.06, 0.8, 0.16)); sparkle(t + 0.1, 0.06); },
    win() { if (!ready()) return; if (sample('stars', 1, 0.95)) return; const t = ctx.currentTime; [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => { osc('triangle', hz(s + 12), t + i * 0.09, 0.45, 0.28); osc('sine', hz(s + 24), t + i * 0.09, 0.3, 0.1); }); },
    // a candy lands: soft thump + glassy sparkle run, the run climbs with progress
    place(step) {
      if (!ready()) return;
      const t = ctx.currentTime, base = SCALE[(Math.max(1, step) - 1) % SCALE.length] + 12;
      reverb(); osc('sine', 130, t, 0.16, 0.26, 52); bell(hz(base + 12), t + 0.02, 0.7, 0.12);
    },
    // a word of praise pops up
    praise(level) {
      if (!ready()) return;
      const t = ctx.currentTime, up = [0, 4, 7, 12, 16].slice(0, 3 + Math.min(2, level || 0));
      reverb(); up.forEach((x, k) => bell(hz(x + 24), t + k * 0.06, 0.7, 0.14)); sparkle(t + 0.05, 0.07);
    },
    ui(name) { if (!ready()) return; const m = { open: 'tap', close: 'tap', back: 'tap', flip: 'tap', buy: 'hint', coin: 'hint' }[name]; if (m && S[m]) S[m](); },
    starIn() { if (!ready()) return; const t = ctx.currentTime; noise(t, 0.4, 0.18, 2400, 0.8); osc('sine', 280, t, 0.42, 0.1, 1600); },
    star(i, earned) {
      if (!ready()) return;
      const t = ctx.currentTime;
      osc('sine', 130, t, 0.2, 0.4, 48);   // landing thump
      if (!earned) { osc('sine', 330, t, 0.2, 0.12, 200); return; }
      const base = [0, 4, 7][Math.min(i, 3) - 1] + 12;
      reverb(); bell(hz(base + 12), t, 1.2, 0.26); bell(hz(base + 24), t + 0.02, 1.0, 0.14); sparkle(t, 0.1);
      [0, 7, 12, 16].forEach((x, k) => bell(hz(base + 24 + x), t + 0.05 + k * 0.05, 0.6, 0.08));
    },
    fanfare() {
      if (!ready()) return;
      const t = ctx.currentTime;
      if (sample('fanfare', 1, 1)) return;
      [0, 4, 7, 12].forEach((x) => { osc('triangle', hz(x + 12), t, 0.9, 0.22); osc('sawtooth', hz(x), t, 0.7, 0.05); });
      [12, 16, 19, 24, 28, 31, 36].forEach((x, k) => osc('sine', hz(x + 12), t + 0.12 + k * 0.07, 0.4, 0.14));
      noise(t + 0.1, 0.6, 0.12, 6000, 0.8);
    },
    lose() { if (!ready()) return; const t = ctx.currentTime; reverb(); [7, 4, 0, -5].forEach((s, i) => { pluck(hz(s), t + i * 0.2, 0.5, 0.28); bell(hz(s + 12), t + i * 0.2, 0.7, 0.07, 0.3); }); },
    hop() { if (!ready()) return; const t = ctx.currentTime; pluck(520, t, 0.12, 0.2); pluck(780, t + 0.08, 0.14, 0.2); bell(1560, t + 0.1, 0.4, 0.06); },
    whoosh() { if (!ready()) return; const t = ctx.currentTime; noise(t, 0.5, 0.22, 900, 0.6); osc('sine', 300, t, 0.45, 0.1, 1200); }
  };
  root.CandokuSound = S;
})(window);
