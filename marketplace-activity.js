(function(){
 "use strict";
 const root=typeof window!=="undefined"?window:globalThis;
 const REMOTE_KEY="storenest_marketplace_activity_v1";
 const STORAGE_PREFIX="storenest:marketplace-activity:v1:";
 const GUEST_KEY=STORAGE_PREFIX+"guest";
 const GUEST_OWNER_KEY=STORAGE_PREFIX+"guest-owner";
 const LAST_USER_KEY=STORAGE_PREFIX+"last-user";
 const LEGACY_KEY="storenest:recent-businesses:v1";
 const LEGACY_IMPORTED_KEY=STORAGE_PREFIX+"legacy-imported";
 const MAX_BUSINESSES=120;
 const listeners=new Set();
 const emptyState=()=>({version:1,categories:{},businesses:{},businessHistoryClearedAt:null});
 const storage={
  get(key){try{return root.localStorage?.getItem(key)||null}catch{return null}},
  set(key,value){try{root.localStorage?.setItem(key,value);return true}catch{return false}},
  remove(key){try{root.localStorage?.removeItem(key);return true}catch{return false}}
 };
 const validId=value=>/^[a-z0-9][a-z0-9-]{0,89}$/.test(String(value||""));
 const validUserId=value=>typeof value==="string"&&value.length>0&&value.length<160;
 const iso=value=>{const time=Date.parse(value||"");return Number.isFinite(time)?new Date(time).toISOString():""};
 const stampTime=value=>{const time=Date.parse(value||"");return Number.isFinite(time)?time:0};
 const userStorageKey=id=>STORAGE_PREFIX+"user:"+id;
 const getLastUser=()=>{const value=storage.get(LAST_USER_KEY);return validUserId(value)?value:null};
 let localContextUserId=getLastUser();
 let activeUserId=null;
 let activeUser=null;
 let authClient=null;
 let hydratedUserId=null;
 let hydrationPromise=null;
 let readyPromise=Promise.resolve();
 let state=readLocal(localContextUserId);
 let syncTimer=null;
 let syncInFlight=false;
 let syncRequested=false;
 let dirty=false;
 let lastRemoteRefresh=0;

 function entryFrom(raw,id,type){
  raw=raw&&typeof raw==="object"?raw:{};
  const lastVisitedAt=iso(raw.lastVisitedAt||raw.visitedAt)||null;
  const visitUpdatedAt=iso(raw.visitUpdatedAt)||lastVisitedAt||"";
  const pinnedAt=iso(raw.pinnedAt)||null;
  const pinUpdatedAt=iso(raw.pinUpdatedAt)||pinnedAt||"";
  const entry={id,lastVisitedAt,visitUpdatedAt,pinnedAt,pinUpdatedAt};
  if(type==="business"){
   entry.slug=id;
   entry.name=String(raw.name||"").trim().slice(0,120);
   entry.category=String(raw.category||"").trim().slice(0,100);
   entry.location=String(raw.location||"").trim().slice(0,120);
   const image=String(raw.logo_url||"").trim();
   entry.logo_url=(/^https:\/\//i.test(image)||(image.startsWith("/")&&!image.startsWith("//")))?image.slice(0,512):"";
  }
  return entry;
 }
 function normalizeState(value){
  const output=emptyState();
  if(!value||typeof value!=="object")return output;
  output.businessHistoryClearedAt=iso(value.businessHistoryClearedAt)||null;
  const categories=value.categories&&typeof value.categories==="object"?value.categories:{};
  for(const id of Object.keys(categories).sort()){
   if(!validId(id))continue;
   const entry=entryFrom(categories[id],id,"category");
   if(entry.lastVisitedAt||entry.visitUpdatedAt||entry.pinnedAt||entry.pinUpdatedAt)output.categories[id]=entry;
  }
  const businesses=value.businesses&&typeof value.businesses==="object"?value.businesses:{};
  for(const slug of Object.keys(businesses).sort()){
   if(!validId(slug))continue;
   const entry=entryFrom(businesses[slug],slug,"business");
   if(entry.lastVisitedAt||entry.visitUpdatedAt||entry.pinnedAt||entry.pinUpdatedAt)output.businesses[slug]=entry;
  }
  return output;
 }
 function readLocal(userId){
  const raw=storage.get(userId?userStorageKey(userId):GUEST_KEY);
  if(!raw)return emptyState();
  try{return normalizeState(JSON.parse(raw))}catch{return emptyState()}
 }
 function saveLocal(){
  const key=localContextUserId?userStorageKey(localContextUserId):GUEST_KEY;
  storage.set(key,JSON.stringify(state));
 }
 function sameState(a,b){return JSON.stringify(normalizeState(a))===JSON.stringify(normalizeState(b))}
 function fieldSource(a,b,stampKey,valueKey){
  const aTime=stampTime(a?.[stampKey]||a?.[valueKey]);
  const bTime=stampTime(b?.[stampKey]||b?.[valueKey]);
  return aTime>=bTime?a:b;
 }
 function mergeEntry(a,b,id,type){
  a=entryFrom(a||{},id,type);b=entryFrom(b||{},id,type);
  const visit=fieldSource(a,b,"visitUpdatedAt","lastVisitedAt");
  const pin=fieldSource(a,b,"pinUpdatedAt","pinnedAt");
  const entry={
   id,
   lastVisitedAt:visit.lastVisitedAt||null,
   visitUpdatedAt:visit.visitUpdatedAt||"",
   pinnedAt:pin.pinnedAt||null,
   pinUpdatedAt:pin.pinUpdatedAt||""
  };
  if(type==="business"){
   const details=fieldSource(a,b,"visitUpdatedAt","lastVisitedAt");
   entry.slug=id;
   entry.name=details.name||a.name||b.name||"";
   entry.category=details.category||a.category||b.category||"";
   entry.location=details.location||a.location||b.location||"";
   entry.logo_url=details.logo_url||a.logo_url||b.logo_url||"";
  }
  return entry;
 }
 function mergeStates(){
  const sources=[...arguments].map(normalizeState);
  const merged=emptyState();
  for(const type of ["categories","businesses"]){
   const isBusiness=type==="businesses", ids=new Set();
   for(const source of sources)Object.keys(source[type]).forEach(id=>ids.add(id));
   for(const id of [...ids].sort()){
    let item=null;
    for(const source of sources)item=mergeEntry(item,source[type][id],id,isBusiness?"business":"category");
    if(item&&(item.lastVisitedAt||item.visitUpdatedAt||item.pinnedAt||item.pinUpdatedAt))merged[type][id]=item;
   }
  }
  const clearTimes=sources.map(source=>stampTime(source.businessHistoryClearedAt));
  const clearTime=Math.max(0,...clearTimes);
  if(clearTime){
   merged.businessHistoryClearedAt=new Date(clearTime).toISOString();
   for(const entry of Object.values(merged.businesses)){
    const updateTime=stampTime(entry.visitUpdatedAt||entry.lastVisitedAt);
    const wasPinnedAtClear=!!entry.pinnedAt&&stampTime(entry.pinUpdatedAt||entry.pinnedAt)<=clearTime;
    if(entry.lastVisitedAt&&updateTime<clearTime){
     if(wasPinnedAtClear)entry.visitUpdatedAt=merged.businessHistoryClearedAt;
     else{entry.lastVisitedAt=null;entry.visitUpdatedAt=merged.businessHistoryClearedAt}
    }
   }
  }
  return normalizeState(merged);
 }
 function readLegacyHistory(){
  if(storage.get(LEGACY_IMPORTED_KEY)==="1")return emptyState();
  storage.set(LEGACY_IMPORTED_KEY,"1");
  const raw=storage.get(LEGACY_KEY);
  if(!raw)return emptyState();
  try{
   const old=JSON.parse(raw),legacy=emptyState(),base=Date.now();
   if(!Array.isArray(old))return legacy;
   old.slice(0,MAX_BUSINESSES).forEach((row,index)=>{
    const entry=entryFrom(row,row?.slug,"business");
    if(!entry.slug||!entry.name)return;
    const visited=new Date(Math.max(0,base-index*1000)).toISOString();
    entry.lastVisitedAt=visited;entry.visitUpdatedAt=visited;
    legacy.businesses[entry.slug]=entry;
   });
   return legacy;
  }catch{return emptyState()}
 }
 state=mergeStates(state,readLegacyHistory());
 saveLocal();

 function nextTimestamp(){
  let latest=stampTime(state.businessHistoryClearedAt);
  for(const collection of [state.categories,state.businesses]){
   for(const entry of Object.values(collection)){
    latest=Math.max(latest,stampTime(entry.visitUpdatedAt||entry.lastVisitedAt),stampTime(entry.pinUpdatedAt||entry.pinnedAt));
   }
  }
  return new Date(Math.max(Date.now(),latest+1)).toISOString();
 }
 function notify(){
  const snapshot=getSnapshot();
  for(const listener of listeners){try{listener(snapshot)}catch(error){console.error("StoreNest activity listener failed:",error)}}
 }
 function scheduleRemoteSync(delay=700){
  if(!activeUserId||!authClient)return;
  dirty=true;
  if(syncTimer)clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{syncTimer=null;void flushRemote()},delay);
 }
 function cleanupGuestIfOwnedBy(userId){
  if(storage.get(GUEST_OWNER_KEY)===userId){
   storage.remove(GUEST_KEY);
   storage.remove(GUEST_OWNER_KEY);
  }
 }
 function trimBusinessHistory(){
  const rows=Object.values(state.businesses);
  if(rows.length<=MAX_BUSINESSES)return;
  const removable=rows.filter(row=>!row.pinnedAt).sort((a,b)=>{
   const aTime=Math.max(stampTime(a.lastVisitedAt),stampTime(a.visitUpdatedAt),stampTime(a.pinUpdatedAt));
   const bTime=Math.max(stampTime(b.lastVisitedAt),stampTime(b.visitUpdatedAt),stampTime(b.pinUpdatedAt));
   return aTime-bTime;
  });
  for(const row of removable){
   if(Object.keys(state.businesses).length<=MAX_BUSINESSES)break;
   delete state.businesses[row.slug];
  }
 }
 function commit(){
  trimBusinessHistory();
  saveLocal();
  notify();
  scheduleRemoteSync();
 }
 function getSnapshot(){return normalizeState(state)}
 function getCategory(id){return state.categories[id]||null}
 function getBusiness(slug){return state.businesses[slug]||null}
 function sortItems(items){
  const list=Array.isArray(items)?items.slice():[];
  const idOf=item=>Array.isArray(item)?String(item[0]||""):String(item?.id||"");
  const initial=new Map(list.map((item,index)=>[idOf(item),index]));
  return list.sort((left,right)=>{
   const a=getCategory(idOf(left))||entryFrom({},idOf(left),"category");
   const b=getCategory(idOf(right))||entryFrom({},idOf(right),"category");
   const pinA=!!a.pinnedAt,pinB=!!b.pinnedAt;
   if(pinA!==pinB)return pinA?-1:1;
   const visitedA=!!a.lastVisitedAt,visitedB=!!b.lastVisitedAt;
   if(pinA&&visitedA!==visitedB)return visitedA?1:-1;
   if(pinA&&!visitedA){
    const diff=stampTime(a.pinnedAt)-stampTime(b.pinnedAt);
    if(diff)return diff;
   }else if(visitedA&&visitedB){
    const diff=stampTime(b.lastVisitedAt)-stampTime(a.lastVisitedAt);
    if(diff)return diff;
   }else if(visitedA!==visitedB)return visitedA?-1:1;
   return (initial.get(idOf(left))??0)-(initial.get(idOf(right))??0);
  });
 }
 function getBusinesses(){
  const rows=Object.values(state.businesses).filter(row=>row.pinnedAt||row.lastVisitedAt);
  rows.sort((a,b)=>{
   const pinA=!!a.pinnedAt,pinB=!!b.pinnedAt;
   if(pinA!==pinB)return pinA?-1:1;
   const visitedA=!!a.lastVisitedAt,visitedB=!!b.lastVisitedAt;
   if(pinA&&visitedA!==visitedB)return visitedA?1:-1;
   if(pinA&&!visitedA){
    const diff=stampTime(a.pinnedAt)-stampTime(b.pinnedAt);
    if(diff)return diff;
   }else if(visitedA&&visitedB){
    const diff=stampTime(b.lastVisitedAt)-stampTime(a.lastVisitedAt);
    if(diff)return diff;
   }else if(visitedA!==visitedB)return visitedA?-1:1;
   return a.slug.localeCompare(b.slug);
  });
  return rows.map(row=>({...row,isPinned:!!row.pinnedAt,visitedAt:row.lastVisitedAt}));
 }
 function recordCategory(id){
  id=String(id||"");
  if(!validId(id))return false;
  const old=getCategory(id)||entryFrom({},id,"category"),at=nextTimestamp(old);
  state.categories[id]={...old,id,lastVisitedAt:at,visitUpdatedAt:at};
  commit();return true;
 }
 function togglePin(type,id,business){
  id=String(id||"");
  if(!validId(id))return false;
  if(type==="business"){
   const details=entryFrom(business||{},id,"business");
   const old=getBusiness(id)||details;
   const at=nextTimestamp(old),isPinned=!!old.pinnedAt;
   state.businesses[id]={
    ...old,...details,slug:id,
    pinnedAt:isPinned?null:at,
    pinUpdatedAt:at
   };
   commit();return !isPinned;
  }
  const old=getCategory(id)||entryFrom({},id,"category");
  const at=nextTimestamp(old),isPinned=!!old.pinnedAt;
  state.categories[id]={...old,id,pinnedAt:isPinned?null:at,pinUpdatedAt:at};
  commit();return !isPinned;
 }
 function toggleCategoryPin(id){return togglePin("category",id)}
 function toggleBusinessPin(slug){return togglePin("business",slug,getBusiness(slug))}
 function safeBusiness(value){
  if(!value||typeof value!=="object")return null;
  const slug=String(value.slug||"").trim().toLowerCase();
  if(!validId(slug))return null;
  const entry=entryFrom(value,slug,"business");
  entry.name=entry.name||slug.replace(/-/g," ").slice(0,120);
  entry.category=String(value.category||"").trim().slice(0,100);
  entry.location=String(value.location||"").trim().slice(0,120);
  return entry;
 }
 function recordBusiness(value){
  const details=safeBusiness(value);
  if(!details)return false;
  const old=getBusiness(details.slug)||entryFrom({},details.slug,"business");
  const at=nextTimestamp(old);
  state.businesses[details.slug]={
   ...old,...details,
   lastVisitedAt:at,visitUpdatedAt:at,
   pinnedAt:old.pinnedAt||null,pinUpdatedAt:old.pinUpdatedAt||""
  };
  commit();return true;
 }
 function removeBusinessVisit(slug){
  slug=String(slug||"").trim().toLowerCase();
  const old=getBusiness(slug);
  if(!old)return false;
  const at=nextTimestamp(old);
  state.businesses[slug]={...old,lastVisitedAt:null,visitUpdatedAt:at};
  commit();return true;
 }
 function clearBusinessHistory(){
  const previous=stampTime(state.businessHistoryClearedAt);
  let newest=Math.max(Date.now(),previous+1);
  for(const row of Object.values(state.businesses)){
   newest=Math.max(newest,stampTime(row.visitUpdatedAt)+1,stampTime(row.pinUpdatedAt)+1);
  }
  const at=new Date(newest).toISOString();
  state.businessHistoryClearedAt=at;
  for(const row of Object.values(state.businesses)){
   if(row.pinnedAt){
    if(row.lastVisitedAt)row.visitUpdatedAt=at;
   }else if(row.lastVisitedAt){
    row.lastVisitedAt=null;row.visitUpdatedAt=at;
   }
  }
  commit();
  return true;
 }
 function hasActivity(value){
  const normalized=normalizeState(value);
  return Object.keys(normalized.categories).length>0||Object.keys(normalized.businesses).length>0;
 }
 function clearGuest(userId){
  cleanupGuestIfOwnedBy(userId);
 }
 async function flushRemote(){
  if(syncTimer){clearTimeout(syncTimer);syncTimer=null}
  if(!activeUserId||!authClient||!activeUser||!authClient.auth?.updateUser)return false;
  if(syncInFlight){syncRequested=true;return false}
  syncInFlight=true;
  const ownerAtStart=activeUserId;
  try{
   if(typeof authClient.auth.getUser==="function"){
    const latest=await authClient.auth.getUser();
    if(latest?.error)throw latest.error;
    const latestUser=latest?.data?.user;
    if(!latestUser||latestUser.id!==ownerAtStart||activeUserId!==ownerAtStart)return false;
    activeUser=latestUser;
   }
   const localSnapshot=normalizeState(state);
   const oldRemote=normalizeState(activeUser.user_metadata?.[REMOTE_KEY]);
   const merged=mergeStates(oldRemote,localSnapshot);
   if(!sameState(merged,oldRemote)){
    const metadata={...(activeUser.user_metadata||{}),[REMOTE_KEY]:merged};
    const result=await authClient.auth.updateUser({data:metadata});
    if(result?.error)throw result.error;
    if(result?.data?.user?.id===ownerAtStart)activeUser=result.data.user;
   }
   if(activeUserId===ownerAtStart){
    const remote=normalizeState(activeUser?.user_metadata?.[REMOTE_KEY]||merged);
    const reconciled=mergeStates(state,remote);
    if(!sameState(reconciled,state)){state=reconciled;saveLocal();notify()}
    dirty=!sameState(state,remote);
    if(!dirty)clearGuest(ownerAtStart);
   }
   return true;
  }catch(error){
   console.debug("StoreNest preference sync will retry when the account is available:",error?.message||error);
   dirty=true;
   return false;
  }finally{
   syncInFlight=false;
   if(syncRequested){syncRequested=false;if(dirty)scheduleRemoteSync(250)}
  }
 }
 async function hydrateUser(userId,fallbackUser){
  if(!userId||!authClient||hydratedUserId===userId)return;
  if(hydrationPromise)return hydrationPromise;
  hydrationPromise=(async()=>{
   let user=fallbackUser||activeUser;
   try{
    if(authClient.auth?.getUser){
     const result=await authClient.auth.getUser();
     if(!result?.error&&result?.data?.user?.id===userId)user=result.data.user;
    }
   }catch{}
   if(activeUserId!==userId)return;
   activeUser=user||activeUser;
   const remote=normalizeState(activeUser?.user_metadata?.[REMOTE_KEY]);
   let merged=mergeStates(state,remote);
   const guestOwner=storage.get(GUEST_OWNER_KEY);
   const canImportGuest=!guestOwner||guestOwner===userId;
   const guest=canImportGuest?readLocal(null):emptyState();
   const importedGuest=canImportGuest&&hasActivity(guest);
   if(importedGuest){
    storage.set(GUEST_OWNER_KEY,userId);
    merged=mergeStates(merged,guest);
   }
   state=merged;
   localContextUserId=userId;
   storage.set(LAST_USER_KEY,userId);
   saveLocal();notify();
   hydratedUserId=userId;
   if(!sameState(remote,state)){
    dirty=true;
    const synced=await flushRemote();
    if(synced&&importedGuest)clearGuest(userId);
   }else if(importedGuest){
    clearGuest(userId);
   }
  })().finally(()=>{hydrationPromise=null});
  return hydrationPromise;
 }
 async function handleAuthEvent(event,user){
  const userId=validUserId(user?.id)?String(user.id):null;
  if(!userId){
   if(activeUserId){
    localContextUserId=activeUserId;
    saveLocal();
    activeUserId=null;activeUser=null;hydratedUserId=null;dirty=false;
    notify();
   }
   return;
  }
  if(userId!==activeUserId){
   if(localContextUserId)saveLocal();
   activeUserId=userId;
   activeUser=user;
   localContextUserId=userId;
   hydratedUserId=null;
   dirty=false;
   storage.set(LAST_USER_KEY,userId);
   state=readLocal(userId);
   notify();
  }else{
   activeUser=user||activeUser;
  }
  if(event==="USER_UPDATED"){
   const remote=normalizeState(user?.user_metadata?.[REMOTE_KEY]);
   const merged=mergeStates(state,remote);
   if(!sameState(merged,state)){state=merged;saveLocal();notify()}
   if(!sameState(remote,state)){dirty=true;scheduleRemoteSync(700)}
   return;
  }
  if(event==="TOKEN_REFRESHED"){
   const remote=normalizeState(user?.user_metadata?.[REMOTE_KEY]);
   const merged=mergeStates(state,remote);
   if(!sameState(merged,state)){state=merged;saveLocal();notify()}
   if(!sameState(remote,state)){dirty=true;scheduleRemoteSync(700)}
   return;
  }
  if(hydratedUserId!==userId)await hydrateUser(userId,user);
 }
 function connect(client){
  if(!client?.auth)return Promise.resolve(false);
  if(authClient===client)return readyPromise;
  authClient=client;
  const auth=client.auth;
  if(typeof auth.onAuthStateChange==="function"){
   auth.onAuthStateChange((event,session)=>{
    setTimeout(()=>{void handleAuthEvent(event,session?.user||null)},0);
   });
  }
  readyPromise=(async()=>{
   try{
    const result=await auth.getSession?.();
    if(result?.error)return false;
    await handleAuthEvent("INITIAL_SESSION",result?.data?.session?.user||null);
    return true;
   }catch(error){
    console.debug("StoreNest preference sync is waiting for authentication:",error?.message||error);
    return false;
   }
  })();
  return readyPromise;
 }
 async function refreshRemote(force=false){
  if(!activeUserId||!authClient||typeof authClient.auth?.getUser!=="function")return false;
  const now=Date.now();
  if(!force&&now-lastRemoteRefresh<25000)return false;
  lastRemoteRefresh=now;
  try{
   const result=await authClient.auth.getUser();
   const user=result?.data?.user;
   if(result?.error||!user||user.id!==activeUserId)return false;
   activeUser=user;
   const remote=normalizeState(user.user_metadata?.[REMOTE_KEY]);
   const merged=mergeStates(state,remote);
   if(!sameState(merged,state)){state=merged;saveLocal();notify()}
   if(!sameState(remote,state)){dirty=true;scheduleRemoteSync(500)}
   return true;
  }catch{return false}
 }
 const api={
  connect,
  ready:()=>readyPromise,
  flush:flushRemote,
  refresh:()=>refreshRemote(true),
  subscribe(listener){if(typeof listener!=="function")return()=>{};listeners.add(listener);return()=>listeners.delete(listener)},
  getSnapshot,
  sortCategories:sortItems,
  getBusinesses,
  isCategoryPinned(id){return !!getCategory(String(id||""))?.pinnedAt},
  isBusinessPinned(slug){return !!getBusiness(String(slug||""))?.pinnedAt},
  recordCategory,
  recordBusiness,
  toggleCategoryPin,
  toggleBusinessPin,
  removeBusinessVisit,
  clearBusinessHistory
 };
 root.StoreNestMarketplaceActivity=api;
 if(typeof module!=="undefined"&&module.exports)module.exports=api;
 if(typeof root.addEventListener==="function"){
  root.addEventListener("storage",event=>{
   const contextKey=localContextUserId?userStorageKey(localContextUserId):GUEST_KEY;
   if(event.key!==contextKey)return;
   state=mergeStates(state,readLocal(localContextUserId));
   notify();
   if(activeUserId){dirty=true;scheduleRemoteSync(700)}
  });
  root.addEventListener("focus",()=>{void refreshRemote(false)});
  root.addEventListener("pageshow",()=>{void refreshRemote(false)});
  root.addEventListener("pagehide",()=>{if(dirty)void flushRemote()});
 }
 if(typeof document!=="undefined"){
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refreshRemote(false)});
 }
})();