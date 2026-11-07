/* Customer-side StoreNest service booking requests: no charges, no basket. */
(function(){
"use strict";
let client=null,business=null,activeItem=null,returnFocus=null,bookingPrefillSequence=0;
const bookingTouchedFields=new Set();
const $=id=>document.getElementById(id);
const money=value=>"R"+Number(value||0).toFixed(2);
const isService=item=>item?.item_type==="service";
function todayLocalDate(){
 const d=new Date(),pad=n=>String(n).padStart(2,"0");
 return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function isBookingOffer(item,context=business){return isService(item)||window.StoreNestCategoryId?.(context?.category)==="events-decor"}
function usesOptionalBookingPricing(item,context=business){return window.StoreNestCategoryId?.(context?.category)==="events-decor"}
function priceLabel(item,context=business){
 if(!isBookingOffer(item,context))return money(item?.price);
 if(!usesOptionalBookingPricing(item,context))return "From "+money(item?.price);
 const min=item.price_range_min,max=item.price_range_max;
 if(min!=null&&max!=null&&Number(min)!==Number(max))return money(min)+" – "+money(max);
 const single=min??max??(Number(item.price)>0?item.price:null);
 return single!=null?money(single):"Request a quote";
}
function bookingFeeAmounts(item){
 const hasRange=item.booking_fee_min!=null||item.booking_fee_max!=null;
 if(!hasRange){
  const legacy=item.booking_fee;
  return {min:legacy!=null&&Number(legacy)>0?legacy:null,max:null};
 }
 let min=item.booking_fee_min??null,max=item.booking_fee_max??null;
 // Older edits copied the legacy R0 default into the new lower-bound field.
 // Treat it as empty when a real upper amount was entered.
 if(min!=null&&Number(min)===0&&max!=null&&Number(max)>0&&item.booking_fee!=null&&Number(item.booking_fee)===0)min=null;
 return {min,max};
}
function bookingFeeLabel(item,context=business){
 if(!usesOptionalBookingPricing(item,context))return "";
 const {min,max}=bookingFeeAmounts(item);
 if(min==null&&max==null)return "";
 if(min!=null&&max!=null&&Number(min)!==Number(max))return "Booking fee: "+money(min)+" – "+money(max);
 return "Booking fee: "+money(min??max);
}
function setContext(nextClient,nextBusiness,items){
 client=nextClient;business=nextBusiness;
 const serviceOnly=window.StoreNestCategoryId?.(business?.category)==="events-decor"||(items.length>0&&items.every(isService));
 document.body.dataset.catalogMode=serviceOnly?"services":"mixed";
 if(serviceOnly){
  const footer=document.querySelector(".footer span:last-child");
  if(footer)footer.textContent="Request a booking · No payment taken until the business confirms the details";
 }
}
async function prefillBookingProfile(form,item,sequence){
 try{
  const {data,error}=await client.auth.getUser();
  if(error)throw error;
  const user=data?.user;
  if(!user)return;
  let profile=null;
  try{profile=await window.StoreNestCustomerAuth.getProfile(user.id)}
  catch(error){console.warn("Could not load the booking customer profile:",error)}
  if(sequence!==bookingPrefillSequence||activeItem?.id!==item.id||$("bookingBackdrop").hidden)return;
  const values={
   customer_name:profile?.profile_name||user.user_metadata?.full_name||"",
   contact_phone:profile?.contact_phone||user.phone||"",
   contact_email:profile?.contact_email||user.email||"",
   event_location:profile?.exact_address||profile?.place||""
  };
  for(const [name,value] of Object.entries(values)){
   const field=form.elements.namedItem(name);
   if(field&&!bookingTouchedFields.has(name)&&!String(field.value||"").trim()&&value)field.value=String(value);
  }
 }catch(error){console.warn("Could not load saved booking contact details:",error)}
}
$("bookingRequestForm").addEventListener("input",event=>{
 const name=event.target?.name;
 if(name)bookingTouchedFields.add(name);
});
function open(item,trigger){
 if(!isBookingOffer(item,business)||!client||!business)return;
 activeItem=item;returnFocus=trigger||null;
 const form=$("bookingRequestForm");form.reset();bookingTouchedFields.clear();form.hidden=false;
 $("bookingSuccess").hidden=true;$("bookingFormError").hidden=true;
 $("bookingPackageName").textContent=item.name;
 $("bookingPackagePrice").textContent=priceLabel(item);
 const feeText=bookingFeeLabel(item),fee=$("bookingPackageFee");fee.textContent=feeText;fee.hidden=!feeText;
 const date=form.elements.namedItem("event_date");
 date.min=todayLocalDate();date.value="";
 $("bookingBackdrop").hidden=false;document.body.style.overflow="hidden";
 const sequence=++bookingPrefillSequence;
 void prefillBookingProfile(form,item,sequence);
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
window.StoreNestBookings={isService,isBookingOffer,usesOptionalBookingPricing,priceLabel,bookingFeeLabel,setContext,open};
})();
