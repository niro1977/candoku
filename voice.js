/* Candoku narrator: recorded lines in a deep, charismatic male voice (audio/voice/*.mp3).
   If a clip is missing or can't play, it falls back to the device's own speech voice. */
(function (root) {
  const S = root.CandokuSound, synth = root.speechSynthesis;
  let enabled = true, last = 0, chosen = null, current = null;
  try { const v = localStorage.getItem('candoku.voice'); if (v !== null) enabled = JSON.parse(v); } catch (e) {}

  const CLIPS = {
    welcome: 'Welcome to Candoku!',
    intro1: 'Candy Land was the sweetest place in the world.',
    intro2: 'Then came a giant sneeze. Achoo! Every candy got mixed up!',
    intro3: 'Help Gumi put them back. One candy in every color, and no two candies can touch!',
    letsplay: "Let's play!",
    first: 'Sweet!', yummy: 'Yummy!', tasty: 'Tasty!', nice: 'Nice one!', delicious: 'Delicious!',
    perfect: 'Delicious! Perfect!', divine: 'Divine! Perfect!', sugartastic: 'Sugar-tastic! Perfect!',
    verytasty: 'Very tasty!', close: 'Sweet! That was close!', lose: 'Oh no! Try again!',
    go: "Let's go!", ready: 'Ready? Go!', hard: 'Hard level! You can do it!', veryhard: 'Very hard level! Good luck!',
    z0: 'Welcome to Lollipop Meadow!', z1: 'Welcome to Chocolate River!', z2: 'Welcome to Frosting Mountains!', z3: 'Welcome to Cotton Candy Sky!',
    z4: 'Welcome to Ice Cream Beach!', z5: 'Welcome to Gingerbread Winter!', z6: 'Welcome to Donut Lake!', z7: 'Welcome to Cookie Canyon!', z8: 'Welcome to Crystal Caves!',
    z9: 'Welcome to Jelly Jungle!', z10: 'Welcome to Cupcake Village!', z11: 'Welcome to Candy Cane Forest!', z12: 'Welcome to Caramel Falls!', z13: 'Welcome to Carnival Fairground!', z14: 'Welcome to Macaron Mesa!', z15: 'Welcome to Waffle Castle!', z16: 'Welcome to Soda Springs!', z17: 'Welcome to Honey Hive Hills!', z18: 'Welcome to Berry Bog!', z19: 'Welcome to Mint Mountain!', z20: 'Welcome to Licorice Night Market!', z21: 'Welcome to Sugar Dunes Oasis!', z22: 'Welcome to Pudding Pools!', z23: 'Welcome to Cinnamon Autumn Forest!', z24: 'Welcome to Starlight Sprinkle Galaxy!', z25: 'Welcome to Toffee Treehouse Village!', z26: 'Welcome to Gumdrop Garden!', z27: 'Welcome to Royal Cake Palace!', z28: 'Welcome to Rainbow Sherbet Glacier!', z29: 'Welcome to Sweet Kingdom Gate!'
  };
  const ID_OF = {}; Object.keys(CLIPS).forEach((k) => { ID_OF[CLIPS[k]] = k; });
  const buffers = {}, loading = {};

  function load(id) {
    if (buffers[id] !== undefined) return Promise.resolve(buffers[id]);
    if (loading[id]) return loading[id];
    const ctx = S.ctx();
    if (!ctx) return Promise.resolve(null);
    loading[id] = fetch('audio/voice/' + id + '.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((b) => (buffers[id] = b))
      .catch(() => (buffers[id] = null));
    return loading[id];
  }
  function preload() { Object.keys(CLIPS).forEach(load); }

  function stop() {
    if (current) { try { current.onended = null; current.stop(); } catch (e) {} current = null; }
    if (synth) synth.cancel();
    const M = root.CandokuMusic; if (M) M.duck(false);
  }

  function pickVoice() {
    if (!synth) return null;
    const vs = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!vs.length) return null;
    chosen = vs.find((v) => /(guy|andrew|christopher|david|daniel|alex|male|fred|george|google uk english male)/i.test(v.name)) || vs.find((v) => /^en-US/i.test(v.lang)) || vs[0];
    return chosen;
  }
  if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice);
  function speakFallback(text) {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text), M = root.CandokuMusic;
    u.voice = chosen || pickVoice(); u.lang = 'en-US'; u.pitch = 0.7; u.rate = 1.0; u.volume = 1;
    u.onstart = () => { if (M) M.duck(true); };
    u.onend = u.onerror = () => { if (M) M.duck(false); };
    synth.speak(u);
  }

  function playClip(id, text) {
    const ctx = S.ctx();
    if (!ctx) return;
    load(id).then((buf) => {
      if (!buf) { stop(); speakFallback(text); return; }
      stop();
      const src = ctx.createBufferSource(), g = ctx.createGain(), M = root.CandokuMusic;
      src.buffer = buf; g.gain.value = 1.15;
      src.connect(g); g.connect(S.dest());
      src.onended = () => { if (current === src) { current = null; if (M) M.duck(false); } };
      current = src;
      if (M) M.duck(true);
      src.start();
    });
  }

  const any = (a) => a[Math.floor(Math.random() * a.length)];
  const V = {
    available() { return true; },
    isEnabled() { return enabled; },
    setEnabled(v) { enabled = !!v; try { localStorage.setItem('candoku.voice', JSON.stringify(enabled)); } catch (e) {} if (!enabled) stop(); else preload(); },
    preload,
    cancel: stop,
    // say by clip id ("first") or by its exact text ("Sweet!"); unknown text uses the device voice
    say(textOrId, force) {
      if (!enabled || !S.isOn()) return;
      const now = performance.now();
      if (!force && now - last < 1500) return;
      last = now;
      const id = CLIPS[textOrId] ? textOrId : ID_OF[textOrId];
      if (id) playClip(id, CLIPS[id]); else { stop(); speakFallback(textOrId); }
    },
    praise() { V.say(any(['yummy', 'tasty', 'nice', 'delicious'])); },
    first() { V.say('first'); },
    win(hearts) { V.say(hearts >= 3 ? any(['divine', 'sugartastic', 'perfect']) : hearts === 2 ? any(['delicious', 'verytasty']) : 'close', true); },
    lose() { V.say('lose', true); },
    start(lv, tier) { V.say(tier === 'veryhard' ? 'veryhard' : tier === 'hard' ? 'hard' : any(['go', 'ready']), true); }
  };
  document.addEventListener('pointerdown', () => { if (enabled) preload(); }, { once: true });
  root.CandokuVoice = V;
})(window);
