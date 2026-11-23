'use strict';
const {ApiError,roundTrip}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization}=require('../server/r2/auth.cjs');
const {decodeImage}=require('../server/r2/image-test.cjs');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/r2-storage-integration')return res.status(404).json({error:'Not found.'});
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed.'});}
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'JSON required.'});
 let stage='request';
 try{
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==4||!['businessId','sessionToken','mime','base64'].every(k=>Object.hasOwn(body,k)))throw new ApiError(400,'Invalid test request.');
  stage='supabase-authorization';
  const owner=await verifyOwner(sessionAuthorization(body.sessionToken),body.businessId);
  stage='image-validation';
  const payload=decodeImage(body.base64,body.mime);
  stage='r2-round-trip';
  return res.status(200).json(await roundTrip({env:process.env,owner,business:body.businessId,payload,type:body.mime}));
 }catch(e){
  const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:502;
  console.warn('R2 image test failed',{stage,status});
  return res.status(status).json({stage,error:e instanceof ApiError?e.message:'Image test failed.'});
 }
};
