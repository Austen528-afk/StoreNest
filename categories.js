/* StoreNest: one shared taxonomy for the marketplace and business registration.
 * Store stable IDs in new business profiles so labels can change without breaking discovery.
 */
(function(){
"use strict";
const categories=Object.freeze([
 Object.freeze({id:"food-drink",label:"Food & Drinks",emoji:"🍔"}),
 Object.freeze({id:"events-decor",label:"Catering and Decor Services",emoji:"🎉"}),
 Object.freeze({id:"electronics",label:"Electronics",emoji:"📱"}),
 Object.freeze({id:"study-supplies",label:"Education & Study Supplies",emoji:"📚"}),
 Object.freeze({id:"fashion",label:"Fashion & Accessories",emoji:"👕"}),
 Object.freeze({id:"cosmetics",label:"Cosmetics",emoji:"🧴",iconSvg:'<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M13 2.5h6v4h-6zM12 6.5h8v4h-8zM12 10.5l-4 4v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-13l-4-4z" fill="#e2f7ea" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12.5 18h7v6h-7z" fill="#fff" stroke="#35b58b" stroke-width="1.3" stroke-linejoin="round"/><path d="M15 4.5h2M10 15h12" stroke="#35b58b" stroke-width="1.3" stroke-linecap="round"/></svg>'}),
 Object.freeze({id:"beauty",label:"Personal Services",emoji:"💇"}),
 Object.freeze({id:"home-living",label:"Home & Living",emoji:"🏠"}),
 Object.freeze({id:"groceries",label:"Groceries & Essentials",emoji:"🛒"}),
 Object.freeze({id:"local-services",label:"Other Services",emoji:"🛠️"}),
 Object.freeze({id:"gifts-occasions",label:"Gifts & Occasions",emoji:"🎁"}),
 Object.freeze({id:"other",label:"Other products",emoji:"🏪"})
]);
const legacy=Object.freeze({
 "Food & Drink":"food-drink",
 "Retail":"other",
 "Beauty & Wellness":"beauty",
 "Personal Care Services and Products":"beauty",
 "Home & Decor":"events-decor",
 "Professional Services":"local-services",
 "Events & Entertainment":"events-decor",
 "Other":"other"
});
const idFor=value=>{
 const v=String(value||"");
 const entry=categories.find(c=>c.id===v||c.label===v);
 return entry?.id||legacy[v]||"";
};
window.StoreNestCategories=categories;
window.StoreNestCategoryId=idFor;
window.StoreNestCategoryLabel=value=>{
 const id=idFor(value);
 return categories.find(c=>c.id===id)?.label||String(value||"");
};
})();