'use strict';
const {UUID,ApiError,config,r2Request,MAX_IMAGE}=require('./storage.cjs');
const {BASE,PUBLIC_KEY,sessionAuthorization}=require('./auth.cjs');
const {decodeImage}=require('./image-test.cjs');
const REF=/^r2:\/\/storenest-media\/r2-catalog-private\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
async function readCatalogueImage({env,item,ref,review=false,token,dbFetch=fetch,r2Fetch}){
 if(typeof item!=='string'||!UUID.test(item)||typeof ref!=='string'||!REF.test(ref))throw new ApiError(404,'Image unavailable.');
 const headers={apikey:PUBLIC_KEY,'content-type':'application/json'};
 if(review)headers.authorization=sessionAuthorization(token);
 // customer requests deliberately use anonymous access, not the caller's session.
 const check=await dbFetch(BASE+'/rest/v1/rpc/resolve_catalogue_image',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(8000),body:JSON.stringify({p_item:item,p_ref:ref,p_review:review})});
 if(!check.ok)throw new ApiError(check.status===401||check.status===403?403:503,'Image authorization unavailable.');
 if(await check.json()!==ref)throw new ApiError(404,'Image unavailable.');
 const upstream=await r2Request(config(env),'GET',ref.slice('r2://storenest-media/'.length),r2Fetch);
 if(!upstream.ok)throw new ApiError(404,'Image unavailable.');
 const mime=upstream.headers.get('content-type'),bytes=Buffer.from(await upstream.arrayBuffer());
 if(!bytes.length||bytes.length>MAX_IMAGE)throw new ApiError(502,'Invalid image.');
 decodeImage(bytes.toString('base64'),mime);
 return {mime,bytes};
}
module.exports={readCatalogueImage};
