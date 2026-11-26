'use strict';
const {createHash,createHmac,randomUUID}=require('node:crypto');
const https=require('node:https');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX='r2-integration-test';
const MAX_IMAGE=2*1024*1024;
const EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64');
class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
function testKey(owner,business,id=randomUUID(),type='image/png'){
  if(!Object.hasOwn(EXT,type))throw new ApiError(415,'Unsupported image type.');
  if(![owner,business,id].every(x=>typeof x==='string'&&UUID.test(x)))throw new ApiError(400,'Invalid identifier.');
  return [PREFIX,owner.toLowerCase(),business.toLowerCase(),id.toLowerCase()+'.'+EXT[type]].join('/');
}
const sha=x=>createHash('sha256').update(x).digest('hex');
const hmac=(k,x,encoding)=>createHmac('sha256',k).update(x).digest(encoding);
function config(env){
  const {R2_ACCOUNT_ID:account,R2_BUCKET_NAME:bucket,R2_ACCESS_KEY_ID:access,R2_SECRET_ACCESS_KEY:secret}=env;
  const isolatedPreview=env.VERCEL_ENV==='preview'
    &&env.VERCEL_GIT_COMMIT_REF==='feat/listing-approval-operations'
    &&env.STORENEST_APPROVAL_PREVIEW_WRITES_ENABLED==='true'
    &&typeof env.STORENEST_APPROVAL_PREVIEW_R2_BUCKET==='string'
    &&env.STORENEST_APPROVAL_PREVIEW_R2_BUCKET===bucket
    &&bucket!=='storenest-media';
  let supabaseHost='';
  try{supabaseHost=new URL(env.STORENEST_SUPABASE_URL||'').hostname.toLowerCase();}catch{}
  const previewHost=String(env.STORENEST_APPROVAL_PREVIEW_SUPABASE_HOST||'').toLowerCase();
  const allowedBucket=bucket==='storenest-media'
    ||(isolatedPreview&&previewHost&&supabaseHost===previewHost&&supabaseHost!=='cypbjzbagezdelmemuhb.supabase.co');
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!allowedBucket||!access||!secret)throw new ApiError(503,'Storage is not configured.');
  if(/[^\x21-\x7e]/.test(access)||/[^\x21-\x7e]/.test(secret))throw new ApiError(503,'R2 credentials contain whitespace or invalid characters.');
  return {account,bucket,access,secret};
}
// S3 Signature Version 4, path-style endpoint, R2 auto region.
// Only accepts scoped diagnostic or isolated draft keys and bounded images.
function sign({account,bucket,access,secret},method,key,now=new Date(),payload=PNG,type='image/png'){
  if(!['PUT','GET','DELETE'].includes(method)||!new RegExp('^(?:'+PREFIX+'|r2-catalog-draft|r2-catalog-private)/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(?:png|jpg|webp|gif)$').test(key))throw new ApiError(400,'Invalid storage operation.');
  const host=account+'.r2.cloudflarestorage.com';
  const path='/'+bucket+'/'+key;
  const date=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=date.slice(0,8),scope=day+'/auto/s3/aws4_request';
  if(method==='PUT'&&(!Buffer.isBuffer(payload)||!payload.length||payload.length>MAX_IMAGE||!Object.hasOwn(EXT,type)||!key.endsWith('.'+EXT[type])))throw new ApiError(400,'Invalid test payload.');
  const body=method==='PUT'?payload:Buffer.alloc(0);
  const headers={host,'x-amz-content-sha256':sha(body),'x-amz-date':date};
  if(method==='PUT'){headers['content-type']=type;headers['if-none-match']='*';headers['cache-control']='no-store';}
  const names=Object.keys(headers).sort(),signed=names.join(';');
  const canonical=names.map(n=>n+':'+headers[n]+'\n').join('');
  const request=[method,path,'',canonical,signed,sha(body)].join('\n');
  const toSign=['AWS4-HMAC-SHA256',date,scope,sha(request)].join('\n');
  const k=hmac(hmac(hmac(hmac('AWS4'+secret,day),'auto'),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+hmac(k,toSign,'hex');
  return {url:'https://'+host+path,options:{method,headers,redirect:'error',...(method==='PUT'?{body}:{}),signal:AbortSignal.timeout(10000)}};
}
// Only for tiny diagnostic objects. Bound response size, time, and error details.
function nativeRequest(url,options){
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method:options.method,headers:options.headers,signal:options.signal},res=>{
      const chunks=[];let length=0;
      res.on('error',reject);
      res.on('data',chunk=>{length+=chunk.length;if(length>MAX_IMAGE+65536){const e=new Error('Response limit');e.code='RESPONSE_LIMIT';res.destroy(e);req.destroy(e);reject(e);}else chunks.push(chunk);});
      res.on('end',()=>{
        try{
          const status=res.statusCode,headers=new Headers();
          for(const [k,v] of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);
          resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));
        }catch(e){reject(e);}
      });
    });
    req.on('error',reject);
    req.setTimeout(10000,()=>{const e=new Error('Timeout');e.code='ETIMEDOUT';req.destroy(e);});
    req.end(options.body);
  });
}
const NETWORK_CODES=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','ABORT_ERR','RESPONSE_LIMIT']);
function safeNetworkCode(e){const code=e?.cause?.code||e?.code;return NETWORK_CODES.has(code)?code:e?.name==='TimeoutError'?'ETIMEDOUT':'UNKNOWN';}
async function r2Request(cfg,method,key,fetcher=nativeRequest,payload=PNG,type='image/png'){
  let req;try{req=sign(cfg,method,key,new Date(),payload,type);}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(502,'R2 '+method+' request signing failed.');}
  try{return await fetcher(req.url,req.options);}catch(e){throw new ApiError(502,'R2 '+method+' network request failed. '+safeNetworkCode(e));}
}
async function roundTrip({env,owner,business,fetcher=nativeRequest,id=randomUUID(),payload=PNG,type='image/png'}){
  const cfg=config(env),key=testKey(owner,business,id,type);
  let created=false,verified=false,removed=false,missing=false;
  try{
    let r=await r2Request(cfg,'PUT',key,fetcher,payload,type);
    if(!r.ok)throw new ApiError(502,'R2 test upload failed. HTTP '+r.status+'.');
    created=true;
    r=await r2Request(cfg,'GET',key,fetcher);
    if(!r.ok)throw new ApiError(502,'R2 test retrieval failed. HTTP '+r.status+'.');
    if(r.headers.get('content-type')!==type)throw new ApiError(502,'R2 test retrieval returned an unexpected media type.');
    let bytes;try{bytes=Buffer.from(await r.arrayBuffer());}catch{throw new ApiError(502,'R2 test retrieval body could not be read.');}
    verified=bytes.equals(payload);
    if(!verified)throw new ApiError(502,'R2 test content did not match.');
  }finally{
    // Never delete a key unless this invocation received a successful PUT.
    if(created){
      try{
        const req=sign(cfg,'DELETE',key),r=await fetcher(req.url,req.options);
        removed=r.ok;
        if(removed){const check=sign(cfg,'GET',key),end=await fetcher(check.url,check.options);missing=end.status===404;}
      }catch{}
      if(!removed||!missing)throw new ApiError(502,'R2 test cleanup could not be verified; inspect test prefix.');
    }
  }
  return {uploaded:created,downloaded:verified,byteMatch:verified,deleted:removed,absenceVerified:missing,bytes:payload.length};
}
module.exports={UUID,ApiError,testKey,sign,roundTrip,config,r2Request};

module.exports.MAX_IMAGE=MAX_IMAGE;
