'use strict';
const {createHash,createHmac,randomUUID}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX='r2-integration-test';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64');
class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
function testKey(owner,business,id=randomUUID()){
  if(![owner,business,id].every(x=>typeof x==='string'&&UUID.test(x)))throw new ApiError(400,'Invalid identifier.');
  return [PREFIX,owner.toLowerCase(),business.toLowerCase(),id.toLowerCase()+'.png'].join('/');
}
const sha=x=>createHash('sha256').update(x).digest('hex');
const hmac=(k,x,encoding)=>createHmac('sha256',k).update(x).digest(encoding);
function config(env){
  const {R2_ACCOUNT_ID:account,R2_BUCKET_NAME:bucket,R2_ACCESS_KEY_ID:access,R2_SECRET_ACCESS_KEY:secret}=env;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||bucket!=='storenest-media'||!access||!secret)throw new ApiError(503,'Storage is not configured.');
  return {account,bucket,access,secret};
}
// S3 Signature Version 4, path-style endpoint, R2 auto region.
// Only accepts server-generated test keys and the fixed test object.
function sign({account,bucket,access,secret},method,key,now=new Date()){
  if(!['PUT','GET','DELETE'].includes(method)||!new RegExp('^'+PREFIX+'/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.png$').test(key))throw new ApiError(400,'Invalid storage operation.');
  const host=account+'.r2.cloudflarestorage.com';
  const path='/'+bucket+'/'+key;
  const date=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=date.slice(0,8),scope=day+'/auto/s3/aws4_request';
  const body=method==='PUT'?PNG:Buffer.alloc(0);
  const headers={host,'x-amz-content-sha256':sha(body),'x-amz-date':date};
  if(method==='PUT'){headers['content-type']='image/png';headers['if-none-match']='*';headers['cache-control']='no-store';}
  const names=Object.keys(headers).sort(),signed=names.join(';');
  const canonical=names.map(n=>n+':'+headers[n]+'\n').join('');
  const request=[method,path,'',canonical,signed,sha(body)].join('\n');
  const toSign=['AWS4-HMAC-SHA256',date,scope,sha(request)].join('\n');
  const k=hmac(hmac(hmac(hmac('AWS4'+secret,day),'auto'),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+hmac(k,toSign,'hex');
  return {url:'https://'+host+path,options:{method,headers,redirect:'error',...(method==='PUT'?{body}:{}),signal:AbortSignal.timeout(10000)}};
}
async function roundTrip({env,owner,business,fetcher=fetch,id=randomUUID()}){
  const cfg=config(env),key=testKey(owner,business,id);
  let created=false,verified=false,removed=false,missing=false;
  try{
    let req=sign(cfg,'PUT',key),r=await fetcher(req.url,req.options);
    if(!r.ok)throw new ApiError(502,'R2 test upload failed.');
    created=true;
    req=sign(cfg,'GET',key);r=await fetcher(req.url,req.options);
    if(!r.ok||r.headers.get('content-length')!==String(PNG.length)||r.headers.get('content-type')!=='image/png')throw new ApiError(502,'R2 test retrieval failed.');
    const bytes=Buffer.from(await r.arrayBuffer());
    verified=bytes.equals(PNG);
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
  return {uploaded:created,downloaded:verified,byteMatch:verified,deleted:removed,absenceVerified:missing,bytes:PNG.length};
}
module.exports={UUID,ApiError,testKey,sign,roundTrip,config};
