(function(root){
"use strict";

const PERIODS=Object.freeze({today:"Today",week:"This week",month:"This month",year:"This year",custom:"Custom range"});
const DAY=86400000;
const PAGE_SIZE=10;
const state={businessId:null,businessName:"",orders:[],loaded:false,loading:false,error:"",transactionLimit:PAGE_SIZE};
const byId=(doc,id)=>doc&&doc.getElementById(id);

function normalizeOrder(row){
 if(!row||typeof row!=="object")return null;
 const id=String(row.id||"");if(!id)return null;
 const amount=Number(row.subtotal);
 return {id,business_id:String(row.business_id||""),status:String(row.status||"").toLowerCase(),payment_status:String(row.payment_status||"").toLowerCase(),payment_method:String(row.payment_method||"").toLowerCase(),subtotal:Number.isFinite(amount)&&amount>0?amount:0,created_at:String(row.created_at||"")};
}
function parseDate(value){const date=value instanceof Date?new Date(value.getTime()):new Date(value||"");return Number.isNaN(date.getTime())?null:date}
function localDay(value){const date=parseDate(value);return date?new Date(date.getFullYear(),date.getMonth(),date.getDate()):null}
function parseDateInput(value){
 const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return null;
 const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
 return date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3])?date:null;
}
function addDays(date,count){return new Date(date.getFullYear(),date.getMonth(),date.getDate()+count)}
function dateLabel(date,options){return new Intl.DateTimeFormat("en-ZA",options).format(date)}
function dateInputValue(date){return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0")}
function periodDateLabel(period,custom,now){
 const range=dateRange(period,custom,now);if(!range)return "Choose a valid date range";
 const last=addDays(range.end,-1),options={dateStyle:"medium"};
 return dateLabel(range.start,options)+(range.start.getTime()===last.getTime()?"":" – "+dateLabel(last,options));
}
function formatCurrency(value){const amount=Number(value);return "R"+(Number.isFinite(amount)?amount:0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function sum(rows){return rows.reduce((total,row)=>total+row.subtotal,0)}
function isCompletedOrder(order){return order.status==="completed"}
function isQualifyingSale(order){return isCompletedOrder(order)&&order.payment_status!=="refunded"}
function isRecordedPaid(order){return order.payment_status==="paid"&&order.status!=="cancelled"&&order.payment_status!=="refunded"}
function isRefunded(order){return order.payment_status==="refunded"}
function inRange(order,range){const day=localDay(order.created_at);return Boolean(day&&range&&day>=range.start&&day<range.end)}
function dateRange(period,custom,now){
 const today=localDay(now)||localDay(new Date()),tomorrow=addDays(today,1);
 if(period==="today")return {start:today,end:tomorrow,previousStart:addDays(today,-1),previousEnd:today};
 if(period==="week"){
  const start=addDays(today,-((today.getDay()+6)%7)),elapsed=Math.round((today-start)/DAY)+1,previousStart=addDays(start,-7);
  return {start,end:tomorrow,previousStart,previousEnd:addDays(previousStart,elapsed)};
 }
 if(period==="month"){
  const start=new Date(today.getFullYear(),today.getMonth(),1),elapsed=today.getDate(),previousStart=new Date(today.getFullYear(),today.getMonth()-1,1),previousDays=new Date(today.getFullYear(),today.getMonth(),0).getDate();
  return {start,end:tomorrow,previousStart,previousEnd:addDays(previousStart,Math.min(elapsed,previousDays))};
 }
 if(period==="year"){
  const start=new Date(today.getFullYear(),0,1),previousStart=new Date(today.getFullYear()-1,0,1),previousMonthDays=new Date(today.getFullYear()-1,today.getMonth()+1,0).getDate(),previousToday=new Date(today.getFullYear()-1,today.getMonth(),Math.min(today.getDate(),previousMonthDays));
  return {start,end:tomorrow,previousStart,previousEnd:addDays(previousToday,1)};
 }
 if(period==="custom"){
  const start=parseDateInput(custom&&custom.start),last=parseDateInput(custom&&custom.end);
  if(!start||!last||last<start)return null;
  const end=addDays(last,1),duration=Math.round((end-start)/DAY);
  return {start,end,previousStart:addDays(start,-duration),previousEnd:start};
 }
 return dateRange("week",custom,now);
}
function rangeRows(input,range){return (Array.isArray(input)?input:[]).map(normalizeOrder).filter(Boolean).filter(order=>inRange(order,range))}
function salesValue(rows){return sum(rows.filter(isQualifyingSale))}
function growthLabel(current,previous){
 if(previous===0)return current>0?"New":"—";
 const change=(current-previous)/previous*100;
 return (change>0?"+":"")+Math.round(change)+"%";
}
function summarizeOrders(input,period,now,custom){
 const orders=(Array.isArray(input)?input:[]).map(normalizeOrder).filter(Boolean),range=dateRange(period||"week",custom,now||new Date());
 if(!range)return {valid:false,orderCount:0,completedCount:0,totalSales:0,recordedPaid:0,refunded:0,averageOrderValue:0,netEarnings:null,pendingPayments:null,availableBalance:null,awaitingRelease:null,paidOut:null,salesGrowth:"—",previousSales:0,previousCompletedCount:0};
 const current=rangeRows(orders,range),previous=rangeRows(orders,{start:range.previousStart,end:range.previousEnd});
 const completed=current.filter(isCompletedOrder),sales=completed.filter(isQualifyingSale),totalSales=sum(sales),recordedPaid=sum(current.filter(isRecordedPaid)),refunded=sum(current.filter(isRefunded));
 return {valid:true,orderCount:current.length,completedCount:completed.length,totalSales,recordedPaid,refunded,averageOrderValue:sales.length?totalSales/sales.length:0,netEarnings:null,pendingPayments:null,availableBalance:null,awaitingRelease:null,paidOut:null,salesGrowth:growthLabel(totalSales,salesValue(previous)),previousSales:salesValue(previous),previousCompletedCount:previous.filter(isCompletedOrder).length,orders:current,range};
}
function chartSlots(period,now,custom){
 const range=dateRange(period,custom,now);if(!range)return [];
 if(period==="today")return [{start:range.start,end:range.end,label:"Today"}];
 if(period==="week")return Array.from({length:7},(_,i)=>{const start=addDays(range.start,i);return {start,end:addDays(start,1),label:dateLabel(start,{weekday:"short"})}});
 if(period==="month"){
  const elapsed=Math.round((range.end-range.start)/DAY),count=Math.min(7,elapsed);
  return Array.from({length:count},(_,i)=>{const first=Math.floor(i*elapsed/count),after=Math.floor((i+1)*elapsed/count),start=addDays(range.start,first);return {start,end:addDays(range.start,after),label:dateLabel(start,{day:"numeric",month:"short"})}});
 }
 if(period==="year"){
  const count=(localDay(now)||localDay(new Date())).getMonth()+1;
  return Array.from({length:count},(_,i)=>{const start=new Date(range.start.getFullYear(),i,1),end=i===count-1?range.end:new Date(range.start.getFullYear(),i+1,1);return {start,end,label:dateLabel(start,{month:"short"})}});
 }
 const days=Math.max(1,Math.round((range.end-range.start)/DAY)),count=days<=14?days:7;
 return Array.from({length:count},(_,i)=>{const first=Math.floor(i*days/count),after=Math.floor((i+1)*days/count),start=addDays(range.start,first);return {start,end:addDays(range.start,after),label:dateLabel(start,{day:"numeric",month:"short"})}});
}
function chartValues(orders,period,now,custom){
 const slots=chartSlots(period,now,custom),sales=slots.map(()=>0),paid=slots.map(()=>0);
 for(const raw of Array.isArray(orders)?orders:[]){
  const order=normalizeOrder(raw);if(!order)continue;
  const day=localDay(order.created_at);if(!day)continue;
  const index=slots.findIndex(slot=>day>=slot.start&&day<slot.end);if(index<0)continue;
  if(isQualifyingSale(order))sales[index]+=order.subtotal;
  if(isRecordedPaid(order))paid[index]+=order.subtotal;
 }
 return {slots,sales,paid};
}
function esc(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
function buildChartSvg(period,orders,now,custom){
 const key=PERIODS[period]?period:"week",data=chartValues(orders,key,now,custom),salesTotal=sum(data.sales.map(subtotal=>({subtotal}))),paidTotal=sum(data.paid.map(subtotal=>({subtotal})));
 if(!data.slots.length)return '<p class="payments-transactions-empty">Choose a valid start and end date to view this range.</p>';
 if(salesTotal<=0&&paidTotal<=0)return '<p class="payments-transactions-empty">No completed order value is recorded for '+esc(PERIODS[key].toLowerCase())+'.</p>';
 const w=620,h=252,l=82,r=12,t=14,b=42,pw=w-l-r,ph=h-t-b,maxValue=Math.max(0,...data.sales,...data.paid),step=Math.max(50,Math.ceil(maxValue/4/50)*50),max=step*4;
 const points=values=>values.map((value,i)=>({x:data.slots.length===1?l+pw/2:l+i*pw/(data.slots.length-1),y:t+ph-value/max*ph,value}));
 const path=pts=>pts.map((point,i)=>(i?"L ":"M ")+point.x.toFixed(1)+" "+point.y.toFixed(1)).join(" "),sales=points(data.sales),paid=points(data.paid);
 let out='<svg class="payments-chart-svg" viewBox="0 0 '+w+" "+h+'" role="img" aria-label="'+esc(PERIODS[key])+': completed order value and order records marked paid"><title>'+esc(PERIODS[key])+': completed order value and order records marked paid</title>';
 for(let i=0;i<=4;i++){const y=t+ph*i/4,value=max*(4-i)/4;out+='<line x1="'+l+'" y1="'+y+'" x2="'+(w-r)+'" y2="'+y+'" class="payments-chart-grid"/><text x="'+(l-12)+'" y="'+(y+4)+'" text-anchor="end" class="payments-chart-label">'+formatCurrency(value)+'</text>'}
 if(salesTotal>0)out+='<path d="'+path(sales)+'" class="payments-chart-line payments-chart-sales"/>';
 if(paidTotal>0)out+='<path d="'+path(paid)+'" class="payments-chart-line payments-chart-earnings"/>';
 sales.forEach((point,i)=>{if(salesTotal>0)out+='<circle cx="'+point.x+'" cy="'+point.y+'" r="4.5" class="payments-chart-dot payments-chart-sales-dot"><title>Completed order value: '+formatCurrency(point.value)+'</title></circle>';if(paidTotal>0)out+='<circle cx="'+paid[i].x+'" cy="'+paid[i].y+'" r="4.5" class="payments-chart-dot payments-chart-earnings-dot"><title>Order records marked paid: '+formatCurrency(paid[i].value)+'</title></circle>'});
 data.slots.forEach((slot,i)=>{const x=data.slots.length===1?l+pw/2:l+i*pw/(data.slots.length-1);out+='<text x="'+x+'" y="'+(h-13)+'" text-anchor="middle" class="payments-chart-label payments-chart-x-label">'+esc(slot.label)+'</text>'});
 return out+'</svg>';
}
function paymentStatusLabel(order){
 if(order.payment_status==="refunded")return "Refund recorded";
 if(order.payment_status==="failed")return "Payment failed";
 if(order.payment_status==="paid")return "Marked paid (not provider-verified)";
 if(order.payment_method==="card"&&order.payment_status==="pending")return "Card preview; no payment processed";
 if(order.payment_method==="pay_on_collection"&&order.payment_status==="unpaid")return "Collection payment not recorded";
 if(order.payment_status==="pending")return "Payment status pending";
 if(order.payment_status==="unpaid")return "Not marked paid";
 return "Payment status unavailable";
}
function paymentStatusClass(order){return order.payment_status==="paid"?"is-paid":order.payment_status==="pending"||order.payment_status==="unpaid"?"is-pending":"is-other"}
function shortOrderRef(id){return String(id).replace(/-/g,"").slice(0,8).toUpperCase()}
function filterOrders(query,rows){
 const needle=String(query||"").trim().toLowerCase(),source=Array.isArray(rows)?rows:[];
 if(!needle)return source.slice();
 return source.filter(raw=>{
  const order=normalizeOrder(raw);if(!order)return false;
  const date=parseDate(order.created_at),formatted=date?dateLabel(date,{day:"numeric",month:"long",year:"numeric"}):"",localIso=date?date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"):"";
  return [order.id,shortOrderRef(order.id),"#"+shortOrderRef(order.id),order.created_at,localIso,formatted,order.status,order.payment_status,order.payment_method,formatCurrency(order.subtotal),paymentStatusLabel(order)].join(" ").toLowerCase().includes(needle);
 });
}
function renderTransactions(container,query,rows,limit){
 if(!container)return;
 const sorted=(Array.isArray(rows)?rows:[]).map(normalizeOrder).filter(Boolean).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
 const filtered=filterOrders(query,sorted);
 if(!filtered.length){container.innerHTML='<p class="payments-transactions-empty">'+(String(query||"").trim()?"No orders match that search.":"No order records are available for this business yet.")+'</p>';return}
 const visible=filtered.slice(0,Math.max(PAGE_SIZE,Number(limit)||PAGE_SIZE)),groups=new Map();
 visible.forEach(order=>{const date=parseDate(order.created_at),label=date?dateLabel(date,{day:"numeric",month:"long",year:"numeric"}):"Date unavailable";if(!groups.has(label))groups.set(label,[]);groups.get(label).push(order)});
 let html="";
 groups.forEach((items,date)=>{html+='<div class="payments-date-group"><h5>'+esc(date)+'</h5>';items.forEach(order=>{const ref=shortOrderRef(order.id),status=paymentStatusLabel(order),method=order.payment_method==="card"?"Card selection":"Pay on collection";html+='<button type="button" class="payments-transaction" data-payment-order-id="'+esc(order.id)+'" aria-label="Open order '+esc(ref)+', '+esc(formatCurrency(order.subtotal))+', '+esc(status)+'"><span class="payments-transaction-id">Order #'+esc(ref)+'</span><strong class="payments-transaction-amount">'+formatCurrency(order.subtotal)+'</strong><span class="payments-transaction-status '+paymentStatusClass(order)+'">'+esc(status)+' · '+esc(method)+'</span></button>'});html+='</div>'});
 if(filtered.length>visible.length)html+='<button type="button" class="payments-load-older" data-payments-load-older>Load older transactions ('+(filtered.length-visible.length)+')</button>';
 container.innerHTML=html;
}
function text(doc,id,value){const node=byId(doc,id);if(node)node.textContent=value}
function render(doc){
 const d=doc||root.document;if(!d)return;
 const list=byId(d,"paymentsTransactions"),search=byId(d,"paymentsTransactionSearch"),period=byId(d,"paymentsPeriod"),chart=byId(d,"paymentsChart"),customStart=byId(d,"paymentsCustomStart"),customEnd=byId(d,"paymentsCustomEnd"),customFields=byId(d,"paymentsCustomFields");
 const key=period&&PERIODS[period.value]?period.value:"week",custom={start:customStart&&customStart.value,end:customEnd&&customEnd.value};
 if(customFields)customFields.hidden=key!=="custom";
 text(d,"paymentsRangeLabel",key==="custom"?periodDateLabel(key,custom,new Date()):PERIODS[key]+" · "+periodDateLabel(key,custom,new Date()));
 if(!state.loaded){
  const display=state.loading?"Loading…":"—";
  ["paymentsTotalSales","paymentsNetEarnings","paymentsPendingPayments","paymentsAvailableBalance","paymentsAwaitingBalance","paymentsPayoutBalance","paymentsPaidOut","paymentsCompletedOrders","paymentsAverageOrderValue","paymentsSalesGrowth","paymentsRefundedAmount"].forEach(id=>text(d,id,display));
  text(d,"paymentsNetEarningsNote","Payment fee data is not connected.");text(d,"paymentsPendingPaymentsNote","Provider-confirmed payments are not connected.");text(d,"paymentsAvailableBalanceNote","No settlement balance is available.");
  text(d,"paymentsAwaitingBalanceNote","StoreNest release tracking is not enabled.");text(d,"paymentsPayoutBalanceNote","No settlement account is connected.");text(d,"paymentsPaidOutNote","Payout records are not available.");
  text(d,"paymentsDataNote",state.error?"Order history could not be loaded. Reopen Payments & Earnings to retry.":state.loading?"Loading this business's recorded orders…":"Order history will appear here when the dashboard opens.");
  text(d,"paymentsDataFootnote","Order completion is separate from payment confirmation. StoreNest does not yet have a connected payment, fee, refund, escrow or payout ledger.");
  if(chart)chart.innerHTML='<p class="payments-transactions-empty">'+(state.loading?"Loading order history…":"Order activity is not loaded yet.")+'</p>';
  if(list)list.innerHTML="";return;
 }
 const data=summarizeOrders(state.orders,key,new Date(),custom);
 if(!data.valid){
  ["paymentsTotalSales","paymentsNetEarnings","paymentsPendingPayments","paymentsCompletedOrders","paymentsAverageOrderValue","paymentsSalesGrowth","paymentsRefundedAmount"].forEach(id=>text(d,id,"—"));
  ["paymentsAvailableBalance","paymentsAwaitingBalance","paymentsPayoutBalance","paymentsPaidOut"].forEach(id=>text(d,id,"—"));
  text(d,"paymentsDataNote","Choose a valid start and end date for this report.");
  if(chart)chart.innerHTML=buildChartSvg(key,state.orders,new Date(),custom);
 }else{
  text(d,"paymentsTotalSales",formatCurrency(data.totalSales));
  text(d,"paymentsNetEarnings","—");
  text(d,"paymentsPendingPayments","—");
  text(d,"paymentsAvailableBalance","—");
  text(d,"paymentsAwaitingBalance","—");
  text(d,"paymentsPayoutBalance","—");
  text(d,"paymentsPaidOut","—");
  text(d,"paymentsCompletedOrders",String(data.completedCount));
  text(d,"paymentsAverageOrderValue",formatCurrency(data.averageOrderValue));
  text(d,"paymentsSalesGrowth",data.salesGrowth);
  text(d,"paymentsRefundedAmount",formatCurrency(data.refunded));
  text(d,"paymentsNetEarningsNote",data.recordedPaid?"Payments are marked paid in order records, but fees are not recorded.":"No order is marked paid; actual collection is not recorded.");
  text(d,"paymentsPendingPaymentsNote","Unpaid/pending order labels do not verify an amount still owed.");
  text(d,"paymentsAvailableBalanceNote","No connected StoreNest settlement balance.");
  text(d,"paymentsAwaitingBalanceNote","StoreNest escrow/release tracking is not enabled.");
  text(d,"paymentsPayoutBalanceNote","No connected settlement account.");
  text(d,"paymentsPaidOutNote","No payout ledger is connected.");
  const salesCount=data.orders.filter(isQualifyingSale).length,paidCount=data.orders.filter(isRecordedPaid).length;
  text(d,"paymentsDataNote",data.orderCount+" order record"+(data.orderCount===1?"":"s")+" in "+PERIODS[key].toLowerCase()+" for "+(state.businessName||"this business")+" · "+salesCount+" completed, non-refunded order"+(salesCount===1?"":"s")+" · "+paidCount+" marked paid.");
  text(d,"paymentsDataFootnote","Total Sales is completed, non-refunded order value by order date. Card checkout is preview-only and pay-on-collection payments are not recorded. Refunded Amount uses the full subtotal of orders marked refunded; partial-refund amounts, provider fees, escrow releases and payouts have no ledger.");
  if(chart)chart.innerHTML=buildChartSvg(key,state.orders,new Date(),custom);
 }
 text(d,"paymentsAwaitingBalanceLabel","Awaiting Release");text(d,"paymentsPayoutBalanceLabel","Available");text(d,"paymentsPaidOutLabel","Paid Out");
 renderTransactions(list,search&&search.value,state.orders,state.transactionLimit);
}
function setBusiness(detail){
 const id=detail&&detail.businessId?String(detail.businessId):null;
 if(id===state.businessId){state.businessName=String(detail&&detail.businessName||state.businessName);render();return}
 state.businessId=id;state.businessName=String(detail&&detail.businessName||"");state.orders=[];state.loaded=false;state.loading=false;state.error="";state.transactionLimit=PAGE_SIZE;render();
 const section=root.document&&root.document.getElementById("paymentsDashboard");
 if(section&&!section.hidden)root.dispatchEvent(new CustomEvent("storenest:owner-payments-reload",{detail:{businessId:id}}));
}
function setData(detail){
 const id=detail&&detail.businessId?String(detail.businessId):null;if(id!==state.businessId)return;
 state.businessName=String(detail&&detail.businessName||state.businessName||"");
 state.orders=(Array.isArray(detail&&detail.orders)?detail.orders:[]).map(normalizeOrder).filter(Boolean).filter(order=>order.business_id===state.businessId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
 state.loaded=true;state.loading=false;state.error="";state.transactionLimit=PAGE_SIZE;render();
}
function upsertOrder(raw,businessId){
 const order=normalizeOrder(raw),id=String(businessId||"");if(!order||!state.loaded||!id||state.businessId!==id||order.business_id!==id)return;
 state.orders=[order,...state.orders.filter(row=>row.id!==order.id)].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));render();
}
function init(doc){
 const d=doc||root.document,section=d&&d.getElementById("paymentsDashboard");if(!section||section.dataset.initialized==="true")return;
 const chart=byId(d,"paymentsChart"),period=byId(d,"paymentsPeriod"),search=byId(d,"paymentsTransactionSearch"),list=byId(d,"paymentsTransactions"),customStart=byId(d,"paymentsCustomStart"),customEnd=byId(d,"paymentsCustomEnd");
 if(!chart||!period||!search||!list)return;
 const today=localDay(new Date());if(customStart&&!customStart.value)customStart.value=dateInputValue(addDays(today,-6));if(customEnd&&!customEnd.value)customEnd.value=dateInputValue(today);
 section.dataset.initialized="true";
 root.addEventListener("storenest:owner-business-ready",event=>setBusiness(event.detail||{}));
 root.addEventListener("storenest:owner-payments-loading",event=>{if(String(event.detail&&event.detail.businessId||"")===String(state.businessId||"")){state.loading=true;state.loaded=false;state.error="";render()}});
 root.addEventListener("storenest:owner-payments-data",event=>setData(event.detail||{}));
 root.addEventListener("storenest:owner-payments-error",event=>{const id=String(event.detail&&event.detail.businessId||"");if(id!==String(state.businessId||""))return;state.loading=false;state.loaded=false;state.error="load";render()});
 root.addEventListener("storenest:owner-orders-updated",event=>{const detail=event.detail||{};upsertOrder(detail.order,detail.businessId)});
 period.addEventListener("change",()=>render(d));
 [customStart,customEnd].forEach(input=>input&&input.addEventListener("change",()=>render(d)));
 search.addEventListener("input",()=>{state.transactionLimit=PAGE_SIZE;renderTransactions(list,search.value,state.orders,state.transactionLimit)});
 list.addEventListener("click",event=>{
  const older=event.target.closest("[data-payments-load-older]");if(older){state.transactionLimit+=PAGE_SIZE;renderTransactions(list,search.value,state.orders,state.transactionLimit);return}
  const order=event.target.closest("[data-payment-order-id]");if(order)root.dispatchEvent(new CustomEvent("storenest:owner-open-order",{detail:{businessId:state.businessId,orderId:order.dataset.paymentOrderId}}));
 });
}
const api=Object.freeze({PERIODS,formatCurrency,normalizeOrder,dateRange,periodDateLabel,chartSlots,summarizeOrders,filterOrders,chartValues,buildChartSvg,renderTransactions,paymentStatusLabel,init,setData,upsertOrder});
root.StoreNestPaymentsDashboard=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root.document){if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",()=>init(root.document),{once:true});else init(root.document)}
})(typeof window!=="undefined"?window:globalThis);
