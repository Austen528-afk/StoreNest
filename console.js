(()=>{
 const sidebar=document.getElementById('sidebar'), backdrop=document.getElementById('navBackdrop'), menu=document.getElementById('menuButton'), content=document.getElementById('content'), title=document.getElementById('topTitle');
 const titles={overview:'Overview',businesses:'Businesses','publisher-recruits':'Publisher Recruits',transactions:'Transactions',subscriptions:'Subscriptions',analytics:'Analytics',settings:'Platform Settings',today:"Today's Workspace",orders:'Orders',bookings:'Bookings',inventory:'Inventory',activity:'Activity'};
 const today=document.getElementById('localDate');
 if(today)today.textContent=new Intl.DateTimeFormat('en-ZA',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date());
 function closeMenu(){sidebar.classList.remove('open');backdrop.classList.remove('visible');menu.setAttribute('aria-expanded','false')}
 function navigate(next){
  if(!document.querySelector('[data-view="'+next+'"]'))return;
  document.querySelectorAll('[data-view]').forEach(el=>el.hidden=el.dataset.view!==next);
  document.querySelectorAll('[data-page]').forEach(el=>{const active=el.dataset.page===next;el.classList.toggle('active',active);el.setAttribute('aria-current',active?'page':'false')});
  title.textContent=titles[next]||'Overview';content.scrollTop=0;closeMenu();
  if(history.replaceState)history.replaceState(null,'','#'+next);
 }
 document.addEventListener('click',event=>{const el=event.target.closest('[data-page]');if(el){event.preventDefault();navigate(el.dataset.page)}});
 menu.addEventListener('click',()=>{const open=!sidebar.classList.contains('open');sidebar.classList.toggle('open',open);backdrop.classList.toggle('visible',open);menu.setAttribute('aria-expanded',String(open))});
 backdrop.addEventListener('click',closeMenu);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
 const start=location.hash.slice(1);
 navigate(document.querySelector('[data-view="'+start+'"]')?start:document.body.dataset.defaultPage||'overview');
 window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(document.querySelector('[data-view="'+page+'"]'))navigate(page)});
})();