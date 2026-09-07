/* KasirPro AT-08 UI Correction — Professional single-door Faktur Pembelian */
import { STORE_KEYS, readStore } from '../modules/database/database-store.js';

const text=v=>String(v??'').trim();
const norm=v=>text(v).toLowerCase();
const num=v=>Number(String(v??0).replace(/[^0-9.-]/g,''))||0;
const rupiah=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(num(v));
const dateOnly=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?text(v):d.toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric'});};
const invoices=()=>readStore(STORE_KEYS.invoices,[])||[];

function section(){return document.querySelector('[data-view-section="purchase-invoices"]');}
function legacyImport(){return document.getElementById('kp-invoice-excel-workflow')||document.querySelector('[data-view-section="import-faktur"]');}

function ensureStyle(){
  if(document.getElementById('kp-invoice-pro-style'))return;
  const style=document.createElement('style');
  style.id='kp-invoice-pro-style';
  style.textContent=`
  .kp-invoice-pro{display:grid;gap:18px;max-width:1440px;margin:0 auto;padding-bottom:28px}
  .kp-invoice-pro *{box-sizing:border-box}
  .kp-invoice-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:22px 24px;border:1px solid #dbe4e8;border-radius:18px;background:linear-gradient(135deg,#ffffff 0%,#f8fbfb 70%,#f1f8f6 100%);box-shadow:0 8px 24px rgba(15,23,42,.05)}
  .kp-invoice-hero h2{margin:0 0 6px;font-size:22px;color:#0f172a}.kp-invoice-hero p{margin:0;color:#64748b;max-width:720px;line-height:1.55}
  .kp-invoice-source-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;background:#ecfdf5;color:#166534;border:1px solid #bbf7d0;font-size:12px;font-weight:800;white-space:nowrap}
  .kp-invoice-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 8px 24px rgba(15,23,42,.045);overflow:hidden}
  .kp-invoice-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 20px;border-bottom:1px solid #eef2f7}
  .kp-invoice-card-head h3{margin:0 0 4px;font-size:16px;color:#0f172a}.kp-invoice-card-head p{margin:0;color:#64748b;font-size:13px}
  .kp-import-body{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:end;padding:18px 20px}
  .kp-file-zone{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 12px;border:1px dashed #cbd5e1;border-radius:13px;background:#f8fafc}
  .kp-file-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#e8f5f2;color:#0f766e;font-size:18px;flex:0 0 auto}
  .kp-file-meta{min-width:0;flex:1}.kp-file-meta strong{display:block;color:#0f172a;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kp-file-meta span{display:block;color:#64748b;font-size:12px;margin-top:2px}
  .kp-import-actions{display:flex;flex-wrap:wrap;gap:9px;justify-content:flex-end}.kp-invoice-pro .btn{min-height:40px;border-radius:10px;font-weight:700}
  .kp-btn-primary{background:#0f766e!important;color:#fff!important;border-color:#0f766e!important}.kp-btn-primary:hover{background:#115e59!important}
  .kp-btn-soft{background:#f8fafc!important;color:#334155!important;border:1px solid #cbd5e1!important}
  .kp-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .kp-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:15px;padding:16px 17px;box-shadow:0 5px 16px rgba(15,23,42,.035)}
  .kp-kpi-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.kp-kpi-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#f1f5f9;color:#475569}.kp-kpi span{font-size:12px;color:#64748b;font-weight:700}.kp-kpi strong{display:block;margin-top:8px;font-size:23px;color:#0f172a;letter-spacing:-.02em}.kp-kpi small{display:block;margin-top:3px;color:#94a3b8;font-size:11px}
  .kp-invoice-toolbar{display:flex;gap:10px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid #eef2f7;background:#fbfcfd}
  .kp-invoice-toolbar input,.kp-invoice-toolbar select{height:40px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:0 11px;color:#334155}.kp-invoice-toolbar input{flex:1;min-width:220px}.kp-invoice-toolbar select{min-width:160px}
  .kp-table-wrap{overflow:auto}.kp-pro-table{width:100%;border-collapse:separate;border-spacing:0}.kp-pro-table th{position:sticky;top:0;background:#f8fafc;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.035em;text-align:left;padding:11px 14px;border-bottom:1px solid #e2e8f0;white-space:nowrap}.kp-pro-table td{padding:13px 14px;border-bottom:1px solid #eef2f7;color:#334155;font-size:13px;vertical-align:middle}.kp-pro-table tr:last-child td{border-bottom:0}.kp-pro-table tbody tr:hover{background:#fbfdfd}
  .kp-inv-number{font-weight:800;color:#0f172a}.kp-inv-supplier{font-weight:650;color:#334155}.kp-money{font-variant-numeric:tabular-nums;font-weight:750;color:#0f172a}
  .kp-status{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800}.kp-status.draft{background:#fff7ed;color:#c2410c}.kp-status.done{background:#ecfdf5;color:#15803d}
  .kp-row-actions{display:flex;gap:7px;justify-content:flex-end}.kp-row-actions button{height:34px;padding:0 10px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:12px;font-weight:750;cursor:pointer}.kp-row-actions .confirm{border-color:#99f6e4;background:#f0fdfa;color:#0f766e}
  .kp-empty{padding:36px 18px!important;text-align:center;color:#94a3b8!important}
  .kp-preview-shell{margin:0 20px 18px;border:1px solid #dbe4e8;border-radius:14px;background:#fbfdfd;overflow:hidden}.kp-preview-shell[hidden]{display:none!important}.kp-preview-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:13px 15px;border-bottom:1px solid #e2e8f0;background:#f8fbfb}.kp-preview-head strong{color:#0f172a}.kp-preview-content{padding:14px}.kp-preview-content #invoice-import-summary{margin:0 0 12px;color:#475569;line-height:1.5}.kp-preview-content #invoice-import-preview{margin:0!important}.kp-preview-content #invoice-import-actions{display:flex!important;justify-content:flex-end;margin-top:12px!important}.kp-preview-content #apply-invoice-import{min-height:40px;border-radius:10px;background:#0f766e;color:#fff;border:0;padding:0 15px;font-weight:800}
  .kp-legacy-invoice-hidden{display:none!important}
  @media(max-width:980px){.kp-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kp-import-body{grid-template-columns:1fr}.kp-import-actions{justify-content:flex-start}.kp-invoice-hero{flex-direction:column}}
  @media(max-width:620px){.kp-kpi-grid{grid-template-columns:1fr 1fr}.kp-invoice-hero{padding:17px}.kp-invoice-card-head,.kp-import-body,.kp-invoice-toolbar{padding-left:14px;padding-right:14px}.kp-invoice-toolbar input,.kp-invoice-toolbar select{width:100%;min-width:0}.kp-row-actions{min-width:180px}.kp-invoice-source-badge{white-space:normal}}
  `;
  document.head.appendChild(style);
}

