'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');

const owner='11111111-1111-4111-8111-111111111111';
const business='22222222-2222-4222-8222-222222222222';
const item='33333333-3333-4333-8333-333333333333';
const id='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const pdf=Buffer.from('%PDF-1.7\nSynthetic CI evidence\n%%EOF');
const baseEnv={
  VERCEL_ENV:'preview',
  VERCEL_GIT_COMMIT_REF:'feat/listing-approval-operations',
  STORENEST_APPROVAL_PREVIEW_WRITES_ENABLED:'true',
  STORENEST_APPROVAL_PREVIEW_R2_BUCKET:'storenest-approval-ci',
  STORENEST_SUPABASE_URL:'https://synthetic-staging.supabase.co',
  STORENEST_SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key',
  STORENEST_SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key',
  R2_ACCOUNT_ID:'a'.repeat(32),
  R2_BUCKET_NAME:'storenest-approval-ci',
  R2_ACCESS_KEY_ID:'synthetic-access',
  R2_SECRET_ACCESS_KEY:'synthetic-secret'
};
const rpc=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function makeResponse(){
  const headers={};
  return {headers,statusCode:0,body:null,setHeader(k,v){headers[k]=v;return this;},status(s){this.statusCode=s;return this;},json(v){this.body=v;return this;},end(v){this.body=v;return this;},send(v){this.body=v;return this;}};
}
async function withEnv(env,fn){
  const names=new Set([...Object.keys(baseEnv),'STORENEST_APPROVAL_EVIDENCE_PRODUCTION_UPLOADS_ENABLED','STORENEST_APPROVAL_EVIDENCE_R2_BUCKET','STORENEST_HQ_APPROVAL_WRITES_ENABLED']);
  const previous=Object.fromEntries([...names].map(key=>[key,process.env[key]]));
  const priorFetch=global.fetch;
  try{
    for(const key of names){if(Object.hasOwn(env,key))process.env[key]=env[key];else delete process.env[key];}
    global.fetch=fn.fetcher||priorFetch;
    for(const path of ['../server/r2/auth.cjs','../server/r2/approval-evidence.cjs','../api/listing-approval-evidence.js'])delete require.cache[require.resolve(path)];
    const helper=require('../server/r2/approval-evidence.cjs');
    if(fn.configureHelper)fn.configureHelper(helper);
    const handler=require('../api/listing-approval-evidence.js');
    const response=makeResponse();
    const req={method:fn.method||'GET',url:fn.url||'/api/listing-approval-evidence',headers:fn.headers||{origin:'https://storenest.example',host:'storenest.example'},body:fn.body};
    await handler(req,response);
    return response;
  }finally{
    global.fetch=priorFetch;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    for(const path of ['../server/r2/auth.cjs','../server/r2/approval-evidence.cjs','../api/listing-approval-evidence.js'])delete require.cache[require.resolve(path)];
  }
}

test('evidence upload uses an isolated R2 bucket and verifies stored bytes and checksum',async()=>{
  const {uploadApprovalEvidence}=require('../server/r2/approval-evidence.cjs');
  const {ApiError}=require('../server/r2/storage.cjs');
  const objects=new Map(),methods=[];
  const fetcher=async(url,options)=>{
    methods.push(options.method);
    const key=new URL(url).pathname.split('/').slice(2).join('/');
    if(options.method==='PUT'){assert.equal(options.headers['if-none-match'],'*');objects.set(key,Buffer.from(options.body));return new Response(null,{status:200});}
    if(options.method==='GET')return new Response(objects.get(key),{status:200,headers:{'content-type':'application/pdf'}});
    throw new Error('Unexpected mocked R2 operation '+options.method);
  };
  const result=await uploadApprovalEvidence({env:{...baseEnv},owner,business,item,bytes:pdf,mime:'application/pdf',fetcher,id});
  assert.equal(result.verified,true);
  assert.equal(result.key,'r2-approval-evidence/'+owner+'/'+business+'/'+item+'/'+id+'.pdf');
  assert.equal(result.sha256,createHash('sha256').update(pdf).digest('hex'));
  assert.deepEqual(methods,['PUT','GET']);
  await assert.rejects(uploadApprovalEvidence({
    env:{...baseEnv,R2_BUCKET_NAME:'storenest-media',STORENEST_APPROVAL_PREVIEW_R2_BUCKET:'storenest-media'},
    owner,business,item,bytes:pdf,mime:'application/pdf',fetcher,id
  }),error=>error instanceof ApiError&&error.status===503);
  assert.deepEqual(methods,['PUT','GET'],'rejected public media bucket never reaches R2');
});

