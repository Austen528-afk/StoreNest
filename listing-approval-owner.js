(()=>{
"use strict";
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const statusLabels={pending:"Pending review",changes_requested:"Changes requested",approved:"Approved",rejected:"Rejected",legacy:"Existing listing"};
const levelLabels={1:"Basic",2:"Moderate",3:"Advanced"};
const allowedTypes=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
let generation=0;
const originalRender=window.renderItems;
if(typeof originalRender==="function"){
  window.renderItems=function(){const result=originalRender.apply(this,arguments);void render();return result;};
}
window.addEventListener("storenest:owner-business-loaded",()=>void render());
function filteredItems(){
  const filter=typeof selectedFilter==="string"?selectedFilter:"all";
  const query=typeof itemQuery==="string"?itemQuery:"";
  return (Array.isArray(businessItems)?businessItems:[]).filter(item=>(filter==="all"||item.item_type===filter)
    &&(!query||(`${item.name||""} ${item.description||""}`.toLowerCase().includes(query))));
}
function panelFor(item,evaluation){
  const panel=document.createElement("section");panel.className="owner-approval-panel";
  const status=item.approval_status||evaluation?.approval_status||"pending";
  const header=document.createElement("div");header.className="owner-approval-heading";
  const title=document.createElement("strong");title.textContent="Listing review";
  const badge=document.createElement("span");badge.className="owner-approval-status status-"+status;badge.textContent=statusLabels[status]||"Status unavailable";
  header.append(title,badge);panel.append(header);
  const level=Number(evaluation?.evaluation_level);
  if(levelLabels[level]){
    const levelNote=document.createElement("p");levelNote.className="owner-approval-hint";
    levelNote.textContent="Evaluation level: Level "+level+" — "+levelLabels[level]+".";panel.append(levelNote);
  }
  const note=item.approval_note||evaluation?.approval_note;
  if(note&&["changes_requested","rejected"].includes(status)){
    const message=document.createElement("p");message.className="owner-approval-feedback";message.textContent=note;panel.append(message);
  }
  if(status==="changes_requested"){
    const hint=document.createElement("p");hint.className="owner-approval-hint";
    hint.textContent="Edit this listing and save your changes to send the updated submission for review.";panel.append(hint);
    if(evaluation?.can_resubmit){
      const resubmit=document.createElement("button");resubmit.type="button";resubmit.className="owner-approval-upload-button";
      resubmit.textContent="Resubmit for review";
      resubmit.addEventListener("click",async()=>{
        resubmit.disabled=true;
        try{
          const client=await loadAuth();
          const result=await client.rpc("business_owner_resubmit_listing",{p_item:item.id,p_version:item.updated_at});
          if(result.error)throw result.error;
          await loadBusinessData();
          if(typeof showToast==="function")showToast("Listing resubmitted for review.");
        }catch(error){
          resubmit.disabled=false;
          const feedback=document.createElement("p");feedback.className="owner-approval-feedback";
          feedback.textContent=error?.message||"The listing could not be resubmitted. Refresh and try again.";resubmit.after(feedback);
        }
      });
      panel.append(resubmit);
    }
  }
  const requests=Array.isArray(evaluation?.evidence_requests)?evaluation.evidence_requests:[];
  if(requests.length){
    const section=document.createElement("div");section.className="owner-approval-requests";
    const heading=document.createElement("h5");heading.textContent="Information requested by StoreNest";section.append(heading);
    for(const request of requests){
      const box=document.createElement("article");box.className="owner-approval-request";
      const description=document.createElement("p");description.textContent=request.request_text||"Additional information requested.";box.append(description);
      const state=document.createElement("span");state.className="owner-approval-status";state.textContent=request.status==="satisfied"?"Reviewed":"Response "+(request.status||"requested").replaceAll("_"," ");box.append(state);
      if(request.owner_feedback){const feedback=document.createElement("p");feedback.className="owner-approval-feedback";feedback.textContent=request.owner_feedback;box.append(feedback);}
      for(const file of Array.isArray(request.files)?request.files:[]){
        const line=document.createElement("p");line.className="owner-approval-file";
        line.textContent=(file.file_name||"Submitted file")+" · "+(file.review_status||"awaiting review");box.append(line);
        if(file.review_note){const review=document.createElement("p");review.className="owner-approval-feedback";review.textContent=file.review_note;box.append(review);}
      }
      if(["requested","submitted"].includes(request.status)&&["pending","changes_requested"].includes(status))box.append(uploadForm(request.id));
      section.append(box);
    }
    const privacy=document.createElement("p");privacy.className="owner-approval-hint";privacy.textContent="Files you submit here stay private and are available to authorized StoreNest reviewers.";section.append(privacy);
    panel.append(section);
  }
  return panel;
}
function uploadForm(requestId){
  const form=document.createElement("form");form.className="owner-approval-upload";
  const file=document.createElement("input");file.type="file";file.accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";file.required=true;
  file.setAttribute("aria-label","Choose an evidence document or image");
  const submit=document.createElement("button");submit.type="submit";submit.className="owner-approval-upload-button";submit.textContent="Submit evidence";
  const message=document.createElement("p");message.className="owner-approval-hint";message.setAttribute("role","status");
  form.append(file,submit,message);
  form.addEventListener("submit",async event=>{
    event.preventDefault();const selected=file.files?.[0];if(!selected)return;
    if(!allowedTypes.has(selected.type)||selected.size<1||selected.size>2*1024*1024){message.textContent="Choose a PDF, JPG, PNG or WebP file up to 2 MB.";return;}
    submit.disabled=true;message.textContent="Uploading private evidence…";
    try{
      const client=await loadAuth();const {data,error}=await client.auth.getSession();if(error)throw error;
      const token=data?.session?.access_token;if(!token)throw Error("Sign in again to submit evidence.");
      const base64=await fileAsBase64(selected);
      const response=await fetch("/api/listing-approval-evidence",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({businessId:currentBusiness.id,sessionToken:token,requestId,fileName:selected.name,mime:selected.type,base64}),
        cache:"no-store",redirect:"error"
      });
      const payload=await response.json().catch(()=>null);if(!response.ok)throw Error(payload?.error||"Evidence could not be submitted.");
      message.textContent="Evidence submitted for HQ review.";file.value="";
      if(typeof showToast==="function")showToast("Evidence submitted for HQ review.");
      await render();
    }catch(error){message.textContent=error?.message||"Evidence could not be submitted. Try again.";}
    finally{submit.disabled=false;}
  });
  return form;
}
function fileAsBase64(file){return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onerror=()=>reject(Error("The selected file could not be read."));
  reader.onload=()=>{const result=String(reader.result||"");const comma=result.indexOf(",");if(comma<0)return reject(Error("The selected file could not be read."));resolve(result.slice(comma+1));};
  reader.readAsDataURL(file);
});}
async function render(){
  const thisGeneration=++generation;
  const business=typeof currentBusiness==="undefined"?null:currentBusiness;
  const currentItems=filteredItems();
  const cards=[...document.querySelectorAll(".item-card")];
  if(!business||!cards.length)return;
  let evaluations=[];
  try{
    const client=await loadAuth();
    const {data,error}=await client.rpc("business_owner_listing_evaluation_queue",{p_business:business.id});
    if(!error&&Array.isArray(data))evaluations=data;
  }catch{}
  if(thisGeneration!==generation||typeof currentBusiness==="undefined"||currentBusiness?.id!==business.id)return;
  const byItem=new Map(evaluations.map(row=>[row.item_id,row]));
  cards.forEach((card,index)=>{
    const item=currentItems[index];if(!item)return;
    card.dataset.itemId=item.id;
    card.querySelector(".owner-approval-panel")?.remove();
    const body=card.querySelector(".item-card-body");if(body)body.append(panelFor(item,byItem.get(item.id)));
  });
}
void render();
window.StoreNestOwnerListingApprovals={refresh:()=>render()};
})();