function buildShell(){
  const target=section();if(!target)return null;
  let shell=document.getElementById('kp-invoice-pro');
  if(shell)return shell;
  ensureStyle();
  shell=document.createElement('div');shell.id='kp-invoice-pro';shell.className='kp-invoice-pro';
  shell.innerHTML=`
    <div class="kp-invoice-hero">
      <div><h2>Faktur Pembelian</h2><p>Kelola seluruh faktur supplier melalui satu alur Excel. Draft hanya ditinjau di aplikasi dan stok berubah setelah Barang Masuk dikonfirmasi.</p></div>
      <div class="kp-invoice-source-badge"><i class="fa-solid fa-file-excel"></i> Excel sebagai sumber data</div>
    </div>
    <section class="kp-invoice-card" id="kp-pro-import-card">
      <div class="kp-invoice-card-head"><div><h3>Import Faktur Excel</h3><p>Unduh template, isi di PC/laptop, kemudian baca dan preview sebelum disimpan sebagai Draft.</p></div></div>
      <div class="kp-import-body">
        <div class="kp-file-zone"><div class="kp-file-icon"><i class="fa-solid fa-file-excel"></i></div><div class="kp-file-meta"><strong id="kp-invoice-file-name">Belum ada file dipilih</strong><span>XLSX / XLS • Template Faktur V2 satu sheet</span></div><button type="button" class="btn kp-btn-soft" id="kp-pro-pick-file">Pilih File</button></div>
        <div class="kp-import-actions"><button type="button" class="btn kp-btn-soft" id="kp-pro-download"><i class="fa-solid fa-download"></i> Download Template</button><button type="button" class="btn kp-btn-primary" id="kp-pro-preview"><i class="fa-solid fa-magnifying-glass"></i> Baca & Preview</button></div>
      </div>
      <div class="kp-preview-shell" id="kp-pro-preview-shell" hidden><div class="kp-preview-head"><strong>Preview Import Faktur</strong><span>Periksa sebelum disimpan</span></div><div class="kp-preview-content" id="kp-pro-preview-content"></div></div>
    </section>
    <div class="kp-kpi-grid">
      <div class="kp-kpi"><div class="kp-kpi-top"><span>Total Faktur</span><div class="kp-kpi-icon"><i class="fa-solid fa-file-invoice"></i></div></div><strong id="kp-kpi-total">0</strong><small>Seluruh faktur tercatat</small></div>
      <div class="kp-kpi"><div class="kp-kpi-top"><span>Draft</span><div class="kp-kpi-icon"><i class="fa-solid fa-clock"></i></div></div><strong id="kp-kpi-draft">0</strong><small>Menunggu Barang Masuk</small></div>
      <div class="kp-kpi"><div class="kp-kpi-top"><span>Barang Masuk</span><div class="kp-kpi-icon"><i class="fa-solid fa-box-open"></i></div></div><strong id="kp-kpi-done">0</strong><small>Sudah menambah stok</small></div>
      <div class="kp-kpi"><div class="kp-kpi-top"><span>Nilai Faktur</span><div class="kp-kpi-icon"><i class="fa-solid fa-money-bill-wave"></i></div></div><strong id="kp-kpi-value">Rp0</strong><small>Total nilai pembelian</small></div>
    </div>
    <section class="kp-invoice-card">
      <div class="kp-invoice-card-head"><div><h3>Daftar Faktur Pembelian</h3><p>Data faktur bersifat read-only. Perbaikan Draft dilakukan dari file Excel lalu import ulang.</p></div></div>
      <div class="kp-invoice-toolbar"><input id="kp-invoice-search" type="search" placeholder="Cari nomor faktur atau supplier..."><select id="kp-invoice-status"><option value="all">Semua Status</option><option value="draft">Draft</option><option value="done">Barang Masuk</option></select><select id="kp-invoice-supplier"><option value="all">Semua Supplier</option></select></div>
      <div class="kp-table-wrap"><table class="kp-pro-table"><thead><tr><th>Nomor Faktur</th><th>Tanggal</th><th>Supplier</th><th>Item</th><th>Total</th><th>Pembayaran</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="kp-pro-invoice-body"></tbody></table></div>
    </section>`;
  Array.from(target.children).forEach(ch=>{if(ch!==shell)ch.classList.add('kp-legacy-invoice-hidden');});
  target.prepend(shell);
  return shell;
}

