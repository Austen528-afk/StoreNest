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
 Object.freeze({id:"beauty",label:"Personal Care Services and Products",emoji:"💈"}),
 Object.freeze({id:"home-living",label:"Home & Living",emoji:"🏠"}),
 Object.freeze({id:"groceries",label:"Groceries & Essentials",emoji:"🛒"}),
 Object.freeze({id:"local-services",label:"Local Services",emoji:"🛠️"}),
 Object.freeze({id:"gifts-occasions",label:"Gifts & Occasions",emoji:"🎁"}),
 Object.freeze({id:"other",label:"Other Businesses",emoji:"🏪"})
]);
const legacy=Object.freeze({
 "Food & Drink":"food-drink",
 "Retail":"other",
 "Beauty & Wellness":"beauty",
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
