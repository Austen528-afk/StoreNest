(function(root){
"use strict";
const PERIODS={week:"This week",month:"This month",thirty:"Last 30 days"};
const DAY=86400000;
let state={businessId:null,businessName:"",orders:[],loaded:false,loading:false,error:""};
const byId=(doc,id)=>doc&&doc.getElementById(id);
function finiteAmount(value){const amount=Number(value);return Number.isFinite(amount)&&amount>0?amount:0}
function normalizeOrder(row){
 if(!row||typeof row!=="object")return null;
 const id=String(row.id||"");if(!id)return null;
 return {id,business_id:String(row.business_id||""),status:String(row.status||"").toLowerCase(),payment_status:String(row.payment_status||"").toLowerCase(),payment_method:String(row.payment_method||"").toLowerCase(),subtotal:finiteAmount(row.subtotal),created_at:String(row.created_at||"")};
}
function localDay(value){
 const date=value instanceof Date?new Date(value.getTime()):new Date(value||"");
 if(Number.isNaN(date.getTime()))return null;
 return new Date(date.getFullYear(),date.getMonth(),date.getDate());
}
function addDays(date,count){return new Date(date.getFullYear(),date.getMonth(),date.getDate()+count)}
function dateLabel(date,options){return new Intl.DateTimeFormat("en-ZA",options).format(date)}
function formatCurrency(value){
 const amount=Number(value);
 return "R"+(Number.isFinite(amount)?amount:0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function isCompletedSale(order){return order.status==="completed"&&order.payment_status!=="refunded"}
function isRecordedPaid(order){return order.payment_status==="paid"&&order.status!=="cancelled"}
function isUnpaidOrPending(order){return (order.payment_status==="pending"||order.payment_status==="unpaid")&&order.status!=="cancelled"}
function comparisonRanges(period,now){
 const today=localDay(now)||localDay(new Date()),tomorrow=addDays(today,1);
 if(period==="month"){
  const currentStart=new Date(today.getFullYear(),today.getMonth(),1),elapsed=today.getDate();
  const previousStart=new Date(today.getFullYear(),today.getMonth()-1,1),previousDays=new Date(today.getFullYear(),today.getMonth(),0).getDate();
  return {currentStart,currentEnd:tomorrow,previousStart,previousEnd:addDays(previousStart,Math.min(elapsed,previousDays))};
 }
 if(period==="thirty"){
  const currentStart=addDays(today,-29);
  return {currentStart,currentEnd:tomorrow,previousStart:addDays(currentStart,-30),previousEnd:currentStart};
 }
 const monday=addDays(today,-((today.getDay()+6)%7)),elapsed=Math.floor((today.getTime()-monday.getTime())/DAY)+1,previousStart=addDays(monday,-7);
 return {currentStart:monday,currentEnd:tomorrow,previousStart,previousEnd:addDays(previousStart,elapsed)};
}
function summarizeOrders(input,period,now){
 const orders=(Array.isArray(input)?input:[]).map(normalizeOrder).filter(Boolean),completed=orders.filter(order=>order.status==="completed"),completedSaleCount=orders.filter(isCompletedSale).length;
 const completedValue=orders.filter(isCompletedSale).reduce((sum,order)=>sum+order.subtotal,0);
 const recordedPaid=orders.filter(isRecordedPaid).reduce((sum,order)=>sum+order.subtotal,0);
 const unpaidOrPending=orders.filter(isUnpaidOrPending).reduce((sum,order)=>sum+order.subtotal,0);
 const refunded=orders.filter(order=>order.payment_status==="refunded").reduce((sum,order)=>sum+order.subtotal,0);
 const range=comparisonRanges(period||"week",now||new Date());
 const current=orders.filter(isCompletedSale).reduce((sum,order)=>{const date=new Date(order.created_at);return date>=range.currentStart&&date<range.currentEnd?sum+order.subtotal:sum},0);
 const previous=orders.filter(isCompletedSale).reduce((sum,order)=>{const date=new Date(order.created_at);return date>=range.previousStart&&date<range.previousEnd?sum+order.subtotal:sum},0);
 let salesGrowth="0%";
 if(previous===0&&current>0)salesGrowth="New";
 else if(previous>0){const change=(current-previous)/previous*100;salesGrowth=(change>0?"+":"")+Math.round(change)+"%"}
 return {orderCount:orders.length,completedCount:completed.length,completedValue,recordedPaid,unpaidOrPending,refunded,averageOrderValue:completedSaleCount?completedValue/completedSaleCount:0,salesGrowth};
}
function chartSlots(period,now){
 const today=localDay(now)||localDay(new Date());
 if(period==="month"){
  const year=today.getFullYear(),month=today.getMonth(),days=new Date(year,month+1,0).getDate(),anchors=Array.from({length:7},(_,i)=>1+Math.round(i*(days-1)/6));
  return anchors.map((day,i)=>{const start=new Date(year,month,day),end=i<anchors.length-1?new Date(year,month,anchors[i+1]):new Date(year,month+1,1);return {start,end,label:day+" "+dateLabel(start,{month:"short"})}});
 }
 if(period==="thirty"){
  const first=addDays(today,-29),anchors=Array.from({length:7},(_,i)=>addDays(first,Math.round(i*29/6)));
  return anchors.map((start,i)=>({start,end:i<anchors.length-1?anchors[i+1]:addDays(today,1),label:dateLabel(start,{day:"numeric",month:"short"})}));
 }
 const monday=addDays(today,-((today.getDay()+6)%7));
 return Array.from({length:7},(_,i)=>{const start=addDays(monday,i);return {start,end:addDays(start,1),label:dateLabel(start,{weekday:"short"})}});
}
function chartValues(orders,period,now){
 const slots=chartSlots(period,now),sales=slots.map(()=>0),paid=slots.map(()=>0);
 for(const raw of Array.isArray(orders)?orders:[]){
  const order=normalizeOrder(raw);if(!order)continue;
  const day=localDay(order.created_at);if(!day)continue;
  const index=slots.findIndex(slot=>day>=slot.start&&day<slot.end);if(index<0)continue;
  if(isCompletedSale(order))sales[index]+=order.subtotal;
  if(isRecordedPaid(order))paid[index]+=order.subtotal;
 }
 return {slots,sales,paid};
}
function buildChartSvg(period,orders,now){
 const key=PERIODS[period]?period:"week",data=chartValues(orders,key,now),w=620,h=252,l=82,r=12,t=14,b=42,pw=w-l-r,ph=h-t-b;
 const maxValue=Math.max(0,...data.sales,...data.paid),step=Math.max(50,Math.ceil(maxValue/4/50)*50),max=step*4;
 const points=values=>values.map((value,i)=>({x:l+i*pw/(values.length-1),y:t+ph-value/max*ph,value}));
 const sales=points(data.sales),paid=points(data.paid),path=pts=>pts.map((point,i)=>(i?"L ":"M ")+point.x.toFixed(1)+" "+point.y.toFixed(1)).join(" ");
 let out='<svg class="payments-chart-svg" viewBox="0 0 '+w+" "+h+'" role="img" aria-label="'+PERIODS[key]+' completed order value and recorded payments"><title>'+PERIODS[key]+': completed order value and recorded payments</title>';
 for(let i=0;i<=4;i++){const y=t+ph*i/4,value=max*(4-i)/4;out+='<line x1="'+l+'" y1="'+y+'" x2="'+(w-r)+'" y2="'+y+'" class="payments-chart-grid"/><text x="'+(l-12)+'" y="'+(y+4)+'" text-anchor="end" class="payments-chart-label">'+formatCurrency(value)+'</text>'}
 out+='<path d="'+path(sales)+'" class="payments-chart-line payments-chart-sales"/><path d="'+path(paid)+'" class="payments-chart-line payments-chart-earnings"/>';
 sales.forEach((point,i)=>{out+='<circle cx="'+point.x+'" cy="'+point.y+'" r="4.5" class="payments-chart-dot payments-chart-sales-dot"><title>Completed order value: '+formatCurrency(point.value)+'</title></circle><circle cx="'+paid[i].x+'" cy="'+paid[i].y+'" r="4.5" class="payments-chart-dot payments-chart-earnings-dot"><title>Recorded as paid: '+formatCurrency(paid[i].value)+'</title></circle>'});
 data.slots.forEach((slot,i)=>{const x=l+i*pw/(data.slots.length-1);out+='<text x="'+x+'" y="'+(h-13)+'" text-anchor="middle" class="payments-chart-label payments-chart-x-label">'+slot.label+'</text>'});
 return out+"</svg>";
}
function esc(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
function displayOrderStatus(order){
 const orderLabel=({new:"New",accepted:"Accepted",preparing:"Preparing",prepared:"Prepared",ready:"Ready for collection",completed:"Completed",cancelled:"Cancelled"})[order.status]||"Order";
 const paymentLabel=({paid:"Marked paid",pending:"Payment pending",unpaid:"Not marked paid",failed:"Payment failed",refunded:"Refunded"})[order.payment_status]||"Payment status unknown";
 return orderLabel+" · "+paymentLabel;
}
function orderStatusClass(order){return order.payment_status==="paid"?"is-paid":order.payment_status==="pending"||order.payment_status==="unpaid"?"is-pending":"is-other"}
function filterOrders(query,rows){
 const needle=String(query||"").trim().toLowerCase(),source=Array.isArray(rows)?rows:[];
 if(!needle)return source.slice();
 return source.filter(raw=>{
  const order=normalizeOrder(raw);if(!order)return false;
  const id=order.id.replace(/-/g,""),shortId=id.slice(0,8).toUpperCase(),date=order.created_at?dateLabel(new Date(order.created_at),{day:"numeric",month:"long",year:"numeric"}):"";
  return [id,shortId,"#"+shortId,date,order.status,order.payment_status,order.payment_method,formatCurrency(order.subtotal),displayOrderStatus(order)].join(" ").toLowerCase().includes(needle);
 });
}
function renderTransactions(container,query,rows){
 if(!container)return;
 const filtered=filterOrders(query,rows);
 if(!filtered.length){container.innerHTML='<p class="payments-transactions-empty">'+(rows&&rows.length?"No orders match that search.":"No orders are recorded for this business yet.")+"</p>";return}
 const groups=new Map();
 filtered.forEach(raw=>{const order=normalizeOrder(raw),date=order.created_at?dateLabel(new Date(order.created_at),{day:"numeric",month:"long",year:"numeric"}):"Date unavailable";if(!groups.has(date))groups.set(date,[]);groups.get(date).push(order)});
 let html="";
 groups.forEach((items,date)=>{html+='<div class="payments-date-group"><h5>'+esc(date)+"</h5>";items.forEach(order=>{const shortId=order.id.replace(/-/g,"").slice(0,8).toUpperCase();html+='<div class="payments-transaction"><span class="payments-transaction-id">#'+esc(shortId)+'</span><strong class="payments-transaction-amount">'+formatCurrency(order.subtotal)+'</strong><span class="payments-transaction-status '+orderStatusClass(order)+'">'+esc(displayOrderStatus(order))+"</span></div>"});html+="</div>"});
 container.innerHTML=html;
}
function text(doc,id,value){const node=byId(doc,id);if(node)node.textContent=value}
function render(doc){
 const d=doc||root.document;if(!d)return;
 const list=byId(d,"paymentsTransactions"),search=byId(d,"paymentsTransactionSearch"),period=byId(d,"paymentsPeriod"),chart=byId(d,"paymentsChart");
 if(!state.loaded){
  const display=state.loading?"Loading…":"—";
  ["paymentsCompletedValue","paymentsRecordedPaid","paymentsUnpaidPending","paymentsAvailableBalance","paymentsAwaitingBalance","paymentsPayoutBalance","paymentsPaidOut","paymentsCompletedOrders","paymentsAverageOrderValue","paymentsSalesGrowth","paymentsRefundedAmount"].forEach(id=>text(d,id,display));
  text(d,"paymentsDataNote",state.error?"Could not load order history. Open Payments & Earnings again to retry.":state.loading?"Loading this business's recorded orders…":"Order history will appear here when the dashboard opens.");
  text(d,"paymentsDataFootnote","Fee and payout records are shown only when the system has recorded them.");
  if(chart)chart.innerHTML='<p class="payments-transactions-empty">'+(state.loading?"Loading order history…":"Order activity is not loaded yet.")+"</p>";
  if(list)list.innerHTML="";
  return;
 }
 const key=period&&PERIODS[period.value]?period.value:"week",data=summarizeOrders(state.orders,key,new Date());
 text(d,"paymentsCompletedValue",formatCurrency(data.completedValue));
 text(d,"paymentsRecordedPaid",formatCurrency(data.recordedPaid));
 text(d,"paymentsUnpaidPending",formatCurrency(data.unpaidOrPending));
 text(d,"paymentsAvailableBalance","Not tracked");
 text(d,"paymentsAwaitingBalance",formatCurrency(data.unpaidOrPending));
 text(d,"paymentsPayoutBalance","Not tracked");
 text(d,"paymentsPaidOut","Not tracked");
 text(d,"paymentsCompletedOrders",String(data.completedCount));
 text(d,"paymentsAverageOrderValue",formatCurrency(data.averageOrderValue));
 text(d,"paymentsSalesGrowth",data.salesGrowth);
 text(d,"paymentsRefundedAmount",formatCurrency(data.refunded));
 text(d,"paymentsDataNote",state.orders.length?state.orders.length+" historical order"+(state.orders.length===1?"":"s")+" loaded for "+(state.businessName||"this business")+". Order values follow the saved order and payment statuses.":"No historical orders are recorded for "+(state.businessName||"this business")+".");
 text(d,"paymentsDataFootnote","Completed order value can include pay-on-collection orders. The database does not record cash collection, StoreNest fees, available payouts or paid-out transfers, so those figures are not inferred.");
 if(chart)chart.innerHTML=buildChartSvg(key,state.orders,new Date());
 renderTransactions(list,search&&search.value,state.orders);
}
function setBusiness(detail){
 const id=detail&&detail.businessId?String(detail.businessId):null;
 if(id===state.businessId)return;
 state={businessId:id,businessName:String(detail&&detail.businessName||""),orders:[],loaded:false,loading:false,error:""};render();
}
function setData(detail){
 const id=detail&&detail.businessId?String(detail.businessId):null;
 if(id!==state.businessId)state={businessId:id,businessName:"",orders:[],loaded:false,loading:false,error:""};
 state.businessName=String(detail&&detail.businessName||state.businessName||"");
 state.orders=(Array.isArray(detail&&detail.orders)?detail.orders:[]).map(normalizeOrder).filter(Boolean).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 state.loaded=true;state.loading=false;state.error="";render();
}
function upsertOrder(raw,businessId){
 const order=normalizeOrder(raw),id=String(businessId||"");
 if(!order||!state.loaded||!id||state.businessId!==id)return;
 const rows=state.orders.filter(row=>row.id!==order.id);rows.push(order);
 state.orders=rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));render();
}
function init(doc){
 const d=doc||root.document,section=d&&d.getElementById("paymentsDashboard");
 if(!section||section.dataset.initialized==="true")return;
 const chart=byId(d,"paymentsChart"),period=byId(d,"paymentsPeriod"),search=byId(d,"paymentsTransactionSearch"),list=byId(d,"paymentsTransactions");
 if(!chart||!period||!search||!list)return;
 section.dataset.initialized="true";
 root.addEventListener("storenest:owner-business-ready",event=>setBusiness(event.detail||{}));
 root.addEventListener("storenest:owner-payments-loading",event=>{if(String(event.detail&&event.detail.businessId||"")===String(state.businessId||"")){state.loading=true;state.loaded=false;state.error="";render()}});
 root.addEventListener("storenest:owner-payments-data",event=>setData(event.detail||{}));
 root.addEventListener("storenest:owner-payments-error",event=>{const id=String(event.detail&&event.detail.businessId||"");if(id!==String(state.businessId||""))return;state.loading=false;state.loaded=false;state.error="load";render()});
 root.addEventListener("storenest:owner-orders-updated",event=>{const detail=event.detail||{};upsertOrder(detail.order,detail.businessId)});
 period.addEventListener("change",()=>render(d));
 search.addEventListener("input",()=>renderTransactions(list,search.value,state.loaded?state.orders:[]));
}
const api=Object.freeze({PERIODS,formatCurrency,normalizeOrder,summarizeOrders,filterOrders,chartValues,buildChartSvg,init,setData,upsertOrder});
root.StoreNestPaymentsDashboard=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root.document){if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",()=>init(root.document),{once:true});else init(root.document)}
})(typeof window!=="undefined"?window:globalThis);
