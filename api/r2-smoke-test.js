'use strict';
const {ApiError,roundTrip}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization}=require('../server/r2/auth.cjs');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/r2-storage-integration')return res.status(404).json({error:'Not found.'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed.'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'JSON required.'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'businessId')||!Object.hasOwn(body,'sessionToken'))throw new ApiError(400,'Provide a businessId and sessionToken.');
    const owner=await verifyOwner(sessionAuthorization(body.sessionToken),body.businessId);
    const result=await roundTrip({env:process.env,owner,business:body.businessId});
    return res.status(200).json(result);
  }catch(e){
    const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:502;
    return res.status(status).json({error:e instanceof ApiError?e.message:status===400?'Invalid JSON.':'Storage test failed.'});
  }
};
