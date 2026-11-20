'use strict';
const {UUID,ApiError}=require('./storage.cjs');
const BASE='https://cypbjzbagezdelmemuhb.supabase.co';
const PUBLIC_KEY="sb_publishable_8W8zyYtggQMWoFlnxrzoVA_BUKjQ9va";
// Diagnostic only: accept the token in an HTTPS POST body because the preview
// proxy did not reliably forward authorization headers. Never log the body.
function sessionAuthorization(token){
  if(typeof token!=='string'||!token)throw new ApiError(401,'StoreNest session was not received.');
  if(token.length<20||token.length>16384||/[^A-Za-z0-9._~+\/=\-]/.test(token))
    throw new ApiError(401,'StoreNest session format is invalid.');
  return 'Bearer '+token;
}
async function verifyOwner(authorization,business,fetcher=fetch){
  if(typeof business!=='string'||!UUID.test(business))throw new ApiError(400,'Invalid business identifier.');
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw new ApiError(401,'Sign in first.');
  authorization=sessionAuthorization(authorization.slice(7));
  const headers={apikey:PUBLIC_KEY,authorization};
  const opts={headers,redirect:'error',signal:AbortSignal.timeout(8000)};
  const userResponse=await fetcher(BASE+'/auth/v1/user',opts);
  if(userResponse.status===401||userResponse.status===403)throw new ApiError(401,'Invalid session.');
  if(!userResponse.ok)throw new ApiError(502,'Authentication service unavailable.');
  const user=await userResponse.json();
  if(typeof user.id!=='string'||!UUID.test(user.id))throw new ApiError(401,'Invalid session.');
  const params=new URLSearchParams({select:'id,owner_id',id:'eq.'+business,owner_id:'eq.'+user.id,limit:'1'});
  const response=await fetcher(BASE+'/rest/v1/businesses?'+params,opts);
  if(!response.ok)throw new ApiError(response.status===401?401:response.status===403?403:502,'Business verification failed.');
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==business||rows[0].owner_id!==user.id)throw new ApiError(403,'Business ownership required.');
  return user.id;
}
module.exports={verifyOwner,sessionAuthorization};