function attachImportCompatibility(){
  const shell=buildShell();if(!shell)return;
  const file=document.getElementById('invoice-import-file');if(file){file.style.display='none';shell.appendChild(file);file.addEventListener('change',()=>{document.getElementById('kp-invoice-file-name').textContent=file.files?.[0]?.name||'Belum ada file dipilih';});}
  const content=document.getElementById('kp-pro-preview-content');
  for(const id of ['invoice-import-summary','invoice-import-preview','invoice-import-actions']){const node=document.getElementById(id);if(node&&content&&!content.contains(node))content.appendChild(node);}
  const old=legacyImport();if(old&&old!==shell)old.classList.add('kp-legacy-invoice-hidden');
}

function itemSubtotal(i){return Math.max(0,num(i.qty)*num(i.buyPrice)-num(i.discount));}
function invoiceTotal(inv){const items=(inv.items||[]).reduce((s,i)=>s+itemSubtotal(i),0);const base=Math.max(0,items-num(inv.discount));return base+base*num(inv.taxPercent)/100+num(inv.otherCost);}
function isDone(inv){return !!inv.stockApplied||norm(inv.status)==='confirmed';}

function suppliersForFilter(list){const select=document.getElementById('kp-invoice-supplier');if(!select)return;const current=select.value;const values=[...new Set(list.map(x=>text(x.supplierName||x.supplierCode)).filter(Boolean))].sort();select.innerHTML='<option value="all">Semua Supplier</option>'+values.map(v=>`<option value="${v.replace(/"/g,'&quot;')}">${v}</option>`).join('');if([...select.options].some(o=>o.value===current))select.value=current;}

