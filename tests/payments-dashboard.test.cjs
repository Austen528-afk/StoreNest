"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {formatCurrency,summarizeOrders,filterOrders,buildChartSvg}=require("../payments-dashboard.js");

const now=new Date(2026,10,10,12,0,0);
const orders=[
 {id:"a4c91f4e-1111-4111-8111-111111111111",business_id:"business-a",status:"completed",payment_status:"unpaid",payment_method:"pay_on_collection",subtotal:150,created_at:new Date(2026,10,10,9).toISOString()},
 {id:"b4c91f4e-2222-4222-8222-222222222222",business_id:"business-a",status:"completed",payment_status:"paid",payment_method:"card",subtotal:90,created_at:new Date(2026,10,9,9).toISOString()},
 {id:"c4c91f4e-3333-4333-8333-333333333333",business_id:"business-a",status:"completed",payment_status:"pending",payment_method:"card",subtotal:25,created_at:new Date(2026,10,10,10).toISOString()},
 {id:"d4c91f4e-4444-4444-8444-444444444444",business_id:"business-a",status:"cancelled",payment_status:"paid",payment_method:"card",subtotal:50,created_at:new Date(2026,10,8,9).toISOString()},
 {id:"e4c91f4e-5555-4555-8555-555555555555",business_id:"business-a",status:"completed",payment_status:"refunded",payment_method:"card",subtotal:20,created_at:new Date(2026,10,8,9).toISOString()}
];

test("dashboard summarizes recorded completed, paid, unpaid, and refunded orders",()=>{
 const summary=summarizeOrders(orders,"week",now);
 assert.equal(summary.orderCount,5);
 assert.equal(summary.completedCount,4);
 assert.equal(summary.completedValue,265);
 assert.equal(summary.recordedPaid,90);
 assert.equal(summary.unpaidOrPending,175);
 assert.equal(summary.refunded,20);
 assert.equal(summary.averageOrderValue,265/3);
});

test("order search covers ids, dates, payment and order statuses, and amounts",()=>{
 assert.deepEqual(filterOrders("#A4C91F4E",orders).map(row=>row.id),[orders[0].id]);
 assert.deepEqual(filterOrders("10 November 2026",orders).map(row=>row.id),[orders[0].id,orders[2].id]);
 assert.deepEqual(filterOrders("not marked paid",orders).map(row=>row.id),[orders[0].id]);
 assert.deepEqual(filterOrders("R90.00",orders).map(row=>row.id),[orders[1].id]);
 assert.deepEqual(filterOrders("no such order",orders),[]);
});

test("currency and chart ranges render from the provided order rows",()=>{
 assert.equal(formatCurrency(1450.5),"R1,450.50");
 const week=buildChartSvg("week",orders,now),month=buildChartSvg("month",orders,now),thirty=buildChartSvg("thirty",orders,now);
 assert.match(week,/This week: completed order value and recorded payments/);
 assert.match(month,/This month: completed order value and recorded payments/);
 assert.notEqual(week,month);
 assert.notEqual(month,thirty);
});
