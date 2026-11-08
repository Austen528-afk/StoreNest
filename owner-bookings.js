/* Owner-only booking inbox: no payment or reservation is confirmed on customer submission. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
let activeClient=null,activeBusiness=null,items=[],requests=[];
let bookingChannel=null,bookingChannelClient=null,bookingChannelBusinessId=null,refreshSequence=0,ownerBookingsHistoryMode=false;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const labels={pending:"Pending",accepted:"Accepted",declined:"Declined",completed:"Completed"};
const money=value=>"R"+Number(value||0).toFixed(2);
function updateBookingNavigationBadge(){
 const count=requests.filter(row=>row.status==="pending"||row.status==="accepted").length;
 document.querySelectorAll('[data-owner-nav-badge="bookings"]').forEach(badge=>{
  badge.textContent=count>99?"99+":String(count);badge.hidden=count===0;
 });
 document.querySelectorAll('.side-link[data-section="bookings"]').forEach(button=>{
  const label=count?"Bookings, "+count+" active booking"+(count===1?"":"s"):"Bookings";
  button.setAttribute("aria-label",label);button.title=label;
 });
}
function resetRealtime(){
 if(bookingChannel&&bookingChannelClient)bookingChannelClient.removeChannel(bookingChannel);
 bookingChannel=null;bookingChannelClient=null;bookingChannelBusinessId=null;
}
function ensureRealtime(client,businessId){
 const id=String(businessId||"");
 if(!id)return;
 if(bookingChannel&&bookingChannelClient===client&&bookingChannelBusinessId===id)return;
 resetRealtime();
 bookingChannelClient=client;bookingChannelBusinessId=id;
 bookingChannel=client.channel("owner-bookings-"+id)
  .on("postgres_changes",{event:"*",schema:"public",table:"service_booking_requests",filter:"business_id=eq."+id},payload=>{
   if(String(activeBusiness?.id||"")!==id||!activeClient)return;
   refresh(activeClient,activeBusiness,items).catch(error=>console.warn("Unable to refresh live booking requests",error));
  })
  .subscribe(status=>{
   if(status==="SUBSCRIBED"){
    if(String(activeBusiness?.id||"")===id&&activeClient)refresh(activeClient,activeBusiness,items).catch(error=>console.warn("Unable to sync the booking inbox after reconnect",error));
   }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")console.warn("StoreNest booking updates are temporarily unavailable:",status);
  });
}
function render(){
 updateBookingNavigationBadge();
 const list=$("ownerBookingsList"),empty=$("ownerBookingsEmpty"),summary=$("ownerBookingsSummary");
 const heading=$("ownerBookingsHeading"),description=$("ownerBookingsDescription"),historyButton=$("ownerBookingsHistory");
 list.replaceChildren();
 const historyRows=requests.filter(r=>r.status==="completed"||r.status==="declined");
 const activeRows=requests.filter(r=>r.status!=="completed"&&r.status!=="declined");
 const visibleRows=ownerBookingsHistoryMode?historyRows:activeRows;
 const pending=activeRows.filter(r=>r.status==="pending").length;
 if(heading)heading.textContent=ownerBookingsHistoryMode?"Booking history":"Bookings & enquiries";
 if(description)description.textContent=ownerBookingsHistoryMode?"Completed and declined booking requests are kept here for your records.":"Review event dates, customer requirements and active service booking requests.";
 if(historyButton){historyButton.textContent=ownerBookingsHistoryMode?"← Active bookings":"▤ History";historyButton.setAttribute("aria-pressed",String(ownerBookingsHistoryMode))}
 if(summary){
  summary.textContent=ownerBookingsHistoryMode
   ?visibleRows.length+" past booking"+(visibleRows.length===1?"":"s")
   :visibleRows.length+" active request"+(visibleRows.length===1?"":"s")+" · "+pending+" awaiting response";
  summary.hidden=!visibleRows.length;
 }
 if(empty){
  empty.hidden=visibleRows.length>0;
  const title=empty.querySelector("strong"),copy=empty.querySelector("p");
  if(title)title.textContent=ownerBookingsHistoryMode?"No booking history yet":"No active booking requests";
  if(copy)copy.textContent=ownerBookingsHistoryMode
   ?"Completed and declined booking requests will appear here."
   :"New customer booking requests will appear here. Finished requests are available in History.";
 }
 if($("statBookings"))$("statBookings").textContent=String(requests.length);
 if($("statBookingsHint"))$("statBookingsHint").textContent=pending?pending+" pending request"+(pending===1?"":"s"):"No pending requests";
 for(const r of visibleRows){
  const product=items.find(i=>i.id===r.item_id);
  const itemName=product?.name||"Service package";
  const pricing=[];
  if(product&&window.StoreNestCategoryId?.(activeBusiness?.category)==="events-decor"){
   const min=product.price_range_min,max=product.price_range_max;
   if(min!=null&&max!=null&&Number(min)!==Number(max))pricing.push(money(min)+" – "+money(max));
   else{const single=min??max??(Number(product.price)>0?product.price:null);pricing.push(single==null?"Price on request":money(single))}
   const hasFeeRange=product.booking_fee_min!=null||product.booking_fee_max!=null;
   let feeMin=hasFeeRange?product.booking_fee_min??null:(product.booking_fee!=null&&Number(product.booking_fee)>0?product.booking_fee:null);
   const feeMax=hasFeeRange?product.booking_fee_max??null:null;
   if(feeMin!=null&&Number(feeMin)===0&&feeMax!=null&&Number(feeMax)>0&&product.booking_fee!=null&&Number(product.booking_fee)===0)feeMin=null;
   if(feeMin!=null&&feeMax!=null&&Number(feeMin)!==Number(feeMax))pricing.push("Booking fee: "+money(feeMin)+" – "+money(feeMax));
   else if(feeMin!=null||feeMax!=null)pricing.push("Booking fee: "+money(feeMin??feeMax));
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
 const previousBusinessId=String(activeBusiness?.id||"");
 activeClient=client;activeBusiness=business;items=products||[];
 const businessId=String(business?.id||"");
 if(previousBusinessId&&previousBusinessId!==businessId){ownerBookingsHistoryMode=false;requests=[];render()}
 if(!businessId)throw Error("Select a business to view its booking requests.");
 ensureRealtime(client,businessId);
 const sequence=++refreshSequence;
 const {data,error}=await client.from("service_booking_requests").select("*").eq("business_id",businessId).order("created_at",{ascending:false});
 if(error)throw error;
 if(sequence!==refreshSequence||String(activeBusiness?.id||"")!==businessId)return {count:requests.length,pending:requests.filter(x=>x.status==="pending").length};
 requests=data||[];render();
 return {count:requests.length,pending:requests.filter(x=>x.status==="pending").length};
}
window.addEventListener("pagehide",resetRealtime);
$("ownerBookingsHistory").addEventListener("click",()=>{ownerBookingsHistoryMode=!ownerBookingsHistoryMode;render()});
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
