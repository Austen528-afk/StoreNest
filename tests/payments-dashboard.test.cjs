"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const {formatCurrency,summarizeOrders,filterOrders,chartValues,buildChartSvg,renderTransactions,paymentStatusLabel}=require("../payments-dashboard.js");

const now=new Date(2026,10,10,12,0,0);
const at=(day,hour=9)=>new Date(2026,10,day,hour).toISOString();
const orders=[
 {id:"a4c91f4e-1111-4111-8111-111111111111",business_id:"business-a",status:"completed",payment_status:"unpaid",payment_method:"pay_on_collection",subtotal:150,created_at:at(10)},
 {id:"b4c91f4e-2222-4222-8222-222222222222",business_id:"business-a",status:"completed",payment_status:"paid",payment_method:"card",subtotal:90,created_at:at(9)},
 {id:"c4c91f4e-3333-4333-8333-333333333333",business_id:"business-a",status:"completed",payment_status:"pending",payment_method:"card",subtotal:25,created_at:at(10,10)},
 {id:"d4c91f4e-4444-4444-8444-444444444444",business_id:"business-a",status:"cancelled",payment_status:"paid",payment_method:"card",subtotal:50,created_at:at(8)},
 {id:"e4c91f4e-5555-4555-8555-555555555555",business_id:"business-a",status:"completed",payment_status:"refunded",payment_method:"card",subtotal:20,created_at:at(8)},
 {id:"f4c91f4e-6666-4666-8666-666666666666",business_id:"business-a",status:"preparing",payment_status:"unpaid",payment_method:"pay_on_collection",subtotal:30,created_at:at(10)},
 {id:"g4c91f4e-7777-4777-8777-777777777777",business_id:"business-b",status:"completed",payment_status:"paid",payment_method:"card",subtotal:999,created_at:at(10)}
];

test("completed sales exclude cancellations and refunded orders; payment status stays separate",()=>{
 const businessA=orders.filter(row=>row.business_id==="business-a");
 const summary=summarizeOrders(businessA,"month",now);
 assert.equal(summary.orderCount,6);
 assert.equal(summary.completedCount,4);
 assert.equal(summary.totalSales,265);
 assert.equal(summary.recordedPaid,90);
 assert.equal(summary.refunded,20);
 assert.equal(summary.averageOrderValue,265/3);
 assert.equal(summary.netEarnings,null);
 assert.equal(summary.pendingPayments,null);
 assert.equal(paymentStatusLabel(orders[0]),"Collection payment not recorded");
 assert.equal(paymentStatusLabel(orders[2]),"Card preview; no payment processed");
 assert.equal(paymentStatusLabel(orders[1]),"Marked paid (not provider-verified)");
});

test("period filters include today, week, month, year and custom inclusive dates",()=>{
 const businessA=orders.filter(row=>row.business_id==="business-a");
 const daily=summarizeOrders(businessA,"today",now);
 assert.equal(daily.totalSales,175);
 assert.equal(daily.completedCount,2);
 const week=summarizeOrders(businessA,"week",now);
 assert.equal(week.totalSales,265);
 const year=summarizeOrders(businessA,"year",now);
 assert.equal(year.totalSales,265);
 assert.equal(year.salesGrowth,"New");
 const custom=summarizeOrders(businessA,"custom",now,{start:"2026-11-09",end:"2026-11-10"});
 assert.equal(custom.totalSales,265);
 assert.equal(custom.completedCount,3);
 assert.equal(summarizeOrders(businessA,"custom",now,{start:"2026-11-11",end:"2026-11-10"}).valid,false);
});

test("business-scoped rows reconcile the DINOS historical order total",()=>{
 const dinos=Array.from({length:14},(_,i)=>({id:"dinos-collection-"+i,business_id:"dinos",status:"completed",payment_status:"unpaid",payment_method:"pay_on_collection",subtotal:i===13?64:58,created_at:at(8)}));
 dinos.push({id:"dinos-card-preview",business_id:"dinos",status:"completed",payment_status:"pending",payment_method:"card",subtotal:25,created_at:at(8)});
 const scoped=dinos.filter(row=>row.business_id==="dinos");
 const summary=summarizeOrders(scoped,"month",now);
 assert.equal(summary.orderCount,15);
 assert.equal(summary.completedCount,15);
 assert.equal(summary.totalSales,843);
 assert.equal(summary.recordedPaid,0);
 assert.equal(chartValues(scoped,"month",now).sales.reduce((a,b)=>a+b,0),843);
});

test("chart and date/ID search use recorded order rows only",()=>{
 assert.equal(formatCurrency(1450.5),"R1,450.50");
 assert.deepEqual(filterOrders("#A4C91F4E",orders).map(row=>row.id),[orders[0].id]);
 assert.deepEqual(filterOrders("10 November 2026",orders).map(row=>row.id),[orders[0].id,orders[2].id,orders[5].id,orders[6].id]);
 assert.deepEqual(filterOrders("2026-11-09",orders).map(row=>row.id),[orders[1].id]);
 const businessA=orders.filter(row=>row.business_id==="business-a");
 const today=buildChartSvg("today",businessA,now);
 assert.match(today,/completed order value and order records marked paid/);
 assert.doesNotMatch(today,/NaN|Infinity/);
 assert.doesNotMatch(today,/payments-chart-line payments-chart-earnings/);
 const noActivity=buildChartSvg("week",[],now);
 assert.match(noActivity,/No completed order value is recorded/);
 assert.doesNotMatch(noActivity,/<svg/);
});

test("transaction list is clickable, sorted by saved timestamp and pages older rows",()=>{
 const rows=Array.from({length:12},(_,i)=>({id:"record-"+String(i).padStart(2,"0"),business_id:"business-a",status:"new",payment_status:"unpaid",payment_method:"pay_on_collection",subtotal:i+1,created_at:new Date(2026,10,10,12-i).toISOString()}));
 const container={innerHTML:""};
 renderTransactions(container,"",rows,10);
 assert.match(container.innerHTML,/data-payment-order-id="record-00"/);
 assert.match(container.innerHTML,/data-payments-load-older/);
 assert.ok(container.innerHTML.indexOf('data-payment-order-id="record-00"')<container.innerHTML.indexOf('data-payment-order-id="record-01"'));
 renderTransactions(container,"2026-11-10",rows,20);
 assert.doesNotMatch(container.innerHTML,/data-payments-load-older/);
});

test("dashboard keeps business scoping and provides the requested operational controls",()=>{
 const html=fs.readFileSync(path.join(__dirname,"..","business-owner.html"),"utf8");
 const script=fs.readFileSync(path.join(__dirname,"..","payments-dashboard.js"),"utf8");
 const viewer=fs.readFileSync(path.join(__dirname,"..","owner-order-viewer.js"),"utf8");
 for(const id of ["paymentsTotalSales","paymentsNetEarnings","paymentsPendingPayments","paymentsAvailableBalance","paymentsPeriod","paymentsCustomStart","paymentsCustomEnd","paymentsTransactionSearch","paymentsTransactions","paymentsRangeLabel"])assert.match(html,new RegExp('id="'+id+'"'));
 for(const period of ["today","week","month","year","custom"])assert.match(html,new RegExp('option value="'+period+'"'));
 assert.match(html,/\.eq\("business_id",businessId\)/);
 assert.match(script,/storenest:owner-open-order/);
 assert.match(html,/storenest:owner-open-order/);
 assert.match(viewer,/Payment status is taken from the saved order record/);
 assert.doesNotMatch(script,/demo|sample|R\s?50,?000|\[\s*\d+\s*,\s*\d+/i);
});