test('production evidence storage requires explicit flags and a separate private R2 bucket',()=>{
  const {evidenceR2Env}=require('../server/r2/approval-evidence.cjs');
  const {config}=require('../server/r2/storage.cjs');
  const production={
    ...baseEnv,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',
    STORENEST_SUPABASE_URL:'https://cypbjzbagezdelmemuhb.supabase.co',
    R2_BUCKET_NAME:'storenest-media',
    STORENEST_APPROVAL_EVIDENCE_R2_BUCKET:'storenest-approval-private'
  };
  assert.equal(evidenceR2Env(production),null,'production configuration is disabled by default');
  const enabled={...production,STORENEST_APPROVAL_EVIDENCE_PRODUCTION_UPLOADS_ENABLED:'true',STORENEST_HQ_APPROVAL_WRITES_ENABLED:'true'};
  assert.equal(evidenceR2Env(enabled).R2_BUCKET_NAME,'storenest-approval-private');
  assert.equal(config(evidenceR2Env(enabled)).bucket,'storenest-approval-private');
  assert.equal(evidenceR2Env({...enabled,STORENEST_APPROVAL_EVIDENCE_R2_BUCKET:'storenest-media'}),null);
  assert.equal(evidenceR2Env({...enabled,STORENEST_HQ_APPROVAL_WRITES_ENABLED:'false'}),null);
  assert.equal(evidenceR2Env({...enabled,STORENEST_SUPABASE_URL:'https://synthetic-staging.supabase.co'}),null);
});

test('evidence endpoint rejects production writes and rejects requests from another origin',async()=>{
  const production={...baseEnv,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',STORENEST_SUPABASE_URL:'https://cypbjzbagezdelmemuhb.supabase.co'};
  const blocked=await withEnv(production,{method:'POST',headers:{origin:'https://storenest.example',host:'storenest.example'}});
  assert.equal(blocked.statusCode,404);
  const crossSite=await withEnv(baseEnv,{method:'GET',headers:{origin:'https://attacker.example',host:'storenest.example'}});
  assert.equal(crossSite.statusCode,403);
  const preview=await withEnv(baseEnv,{method:'GET',url:'/api/listing-approval-evidence?file='+id,headers:{origin:'https://storenest.example',host:'storenest.example'}});
  assert.equal(preview.statusCode,401,'isolated preview is reachable but a missing session is rejected');
});

test('owner upload authorization rejects a different business owner before any R2 request',async()=>{
  let r2Requests=0;
  const fetcher=async(url)=>{
    if(String(url).endsWith('/auth/v1/user'))return rpc({id:owner});
    if(String(url).includes('/rest/v1/businesses?'))return rpc([]);
    if(String(url).includes('r2.cloudflarestorage.com'))r2Requests++;
    throw new Error('Unexpected request '+url);
  };
  const response=await withEnv(baseEnv,{
    method:'POST',fetcher,headers:{origin:'https://storenest.example',host:'storenest.example','content-type':'application/json'},
    body:{businessId:business,sessionToken:'synthetic-session-token-123456789',requestId,fileName:'test.pdf',mime:'application/pdf',base64:pdf.toString('base64')}
  });
  assert.equal(response.statusCode,403);
  assert.equal(r2Requests,0);
});

test('owner evidence retrieval rejects an unauthorized file before R2 access',async()=>{
  let r2Requests=0;
  const fetcher=async(url)=>{
    if(String(url).includes('/rest/v1/rpc/business_owner_listing_evidence_file'))return rpc({message:'denied'},403);
    if(String(url).includes('r2.cloudflarestorage.com'))r2Requests++;
    throw new Error('Unexpected request '+url);
  };
  const response=await withEnv(baseEnv,{
    method:'GET',url:'/api/listing-approval-evidence?file='+id,fetcher,
    headers:{origin:'https://storenest.example',host:'storenest.example',authorization:'Bearer synthetic-session-token-123456789'}
  });
  assert.equal(response.statusCode,403);
  assert.equal(r2Requests,0);
});

test('authorized owner retrieves only the owner-scoped evidence record and bytes are reverified',async()=>{
  const digest=createHash('sha256').update(pdf).digest('hex');
  let r2Reads=0;
  const fetcher=async(url,options)=>{
    if(String(url).includes('/rest/v1/rpc/business_owner_listing_evidence_file'))return rpc({
      id,owner_id:owner,business_id:business,item_id:item,
      object_key:'r2-approval-evidence/'+owner+'/'+business+'/'+item+'/'+id+'.pdf',
      file_name:'support.pdf',content_type:'application/pdf',byte_size:pdf.length,sha256:digest
    });
    if(String(url).includes('r2.cloudflarestorage.com')){
      r2Reads++;assert.equal(options.method,'GET');
      return new Response(pdf,{status:200,headers:{'content-type':'application/pdf'}});
    }
    throw new Error('Unexpected request '+url);
  };
  const response=await withEnv(baseEnv,{
    method:'GET',url:'/api/listing-approval-evidence?file='+id,fetcher,
    configureHelper(helper){
      const read=helper.readApprovalEvidence;
      helper.readApprovalEvidence=args=>read({...args,fetcher:async()=>{r2Reads++;return new Response(pdf,{status:200,headers:{'content-type':'application/pdf'}});}});
    },
    headers:{origin:'https://storenest.example',host:'storenest.example',authorization:'Bearer synthetic-session-token-123456789'}
  });
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['Content-Disposition'],'attachment; filename="support.pdf"');
  assert.deepEqual(response.body,pdf);
  assert.equal(r2Reads,1);
});

