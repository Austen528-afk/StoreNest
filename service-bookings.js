/* Customer-side StoreNest service booking requests: no charges, no basket. */
(function(){
"use strict";
let client=null,business=null,activeItem=null,returnFocus=null;
const $=id=>document.getElementById(id);
const money=value=>"R"+Number(value||0).toFixed(2);
const isService=item=>item?.item_type==="service";
function todayLocalDate(){
 const d=new Date(),pad=n=>String(n).padStart(2,"0");
 return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function setContext(nextClient,nextBusiness,items){
 client=nextClient;business=nextBusiness;
 const serviceOnly=items.length>0&&items.every(isService);
 document.body.dataset.catalogMode=serviceOnly?"services":"mixed";
 if(serviceOnly){
  const footer=document.querySelector(".footer span:last-child");
  if(footer)footer.textContent="Request a booking · No payment taken until the business confirms the details";
 }
}
function open(item,trigger){
 if(!isService(item)||!client||!business)return;
 activeItem=item;returnFocus=trigger||null;
 const form=$("bookingRequestForm");form.reset();form.hidden=false;
 $("bookingSuccess").hidden=true;$("bookingFormError").hidden=true;
 $("bookingPackageName").textContent=item.name;
 $("bookingPackagePrice").textContent="From "+money(item.price);
 const date=form.elements.namedItem("event_date");
 date.min=todayLocalDate();date.value="";
 $("bookingBackdrop").hidden=false;document.body.style.overflow="hidden";
 form.elements.namedItem("customer_name").focus();
}
function close(){
 $("bookingBackdrop").hidden=true;document.body.style.overflow="";
 activeItem=null;returnFocus?.focus();returnFocus=null;
}
for(const id of ["bookingClose","bookingCancel","bookingDone"])$(id).addEventListener("click",close);
$("bookingBackdrop").addEventListener("click",e=>{if(e.target===$("bookingBackdrop"))close()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("bookingBackdrop").hidden){e.preventDefault();close()}});
$("bookingRequestForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const form=e.currentTarget,submit=$("bookingSubmit"),errorBox=$("bookingFormError");
 if(!activeItem||!business||!client)return;
 const d=new FormData(form);
 const phone=String(d.get("contact_phone")||"").trim(),email=String(d.get("contact_email")||"").trim();
 if(!phone&&!email){errorBox.textContent="Enter a phone number or email so the business can reach you.";errorBox.hidden=false;return}
 if(String(d.get("event_date")||"")<todayLocalDate()){errorBox.textContent="Please choose today or a future date.";errorBox.hidden=false;return}
 submit.disabled=true;submit.textContent="Sending…";errorBox.hidden=true;
 try{
  const payload={
   business_id:business.id,item_id:activeItem.id,
   customer_name:String(d.get("customer_name")||"").trim(),
   contact_phone:phone||null,contact_email:email||null,
   event_date:String(d.get("event_date")||""),
   event_location:String(d.get("event_location")||"").trim(),
   guest_count:d.get("guest_count")?Number(d.get("guest_count")):null,
   notes:String(d.get("notes")||"").trim()
  };
  const {error}=await client.from("service_booking_requests").insert(payload);
  if(error)throw error;
  form.hidden=true;$("bookingSuccess").hidden=false;$("bookingDone").focus();
 }catch(err){
  errorBox.textContent="Unable to send this booking enquiry. Please check your details and try again.";
  errorBox.hidden=false;console.warn("Service booking request:",err);
 }finally{submit.disabled=false;submit.textContent="Send request →"}
});
window.StoreNestBookings={isService,setContext,open};
})();
