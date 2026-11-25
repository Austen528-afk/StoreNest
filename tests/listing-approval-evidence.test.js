'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');

const owner='11111111-1111-4111-8111-111111111111';
const business='22222222-2222-4222-8222-222222222222';
const item='33333333-3333-4333-8333-333333333333';
const id='44444444-4444-4444-8444-444444444444';
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

test('evidence upload is scoped to a non-production preview bucket and verified with a mocked R2 adapter',async()=>{
  const {uploadApprovalEvidence}=require('../server/r2/approval-evidence.cjs');
  const {ApiError}=require('../server/r2/storage.cjs');
  const objects=new Map(),methods=[];
  const fetcher=async(url,options)=>{
    methods.push(options.method);
    const key=new URL(url).pathname.split('/').slice(2).join('/');
    if(options.method==='PUT'){
      assert.equal(options.headers['if-none-match'],'*');
      objects.set(key,Buffer.from(options.body));
      return new Response(null,{status:200});
    }
    if(options.method==='GET'){
      assert.ok(objects.has(key));
      return new Response(objects.get(key),{status:200,headers:{'content-type':'application/pdf'}});
    }
    throw new Error('Unexpected mocked R2 operation '+options.method);
  };
  const env={...baseEnv};
  const result=await uploadApprovalEvidence({env,owner,business,item,bytes:pdf,mime:'application/pdf',fetcher,id});
  assert.equal(result.verified,true);
  assert.equal(result.key,`r2-approval-evidence/${owner}/${business}/${item}/${id}.pdf`);
  assert.equal(result.sha256,createHash('sha256').update(pdf).digest('hex'));
  assert.deepEqual(methods,['PUT','GET']);

  await assert.rejects(uploadApprovalEvidence({
    env:{...env,R2_BUCKET_NAME:'storenest-media',STORENEST_APPROVAL_PREVIEW_R2_BUCKET:'storenest-media'},
    owner,business,item,bytes:pdf,mime:'application/pdf',fetcher,id
  }),error=>error instanceof ApiError&&error.status===503);
  assert.deepEqual(methods,['PUT','GET'],'rejected production bucket never reaches the mock R2 adapter');
});

test('evidence route rejects production Supabase and accepts only explicitly isolated preview configuration',async()=>{
  const keys=Object.keys(baseEnv);
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  async function callWith(env){
    for(const key of keys){if(Object.hasOwn(env,key))process.env[key]=env[key];else delete process.env[key];}
    delete require.cache[require.resolve('../server/r2/auth.cjs')];
    delete require.cache[require.resolve('../api/listing-approval-evidence.js')];
    const handler=require('../api/listing-approval-evidence.js');
    const headers={};
    const res={statusCode:0,body:null,setHeader(key,value){headers[key]=value;return this;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    await handler({method:'GET',headers:{},url:'/api/listing-approval-evidence'},res);
    return res.statusCode;
  }
  try{
    assert.equal(await callWith({...baseEnv,STORENEST_SUPABASE_URL:'https://cypbjzbagezdelmemuhb.supabase.co'}),404);
    assert.equal(await callWith({...baseEnv,R2_BUCKET_NAME:'storenest-media',STORENEST_APPROVAL_PREVIEW_R2_BUCKET:'storenest-media'}),404);
    assert.equal(await callWith(baseEnv),405,'isolated preview passes the write gate but GET remains unsupported');
    assert.equal(await callWith({...baseEnv,VERCEL_GIT_COMMIT_REF:'main'}),404);
  }finally{
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    delete require.cache[require.resolve('../server/r2/auth.cjs')];
    delete require.cache[require.resolve('../api/listing-approval-evidence.js')];
  }
});
