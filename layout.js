// Keep scrollable content from being lost under the header. Measures pixel height of #stick-top and writes that to --sticky-offset in the CSS.
function updateStickyOffset(){
  const el=document.getElementById('sticky-top');
  if(el) document.documentElement.style.setProperty('--sticky-offset', el.offsetHeight+'px');
}

// Moves the sidebar element in and out of the topbar. This preserves the sidebar's scroll position and state (e.g. open filters) 
// when switching between layouts.
function moveSidebar(toTopbar){
  const sidebar=document.getElementById('sidebar');
  if(!sidebar) return;
  if(toTopbar){
    const ctrl=document.getElementById('ctrl');
    if(ctrl && sidebar.parentNode!==ctrl.parentNode) ctrl.parentNode.insertBefore(sidebar,ctrl);
  } else {
    const appBody=document.getElementById('app-body');
    if(appBody && sidebar.parentNode!==appBody) appBody.insertBefore(sidebar,appBody.firstChild);
  }
}
(function(){                                            //helper function to apply layout
  function applyLayout(){
    const mobile=window.innerWidth<=700;                //called mobile but really just "small screen" since it also applies to narrow desktop windows
    const btn=document.getElementById('btn-layout');
    if(mobile){                                         //force topbar mode on mobile
      document.body.classList.add('topbar-mode');
      moveSidebar(true);
    } else {
      const pref=localStorage.getItem('navLayout');
      const topbar=pref==='topbar';
      document.body.classList.toggle('topbar-mode', topbar);
      if(btn) btn.textContent=topbar?'Side Nav':'Top Nav';
      moveSidebar(topbar);
    }
    updateStickyOffset();
  }
  applyLayout();
  window.addEventListener('resize', applyLayout);
  if('ResizeObserver' in window){                      // watch for changes and update the height of the sticky header (e.g. filters row expanding/collapsing) and update offset accordingly
    new ResizeObserver(updateStickyOffset).observe(document.getElementById('sticky-top'));
  }
})();
//Logic to toggle between topbar and sidebar nav layouts.
function toggleLayout(){
  const topbar=document.body.classList.toggle('topbar-mode');
  document.getElementById('btn-layout').textContent=topbar?'Side Nav':'Top Nav';
  localStorage.setItem('navLayout',topbar?'topbar':'sidebar');
  moveSidebar(topbar);
  updateStickyOffset();
}
//Hamburger menu toggle.
function toggleMenu(e){
  e.stopPropagation();
  document.getElementById('hdr-menu').classList.toggle('open');
}
//Listens for clicks outside of the menu to close it when open. Does not close if the click is on the menu button itself.
document.addEventListener('click', function(e){
  const menu = document.getElementById('hdr-menu');
  if(!menu || !menu.classList.contains('open')) return;
  if(e.target.closest('#btn-menu')) return;
  menu.classList.remove('open');
});
//Show filter options.
function toggleFilterRow(){
  const open=document.getElementById('ctrl-filters').classList.toggle('open');
  document.getElementById('btn-filters').textContent=open?'Filters ▴':'Filters ▾';
  const tab=typeof activeTab!=='undefined'?activeTab:'default';
  localStorage.setItem('filtersOpen-'+tab,open?'1':'0');
  updateStickyOffset();
}
// Block slider track-taps on touch devices; allow thumb drags
(function(){
  if(!('ontouchstart' in window)) return;
  let blocked=false, savedVal=null;
  document.addEventListener('touchstart', function(e){
    blocked=false;
    const s=e.target.closest('.rank-slider');
    if(!s) return;
    const rect=s.getBoundingClientRect();
    const tx=e.touches[0].clientX - rect.left;
    const pct=(parseFloat(s.value)-parseFloat(s.min))/(parseFloat(s.max)-parseFloat(s.min));
    if(Math.abs(tx - pct*rect.width) > 24){ blocked=true; savedVal=s.value; } // adds a 24px "thumb zone" on either side of the slider value, change this if the tolerance is wrong.
  },{passive:true});
  document.addEventListener('input', function(e){
    const s=e.target.closest('.rank-slider');
    if(!s||!blocked) return;
    s.value=savedVal;
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('touchend', function(){ blocked=false; },{passive:true});
})();

// Event handler wiring — all inline onclick/oninput/onchange attributes replaced here
(function(){
  function on(id, evt, fn){ const el=document.getElementById(id); if(el) el.addEventListener(evt, fn); }

  on('btn-menu',         'click',  function(e){ toggleMenu(e); });
  on('btn-layout',       'click',  function(){ toggleLayout(); });
  on('btn-backup',       'click',  function(){ setBackupFile(); });
  on('btn-import',       'click',  function(){ openImport(); });
  on('btn-export',       'click',  function(){ openExport(); });
  on('btn-add-item',     'click',  function(){ openAddModal(); });
  on('btn-reset',        'click',  function(){ askReset(); });
  on('btn-auth',         'click',  function(){ currentUser ? logout() : login(); });

  on('search',           'input',  function(){ render(); });
  on('btn-filters',      'click',  function(){ toggleFilterRow(); });

  on('fb-incarnon',      'click',  function(){ toggleFilt('incarnon', this); });
  on('fb-hasparts',      'click',  function(){ toggleFilt('hasParts', this); });
  on('fb-tile',          'click',  function(){ setListView(false); });
  on('fb-list',          'click',  function(){ setListView(true); });
  on('fb-grp',           'click',  function(){ toggleGroupView(); });
  on('fb-wftile',        'click',  function(){ toggleWfTileImages(this); });
  on('fb-wfbg',          'click',  function(){ toggleWfBgImages(this); });

  on('btn-maxall',       'click',  function(){ maxAllVisible(); });
  on('btn-zeroall',      'click',  function(){ zeroAllVisible(); });

  on('blp-search',       'input',  function(){ blpFilterItems(); });

  on('overlay',          'click',  function(e){ overlayClick(e); });
  on('modal-file-input', 'change', function(e){ handleFileSelect(e); });
  on('btn-import-file',  'click',  function(){ openImportFile(); });
  on('btn-fetch-sheets', 'click',  function(){ fetchFromSheets(); });
  on('btn-test-sheets',  'click',  function(){ testSheetsUrl(); });
  on('sheets-help-link', 'click',  function(e){ toggleSheetsHelp(e); });
  on('btn-close-modal',  'click',  function(){ closeModal(); });
  on('modal-save-file',  'click',  function(){ saveProgressToFile(); });

  on('confirm-overlay',  'click',  function(e){ confirmOverlayClick(e); });
  on('btn-close-confirm','click',  function(){ closeConfirm(); });
  on('btn-do-reset',     'click',  function(){ doReset(); });

  on('add-overlay',      'click',  function(e){ addOverlayClick(e); });
  on('add-tab',          'change', function(){ updateAddTabDefaults(); });
  on('btn-close-add',    'click',  function(){ closeAddModal(); });
  on('btn-submit-add',   'click',  function(){ submitAddItem(); });

})();
