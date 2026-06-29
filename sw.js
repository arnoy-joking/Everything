 const CACHE_NAME = 'hsc-routine-v1';
  const urlsToCache = ['.', 'test-routine.html'];
  
  self.addEventListener('install', event => {
      event.waitUntil(
          caches.open(CACHE_NAME)
              .then(cache => cache.addAll(urlsToCache))
              .then(() => self.skipWaiting())
      );
  });
  
  self.addEventListener('activate', event => {
      event.waitUntil(
          caches.keys().then(cacheNames => {
              return Promise.all(
                  cacheNames.map(name => {
                      if (name !== CACHE_NAME) {
                          return caches.delete(name);
                      }
                  })
              );
          }).then(() => self.clients.claim())
      );
  });
  
  self.addEventListener('fetch', event => {
      event.respondWith(
          caches.match(event.request)
              .then(response => response || fetch(event.request))
              .catch(() => new Response('Offline', { status: 503 }))
      );
  });
