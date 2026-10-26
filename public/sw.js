
const CACHE='cs77-v3-merged';const ASSETS=['/','/index.html','/manifest.json','/ms_item.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{caches.open(CACHE).then(c=>c.put(e.request,res.clone()));return res;}).catch(()=>caches.match('/index.html'))))});
