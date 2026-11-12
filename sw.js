/* Candoku service worker: cache the app shell so it works offline. Bump VERSION on each release. */
const VERSION = 'candoku-v20';
const FILES = ['./', 'index.html', 'style.css', 'engine.js', 'hints.js', 'seeds.js', 'sound.js', 'music.js', 'voice.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icons/lollipop.png', 'icons/candy.png', 'icons/chocolate_bar.png', 'icons/doughnut.png', 'icons/cupcake.png', 'icons/cookie.png', 'icons/cherries.png', 'icons/soft_ice_cream.png', 'icons/shortcake.png', 'icons/dango.png', 'art/bg_0.jpg', 'art/bg_1.jpg', 'art/bg_2.jpg', 'art/bg_3.jpg', 'art/bg_4.jpg', 'art/bg_5.jpg', 'art/bg_6.jpg', 'art/bg_7.jpg', 'art/bg_8.jpg', 'art/gumi.webp', 'art/panel.webp', 'audio/music/menu.mp3', 'audio/music/w0.mp3', 'audio/music/w1.mp3', 'audio/music/w2.mp3', 'audio/music/w3.mp3', 'audio/voice/close.mp3', 'audio/voice/delicious.mp3', 'audio/voice/divine.mp3', 'audio/voice/first.mp3', 'audio/voice/go.mp3', 'audio/voice/hard.mp3', 'audio/voice/intro1.mp3', 'audio/voice/intro2.mp3', 'audio/voice/intro3.mp3', 'audio/voice/letsplay.mp3', 'audio/voice/lose.mp3', 'audio/voice/nice.mp3', 'audio/voice/perfect.mp3', 'audio/voice/ready.mp3', 'audio/voice/sugartastic.mp3', 'audio/voice/tasty.mp3', 'audio/voice/veryhard.mp3', 'audio/voice/verytasty.mp3', 'audio/voice/welcome.mp3', 'audio/voice/yummy.mp3', 'audio/voice/z0.mp3', 'audio/voice/z1.mp3', 'audio/voice/z2.mp3', 'audio/voice/z3.mp3', 'audio/voice/z4.mp3', 'audio/voice/z5.mp3', 'audio/voice/z6.mp3', 'audio/voice/z7.mp3', 'audio/voice/z8.mp3'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
