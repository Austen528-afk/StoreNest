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

test('network failures identify the failing service without exposing credentials',async()=>{
 await assert.rejects(verifyOwner('Bearer '+'x'.repeat(30),b,async()=>{throw Error('secret internal details');}),/Supabase session verification network request failed/);
 await assert.rejects(roundTrip({env,owner:a,business:b,id:c,fetcher:async()=>{throw Error('secret internal details');}}),/R2 PUT network request failed/);
});

test('network diagnostic reports allowlisted codes only',async()=>{
 await assert.rejects(roundTrip({env,owner:a,business:b,id:c,fetcher:async()=>{throw Object.assign(new Error('private data'),{code:'ENOTFOUND'});}}),/ENOTFOUND/);
 assert.throws(()=>config({...env,R2_SECRET_ACCESS_KEY:'bad\nkey'}),/whitespace or invalid characters/);
});

test('real-image test validates content and rejects disguised or oversized payloads',()=>{
 const {decodeImage}=require('../server/r2/image-test.cjs');
 const original='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 assert.equal(decodeImage(original,'image/png').length,68);
 assert.throws(()=>decodeImage(original,'image/jpeg'),e=>e.status===415);
 assert.throws(()=>decodeImage(Buffer.from('<svg/>').toString('base64'),'image/svg+xml'),e=>e.status===415);
 assert.throws(()=>decodeImage('A'.repeat(3000000),'image/png'),e=>e.status===400);
});
test('image signing uses actual payload and media type',async()=>{
 const image=Buffer.from('RIFF0000WEBPVP8 test');
 const calls=[];let stored;
 const fetcher=async(url,opts)=>{
  calls.push(opts.method);assert.match(url,/\.webp$/);
  if(opts.method==='PUT'){assert.equal(opts.headers['content-type'],'image/webp');stored=opts.body;return new Response(null,{status:200});}
  if(opts.method==='DELETE'){stored=null;return new Response(null,{status:204});}
  return stored?new Response(stored,{headers:{'content-type':'image/webp'}}):new Response(null,{status:404});
 };
 const result=await roundTrip({env,owner:a,business:b,id:c,fetcher,payload:image,type:'image/webp'});
 assert.equal(result.bytes,image.length);assert.equal(result.absenceVerified,true);assert.deepEqual(calls,['PUT','GET','DELETE','GET']);
});

test('persistent draft is retained after upload, can be read, and explicitly deleted',async()=>{
 const {draftOperation}=require('../server/r2/draft.cjs');
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 const calls=[];let bytes;
 const fetcher=async(url,opts)=>{
  calls.push(opts.method);assert.match(url,/\/r2-catalog-draft\//);
  if(opts.method==='PUT'){bytes=opts.body;return new Response(null,{status:200});}
  if(opts.method==='DELETE'){bytes=null;return new Response(null,{status:204});}
  return bytes?new Response(bytes,{headers:{'content-type':'image/png'}}):new Response(null,{status:404});
 };
 const common={env,owner:a,business:b,fetcher,id:c};
 const saved=await draftOperation({...common,action:'upload',mime:'image/png',base64});
 assert.equal(saved.verified,true);assert.deepEqual(calls,['PUT','GET']);
 const loaded=await draftOperation({...common,action:'read',key:saved.key});
 assert.equal(loaded.sha256,saved.sha256);assert.equal(loaded.base64,base64);
 await assert.rejects(draftOperation({...common,business:c,action:'delete',key:saved.key}),e=>e.status===403);
 assert.equal((await draftOperation({...common,action:'delete',key:saved.key})).deleted,true);
 assert.deepEqual(calls,['PUT','GET','GET','DELETE','GET']);
});

test('registered private catalogue media is separate from draft keys and cannot be deleted by the draft API',async()=>{
 const {draftOperation,scopedKey}=require('../server/r2/draft.cjs');
 const key='r2-catalog-private/'+a+'/'+b+'/'+c+'.png';
 assert.throws(()=>scopedKey(a,b,key),e=>e.status===403);
 assert.equal(scopedKey(a,b,key,'r2-catalog-private'),key);
 assert.throws(()=>scopedKey(a,c,key,'r2-catalog-private'),e=>e.status===403);
 await assert.rejects(draftOperation({env,owner:a,business:b,action:'delete',key,namespace:'r2-catalog-private'}),e=>e.status===403);
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 let stored;const calls=[];
 const fetcher=async(url,options)=>{
  assert.match(url,/\/r2-catalog-private\//);calls.push(options.method);
  if(options.method==='PUT'){stored=options.body;return new Response(null,{status:200});}
  return new Response(stored,{headers:{'content-type':'image/png'}});
 };
 const result=await draftOperation({env,owner:a,business:b,id:c,action:'upload',mime:'image/png',base64,namespace:'r2-catalog-private',fetcher});
 assert.equal(result.key,key);assert.equal(result.verified,true);assert.deepEqual(calls,['PUT','GET']);
});
test('catalogue preview source keeps public visibility off and does not use a draft delete path',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../business-owner.html'),'utf8');
 assert.match(html,/if\(privateSave\)\{[\s\S]*?row\.is_available=false;[\s\S]*?\.from\("business_items"\)\.insert\(\{\.\.\.row,id:savedId\}\)/);
 assert.match(html,/privateSave\?"\/api\/r2-catalog-private":"\/api\/r2-catalog-draft"/);
 assert.match(html,/void renderPrivateR2Cover\(card,item\)/);
});

test('private catalogue normalization preserves references and hashes, without accepting arbitrary URI schemes',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').join(__dirname,'../business-owner.html'),'utf8');
 const extract=(from,to)=>{const i=html.indexOf(from),j=html.indexOf(to,i);assert.ok(i>=0&&j>i);return html.slice(i,j);};
 const ctx={};vm.createContext(ctx);
 vm.runInContext(extract('const R2_PRIVATE_URI=','async function loadPrivateR2Image')+extract('function normalizeCatalogMedia','function catalogMediaEntries'),ctx);
 const url='r2://storenest-media/r2-catalog-private/'+a+'/'+b+'/'+c+'.png';
 const obj=ctx.normalizeCatalogMedia({url,width:400,height:600,sha256:'hash',variants:[{url:url.replace('.png','.webp'),width:300,sha256:'variant-hash'}]});
 assert.equal(obj.url,url);assert.equal(obj.sha256,'hash');assert.equal(obj.variants[0].sha256,'variant-hash');
 assert.equal(ctx.normalizeCatalogMedia('javascript:alert(1)'),null);
 assert.equal(ctx.normalizeCatalogMedia('r2://storenest-media/r2-catalog-draft/'+a+'/'+b+'/'+c+'.png'),null);
 assert.equal(ctx.normalizeCatalogMedia('https://example.com/image.jpg').url,'https://example.com/image.jpg');
});
test('owner edit uses optimistic version check and preserves unavailable status',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../business-owner.html'),'utf8');
 assert.match(html,/\.update\(row\)\.eq\("id",savedId\)\.eq\("business_id",draftContext\.business\)\.eq\("updated_at",version\)/);
 assert.match(html,/if\(\(r2DraftMode\|\|privateSave\)&&entry\.file\)/);
 assert.match(html,/Removal is disabled until safe archiving preserves historical bookings and analytics/);
});

