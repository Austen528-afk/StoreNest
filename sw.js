const CACHE_NAME="storenest-shell-v27";
const SHELL=["/","/index.html","/business-owner.html","/storefront.html","/categories.js","/product-customization.js","/owner-order-viewer.js","/owner-order-viewer.css","/owner-bookings.js","/owner-bookings.css","/service-bookings.js","/service-bookings.css","/theme.css","/console.css","/theme.js","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/assets/install-iphone-share.svg","/assets/install-iphone-home-screen.svg","/assets/install-iphone-confirm.svg"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));
 self.skipWaiting();
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));
 self.clients.claim();
});
self.addEventListener("fetch",event=>{
 const req=event.request;
 if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
 const url=new URL(req.url);
 if(req.mode==="navigate"||url.pathname.endsWith(".css")||url.pathname==="/categories.js"||url.pathname==="/product-customization.js"||url.pathname==="/owner-order-viewer.js"||url.pathname==="/owner-bookings.js"||url.pathname==="/service-bookings.js"||url.pathname==="/theme.js"||url.pathname==="/theme.css"||url.pathname==="/manifest.webmanifest"){
   event.respondWith(fetch(req).then(response=>{
     if(response.ok){const clone=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,clone)).catch(()=>{});}
     return response;
   }).catch(()=>caches.match(req).then(cached=>cached||caches.match("/index.html"))));
   return;
 }
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