test('identical evidence already recorded is returned without uploading another object',async()=>{
  const digest=createHash('sha256').update(pdf).digest('hex');
  let r2Requests=0,hashChecks=0;
  const fetcher=async(url,options)=>{
    const value=String(url);
    if(value.endsWith('/auth/v1/user'))return rpc({id:owner});
    if(value.includes('/rest/v1/businesses?'))return rpc([{id:business,owner_id:owner}]);
    if(value.includes('/rpc/business_owner_listing_evidence_context'))return rpc({business_id:business,owner_id:owner,item_id:item,status:'submitted'});
    if(value.includes('/rpc/business_owner_find_listing_evidence_by_hash')){
      hashChecks++;assert.equal(JSON.parse(options.body).p_sha256,digest);
      return rpc({id,object_key:'r2-approval-evidence/'+owner+'/'+business+'/'+item+'/'+id+'.pdf'});
    }
    if(value.includes('r2.cloudflarestorage.com'))r2Requests++;
    throw new Error('Unexpected request '+value);
  };
  const response=await withEnv(baseEnv,{
    method:'POST',fetcher,headers:{origin:'https://storenest.example',host:'storenest.example','content-type':'application/json'},
    body:{businessId:business,sessionToken:'synthetic-session-token-123456789',requestId,fileName:'test.pdf',mime:'application/pdf',base64:pdf.toString('base64')}
  });
  assert.equal(response.statusCode,200);
  assert.equal(response.body.duplicate,true);
  assert.equal(response.body.fileId,id);
  assert.equal(hashChecks,1);
  assert.equal(r2Requests,0);
});

test('failed database recording removes an unreferenced uploaded object after a conclusive hash check',async()=>{
  const objects=new Map(),r2Methods=[];
  let recordCalls=0,hashCalls=0;
  const fetcher=async(url,options)=>{
    const value=String(url);
    if(value.endsWith('/auth/v1/user'))return rpc({id:owner});
    if(value.includes('/rest/v1/businesses?'))return rpc([{id:business,owner_id:owner}]);
    if(value.includes('/rpc/business_owner_listing_evidence_context'))return rpc({business_id:business,owner_id:owner,item_id:item,status:'requested'});
    if(value.includes('/rpc/business_owner_find_listing_evidence_by_hash')){hashCalls++;return rpc(null);}
    if(value.includes('/rpc/business_owner_submit_listing_evidence')){recordCalls++;return rpc({message:'database unavailable'},503);}
    if(value.includes('r2.cloudflarestorage.com')){
      r2Methods.push(options.method);
      const key=new URL(value).pathname.split('/').slice(2).join('/');
      if(options.method==='PUT'){objects.set(key,Buffer.from(options.body));return new Response(null,{status:200});}
      if(options.method==='GET')return new Response(objects.get(key),{status:200,headers:{'content-type':'application/pdf'}});
      if(options.method==='DELETE'){objects.delete(key);return new Response(null,{status:204});}
    }
    throw new Error('Unexpected request '+value);
  };
  const response=await withEnv(baseEnv,{
    method:'POST',fetcher,headers:{origin:'https://storenest.example',host:'storenest.example','content-type':'application/json'},
    configureHelper(helper){
      const upload=helper.uploadApprovalEvidence,remove=helper.removeApprovalEvidence;
      const mockR2=async(url,options)=>{
        r2Methods.push(options.method);
        const key=new URL(url).pathname.split('/').slice(2).join('/');
        if(options.method==='PUT'){objects.set(key,Buffer.from(options.body));return new Response(null,{status:200});}
        if(options.method==='GET')return new Response(objects.get(key),{status:200,headers:{'content-type':'application/pdf'}});
        if(options.method==='DELETE'){objects.delete(key);return new Response(null,{status:204});}
        throw new Error('Unexpected mock R2 operation '+options.method);
      };
      helper.uploadApprovalEvidence=args=>upload({...args,fetcher:mockR2});
      helper.removeApprovalEvidence=args=>remove({...args,fetcher:mockR2});
    },
    body:{businessId:business,sessionToken:'synthetic-session-token-123456789',requestId,fileName:'test.pdf',mime:'application/pdf',base64:pdf.toString('base64')}
  });
  assert.equal(response.statusCode,503);
  assert.equal(recordCalls,1);
  assert.equal(hashCalls,2,'the route checks duplicates before and after upload');
  assert.deepEqual(r2Methods,['PUT','GET','DELETE']);
  assert.equal(objects.size,0);
});
