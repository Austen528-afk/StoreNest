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

test('new live products and services require a valid storefront category before save',()=>{
 const source=fs.readFileSync('business-owner.html','utf8'),vm=require('node:vm');
 assert.match(source,/categorySelect\.required=!item&&!r2DraftMode&&!r2CatalogueMode/);
 assert.match(source,/categoryPlaceholder\.textContent=categorySelect\.required\?"Choose a category":"No section"/);
 const start=source.indexOf('function validateListingCategory('),end=source.indexOf('\nfunction renderCategories',start);
 assert.ok(start>=0&&end>start);
 const context={};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const categories=[{id:'section-a'}];
 assert.doesNotThrow(()=>context.validateListingCategory({itemId:'',selectedCategoryId:'section-a',businessCategories:categories}));
 assert.throws(()=>context.validateListingCategory({itemId:'',selectedCategoryId:'',businessCategories:categories}),/Choose or add a category/);
 assert.throws(()=>context.validateListingCategory({itemId:'',selectedCategoryId:'foreign',businessCategories:categories}),/belonging to this storefront/);
 assert.doesNotThrow(()=>context.validateListingCategory({itemId:'',selectedCategoryId:'',businessCategories:[],privateSave:true}));
 assert.doesNotThrow(()=>context.validateListingCategory({itemId:'',selectedCategoryId:'',businessCategories:[],r2DraftMode:true}));
 assert.doesNotThrow(()=>context.validateListingCategory({itemId:'existing',existingItem:{category_id:'section-a'},selectedCategoryId:'',businessCategories:categories}));
 assert.throws(()=>context.validateListingCategory({itemId:'existing',existingItem:{category_id:'gone'},selectedCategoryId:'',businessCategories:categories}),/saved category could not be confirmed/);
 assert.match(source,/category_id:\$\("itemCategory"\)\.value\|\|null/);
 assert.match(source,/\$\("itemCategory"\)\.value=data\.id/);
});
