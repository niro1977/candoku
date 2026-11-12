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
    master = ctx.createGain(); master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function ready() { return on && init(); }

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
    candy(id, step) {
      if (!ready()) return;
      const t = ctx.currentTime, semi = SCALE[(Math.max(1, step) - 1) % SCALE.length];
      voices[id % voices.length](hz(semi), t);
      osc('sine', hz(semi + 12) * 2, t + 0.02, 0.35, 0.06); // sparkle on top
    },
    x() { if (!ready()) return; const t = ctx.currentTime; noise(t, 0.05, 0.3, 2600, 2); osc('sine', 520, t, 0.07, 0.12); },
    tap() { if (!ready()) return; const t = ctx.currentTime; osc('sine', 660, t, 0.09, 0.25, 880); },
    wrong() { if (!ready()) return; const t = ctx.currentTime; osc('sawtooth', 180, t, 0.28, 0.25, 90); osc('square', 140, t + 0.08, 0.25, 0.15, 70); },
    hint() { if (!ready()) return; const t = ctx.currentTime; [0, 4, 7, 12].forEach((s, i) => osc('sine', hz(s + 12), t + i * 0.07, 0.3, 0.22)); },
    win() { if (!ready()) return; const t = ctx.currentTime; [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => { osc('triangle', hz(s + 12), t + i * 0.09, 0.45, 0.28); osc('sine', hz(s + 24), t + i * 0.09, 0.3, 0.1); }); },
    star(i, earned) {
      if (!ready()) return;
      const t = ctx.currentTime;
      if (!earned) { osc('sine', 330, t, 0.2, 0.12, 200); return; }
      const base = [0, 4, 7][Math.min(i, 3) - 1] + 12;
      osc('triangle', hz(base + 12), t, 0.6, 0.3); osc('sine', hz(base + 24), t, 0.5, 0.18); osc('sine', hz(base + 31), t + 0.03, 0.4, 0.1);
      noise(t, 0.3, 0.14, 7200, 1.2);
      [0, 7, 12, 16].forEach((x, k) => osc('sine', hz(base + 24 + x), t + 0.05 + k * 0.05, 0.28, 0.07));
    },
    fanfare() {
      if (!ready()) return;
      const t = ctx.currentTime;
      [0, 4, 7, 12].forEach((x) => { osc('triangle', hz(x + 12), t, 0.9, 0.22); osc('sawtooth', hz(x), t, 0.7, 0.05); });
      [12, 16, 19, 24, 28, 31, 36].forEach((x, k) => osc('sine', hz(x + 12), t + 0.12 + k * 0.07, 0.4, 0.14));
      noise(t + 0.1, 0.6, 0.12, 6000, 0.8);
    },
    lose() { if (!ready()) return; const t = ctx.currentTime; [7, 4, 0, -5].forEach((s, i) => osc('triangle', hz(s), t + i * 0.18, 0.4, 0.3)); },
    hop() { if (!ready()) return; const t = ctx.currentTime; osc('sine', 500, t, 0.14, 0.25, 900); },
    whoosh() { if (!ready()) return; const t = ctx.currentTime; noise(t, 0.5, 0.22, 900, 0.6); osc('sine', 300, t, 0.45, 0.1, 1200); }
  };
  root.CandokuSound = S;
})(window);
