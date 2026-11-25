(()=>{
"use strict";
const statusLabels={pending:"Pending review",changes_requested:"Changes requested",approved:"Approved",rejected:"Rejected",legacy:"Existing listing"};
const levelLabels={1:"Basic",2:"Moderate",3:"Advanced"};
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
  badge.setAttribute("aria-label","Approval status: "+badge.textContent);
  header.append(title,badge);panel.append(header);
  const level=Number(evaluation?.evaluation_level);
  if(levelLabels[level]){
    const levelNote=document.createElement("p");levelNote.className="owner-approval-hint";
    levelNote.textContent="Evaluation level: Level "+level+" — "+levelLabels[level]+".";panel.append(levelNote);
  }
  const note=item.approval_note||evaluation?.approval_note;
  if(note&&["changes_requested","rejected"].includes(status)){
    const message=document.createElement("p");message.className="owner-approval-feedback";message.textContent=note;
    message.setAttribute("role","status");panel.append(message);
  }
  if(status==="changes_requested"){
    const hint=document.createElement("p");hint.className="owner-approval-hint";
    hint.textContent="Edit this listing and save your changes to send the updated submission for review.";panel.append(hint);
  }
  return panel;
}
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
