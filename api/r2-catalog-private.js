'use strict';
const {ApiError}=require('../server/r2/storage.cjs');
const {verifyOwner,sessionAuthorization}=require('../server/r2/auth.cjs');
const {draftOperation}=require('../server/r2/draft.cjs');
// Preview-only, no anonymous delivery or deletion of registered catalogue media.
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/r2-storage-integration')return res.status(404).json({error:'Not found.'});
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed.'});}
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'JSON required.'});
 try{
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'Invalid request.');
  const required=body.action==='upload'?['action','businessId','sessionToken','mime','base64']:['action','businessId','sessionToken','key'];
  if(!['upload','read'].includes(body.action)||Object.keys(body).length!==required.length||!required.every(k=>Object.hasOwn(body,k)))throw new ApiError(400,'Invalid catalogue media request.');
  const owner=await verifyOwner(sessionAuthorization(body.sessionToken),body.businessId);
  return res.status(200).json(await draftOperation({env:process.env,owner,business:body.businessId,action:body.action,key:body.key,mime:body.mime,base64:body.base64,namespace:'r2-catalog-private'}));
 }catch(e){const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:502;console.warn('R2 private catalogue operation failed',{status});return res.status(status).json({error:e instanceof ApiError?e.message:'Catalogue media operation failed.'});}
};
