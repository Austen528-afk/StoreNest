'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('business owner view shows review status and feedback with the existing edit path',()=>{
 const source=fs.readFileSync('listing-approval-owner.js','utf8');
 assert.match(source,/business_owner_listing_evaluation_queue/);
 assert.match(source,/approval_status/);
 assert.match(source,/approval_note/);
 assert.match(source,/Edit this listing and save your changes/);
 assert.doesNotMatch(source,/evidence|upload|business_owner_resubmit_listing|can_resubmit/i);
});
test('basic approval owner panel has no file controls or evidence styling',()=>{
 const css=fs.readFileSync('listing-approval-owner.css','utf8');
 assert.doesNotMatch(css,/file|evidence|upload/i);
});
test('preview R2 bucket remains isolated from the production StoreNest database',()=>{
 const {config}=require('../server/r2/storage.cjs');
 const isolated={
  VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/listing-approval-operations',
  STORENEST_APPROVAL_PREVIEW_WRITES_ENABLED:'true',
  STORENEST_APPROVAL_PREVIEW_SUPABASE_HOST:'preview-project.supabase.co',
  STORENEST_SUPABASE_URL:'https://preview-project.supabase.co',
  STORENEST_APPROVAL_PREVIEW_R2_BUCKET:'storenest-approval-preview',
  R2_ACCOUNT_ID:'a'.repeat(32),R2_BUCKET_NAME:'storenest-approval-preview',
  R2_ACCESS_KEY_ID:'synthetic-preview-access',R2_SECRET_ACCESS_KEY:'synthetic-preview-secret'
 };
 assert.equal(config(isolated).bucket,'storenest-approval-preview');
 assert.throws(()=>config({...isolated,STORENEST_SUPABASE_URL:'https://cypbjzbagezdelmemuhb.supabase.co'}),/Storage is not configured/);
 assert.throws(()=>config({...isolated,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main'}),/Storage is not configured/);
});
