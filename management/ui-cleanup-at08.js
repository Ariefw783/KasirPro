/* KasirPro AT-08 — remove PDF export/print actions from Inventory & Sales */
const TARGET_VIEWS = ['stock','goods-in','stock-opname','purchase-invoices','sales','reports'];
const PDF_PATTERN = /(?:export\s*pdf|cetak\s*pdf|simpan\s*(?:sebagai\s*)?pdf|\bpdf\b)/i;

function actionText(el){
  return [el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
    .filter(Boolean).join(' ').trim();
}

function removePdfActions(root){
  if(!root) return;
  root.querySelectorAll('button,a,[role="button"]').forEach(el=>{
    if(PDF_PATTERN.test(actionText(el))) el.remove();
  });
}

function cleanTargetViews(){
  for(const view of TARGET_VIEWS){
    const section = document.querySelector(`[data-view-section="${view}"]`);
    if(section) removePdfActions(section);
  }
}

function observeTargetViews(){
  for(const view of TARGET_VIEWS){
    const section = document.querySelector(`[data-view-section="${view}"]`);
    if(!section || section.dataset.kpPdfCleanupObserved === '1') continue;
    section.dataset.kpPdfCleanupObserved = '1';
    const observer = new MutationObserver(()=>removePdfActions(section));
    observer.observe(section,{childList:true,subtree:true});
  }
}

function install(){
  cleanTargetViews();
  observeTargetViews();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
window.addEventListener('kasirpro:operational-ready',install);
document.addEventListener('click',()=>queueMicrotask(cleanTargetViews),true);

window.KasirProUICleanupAT08 = Object.freeze({install, cleanTargetViews});