function render(){
  if(!buildShell())return;
  const list=[...invoices()];
  suppliersForFilter(list);
  const draft=list.filter(x=>!isDone(x));const done=list.filter(isDone);const totalValue=list.reduce((s,x)=>s+invoiceTotal(x),0);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};set('kp-kpi-total',list.length);set('kp-kpi-draft',draft.length);set('kp-kpi-done',done.length);set('kp-kpi-value',rupiah(totalValue));
  const q=norm(document.getElementById('kp-invoice-search')?.value);const st=document.getElementById('kp-invoice-status')?.value||'all';const sp=document.getElementById('kp-invoice-supplier')?.value||'all';
  const filtered=list.filter(inv=>{const doneState=isDone(inv);if(st==='draft'&&doneState)return false;if(st==='done'&&!doneState)return false;if(sp!=='all'&&text(inv.supplierName||inv.supplierCode)!==sp)return false;if(q&&!norm(`${inv.number} ${inv.supplierName} ${inv.supplierCode}`).includes(q))return false;return true;});
  const body=document.getElementById('kp-pro-invoice-body');if(!body)return;
  body.innerHTML=filtered.length?filtered.map(inv=>{const doneState=isDone(inv);return `<tr><td><span class="kp-inv-number">${text(inv.number)||'—'}</span></td><td>${dateOnly(inv.date)}</td><td><span class="kp-inv-supplier">${text(inv.supplierName||inv.supplierCode)||'—'}</span></td><td>${(inv.items||[]).length}</td><td><span class="kp-money">${rupiah(invoiceTotal(inv))}</span></td><td>${text(inv.paymentType)||'—'}</td><td><span class="kp-status ${doneState?'done':'draft'}"><i class="fa-solid ${doneState?'fa-circle-check':'fa-clock'}"></i>${doneState?'Barang Masuk':'Draft'}</span></td><td><div class="kp-row-actions"><button type="button" data-invoice-edit="${inv.id}"><i class="fa-solid fa-eye"></i> Lihat</button>${doneState?'':`<button type="button" class="confirm" data-invoice-confirm="${inv.id}"><i class="fa-solid fa-box-open"></i> Barang Masuk</button>`}</div></td></tr>`;}).join(''):'<tr><td colspan="8" class="kp-empty">Belum ada faktur yang sesuai filter.</td></tr>';
}

async function onPreview(){
  const api=window.KasirProInvoiceAT08;if(!api?.preview)return window.KasirProDialog?.error?.('Fitur Belum Siap','Modul Import Faktur belum tersedia.');
  await api.preview();const p=document.getElementById('kp-pro-preview-shell');if(p)p.hidden=false;
}
function bind(){
  document.getElementById('kp-pro-pick-file')?.addEventListener('click',()=>document.getElementById('invoice-import-file')?.click());
  document.getElementById('kp-pro-download')?.addEventListener('click',()=>window.KasirProInvoiceAT08?.downloadTemplate?.());
  document.getElementById('kp-pro-preview')?.addEventListener('click',()=>onPreview().catch(err=>window.KasirProDialog?.error?.('Faktur Tidak Dapat Diproses',err?.message||String(err))));
  ['kp-invoice-search','kp-invoice-status','kp-invoice-supplier'].forEach(id=>document.getElementById(id)?.addEventListener(id==='kp-invoice-search'?'input':'change',render));
}
function install(){
  const shell=buildShell();if(!shell)return;attachImportCompatibility();bind();render();
  const legacyBody=document.getElementById('invoice-table-body');if(legacyBody&&!legacyBody.dataset.kpProWatch){legacyBody.dataset.kpProWatch='1';new MutationObserver(render).observe(legacyBody,{childList:true,subtree:true});}
  const apply=document.getElementById('apply-invoice-import');if(apply&&!apply.dataset.kpProHook){apply.dataset.kpProHook='1';apply.addEventListener('click',()=>setTimeout(()=>{render();const p=document.getElementById('kp-pro-preview-shell');if(p)p.hidden=true;},250));}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.addEventListener('kasirpro:operational-ready',()=>{install();render();});
document.addEventListener('click',e=>{if(e.target.closest('[data-view="purchase-invoices"]'))setTimeout(()=>{install();render();},0);},true);
window.KasirProInvoiceProUI=Object.freeze({install,render});
