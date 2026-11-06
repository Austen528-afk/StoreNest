/* Owner-only booking inbox: no payment or reservation is confirmed on customer submission. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
let activeClient=null,activeBusiness=null,items=[],requests=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const labels={pending:"Pending",accepted:"Accepted",declined:"Declined",completed:"Completed"};
const money=value=>"R"+Number(value||0).toFixed(2);
function render(){
 const list=$("ownerBookingsList"),empty=$("ownerBookingsEmpty"),summary=$("ownerBookingsSummary");
 list.replaceChildren();
 const pending=requests.filter(r=>r.status==="pending").length;
 if(summary)summary.textContent=requests.length+" request"+(requests.length===1?"":"s")+" · "+pending+" awaiting response";
 empty.hidden=requests.length>0;
 if($("statBookings"))$("statBookings").textContent=String(requests.length);
 if($("statBookingsHint"))$("statBookingsHint").textContent=pending?pending+" pending request"+(pending===1?"":"s"):"No pending requests";
 for(const r of requests){
  const product=items.find(i=>i.id===r.item_id);
  const itemName=product?.name||"Service package";
  const pricing=[];
  if(product&&window.StoreNestCategoryId?.(activeBusiness?.category)==="events-decor"){
   const min=product.price_range_min??(Number(product.price)>0?product.price:null),max=product.price_range_max;
   pricing.push(min==null?"Price on request":max==null?"From "+money(min):money(min)+" – "+money(max));
   if(product.booking_fee!=null&&Number(product.booking_fee)>0)pricing.push("Booking fee: "+money(product.booking_fee));
  }
  const status=labels[r.status]||"Pending";
  const created=new Date(r.created_at);
  const submitted=Number.isNaN(created.getTime())?"":created.toLocaleDateString("en-ZA",{year:"numeric",month:"short",day:"numeric"});
  const card=document.createElement("article");
  card.className="booking-request-card";
  const contact=[];
  if(r.contact_phone){const tel=r.contact_phone.replace(/[^\d+]/g,"");contact.push('<a href="tel:'+esc(tel)+'">'+esc(r.contact_phone)+'</a>')}
  if(r.contact_email)contact.push('<a href="mailto:'+encodeURIComponent(r.contact_email)+'">'+esc(r.contact_email)+'</a>');
  const actions=r.status==="pending"?
    '<button type="button" data-booking-id="'+esc(r.id)+'" data-booking-status="accepted">Accept request</button><button type="button" data-booking-id="'+esc(r.id)+'" data-booking-status="declined">Decline</button>':
    r.status==="accepted"?'<button type="button" data-booking-id="'+esc(r.id)+'" data-booking-status="completed">Mark service complete</button>':'';
  card.innerHTML=
   '<div class="booking-request-top"><div><div class="booking-request-title">'+esc(itemName)+'</div><div class="booking-request-meta">Requested by '+esc(r.customer_name)+' · '+esc(submitted)+'</div></div><span class="booking-request-status '+esc(r.status)+'">'+esc(status)+'</span></div>'+
   '<div class="booking-request-details">'+
   '<div><small>Event date</small><strong>'+esc(r.event_date)+'</strong></div>'+
   '<div><small>Venue / location</small><strong>'+esc(r.event_location)+'</strong></div>'+
   '<div><small>Customer</small><strong>'+esc(r.customer_name)+'</strong></div>'+
   '<div><small>Contact</small><strong>'+contact.join(" · ")+'</strong></div>'+
   (pricing.length?'<div><small>Booking pricing</small><strong>'+esc(pricing.join(" · "))+'</strong></div>':'')+
   (r.guest_count?'<div><small>Estimated guests</small><strong>'+esc(r.guest_count)+'</strong></div>':'')+
   '</div>'+
   (r.notes?'<div class="booking-request-notes"><small>Special requirements</small><p>'+esc(r.notes)+'</p></div>':'')+
   (actions?'<div class="booking-request-actions">'+actions+'</div>':'');
  list.append(card);
 }
}
async function refresh(client,business,products){
 activeClient=client;activeBusiness=business;items=products;
 const {data,error}=await client.from("service_booking_requests").select("*").eq("business_id",business.id).order("created_at",{ascending:false});
 if(error)throw error;
 requests=data||[];render();
 return {count:requests.length,pending:requests.filter(x=>x.status==="pending").length};
}
$("ownerBookingsList").addEventListener("click",async e=>{
 const button=e.target.closest("[data-booking-id][data-booking-status]");
 if(!button||!activeClient||!activeBusiness)return;
 const row=requests.find(r=>r.id===button.dataset.bookingId),next=button.dataset.bookingStatus;
 if(!row||!["pending","accepted"].includes(row.status))return;
 const permitted=row.status==="pending"?["accepted","declined"]:["completed"];
 if(!permitted.includes(next))return;
 if(next==="declined"&&!confirm("Decline this booking request?"))return;
 button.disabled=true;
 try{
  const {data,error}=await activeClient.from("service_booking_requests")
    .update({status:next,updated_at:new Date().toISOString()})
    .eq("business_id",activeBusiness.id).eq("id",row.id).eq("status",row.status).select("id");
  if(error)throw error;
  if(!data?.length)throw Error("This request may have changed. Refresh and try again.");
  await refresh(activeClient,activeBusiness,items);
 }catch(err){
  console.error("Unable to update booking request",err);
  alert("Could not update the booking request. Please try again.");
 }finally{button.disabled=false}
});
window.StoreNestOwnerBookings={refresh};
})();
