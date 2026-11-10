(function(root){
"use strict";
const charts={
 week:{label:"This week",labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],max:3200,sales:[1200,1700,1400,2300,2000,3200,2800],earnings:[1100,1600,1350,2200,1900,3100,2700]},
 month:{label:"This month",labels:["1 Nov","5 Nov","9 Nov","13 Nov","17 Nov","21 Nov","30 Nov"],max:16000,sales:[5200,8100,6400,11200,9400,14800,13200],earnings:[4980,7750,6120,10724,8990,14171,12639]},
 thirty:{label:"Last 30 days",labels:["12 Oct","17 Oct","22 Oct","27 Oct","1 Nov","6 Nov","10 Nov"],max:14000,sales:[4100,6800,5300,9200,7400,12600,10800],earnings:[3926,6511,5075,8810,7086,12065,10341]}
};
const sampleTransactions=[
 {id:"1043",date:"8 November 2026",amount:150,status:"Paid"},
 {id:"1042",date:"8 November 2026",amount:90,status:"Pending"},
 {id:"1041",date:"7 November 2026",amount:415,status:"Paid"},
 {id:"1040",date:"7 November 2026",amount:230,status:"Paid"},
 {id:"1039",date:"6 November 2026",amount:280,status:"Pending"},
 {id:"1038",date:"6 November 2026",amount:175,status:"Paid"},
 {id:"1037",date:"5 November 2026",amount:520,status:"Paid"}
];
function formatCurrency(amount){
 const n=Math.round(Number(amount)||0);
 return "R"+Math.abs(n).toLocaleString("en-US")+(n<0?" debit":"");
}
function filterTransactions(query,rows){
 const needle=String(query||"").trim().toLowerCase(), source=Array.isArray(rows)?rows:sampleTransactions;
 if(!needle)return source.slice();
 return source.filter(row=>[row.id,"#"+row.id,row.date,row.status,formatCurrency(row.amount)].join(" ").toLowerCase().includes(needle));
}
function buildChartSvg(key){
 const data=charts[key]||charts.week,w=620,h=252,l=78,r=12,t=14,b=42,pw=w-l-r,ph=h-t-b;
 const points=values=>values.map((v,i)=>({x:l+i*pw/(values.length-1),y:t+ph-v/data.max*ph,v}));
 const sales=points(data.sales),earnings=points(data.earnings);
 const path=pts=>pts.map((p,i)=>(i?"L ":"M ")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
 let out='<svg class="payments-chart-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+data.label+' sample sales and net earnings"><title>'+data.label+': sample sales and net earnings</title>';
 for(let i=0;i<=4;i++){const y=t+ph*i/4,n=Math.round(data.max*(4-i)/4);out+='<line x1="'+l+'" y1="'+y+'" x2="'+(w-r)+'" y2="'+y+'" class="payments-chart-grid"/><text x="'+(l-12)+'" y="'+(y+4)+'" text-anchor="end" class="payments-chart-label">'+formatCurrency(n)+'</text>'}
 out+='<path d="'+path(sales)+'" class="payments-chart-line payments-chart-sales"/><path d="'+path(earnings)+'" class="payments-chart-line payments-chart-earnings"/>';
 sales.forEach((p,i)=>{out+='<circle cx="'+p.x+'" cy="'+p.y+'" r="4.5" class="payments-chart-dot payments-chart-sales-dot"><title>Sales: '+formatCurrency(p.v)+'</title></circle><circle cx="'+earnings[i].x+'" cy="'+earnings[i].y+'" r="4.5" class="payments-chart-dot payments-chart-earnings-dot"><title>Net earnings: '+formatCurrency(earnings[i].v)+'</title></circle>'});
 data.labels.forEach((label,i)=>{const x=l+i*pw/(data.labels.length-1);out+='<text x="'+x+'" y="'+(h-13)+'" text-anchor="middle" class="payments-chart-label payments-chart-x-label">'+label+'</text>'});
 return out+"</svg>";
}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderTransactions(container,query){
 if(!container)return;
 const rows=filterTransactions(query);
 if(!rows.length){container.innerHTML='<p class="payments-transactions-empty">No sample transactions match that search.</p>';return}
 const groups=new Map();
 rows.forEach(row=>{if(!groups.has(row.date))groups.set(row.date,[]);groups.get(row.date).push(row)});
 let html="";
 groups.forEach((items,date)=>{
  html+='<div class="payments-date-group"><h5>'+esc(date)+'</h5>';
  items.forEach(row=>{html+='<div class="payments-transaction"><span class="payments-transaction-id">#'+esc(row.id)+'</span><strong class="payments-transaction-amount">'+formatCurrency(row.amount)+'</strong><span class="payments-transaction-status '+(row.status==="Paid"?"is-paid":"is-pending")+'">'+esc(row.status)+'</span></div>'});
  html+="</div>";
 });
 container.innerHTML=html;
}
function init(doc){
 const d=doc||root.document,section=d&&d.getElementById("paymentsDashboard");
 if(!section||section.dataset.initialized==="true")return;
 const chart=d.getElementById("paymentsChart"),period=d.getElementById("paymentsPeriod"),search=d.getElementById("paymentsTransactionSearch"),list=d.getElementById("paymentsTransactions");
 if(!chart||!period||!search||!list)return;
 section.dataset.initialized="true";
 const draw=()=>{chart.innerHTML=buildChartSvg(period.value)};
 draw();renderTransactions(list,search.value);
 period.addEventListener("change",draw);
 search.addEventListener("input",()=>renderTransactions(list,search.value));
 d.querySelectorAll('.side-link[data-section="payments"]').forEach(button=>button.addEventListener("click",draw));
}
const api=Object.freeze({charts,sampleTransactions,formatCurrency,filterTransactions,buildChartSvg,init});
root.StoreNestPaymentsDashboard=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root.document){if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",()=>init(root.document),{once:true});else init(root.document)}
})(typeof window!=="undefined"?window:globalThis);