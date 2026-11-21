'use strict';
const {ApiError}=require('../server/r2/storage.cjs');
const {readCatalogueImage}=require('../server/r2/public-media.cjs');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feat/r2-storage-integration')return res.status(404).end();
 try{
  const review=req.method==='POST';
  if(!review&&req.method!=='GET')return res.status(405).end();
  const input=review?(typeof req.body==='string'?JSON.parse(req.body):req.body):req.query;
  const {mime,bytes}=await readCatalogueImage({env:process.env,item:input?.item,ref:input?.ref,review,token:review?input?.sessionToken:undefined});
  res.setHeader('Content-Type',mime);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  return res.status(200).send(bytes);
 }catch(e){return res.status(e instanceof ApiError?e.status:503).end();}
};
