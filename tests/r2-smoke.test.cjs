'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {testKey,sign,roundTrip,config}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization}=require('../server/r2/auth.cjs');
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env={R2_ACCOUNT_ID:'a'.repeat(32),R2_BUCKET_NAME:'storenest-media',R2_ACCESS_KEY_ID:'fake',R2_SECRET_ACCESS_KEY:'fake-secret'};
test('test keys are tenant scoped and reject path traversal',()=>{
 assert.equal(testKey(a,b,c),'r2-integration-test/'+a+'/'+b+'/'+c+'.png');
 assert.throws(()=>testKey(a,'../other',c));assert.throws(()=>testKey(a,b,'../other'));
});
test('signer targets only R2 test prefix and signs create-only header',()=>{
 const {url,options}=sign(config(env),'PUT',testKey(a,b,c),new Date('2026-11-20T00:00:00Z'));
 assert.equal(url,'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/storenest-media/'+testKey(a,b,c));
 assert.equal(options.headers['if-none-match'],'*');
 assert.match(options.headers.authorization,/20261120\/auto\/s3\/aws4_request/);
 assert.match(options.headers.authorization,/Signature=[a-f0-9]{64}$/);
 assert.throws(()=>sign(config(env),'DELETE','existing-media.png'));
 assert.throws(()=>config({...env,R2_BUCKET_NAME:'streamx-media'}));
});
test('round trip verifies bytes and deletion',async()=>{
 let bytes;const calls=[];
 const fetcher=async(url,opts)=>{calls.push(opts.method);
 if(opts.method==='PUT'){bytes=opts.body;return new Response(null,{status:200});}
 if(opts.method==='DELETE'){bytes=undefined;return new Response(null,{status:204});}
 return bytes?new Response(bytes,{headers:{'content-length':String(bytes.length),'content-type':'image/png'}}):new Response(null,{status:404});
 };
 const r=await roundTrip({env,owner:a,business:b,id:c,fetcher});
 assert.equal(r.byteMatch,true);assert.equal(r.absenceVerified,true);assert.deepEqual(calls,['PUT','GET','DELETE','GET']);
});
test('collision does not delete existing object',async()=>{
 const calls=[];await assert.rejects(roundTrip({env,owner:a,business:b,id:c,fetcher:async(_,o)=>{calls.push(o.method);return new Response(null,{status:412});}}),/upload failed/);
 assert.deepEqual(calls,['PUT']);
});
test('authentication and owner check fail closed',async()=>{
 await assert.rejects(verifyOwner('',b),e=>e.status===401);
 let n=0;const token='Bearer '+ 'x'.repeat(30);
 await assert.rejects(verifyOwner(token,b,async()=>++n===1?Response.json({id:a}):Response.json([])),e=>e.status===403);
 n=0;assert.equal(await verifyOwner(token,b,async()=>++n===1?Response.json({id:a}):Response.json([{id:b,owner_id:a}])),a);
});

test('diagnostic body session must be a valid bearer-token string',()=>{
 const token='header.payload.'+'x'.repeat(30);
 assert.equal(sessionAuthorization(token),'Bearer '+token);
 for(const input of [undefined,{},[],['invalid'],'Bearer '+token,token+'\n','x'.repeat(16385)]){
  assert.throws(()=>sessionAuthorization(input),e=>e.status===401);
 }
});
test('invalid Supabase token is rejected and never reaches ownership lookup',async()=>{
 let calls=0;
 await assert.rejects(verifyOwner('Bearer '+'x'.repeat(30),b,async()=>{calls++;return new Response(null,{status:401});}),e=>e.status===401);
 assert.equal(calls,1);
});
