'use strict';
const {ApiError}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization,BASE,PUBLIC_KEY}=require('../server/r2/auth.cjs');
const {uploadApprovalEvidence,removeApprovalEvidence,TYPES,MAX_EVIDENCE_BYTES}=require('../server/r2/approval-evidence.cjs');
const REQUEST_KEYS=['businessId','sessionToken','requestId','fileName','mime','base64'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sameOrigin(req){
  const origin=req.headers?.origin;
  const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim().toLowerCase();
  if(!origin||!host)return false;
  try{const value=new URL(origin);return value.protocol==='https:'&&value.host.toLowerCase()===host;}catch{return false;}
}
function previewWritesEnabled(){
  if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/listing-approval-operations'
    ||process.env.STORENEST_APPROVAL_PREVIEW_WRITES_ENABLED!=='true'
    ||!process.env.STORENEST_SUPABASE_SERVICE_ROLE_KEY)return false;
  const previewBucket=process.env.STORENEST_APPROVAL_PREVIEW_R2_BUCKET;
  if(!previewBucket||previewBucket==='storenest-media'||process.env.R2_BUCKET_NAME!==previewBucket)return false;
  try{return new URL(BASE).hostname!=='cypbjzbagezdelmemuhb.supabase.co';}catch{return false;}
}
function parseBase64(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_EVIDENCE_BYTES*4/3)+8||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new ApiError(400,'Evidence file payload is invalid.');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>MAX_EVIDENCE_BYTES)throw new ApiError(413,'Choose a file no larger than 2 MB.');
  return bytes;
}
async function requestContext(token,requestId){
  const response=await fetch(new URL('/rest/v1/rpc/business_owner_listing_evidence_context',BASE),{
    method:'POST',headers:{apikey:PUBLIC_KEY,authorization:sessionAuthorization(token),'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({p_request:requestId}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw new ApiError(response.status===401?401:response.status===403?403:503,'Evidence request is unavailable.');
  const value=await response.json().catch(()=>null);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(404,'Evidence request is unavailable.');
  return value;
}
async function recordEvidence(owner,requestId,upload,fileName){
  const serviceKey=process.env.STORENEST_SUPABASE_SERVICE_ROLE_KEY;
  const response=await fetch(new URL('/rest/v1/rpc/business_owner_submit_listing_evidence',BASE),{
    method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({p_owner:owner,p_request:requestId,p_object_key:upload.key,p_file_name:fileName,
      p_content_type:upload.mime,p_byte_size:upload.byte_size,p_sha256:upload.sha256}),
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)
  });
  return response;
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!previewWritesEnabled())return res.status(404).json({error:'Evidence uploads are not enabled for this preview.'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed.'});}
  if(!sameOrigin(req))return res.status(403).json({error:'Same-origin request required.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON required.'});
  let upload=null,context=null,owner=null;
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==REQUEST_KEYS.length||!REQUEST_KEYS.every(key=>Object.hasOwn(body,key)))
      throw new ApiError(400,'Invalid evidence upload request.');
    if(!UUID.test(body.businessId)||!UUID.test(body.requestId)||typeof body.fileName!=='string'
      ||body.fileName.length<1||body.fileName.length>180||/[\r\n/\\]/.test(body.fileName)||!Object.hasOwn(TYPES,body.mime))
      throw new ApiError(400,'Evidence file details are invalid.');
    const bytes=parseBase64(body.base64);
    owner=await verifyOwner(sessionAuthorization(body.sessionToken),body.businessId);
    context=await requestContext(body.sessionToken,body.requestId);
    if(context.business_id!==body.businessId||context.owner_id!==owner||!UUID.test(context.item_id||''))
      throw new ApiError(403,'Evidence request is not associated with this business.');
    upload=await uploadApprovalEvidence({env:process.env,owner,business:body.businessId,item:context.item_id,bytes,mime:body.mime});
    let recorded;
    try{recorded=await recordEvidence(owner,body.requestId,upload,body.fileName.trim());}
    catch{throw new ApiError(503,'Evidence upload was stored, but its submission could not be confirmed. Refresh the request before retrying.');}
    if(!recorded.ok){
      try{await removeApprovalEvidence({env:process.env,key:upload.key,owner,business:body.businessId,item:context.item_id});}catch{}
      throw new ApiError(recorded.status===401?401:recorded.status===403?403:422,'Evidence submission was not accepted.');
    }
    const fileId=await recorded.json().catch(()=>null);
    return res.status(200).json({submitted:true,fileId});
  }catch(error){
    const status=error instanceof ApiError?error.status:error instanceof SyntaxError?400:502;
    console.warn('Listing evidence upload failed',{status});
    return res.status(status).json({error:error instanceof ApiError?error.message:'Evidence upload failed.'});
  }
};
