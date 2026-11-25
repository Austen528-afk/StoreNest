'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {UUID,ApiError,config,r2Request,MAX_IMAGE}=require('./storage.cjs');
const {decodeImage}=require('./image-test.cjs');
const TYPES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const KEY=/^r2-approval-evidence\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(pdf|jpg|png|webp)$/i;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function scopedKey(owner,business,item,id,extension){
  if(![owner,business,item,id].every(value=>typeof value==='string'&&UUID.test(value))||!Object.values(TYPES).includes(extension))
    throw new ApiError(400,'Invalid evidence identifier or file type.');
  return `r2-approval-evidence/${owner.toLowerCase()}/${business.toLowerCase()}/${item.toLowerCase()}/${id.toLowerCase()}.${extension}`;
}
function validateFile(bytes,mime){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_IMAGE||!Object.hasOwn(TYPES,mime))
    throw new ApiError(413,'Choose a supported file no larger than 2 MB.');
  if(mime==='application/pdf'){
    const header=bytes.subarray(0,8).toString('ascii');
    const trailer=bytes.subarray(Math.max(0,bytes.length-2048)).toString('latin1');
    if(!header.startsWith('%PDF-')||!trailer.includes('%%EOF'))throw new ApiError(415,'The selected file is not a valid PDF.');
  }else decodeImage(bytes.toString('base64'),mime,MAX_IMAGE);
  return true;
}
function isolatedPreviewWritesAllowed(env){
  if(!env||typeof env.STORENEST_SUPABASE_URL!=='string')return false;
  let supabaseHost;
  try{supabaseHost=new URL(env.STORENEST_SUPABASE_URL).hostname;}catch{return false;}
  return env.VERCEL_ENV==='preview'
    &&env.VERCEL_GIT_COMMIT_REF==='feat/listing-approval-operations'
    &&env.STORENEST_APPROVAL_PREVIEW_WRITES_ENABLED==='true'
    &&typeof env.STORENEST_APPROVAL_PREVIEW_R2_BUCKET==='string'
    &&env.STORENEST_APPROVAL_PREVIEW_R2_BUCKET===env.R2_BUCKET_NAME
    &&env.R2_BUCKET_NAME!=='storenest-media'
    &&supabaseHost!=='cypbjzbagezdelmemuhb.supabase.co';
}
function keyForOwnerItem(key,owner,business,item){
  if(typeof key!=='string')throw new ApiError(403,'Evidence object is outside this listing.');
  const match=KEY.exec(key);
  if(!match||match[1].toLowerCase()!==owner.toLowerCase()||match[2].toLowerCase()!==business.toLowerCase()
    ||match[3].toLowerCase()!==item.toLowerCase())throw new ApiError(403,'Evidence object is outside this listing.');
  return match;
}
async function uploadApprovalEvidence({env,owner,business,item,bytes,mime,fetcher,id=randomUUID()}){
  if(!isolatedPreviewWritesAllowed(env))throw new ApiError(503,'Evidence uploads require an isolated preview database and R2 bucket.');
  const extension=TYPES[mime];
  if(!extension)throw new ApiError(415,'Choose a PDF, JPG, PNG or WebP file.');
  validateFile(bytes,mime);
  const key=scopedKey(owner,business,item,id,extension),cfg=config(env);
  let uploaded=false;
  try{
    const put=await r2Request(cfg,'PUT',key,fetcher,bytes,mime);
    if(!put.ok)throw new ApiError(502,'Evidence upload failed.');
    uploaded=true;
    const get=await r2Request(cfg,'GET',key,fetcher);
    if(!get.ok||(get.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!==mime)
      throw new ApiError(502,'Evidence upload could not be verified.');
    const saved=Buffer.from(await get.arrayBuffer());
    if(!saved.equals(bytes))throw new ApiError(502,'Evidence upload verification did not match.');
    return {key,mime,byte_size:bytes.length,sha256:sha256(bytes),verified:true};
  }catch(error){
    if(uploaded){try{await r2Request(cfg,'DELETE',key,fetcher);}catch{}}
    throw error;
  }
}
async function removeApprovalEvidence({env,key,owner,business,item,fetcher}){
  if(!isolatedPreviewWritesAllowed(env))throw new ApiError(503,'Evidence removal is disabled outside an isolated preview.');
  keyForOwnerItem(key,owner,business,item);
  return r2Request(config(env),'DELETE',key,fetcher);
}
module.exports={uploadApprovalEvidence,removeApprovalEvidence,keyForOwnerItem,validateFile,isolatedPreviewWritesAllowed,TYPES,MAX_EVIDENCE_BYTES:MAX_IMAGE};
