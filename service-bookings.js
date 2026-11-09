/* Customer-side StoreNest service booking requests: no charges, no basket. */
(function(){
"use strict";
let client=null,business=null,activeItem=null,returnFocus=null,activeDecorColorSetName="",activeBookingOptions=[],activeBookingOptionSurcharge=0,activeBookingEstimatedPrice=null;
const $=id=>document.getElementById(id);
const money=value=>"R"+Number(value||0).toFixed(2);
const isService=item=>item?.item_type==="service";
const BOOKING_TRACKING_PREFIX="storenest_booking_tracking:";
let bookingPrefillRequest=0;
function rememberCustomerBooking(request,userId){
 const key=BOOKING_TRACKING_PREFIX+(userId||"guest");
 try{
  const existing=JSON.parse(localStorage.getItem(key)||"[]");
  const rows=Array.isArray(existing)?existing.filter(row=>row?.id!==request.id):[];
  localStorage.setItem(key,JSON.stringify([request,...rows].slice(0,50)));
 }catch(error){console.warn("Could not save booking status on this device:",error)}
}

function todayLocalDate(){
 const d=new Date(),pad=n=>String(n).padStart(2,"0");
 return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function isBookingOffer(item,context=business){return isService(item)||window.StoreNestCategoryId?.(context?.category)==="events-decor"}
function isLocalServiceOffer(item,context=business){return window.StoreNestCategoryId?.(context?.category)==="local-services"&&isService(item)}
function usesOptionalBookingPricing(item,context=business){const category=window.StoreNestCategoryId?.(context?.category);return category==="events-decor"||(category==="local-services"&&isService(item))}
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
  if(footer)footer.textContent=window.StoreNestCategoryId?.(business?.category)==="local-services"?"Request a service · No payment taken until the business confirms the details":"Request a booking · No payment taken until the business confirms the details";
 }
}
async function prefillBookingCustomerDetails(form,requestId){
 const isCurrentRequest=()=>requestId===bookingPrefillRequest&&!$("bookingBackdrop").hidden&&!!activeItem;
 const firstText=(...values)=>values.find(value=>typeof value==="string"&&value.trim())?.trim()||"";
 const autoFilledValues=new Map();
 const fillIfEmpty=(fieldName,...values)=>{
  const field=form.elements.namedItem(fieldName);
  if(!field)return;
  const current=String(field.value||"").trim();
  const previousAutoFill=autoFilledValues.get(fieldName);
  if(current&&current!==previousAutoFill)return;
  const value=firstText(...values);
  if(value){field.value=value;autoFilledValues.set(fieldName,value)}
 };
 try{
  // Read the persisted session locally so mobile doesn't wait on an Auth user
  // round trip before it can start filling the enquiry form.
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  const user=data?.session?.user;
  if(!user||!isCurrentRequest())return;
  const metadata=user.user_metadata||{};
  fillIfEmpty("customer_name",metadata.profile_name,metadata.full_name,metadata.name);
  fillIfEmpty("contact_phone",user.phone,metadata.contact_phone,metadata.phone);
  fillIfEmpty("contact_email",user.email,metadata.contact_email,metadata.email);
  const profile=await window.StoreNestCustomerAuth?.getProfile(user.id);
  if(!isCurrentRequest())return;
  fillIfEmpty("customer_name",profile?.profile_name,metadata.profile_name,metadata.full_name,metadata.name);
  fillIfEmpty("contact_phone",profile?.contact_phone,user.phone,metadata.contact_phone,metadata.phone);
  fillIfEmpty("contact_email",profile?.contact_email,user.email,metadata.contact_email,metadata.email);
  fillIfEmpty("event_location",profile?.exact_address,profile?.place,metadata.exact_address,metadata.place);
 }catch(error){console.warn("Could not prefill booking contact details:",error)}
}
function open(item,trigger,options={}){
 if(!isBookingOffer(item,business)||!client||!business)return;
 activeItem=item;returnFocus=trigger||null;activeDecorColorSetName=String(options?.decorColorSetName||"").trim().slice(0,80);
 activeBookingOptions=(Array.isArray(options?.selectedOptions)?options.selectedOptions:[]).slice(0,12).map(row=>({
  group:String(row?.group||"").trim().slice(0,75),
  values:(Array.isArray(row?.values)?row.values:[]).slice(0,8).map(value=>String(value||"").trim().slice(0,75)).filter(Boolean),
  price:Number.isFinite(Number(row?.price))&&Number(row?.price)>0?Number(row.price):0
 })).filter(row=>row.group&&row.values.length);
 activeBookingOptionSurcharge=Number.isFinite(Number(options?.optionSurcharge))&&Number(options.optionSurcharge)>0?Number(options.optionSurcharge):0;
 activeBookingEstimatedPrice=Number.isFinite(Number(options?.estimatedPrice))&&Number(options.estimatedPrice)>=0?Number(options.estimatedPrice):null;
 const requestId=++bookingPrefillRequest;
 const form=$("bookingRequestForm");form.reset();form.hidden=false;
 const localService=isLocalServiceOffer(item,business);
 $("bookingEyebrow").textContent=localService?"SERVICE REQUEST":"BOOKING ENQUIRY";
 $("bookingTitle").textContent=localService?"Request a service":"Request a booking";
 $("bookingIntro").textContent=localService?"Tell the business what service you need and when. No payment is required.":"Tell the business about your event. No payment is required.";
 $("bookingClose").setAttribute("aria-label",localService?"Close service request":"Close booking request");
 $("bookingDateFieldText").textContent=localService?"Preferred date":"Event date";
 $("bookingLocationFieldText").textContent=localService?"Service address or location":"Venue or event location";
 $("bookingQuantityFieldText").textContent=localService?"Quantity (optional)":"Estimated guests (optional)";
 $("bookingNotesFieldText").textContent=localService?"Service details or special requests":"Requirements or special requests";
 form.elements.namedItem("event_location").placeholder=localService?"Town, area and service address":"Town, area and venue";
 form.elements.namedItem("guest_count").placeholder=localService?"e.g. 1":"e.g. 50";
 form.elements.namedItem("notes").placeholder=localService?"Describe the service you need, any issue and helpful details.":"Occasion, theme, colours, setup time, or catering needs";
 $("bookingHelp").textContent=localService
  ?"Provide a phone number or email. Your contact details will be visible only to this business. The business will confirm availability and the final price."
  :"Provide a phone number or email. Your contact details will be visible only to this business. Availability and the final quotation must be confirmed by the owner.";
 $("bookingSuccess").hidden=true;$("bookingFormError").hidden=true;
 $("bookingPackageName").textContent=item.name;
 const baseLabel=priceLabel(item),selectionBox=$("bookingPackageOptions"),optionPrice=$("bookingPackageOptionPrice");
 selectionBox.hidden=!activeBookingOptions.length;
 selectionBox.textContent=activeBookingOptions.length?"Selected: "+activeBookingOptions.map(row=>row.group+": "+row.values.join(", ")+(row.price>0?" (+"+money(row.price)+")":"")).join(" · "):"";
 optionPrice.hidden=!activeBookingOptions.length;
 optionPrice.textContent=activeBookingOptions.length?"Includes "+money(activeBookingOptionSurcharge)+" in selected option extras": "";
 $("bookingPackagePrice").textContent=activeBookingOptions.length&&activeBookingEstimatedPrice!==null
  ? "Estimated from "+money(activeBookingEstimatedPrice)+" · "+baseLabel+" base"
  : baseLabel;
 form.elements.namedItem("notes").value=String(options?.specialInstructions||"").slice(0,1500);
 const feeText=bookingFeeLabel(item),fee=$("bookingPackageFee");fee.textContent=feeText;fee.hidden=!feeText;
 const date=form.elements.namedItem("event_date");
 date.min=todayLocalDate();date.value="";
 $("bookingBackdrop").hidden=false;document.body.style.overflow="hidden";
 void prefillBookingCustomerDetails(form,requestId);
 if(!window.matchMedia("(pointer: coarse)").matches)form.elements.namedItem("customer_name").focus();
}
function close(){
 bookingPrefillRequest++;
 $("bookingBackdrop").hidden=true;document.body.style.overflow="";
 activeItem=null;activeDecorColorSetName="";activeBookingOptions=[];activeBookingOptionSurcharge=0;activeBookingEstimatedPrice=null;returnFocus?.focus();returnFocus=null;
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
   notes:(()=>{
    const optionLines=activeBookingOptions.map(row=>row.group+": "+row.values.join(", ")+(row.price>0?" (+"+money(row.price)+")":""));
    const selectionNotes=optionLines.length?"Selected service options:\n"+optionLines.join("\n"):"";
    const estimateNotes=activeBookingOptions.length&&activeBookingEstimatedPrice!==null?"Estimated from selected options: "+money(activeBookingEstimatedPrice):"";
    const prefix=[activeDecorColorSetName?"Selected décor colour set: "+activeDecorColorSetName:"",selectionNotes,estimateNotes].filter(Boolean).join("\n\n").slice(0,900);
    const customerNotes=String(d.get("notes")||"").trim();
    return (prefix+(prefix&&customerNotes?"\n\n":"")+customerNotes.slice(0,Math.max(0,1500-prefix.length-(prefix&&customerNotes?2:0)))).slice(0,1500);
   })()
  };
  // The account ID is verified by Supabase RLS; guests retain a private tracking token on this device.
  let userId=null;
  try{
   const {data:sessionData,error:sessionError}=await client.auth.getSession();
   if(sessionError)throw sessionError;
   if(sessionData?.session){
    const {data,error:authError}=await client.auth.getUser();
    if(authError)throw authError;
    userId=data?.user?.id||null;
   }
  }catch(authError){console.warn("Booking will be tracked on this device:",authError)}
  const bookingId=crypto.randomUUID(),trackingToken=crypto.randomUUID();
  payload.id=bookingId;
  payload.tracking_token=trackingToken;
  if(userId)payload.customer_user_id=userId;
  const {error}=await client.from("service_booking_requests").insert(payload);
  if(error)throw error;
  rememberCustomerBooking({
   id:bookingId,token:trackingToken,customerUserId:userId,
   businessName:business.name||"Business",itemName:activeItem.name||"Service",
   businessId:business.id,itemId:activeItem.id,
   customerName:payload.customer_name,contactPhone:payload.contact_phone,contactEmail:payload.contact_email,
   eventDate:payload.event_date,eventLocation:payload.event_location,
   guestCount:payload.guest_count==null?"":String(payload.guest_count),notes:payload.notes,
   selectedOptions:activeBookingOptions,estimatedPrice:activeBookingEstimatedPrice,
   createdAt:new Date().toISOString(),status:"pending"
  },userId);
  window.dispatchEvent(new Event("storenest:booking-created"));
  form.hidden=true;$("bookingSuccess").hidden=false;
  const message=$("bookingSuccess").querySelector("p");
  if(message)message.textContent=isLocalServiceOffer(activeItem,business)
   ?"Your service request was sent to the business. Track its progress under My Bookings on the StoreNest home page. The business will confirm the appointment."
   :"Your request was sent to the business. Track its progress under My Bookings on the StoreNest home page. A request is not a confirmed reservation.";
  $("bookingDone").focus();
 }catch(err){
  errorBox.textContent=isLocalServiceOffer(activeItem,business)?"Unable to send this service request. Please check your details and try again.":"Unable to send this booking enquiry. Please check your details and try again.";
  errorBox.hidden=false;console.warn("Service booking request:",err);
 }finally{submit.disabled=false;submit.textContent="Send request →"}
});
window.StoreNestBookings={isService,isBookingOffer,usesOptionalBookingPricing,priceLabel,bookingFeeLabel,setContext,open};
})();
