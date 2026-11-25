'use strict';
const {ApiError}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization,BASE,PUBLIC_KEY}=require('../server/r2/auth.cjs');
const {uploadApprovalEvidence,readApprovalEvidence,removeApprovalEvidence,evidenceR2Env,sha256,TYPES,MAX_EVIDENCE_BYTES}=require('../server/r2/approval-evidence.cjs');
const REQUEST_KEYS=['businessId','sessionToken','requestId','fileName','mime','base64'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sameOrigin(req){
  const origin=req.headers?.origin;
  const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim().toLowerCase();
  if(!origin||!host)return false;
  try{const value=new URL(origin);return value.protocol==='https:'&&value.host.toLowerCase()===host;}catch{return false;}
}
function safeName(value){
  return String(value||'evidence').replace(/[\r\n"\\]/g,'_').slice(0,180)||'evidence';
}
function bearer(req){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization||''));
  return match?.[1]||'';
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
async function serviceEvidenceRpc(name,payload){
  const serviceKey=process.env.STORENEST_SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey)throw new ApiError(503,'Evidence submission is unavailable.');
  return fetch(new URL('/rest/v1/rpc/'+name,BASE),{
    method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)
  });
}
async function findEvidenceByHash(owner,requestId,digest){
  const response=await serviceEvidenceRpc('business_owner_find_listing_evidence_by_hash',{
    p_owner:owner,p_request:requestId,p_sha256:digest
  });
  if(!response.ok)throw new ApiError(503,'Evidence duplicate check is unavailable.');
  const value=await response.json().catch(()=>null);
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||!UUID.test(value.id||'')||typeof value.object_key!=='string')
    throw new ApiError(503,'Evidence duplicate check returned invalid data.');
  return value;
}
async function recordEvidence(owner,requestId,upload,fileName){
  return serviceEvidenceRpc('business_owner_submit_listing_evidence',{
    p_owner:owner,p_request:requestId,p_object_key:upload.key,p_file_name:fileName,
    p_content_type:upload.mime,p_byte_size:upload.byte_size,p_sha256:upload.sha256
  });
}
async function ownerEvidenceRecord(token,fileId){
  const response=await fetch(new URL('/rest/v1/rpc/business_owner_listing_evidence_file',BASE),{
    method:'POST',headers:{apikey:PUBLIC_KEY,authorization:sessionAuthorization(token),'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({p_file:fileId}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw new ApiError(response.status===401?401:response.status===403?403:503,'Evidence file is unavailable.');
  const value=await response.json().catch(()=>null);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(404,'Evidence file is unavailable.');
  return value;
}
async function cleanupUpload(upload,context,owner){
  if(!upload||!context)return;
  try{await removeApprovalEvidence({env:process.env,key:upload.key,owner,business:context.business_id,item:context.item_id});}catch{}
}
async function reconcileUpload(owner,requestId,upload,context){
  try{
    const existing=await findEvidenceByHash(owner,requestId,upload.sha256);
    if(existing){if(existing.object_key!==upload.key)await cleanupUpload(upload,context,owner);return {existing};}
    await cleanupUpload(upload,context,owner);
    return {existing:null};
  }catch{return {unknown:true};}
}
async function handleEvidenceRead(req,res){
  const fileId=new URL(req.url,'https://storenest.invalid').searchParams.get('file');
  if(!fileId||!UUID.test(fileId))throw new ApiError(400,'Invalid evidence file reference.');
  const token=bearer(req);
  if(!token)throw new ApiError(401,'Sign in to open this evidence file.');
  const file=await ownerEvidenceRecord(token,fileId);
  const result=await readApprovalEvidence({
    env:process.env,key:file.object_key,owner:file.owner_id,business:file.business_id,item:file.item_id,
    mime:file.content_type,expectedBytes:Number(file.byte_size),expectedSha256:file.sha256
  });
  res.setHeader('Content-Type',result.mime);
  res.setHeader('Content-Disposition','attachment; filename="'+safeName(file.file_name)+'"');
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  return res.status(200).send(result.bytes);
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!sameOrigin(req))return res.status(403).json({error:'Same-origin request required.'});
  if(!evidenceR2Env(process.env))return res.status(404).json({error:'Evidence access is not enabled in this environment.'});
  if(req.method==='GET'){
    try{return await handleEvidenceRead(req,res);}
    catch(error){
      const status=error instanceof ApiError?error.status:502;
      console.warn('Listing evidence retrieval failed',{status});
      return res.status(status).end();
    }
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
  if(!process.env.STORENEST_SUPABASE_SERVICE_ROLE_KEY)return res.status(404).json({error:'Evidence uploads are not enabled in this environment.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON required.'});
  let upload=null,context=null,owner=null,requestId=null;
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==REQUEST_KEYS.length||!REQUEST_KEYS.every(key=>Object.hasOwn(body,key)))
      throw new ApiError(400,'Invalid evidence upload request.');
    if(!UUID.test(body.businessId)||!UUID.test(body.requestId)||typeof body.fileName!=='string'
      ||body.fileName.length<1||body.fileName.length>180||/[\r\n/\\]/.test(body.fileName)||!Object.hasOwn(TYPES,body.mime))
      throw new ApiError(400,'Evidence file details are invalid.');
    requestId=body.requestId;
    const bytes=parseBase64(body.base64);
    owner=await verifyOwner(sessionAuthorization(body.sessionToken),body.businessId);
    context=await requestContext(body.sessionToken,requestId);
    if(context.business_id!==body.businessId||context.owner_id!==owner||!UUID.test(context.item_id||''))
      throw new ApiError(403,'Evidence request is not associated with this business.');
    const digest=sha256(bytes);
    const duplicate=await findEvidenceByHash(owner,requestId,digest);
    if(duplicate)return res.status(200).json({submitted:true,fileId:duplicate.id,duplicate:true});
    upload=await uploadApprovalEvidence({env:process.env,owner,business:body.businessId,item:context.item_id,bytes,mime:body.mime});
    let recorded;
    try{recorded=await recordEvidence(owner,requestId,upload,body.fileName.trim());}
    catch{
      const reconciled=await reconcileUpload(owner,requestId,upload,context);
      if(reconciled.existing)return res.status(200).json({submitted:true,fileId:reconciled.existing.id,duplicate:true});
      if(!reconciled.unknown)throw new ApiError(503,'The upload was not recorded; the temporary object was removed. Refresh the request before retrying.');
      throw new ApiError(503,'The upload could not be confirmed. Refresh the request before retrying; its private object was retained while database recording is checked.');
    }
    if(!recorded.ok){
      const reconciled=await reconcileUpload(owner,requestId,upload,context);
      if(reconciled.existing)return res.status(200).json({submitted:true,fileId:reconciled.existing.id,duplicate:true});
      if(reconciled.unknown)throw new ApiError(503,'The upload could not be confirmed. Refresh the request before retrying; its private object was retained while database recording is checked.');
      const rejectedStatus=recorded.status===401?401:recorded.status===403?403:recorded.status>=500?503:422;
      throw new ApiError(rejectedStatus,'Evidence submission was not accepted; its temporary object was removed.');
    }
    const fileId=await recorded.json().catch(()=>null);
    if(typeof fileId!=='string'||!UUID.test(fileId)){
      const reconciled=await reconcileUpload(owner,requestId,upload,context);
      if(reconciled.existing)return res.status(200).json({submitted:true,fileId:reconciled.existing.id,duplicate:true});
      throw new ApiError(503,'Evidence recording could not be confirmed. Refresh before retrying.');
    }
    return res.status(200).json({submitted:true,fileId,duplicate:false});
  }catch(error){
    const status=error instanceof ApiError?error.status:error instanceof SyntaxError?400:502;
    console.warn('Listing evidence upload failed',{status});
    return res.status(status).json({error:error instanceof ApiError?error.message:'Evidence upload failed.'});
  }
};
