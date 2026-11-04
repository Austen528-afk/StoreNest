/* StoreNest appearance preference shared across marketplace, owner dashboard and storefront. */
(()=>{
"use strict";
const KEY="storenest:theme";
const root=document.documentElement;
const read=()=>{try{return localStorage.getItem(KEY)==="dark"?"dark":"light"}catch(_){return"light"}};
function apply(value,persist=false){
 const theme=value==="dark"?"dark":"light";
 root.dataset.theme=theme;
 root.style.colorScheme=theme;
 if(persist){try{localStorage.setItem(KEY,theme)}catch(_){}}
 const meta=document.querySelector('meta[name="theme-color"]');
 // Keep the native/PWA system status bar opaque and dark in both appearance modes.
 if(meta)meta.content="#10171d";
 document.querySelectorAll("[data-theme-toggle]").forEach(button=>{
  const dark=theme==="dark";
  const label=button.querySelector(".theme-switch-label");
  const icon=button.querySelector(".theme-switch-icon");
  if(label)label.textContent=dark?"Light mode":"Dark mode";
  if(icon)icon.textContent=dark?"☀":"☾";
  button.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");
  button.setAttribute("aria-pressed",String(dark));
  button.title=dark?"Switch to light mode":"Switch to dark mode";
 });
}
apply(read());
document.addEventListener("click",event=>{
 const button=event.target.closest("[data-theme-toggle]");
 if(button)apply(root.dataset.theme==="dark"?"light":"dark",true);
});
window.addEventListener("storage",event=>{
 if(event.key===KEY)apply(read());
});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>apply(read()),{once:true});
})();