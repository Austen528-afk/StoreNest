(()=>{"use strict";
 const $=id=>document.getElementById(id);let client=null,epoch=0;const urls=new Set();
 const clear=()=>{for(const u of urls)URL.revokeObjectURL(u);urls.clear();$("listingReviewQueue").replaceChildren();};
 function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
 async function load(){
  if(!client)return;const generation=++epoch;clear();const status=$("listingReviewStatus");status.textContent="Loading review queue…";
  const result=await client.rpc("hq_listing_queue");if(generation!==epoch)return;
  if(result.error){status.textContent="Approval database is not active or access was denied. No decisions can be recorded.";return;}
  status.textContent=result.data.length+" listings awaiting review or resubmission.";
  for(const item of result.data){
   const card=node("article");card.style.cssText="border:1px solid #dce9e0;border-radius:12px;padding:18px;margin:12px 0;background:#fff;color:#14241d";
   card.append(node("h3",item.name),node("p",item.item_type+" · "+item.approval_status+" · R"+Number(item.price||0).toFixed(2)),node("p",item.description||"No description"),node("small","Business: "+item.business_id));
   const media=node("div");card.append(media);
   const entries=(Array.isArray(item.media_urls)?item.media_urls:[]).map(e=>typeof e==="string"?e:e?.url).filter(Boolean);if(!entries.length&&item.image_url)entries.push(item.image_url);
   const loaded=[];
   for(const ref of entries){
    const image=node("img");image.alt="Listing media";image.style.cssText="width:150px;height:150px;object-fit:contain;margin:8px";media.append(image);
    loaded.push(new Promise(resolve=>{image.onload=()=>resolve(true);image.onerror=()=>resolve(false);if(/^https:\/\//i.test(ref)){image.src=ref;return;}
     if(!ref.startsWith("r2://")){resolve(false);return;}
     (async()=>{try{const {data:{session}}=await client.auth.getSession();if(!session?.access_token)throw Error();const resp=await fetch("/api/r2-catalogue-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item:item.id,ref,sessionToken:session.access_token}),cache:"no-store",redirect:"error"});if(!resp.ok)throw Error();const blob=await resp.blob();if(generation!==epoch){resolve(false);return;}const url=URL.createObjectURL(blob);urls.add(url);image.src=url;}catch{resolve(false);}})();
    }));
   }
   if(item.approval_status==="pending"){
    const form=node("form"),legit=node("input"),safe=node("input"),note=node("textarea");
    legit.type=safe.type="checkbox";const label1=node("label"," Legitimacy verified "),label2=node("label"," Safety verified ");label1.prepend(legit);label2.prepend(safe);note.placeholder="Review notes / rejection reason";note.maxLength=2000;note.style.display="block";
    const approve=node("button","Approve"),reject=node("button","Reject");approve.type=reject.type="button";approve.className=reject.className="admin-refresh";approve.disabled=true;
    let mediaOk=false;const update=()=>{approve.disabled=!(legit.checked&&safe.checked&&mediaOk);};legit.onchange=safe.onchange=update;
    Promise.all(loaded).then(results=>{mediaOk=results.length>0&&results.every(Boolean);update();if(!mediaOk)media.append(node("p","Media could not be fully verified; approval disabled."));});
    async function decide(yes){if(yes&&approve.disabled)return;if(!yes&&!note.value.trim()){status.textContent="Enter a rejection reason.";return;}if(!confirm(yes?"Approve this listing without publishing it?":"Reject this listing?"))return;approve.disabled=reject.disabled=true;
     const r=await client.rpc("hq_review_listing",{p_item:item.id,p_version:item.updated_at,p_approve:yes,p_legitimate:legit.checked,p_safe:safe.checked,p_note:note.value.trim()});
     if(r.error){status.textContent="Review not saved. Refresh and try again.";reject.disabled=false;update();return;}await load();}
    approve.onclick=()=>void decide(true);reject.onclick=()=>void decide(false);form.onsubmit=e=>e.preventDefault();form.append(label1,label2,note,approve,reject);card.append(form);
   }else card.append(node("p",item.approval_note||"Awaiting owner changes."));
   $("listingReviewQueue").append(card);
  }
 }
 $("listingReviewRefresh").onclick=()=>void load();
 window.addEventListener("storenest:hq-admin-ready",event=>{client=event.detail.client;void load();});
 window.addEventListener("storenest:hq-admin-signed-out",()=>{client=null;++epoch;clear();$("listingReviewStatus").textContent="Sign in to review listings.";});
})();
