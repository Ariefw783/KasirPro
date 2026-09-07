/* KasirPro AT-08 — guided invoice import: choose file -> auto preview -> save draft */
let busy=false;

function input(){return document.getElementById('invoice-import-file');}
function box(){return document.getElementById('kp-final-preview-box');}
function summary(){return document.getElementById('invoice-import-summary');}
function saveButton(){return document.getElementById('kp-final-save-draft');}

function installStyle(){
  if(document.getElementById('kp-invoice-auto-flow-style'))return;
  const s=document.createElement('style');s.id='kp-invoice-auto-flow-style';s.textContent=`
  #kp-final-preview{display:none!important}
  .kp-flow-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px 18px 0}
  .kp-flow-step{display:flex;align-items:center;gap:9px;padding:10px 11px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#64748b}
  .kp-flow-step b{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#e2e8f0;color:#475569;font-size:11px;flex:0 0 auto}
  .kp-flow-step strong{display:block;font-size:11px;color:inherit}.kp-flow-step span{display:block;font-size:10px;margin-top:2px;color:#94a3b8}
  .kp-flow-step.active{border-color:#99f6e4;background:#f0fdfa;color:#0f766e}.kp-flow-step.active b,.kp-flow-step.done b{background:#0f766e;color:#fff}
  .kp-flow-step.done{color:#166534;background:#f0fdf4;border-color:#bbf7d0}.kp-flow-step.error{color:#b91c1c;background:#fef2f2;border-color:#fecaca}.kp-flow-step.error b{background:#dc2626;color:#fff}
  .kp-flow-status{margin:0 18px 14px;padding:10px 12px;border-radius:9px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;color:#475569}
  .kp-flow-status.reading{color:#0f766e;background:#f0fdfa;border-color:#ccfbf1}.kp-flow-status.error{color:#b91c1c;background:#fef2f2;border-color:#fecaca}.kp-flow-status.ready{color:#166534;background:#f0fdf4;border-color:#bbf7d0}
  .kp-final-preview-footer{gap:8px;align-items:center}.kp-flow-change{margin-right:auto}
  @media(max-width:640px){.kp-flow-steps{grid-template-columns:1fr;padding-left:14px;padding-right:14px}}
  `;document.head.appendChild(s);
}

function ensureSteps(){
  const root=document.getElementById('kp-invoice-final');if(!root)return;
  const card=root.querySelector('.kp-final-card');if(!card)return;
  if(!document.getElementById('kp-flow-steps')){
    const steps=document.createElement('div');steps.id='kp-flow-steps';steps.className='kp-flow-steps';steps.innerHTML=`
      <div class="kp-flow-step active" data-flow-step="1"><b>1</b><div><strong>Pilih File</strong><span>File Excel faktur</span></div></div>
      <div class="kp-flow-step" data-flow-step="2"><b>2</b><div><strong>Periksa Data</strong><span>Preview & validasi otomatis</span></div></div>
      <div class="kp-flow-step" data-flow-step="3"><b>3</b><div><strong>Simpan Draft</strong><span>Stok belum berubah</span></div></div>`;
    const imp=card.querySelector('.kp-final-import');card.insertBefore(steps,imp);
  }
  if(!document.getElementById('kp-flow-status')){
    const st=document.createElement('div');st.id='kp-flow-status';st.className='kp-flow-status';st.textContent='Pilih file Excel. Aplikasi akan membaca dan menampilkan preview secara otomatis.';
    const preview=box();card.insertBefore(st,preview||null);
  }
  const p=document.getElementById('kp-final-preview');if(p)p.hidden=true;
  const save=saveButton();if(save){save.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Simpan sebagai Draft';}
  ensureChangeButton();
}

function setStep(n,state){document.querySelectorAll('[data-flow-step]').forEach(el=>{el.classList.remove('active','done','error');const k=Number(el.dataset.flowStep);if(k<n)el.classList.add('done');else if(k===n)el.classList.add(state||'active');});}
function setStatus(message,state=''){const st=document.getElementById('kp-flow-status');if(!st)return;st.className='kp-flow-status'+(state?' '+state:'');st.innerHTML=message;}

function ensureChangeButton(){
  const footer=document.getElementById('kp-final-preview-footer');if(!footer||footer.querySelector('.kp-flow-change'))return;
  const label=document.createElement('label');label.className='kp-final-btn kp-flow-change';label.htmlFor='invoice-import-file';label.innerHTML='<i class="fa-solid fa-rotate"></i> Ganti File';footer.prepend(label);
}

function hasValidationProblems(){const t=(summary()?.textContent||'').toLowerCase();return /masalah validasi|perlu diperbaiki/.test(t);}

async function autoPreview(){
  const file=input()?.files?.[0];if(!file||busy)return;
  busy=true;ensureSteps();setStep(2,'active');setStatus('<i class="fa-solid fa-spinner fa-spin"></i> Membaca file dan memeriksa data faktur…','reading');
  const trigger=document.querySelector('.kp-file-trigger');if(trigger){trigger.style.pointerEvents='none';trigger.style.opacity='.65';}
  try{
    const api=window.KasirProInvoiceAT08;if(!api?.preview)throw new Error('Modul preview Faktur belum siap. Muat ulang aplikasi.');
    await api.preview();
    const previewBox=box();if(previewBox)previewBox.hidden=false;
    ensureChangeButton();
    const invalid=hasValidationProblems();
    const save=saveButton();if(save){save.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Simpan sebagai Draft';save.disabled=invalid;}
    if(invalid){setStep(2,'error');setStatus('Data sudah dibaca, tetapi masih ada masalah. Perbaiki file Excel lalu pilih ulang file.','error');}
    else{setStep(3,'active');setStatus('File berhasil dibaca. Periksa preview di bawah, lalu pilih <strong>Simpan sebagai Draft</strong>.','ready');}
    previewBox?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }catch(err){console.error('AT-08 Auto Preview:',err);setStep(2,'error');setStatus(err?.message||String(err),'error');await window.KasirProDialog?.error?.('File Faktur Tidak Dapat Dibaca',err?.message||String(err));}
  finally{busy=false;if(trigger){trigger.style.pointerEvents='';trigger.style.opacity='';}}
}

function resetFlow(){
  const file=input()?.files?.[0];ensureSteps();
  if(!file){setStep(1,'active');setStatus('Pilih file Excel. Aplikasi akan membaca dan menampilkan preview secara otomatis.');const b=box();if(b)b.hidden=true;}
}

function bind(){
  const el=input();if(el&&!el.dataset.kpAutoFlowBound){el.dataset.kpAutoFlowBound='1';el.addEventListener('change',()=>{if(el.files?.[0])queueMicrotask(autoPreview);else resetFlow();});}
  document.addEventListener('click',e=>{const save=e.target.closest('#kp-final-save-draft');if(save&&!save.disabled){setStep(3,'active');setStatus('<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan faktur sebagai Draft…','reading');}},true);
}

function install(){installStyle();ensureSteps();bind();resetFlow();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.addEventListener('kasirpro:operational-ready',install);
window.KasirProInvoiceAutoFlowAT08=Object.freeze({install,autoPreview,reset:resetFlow});
