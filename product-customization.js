/* Shared, data-only item option helpers for the owner editor and public catalogue.
   Cart pricing is a browsing preview only; future payment processing must
   independently validate and calculate selections on the server. */
(function(){
 "use strict";
 const clean=(v,max=90)=>String(v??"").trim().slice(0,max);
 const safeId=v=>clean(v,90).replace(/[^a-zA-Z0-9_-]/g,"");
 const price=v=>{
  const n=Number(v);
  return Number.isFinite(n)&&n>=0?Math.min(100000,Math.round(n*100)/100):0;
 };
 function normalize(raw){
  if(!Array.isArray(raw))return [];
  return raw.slice(0,12).map((group,gIndex)=>{
   const options=Array.isArray(group?.options)?group.options.slice(0,16).map((item,i)=>({
    id:safeId(item?.id)||"option-"+gIndex+"-"+i,
    name:clean(item?.name,75),
    price:price(item?.price)
   })).filter(option=>option.name):[];
   const selection=group?.selection==="scale"?"scale":group?.selection==="multiple"?"multiple":"single";
   const max=selection==="multiple"?Math.min(Math.max(1,Number(group?.max)||options.length||1),options.length||1):1;
   let defaultOptionId="";
   if(selection==="scale"&&options.length){
    const requested=options.find(option=>option.id===safeId(group?.defaultOptionId));
    const namedMidpoint=options.find(option=>/^(mid|medium|moderate|regular)$/i.test(option.name));
    defaultOptionId=(requested||namedMidpoint||options[Math.floor(options.length/2)]).id;
   }
   return {
    id:safeId(group?.id)||"group-"+gIndex,
    name:clean(group?.name,75),
    selection,
    required:Boolean(group?.required),
    max,
    defaultOptionId,
    options
   };
  }).filter(group=>group.name&&group.options.length);
 }
 function quote(item,selection={}){
  const groups=normalize(item?.customization_options);
  const summary=[];
  let total=price(item?.price),error=null;
  for(const group of groups){
   const selected=selection[group.id];
   const ids=Array.isArray(selected)?selected:[];
   const unique=[...new Set(ids)];
   const found=unique.map(id=>group.options.find(o=>o.id===id)).filter(Boolean);
   if(group.required&&!found.length&&!error)error={id:group.id,message:"Choose an option for "+group.name+"."};
   const tooMany=group.selection==="multiple"?unique.length>group.max:unique.length>1;
   if(tooMany&&!error)error={id:group.id,message:"Too many selections for "+group.name+"."};
   if(found.length){
    total+=found.reduce((sum,o)=>sum+o.price,0);
    summary.push({group:group.name,values:found.map(o=>o.name),price:found.reduce((sum,o)=>sum+o.price,0)});
   }
  }
  return {total:Math.round(total*100)/100,summary,error,valid:!error};
 }
 window.StoreNestOptions=Object.freeze({normalize,quote,price});
})();