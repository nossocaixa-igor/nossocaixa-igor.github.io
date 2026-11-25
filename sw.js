const C='nc-v28';
const BASE=['./','./index.html','./config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(BASE)).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch{d={title:'Nosso Caixa',body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'Nosso Caixa',{body:d.body||'',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||'nc',renotify:true,vibrate:[180,80,180],requireInteraction:true,data:{url:d.url||'./#contas'},actions:[{action:'ciente',title:'Ciente'},{action:'abrir',title:'Abrir'}]}))});
self.addEventListener('notificationclick',e=>{e.notification.close();if(e.action==='ciente')return;const url=new URL(e.notification.data&&e.notification.data.url||'./',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.navigate(url).catch(()=>{});return c.focus()}}return clients.openWindow(url)}))});
