'use strict';
const {config,testKey,r2Request,ApiError}=require('../server/r2/storage.cjs');
const {randomUUID}=require('node:crypto');
// Protected preview only. No user-supplied paths, no mutation, no object contents returned.
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/r2-storage-integration')return res.status(404).json({error:'Not found.'});
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
 let stage='configuration';
 try{
  const cfg=config(process.env);
  stage='r2-read';
  const r=await r2Request(cfg,'GET',testKey(randomUUID(),randomUUID()));
  if(r.status===404){
   const xml=await r.text();
   return res.status(200).json({stage,upstreamStatus:404,missingObject:/<Code>NoSuchKey<\/Code>/.test(xml),missingBucket:/<Code>NoSuchBucket<\/Code>/.test(xml)});
  }
  if(r.body)await r.body.cancel();
  return res.status(200).json({stage,upstreamStatus:r.status,missingObject:false});
 }catch(e){return res.status(502).json({stage,error:e instanceof ApiError?e.message:'Unexpected readiness failure.'});}
};
