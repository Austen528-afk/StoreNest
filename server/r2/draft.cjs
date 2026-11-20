'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {UUID,ApiError,config,r2Request,MAX_IMAGE}=require('./storage.cjs');
const {decodeImage}=require('./image-test.cjs');
const EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
const digest=b=>createHash('sha256').update(b).digest('hex');
function prefix(owner,business){
 if(![owner,business].every(x=>typeof x==='string'&&UUID.test(x)))throw new ApiError(400,'Invalid owner or business.');
 return 'r2-catalog-draft/'+owner.toLowerCase()+'/'+business.toLowerCase()+'/';
}
function scopedKey(owner,business,key){
 const start=prefix(owner,business);
 if(typeof key!=='string'||!key.startsWith(start)||!(/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(key.slice(start.length)))||!UUID.test(key.slice(start.length).split('.')[0]))throw new ApiError(403,'Draft object is outside this business.');
 return key;
}
async function read(cfg,key,fetcher){
 const r=await r2Request(cfg,'GET',key,fetcher);
 if(r.status===404)throw new ApiError(404,'Draft image not found.');
 if(!r.ok)throw new ApiError(502,'R2 draft read failed. HTTP '+r.status);
 const mime=r.headers.get('content-type'),bytes=Buffer.from(await r.arrayBuffer());
 if(!Object.hasOwn(EXT,mime)||!key.endsWith('.'+EXT[mime])||!bytes.length||bytes.length>MAX_IMAGE)throw new ApiError(502,'Unexpected draft image content.');
 decodeImage(bytes.toString('base64'),mime);
 return {mime,bytes};
}
async function draftOperation({env,owner,business,action,key,mime,base64,fetcher,id=randomUUID()}){
 const cfg=config(env);
 if(action==='upload'){
  const bytes=decodeImage(base64,mime);
  if(!UUID.test(id))throw new ApiError(400,'Invalid draft identifier.');
  key=prefix(owner,business)+id.toLowerCase()+'.'+EXT[mime];
  const r=await r2Request(cfg,'PUT',key,fetcher,bytes,mime);
  if(!r.ok)throw new ApiError(502,'R2 draft upload failed. HTTP '+r.status);
  try{
   const saved=await read(cfg,key,fetcher);
   if(saved.mime!==mime||!saved.bytes.equals(bytes))throw new ApiError(502,'R2 draft verification failed.');
   return {key,mime,bytes:bytes.length,sha256:digest(bytes),verified:true};
  }catch(e){
   try{const gone=await r2Request(cfg,'DELETE',key,fetcher);if(!gone.ok)throw Error();}catch{throw new ApiError(502,'Draft verification and cleanup failed; inspect draft prefix.');}
   throw e;
  }
 }
 key=scopedKey(owner,business,key);
 if(action==='read'){
  const result=await read(cfg,key,fetcher);
  return {key,mime:result.mime,bytes:result.bytes.length,sha256:digest(result.bytes),base64:result.bytes.toString('base64')};
 }
 if(action==='delete'){
  const r=await r2Request(cfg,'DELETE',key,fetcher);
  if(!r.ok)throw new ApiError(502,'R2 draft deletion failed. HTTP '+r.status);
  const check=await r2Request(cfg,'GET',key,fetcher);
  if(check.status!==404)throw new ApiError(502,'R2 draft deletion not verified.');
  return {key,deleted:true};
 }
 throw new ApiError(400,'Unknown draft operation.');
}
module.exports={draftOperation,scopedKey};
