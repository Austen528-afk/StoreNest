"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {charts,sampleTransactions,formatCurrency,filterTransactions,buildChartSvg}=require("../payments-dashboard.js");

test("sample transaction search covers ids, dates, statuses, and amounts",()=>{
 assert.deepEqual(filterTransactions("#1043").map(row=>row.id),["1043"]);
 assert.deepEqual(filterTransactions("8 november 2026").map(row=>row.id),["1043","1042"]);
 assert.deepEqual(filterTransactions("pending").map(row=>row.id),["1042","1039"]);
 assert.deepEqual(filterTransactions("R415").map(row=>row.id),["1041"]);
});
test("empty and unmatched searches return predictable results",()=>{
 assert.equal(filterTransactions("").length,sampleTransactions.length);
 assert.deepEqual(filterTransactions("no such transaction"),[]);
});
test("currency and period charts render correctly",()=>{
 assert.equal(formatCurrency(48500),"R48,500");
 assert.equal(Object.keys(charts).length,3);
 const week=buildChartSvg("week"),month=buildChartSvg("month");
 assert.match(week,/This week: sample sales and net earnings/);
 assert.match(week,/Sales: R1,200/);
 assert.notEqual(week,month);
 assert.match(buildChartSvg("invalid"),/This week: sample sales and net earnings/);
});