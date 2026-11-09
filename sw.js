const CACHE_NAME="storenest-shell-v40";
const SHELL=["/","/index.html","/business-owner.html","/storefront.html","/basket.html","/customer-account.html","/messaging-centre.js","/messaging-centre.css","/chat-launcher.js","/customer-auth.js","/categories.js","/product-customization.js","/owner-order-viewer.js","/owner-order-viewer.css","/owner-bookings.js","/owner-bookings.css","/service-bookings.js","/service-bookings.css","/theme.css","/console.css","/theme.js","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/assets/install-iphone-share.svg","/assets/install-iphone-home-screen.svg","/assets/install-iphone-confirm.svg"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));
 self.skipWaiting();
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));
 self.clients.claim();
});
self.addEventListener("notificationclick",event=>{
 const notification=event.notification,data=notification.data||{};
 if(data.type!=="storenest-message"||!data.conversationId)return;
 notification.close();
 event.waitUntil((async()=>{
  const mode=data.mode==="owner"?"owner":"customer";
  const path=mode==="owner"?"/business-owner.html":"/";
  const destination=new URL(path,self.location.origin);
  destination.searchParams.set("storenestMessageMode",mode);
  destination.searchParams.set("storenestMessageConversation",data.conversationId);
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const target=windows.find(client=>{
   const clientUrl=new URL(client.url);
   return mode==="owner"?clientUrl.pathname==="/business-owner.html":clientUrl.pathname==="/"||clientUrl.pathname==="/index.html";
  });
  if(target){
   await target.focus();
   target.postMessage({type:"storenest:open-message",mode:mode,conversationId:data.conversationId});
   return;
  }
  await self.clients.openWindow(destination.href);
 })());
});
self.addEventListener("fetch",event=>{
 const req=event.request;
 if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
 const url=new URL(req.url);
 if(req.mode==="navigate"||url.pathname.endsWith(".css")||url.pathname==="/categories.js"||url.pathname==="/product-customization.js"||url.pathname==="/owner-order-viewer.js"||url.pathname==="/owner-bookings.js"||url.pathname==="/service-bookings.js"||url.pathname==="/messaging-centre.js"||url.pathname==="/chat-launcher.js"||url.pathname==="/customer-auth.js"||url.pathname==="/theme.js"||url.pathname==="/theme.css"||url.pathname==="/manifest.webmanifest"){
   event.respondWith(fetch(req).then(response=>{
     if(response.ok){const clone=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,clone)).catch(()=>{});}
     return response;
   }).catch(()=>caches.match(req).then(cached=>cached||caches.match("/index.html"))));
   return;
 }
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
