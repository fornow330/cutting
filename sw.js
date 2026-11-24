const CACHE = 'gz-e6dca25ae9';
const CORE = ['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(CORE); }).catch(function(){}).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k !== CACHE && k.indexOf('gz-') === 0; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var isChunk = url.pathname.indexOf('/chunks/') >= 0;
  var isDoc = req.mode === 'navigate' || url.pathname.endsWith('/index.html');
  if (!isChunk && !isDoc) return;
  e.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function(){
      return caches.match(req, {ignoreSearch: isChunk}).then(function(hit){ return hit || caches.match('./index.html'); });
    })
  );
});
