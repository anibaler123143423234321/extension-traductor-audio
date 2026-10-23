/**
 * Service worker: permite instalar la web como app.
 * - Archivos propios: primero la red (siempre la versión más reciente, sin
 *   mezclar versiones tras una actualización); la caché solo sin conexión.
 * - Peticiones a otros dominios (traducción, Deepgram, Groq): nunca se cachean.
 */
const CACHE = 'liveaudio-web-v2';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/qrcode.js',
  './icons/icon-192.png',
  './icons/favicon-32.png',
  '../extension/lib/pipeline.js',
  '../extension/lib/errors.js',
  '../extension/lib/log.js',
  '../extension/lib/languages.js',
  '../extension/lib/translator.js',
  '../extension/lib/engines/index.js',
  '../extension/lib/engines/webspeech.js',
  '../extension/lib/engines/deepgram.js',
  '../extension/lib/engines/groq.js',
  '../extension/lib/audio/pcm-capture.js',
  '../extension/lib/audio/pcm-worklet.js',
  '../extension/lib/audio/vad.js',
  '../extension/lib/audio/wav.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
