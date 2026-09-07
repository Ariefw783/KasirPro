/* KasirPro AT-08 Fix — Faktur button interaction recovery */
function dialog(){ return window.KasirProDialog; }

function installPickFileFix(){
  const oldButton=document.getElementById('kp-pro-pick-file');
  const input=document.getElementById('invoice-import-file');
  if(!oldButton || !input) return;

  input.style.position='fixed';
  input.style.left='-10000px';
  input.style.top='0';
  input.style.width='1px';
  input.style.height='1px';
  input.style.opacity='0';
  input.style.pointerEvents='none';
  input.style.overflow='hidden';

  if(oldButton.tagName.toLowerCase()==='label') return;

  const label=document.createElement('label');
  label.id='kp-pro-pick-file';
  label.className=oldButton.className;
  label.htmlFor='invoice-import-file';
  label.setAttribute('role','button');
  label.setAttribute('tabindex','0');
  label.textContent='Pilih File';
  label.addEventListener('keydown',event=>{
    if(event.key==='Enter' || event.key===' '){
      event.preventDefault();
      input.click();
    }
  });
  oldButton.replaceWith(label);
}

function installPreviewFix(){
  const oldButton=document.getElementById('kp-pro-preview');
  if(!oldButton || oldButton.dataset.kpPreviewFixed==='1') return;

  const button=oldButton.cloneNode(true);
  button.dataset.kpPreviewFixed='1';
  /* Zero-width break keeps the visual wording but avoids legacy text-based capture matcher. */
  button.innerHTML='<i class="fa-solid fa-magnifying-glass"></i> Baca & Pre\u200bview';

  button.addEventListener('click',async event=>{
    event.preventDefault();
    event.stopPropagation();
    try{
      const api=window.KasirProInvoiceAT08;
      if(!api?.preview) throw new Error('Modul Import Faktur belum siap. Muat ulang aplikasi lalu coba kembali.');
      await api.preview();
      const shell=document.getElementById('kp-pro-preview-shell');
      if(shell) shell.hidden=false;
    }catch(err){
      console.error('AT-08 preview button:',err);
      await dialog()?.error?.('Faktur Tidak Dapat Diproses',err?.message||String(err),{confirmText:'Tutup'});
    }
  });

  oldButton.replaceWith(button);
}

function install(){
  installPickFileFix();
  installPreviewFix();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
window.addEventListener('kasirpro:operational-ready',install);

window.KasirProInvoiceButtonFixAT08=Object.freeze({install});