test('owner dashboard inline JavaScript parses without syntax errors',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'../business-owner.html'),'utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/.test(match[1])||/\btype\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(match[1]))continue;
  if(match[2].trim())new vm.Script(match[2]);
 }
});

test('customer preview only accepts scoped private reference format and permits only created blob URLs',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'../storefront.html'),'utf8');
 const grab=(s,e)=>{const i=html.indexOf(s),j=html.indexOf(e,i);assert.ok(i>=0&&j>i);return html.slice(i,j);};
 const ctx={URL,ownerCataloguePreview:true,privatePreviewUrls:new Set(['blob:known'])};vm.createContext(ctx);
 vm.runInContext(grab('function safeUrl','function isProductVideo')+grab('function isPrivatePreviewRef','function installOwnerPreviewGuard'),ctx);
 assert.equal(ctx.safeUrl('blob:known'),'blob:known');assert.equal(ctx.safeUrl('blob:unknown'),'');
 assert.equal(ctx.isPrivatePreviewRef('r2://storenest-media/r2-catalog-private/'+a+'/'+b+'/'+c+'.png'),true);
 assert.equal(ctx.isPrivatePreviewRef('r2://storenest-media/r2-catalog-draft/'+a+'/'+b+'/'+c+'.png'),false);
 assert.match(html,/if\(ownerCataloguePreview\)\{await loadOwnerCataloguePreview\(root,slug\);return;\}/);
 assert.match(html,/\.eq\("owner_id",user\.id\)/);
 assert.match(html,/if\(readOnly\)return;\s*syncCartBadge/);
 assert.match(html,/renderPublishedStorefront\(root,null,business,items,sections\.data\|\|\[\],true\)/);
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/.test(match[1])||/\btype\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(match[1]))continue;
  if(match[2].trim())new vm.Script(match[2]);
 }
});

test('public R2 image delivery fails closed before storage read when approval RPC is absent or refuses reference',async()=>{
 const {readCatalogueImage}=require('../server/r2/public-media.cjs');
 const ref='r2://storenest-media/r2-catalog-private/'+a+'/'+b+'/'+c+'.png';
 let reads=0;
 for(const dbFetch of [async()=>new Response(null,{status:404}),async()=>Response.json(null),async()=>Response.json(ref+'other')]){
  await assert.rejects(readCatalogueImage({env,item:c,ref,dbFetch,r2Fetch:async()=>{reads++;throw Error('must not read');}}));
 }
 assert.equal(reads,0);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64');
 const image=await readCatalogueImage({env,item:c,ref,dbFetch:async(url,opts)=>{assert.equal(opts.headers.authorization,undefined);assert.equal(JSON.parse(opts.body).p_review,false);return Response.json(ref)},r2Fetch:async()=>new Response(png,{headers:{'content-type':'image/png'}})});
 assert.equal(image.bytes.equals(png),true);
});
test('superseded Marketplace approval SQL is clearly marked read-only',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.join(__dirname,'../docs/listing-approval-candidate.sql'),'utf8');
 assert.match(sql,/SUPERSEDED — DO NOT APPLY/);
 assert.match(sql,/sole authoritative approval migration candidate is maintained in/i);
});
