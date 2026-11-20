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
  const xml=await r.text();
  const code=/<Code>([A-Za-z0-9]+)<\/Code>/.exec(xml)?.[1];
  const known=['InvalidArgument','InvalidRequest','InvalidAccessKeyId','SignatureDoesNotMatch','AccessDenied','AuthorizationHeaderMalformed','RequestTimeTooSkewed','InvalidToken','ExpiredToken','BadRequest','NotImplemented','InternalError','InvalidBucketName','InvalidURI','InvalidSecurity','InvalidDigest','MissingSecurityHeader'];
  return res.status(200).json({stage,upstreamStatus:r.status,missingObject:false,upstreamCode:known.includes(code)?code:'Unclassified',accessKeyFormat:/^[a-f0-9]{32}$/i.test(cfg.access),secretKeyFormat:/^[a-f0-9]{64}$/i.test(cfg.secret)});
 }catch(e){return res.status(502).json({stage,error:e instanceof ApiError?e.message:'Unexpected readiness failure.'});}
};
