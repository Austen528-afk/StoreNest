/* StoreNest owner order viewer. No additional database access: only orders loaded
   through the authenticated business owner's existing RLS-protected Orders list. */
(function(){
 "use strict";
 const overlay=document.getElementById("ownerOrderViewer");
 const list=document.getElementById("ownerOrdersList");
 if(!overlay||!list)return;
 const body=document.getElementById("ownerOrderViewerBody");
 const title=document.getElementById("ownerOrderViewerTitle");
 const closeButton=document.getElementById("ownerOrderViewerClose");
 let selectedId=null,returnFocus=null;
 function html(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
 function money(value){const n=Number(value);return Number.isFinite(n)?"R"+n.toFixed(2):"—"}
 function imageUrl(value){
  const raw=typeof value==="string"?value:value?.url;
  try{const u=new URL(String(raw||""));return (u.protocol==="https:"||u.protocol==="http:")&&!/\.(?:mp4|webm)(?:[?#]|$)/i.test(u.href)?u.href:""}catch{return""}
 }
 function rowFor(id){
  return ownerOrdersRows.find(row=>String(row.id)===String(id)&&String(row.business_id)===String(currentBusiness?.id));
 }
 function render(order){
  const ref=String(order.id).replace(/-/g,"").slice(0,8).toUpperCase();
  const statusLabels={new:"Awaiting acceptance",accepted:"Order received",preparing:"In progress",prepared:"Prepared",ready:"Ready for collection",completed:"Collected",cancelled:"Cancelled"};
  const payment=order.payment_method==="card"?"Pay with card":"Pay on collection";
  const status=statusLabels[order.status]||"New";
  const items=Array.isArray(order.items)?order.items:[];
  title.textContent="Order #"+ref;
  const content=items.map(item=>{
   const quantity=Math.max(1,Math.floor(Number(item?.quantity)||1));
   const photo=imageUrl(item?.image_url||item?.media_urls?.[0]);
   const options=Array.isArray(item?.customizations)?item.customizations:[];
   const optionsHtml=options.map(group=>{
    const values=Array.isArray(group?.values)?group.values.map(x=>String(x)).filter(Boolean):[];
    return values.length?'<span class="owner-order-viewer-choice"><strong>'+html(group?.group||"Option")+':</strong> '+html(values.join(", "))+'</span>':"";
   }).join("");
   const note=String(item?.note||"").trim();
   const total=item?.line_total??(Number(item?.unit_price||0)*quantity);
   const perItem=item?.unit_price!==undefined&&item?.unit_price!==null?'<small>'+money(item.unit_price)+' each</small>':"";
   return '<div class="owner-order-viewer-item"><div class="owner-order-viewer-photo">'+(photo?'<img alt="" src="'+html(photo)+'" loading="lazy" decoding="async">':'▧')+'</div>'+
    '<div class="owner-order-viewer-item-body"><strong>'+html(quantity+" × "+String(item?.name||"Product"))+'</strong>'+optionsHtml+
    (note?'<span class="owner-order-viewer-note"><strong>Special instructions:</strong> '+html(note)+'</span>':"")+
    '</div><div class="owner-order-viewer-price">'+money(total)+perItem+'</div></div>';
  }).join("");
  const phone=String(order.contact_phone||"").trim(),email=String(order.contact_email||"").trim();
  const place=[order.customer_place,order.customer_exact_address].filter(Boolean).join(" · ");
  const submitted=new Date(order.created_at);
  const dateLabel=Number.isNaN(submitted.getTime())?"":submitted.toLocaleString("en-ZA",{dateStyle:"medium",timeStyle:"short"});
  body.innerHTML=
   '<div class="owner-order-viewer-tags"><span>'+html(status)+'</span><span>'+html(payment)+'</span>'+(dateLabel?'<span>'+html(dateLabel)+'</span>':"")+'</div>'+
   '<section class="owner-order-viewer-customer"><strong>'+html(order.customer_name||"Customer")+'</strong>'+
   (phone?'<div>Phone: <a href="tel:'+html(phone.replace(/[^0-9+]/g,""))+'">'+html(phone)+'</a></div>':"")+
   (email?'<div>Email: <a href="mailto:'+encodeURIComponent(email)+'">'+html(email)+'</a></div>':"")+
   (place?'<div>Location: '+html(place)+'</div>':"")+'</section>'+
   '<h3>Order contents</h3><div class="owner-order-viewer-items">'+(content||'<p>Item details are unavailable for this order.</p>')+'</div>'+
   '<div class="owner-order-viewer-total"><strong>Order total</strong><strong>'+money(order.subtotal)+'</strong></div>';
 }
 function open(id,trigger){
  const row=rowFor(id);if(!row)return;
  selectedId=id;returnFocus=trigger||document.activeElement;
  render(row);overlay.hidden=false;document.getElementById("ownerOrderViewerScroll").scrollTop=0;
  closeButton.focus({preventScroll:true});
 }
 function close(){
  if(overlay.hidden)return;
  overlay.hidden=true;selectedId=null;
  if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  returnFocus=null;
 }
 closeButton.addEventListener("click",close);
 overlay.addEventListener("click",event=>{if(event.target===overlay)close()});
 overlay.addEventListener("keydown",event=>{
  if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();return}
  if(event.key!=="Tab")return;
  const focusable=[...overlay.querySelectorAll("a[href],button:not([disabled])")].filter(x=>x.getClientRects().length);
  if(!focusable.length)return;
  if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable[focusable.length-1].focus()}
  else if(!event.shiftKey&&document.activeElement===focusable[focusable.length-1]){event.preventDefault();focusable[0].focus()}
 });
 list.addEventListener("click",event=>{
  if(event.target.closest("button,input,select,textarea,a,label,[data-order-next],[data-verify-collection-pin]"))return;
  const card=event.target.closest("[data-owner-order-view]");
  if(card)open(card.dataset.ownerOrderView,card);
 });
 list.addEventListener("keydown",event=>{
  const card=event.target.closest("[data-owner-order-view]");
  if(card&&event.target===card&&(event.key==="Enter"||event.key===" ")){event.preventDefault();open(card.dataset.ownerOrderView,card)}
 });
 document.addEventListener("click",event=>{
  if(event.target.closest("#dashboardSidebar .side-link,#mobileNavList .side-link,#logoutButton,[data-business-switch]"))close();
 },true);
 const observer=new MutationObserver(()=>{
  if(!selectedId||overlay.hidden)return;
  const row=rowFor(selectedId);
  if(row)render(row);else close();
 });
 observer.observe(list,{childList:true});
})();
