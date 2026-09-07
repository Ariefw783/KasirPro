/* KasirPro AT-08 — Single-door invoice workflow inspired by V1, Excel-only input */
import { STORE_KEYS, readStore, writeStore } from '../modules/database/database-store.js';

const text=v=>String(v??'').trim();
const norm=v=>text(v).toLowerCase();
const num=v=>Number(String(v??0).replace(/[^0-9.-]/g,''))||0;
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const nowIso=()=>new Date().toISOString();
const rupiah=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(num(v));
const allowedSuppliers=new Set(['supplier 1','supplier 2','supplier 3','supplier 4','supplier 5','supplier 6']);

function dialog(){return window.KasirProDialog;}
function master(){return readStore(STORE_KEYS.master,{produk:[],supplier:[],kategori:[],pengaturan_toko:[]});}
function invoices(){return readStore(STORE_KEYS.invoices,[]);}
function products(m=master()){return Array.isArray(m.produk)?m.produk:[];}
function suppliers(m=master()){return Array.isArray(m.supplier)?m.supplier:[];}
function byCode(code,m=master()){const k=norm(code);return k?products(m).find(x=>norm(x?.['Kode Produk'])===k)||null:null;}
function canonicalSupplier(value,m=master()){
  const k=norm(value);
  if(allowedSuppliers.has(k)) return `Supplier ${Number(k.replace(/\D/g,''))}`;
  const row=suppliers(m).find(x=>norm(x?.['Nama Supplier'])===k||norm(x?.Supplier)===k);
  const label=text(row?.Supplier); return allowedSuppliers.has(norm(label))?label:'';
}
function supplierName(label,m=master()){const row=suppliers(m).find(x=>norm(x?.Supplier)===norm(label));return text(row?.['Nama Supplier'])||label;}
function dateOnly(value){if(!value)return'';if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);const d=new Date(value);return Number.isNaN(d.getTime())?text(value):d.toISOString().slice(0,10);}
function invoiceSubtotal(item){return Math.max(0,num(item.qty)*num(item.buyPrice)-num(item.discount));}
function invoiceTotal(inv){const item=(inv.items||[]).reduce((s,x)=>s+invoiceSubtotal(x),0);const base=Math.max(0,item-num(inv.discount));return base+base*num(inv.taxPercent)/100+num(inv.otherCost);}

function importSection(){return document.querySelector('[data-view-section="import-faktur"]');}
function invoiceSection(){return document.querySelector('[data-view-section="purchase-invoices"]');}
function fileInput(){return document.getElementById('invoice-import-file');}

function installReadOnlyModal(){
  if(document.getElementById('kp-invoice-readonly'))return;
  const wrap=document.createElement('div');
  wrap.id='kp-invoice-readonly';wrap.hidden=true;
  wrap.innerHTML=`<div class="kp-ro-backdrop"></div><div class="kp-ro-card" role="dialog" aria-modal="true"><div class="kp-ro-head"><div><span class="kp-ro-kicker">Faktur Pembelian</span><h2 data-ro-title>Detail Faktur</h2><p data-ro-subtitle></p></div><button type="button" class="icon-button" data-ro-close aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div><div class="kp-ro-meta" data-ro-meta></div><div class="kp-ro-table"><table><thead><tr><th>Kode</th><th>Produk</th><th>Qty</th><th>Harga Beli</th><th>Diskon</th><th>PPN</th><th>Total</th></tr></thead><tbody data-ro-items></tbody></table></div><div class="kp-ro-total" data-ro-total></div><div class="kp-ro-actions"><button type="button" class="btn btn-secondary" data-ro-close>Kembali</button></div></div>`;
  document.body.appendChild(wrap);
  const style=document.createElement('style');style.id='kp-invoice-workflow-style';style.textContent=`
  #kp-invoice-readonly{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px}#kp-invoice-readonly[hidden]{display:none!important}.kp-ro-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.56);backdrop-filter:blur(2px)}.kp-ro-card{position:relative;width:min(1100px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(15,23,42,.28);padding:22px}.kp-ro-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #e2e8f0;padding-bottom:14px}.kp-ro-head h2{margin:3px 0 4px}.kp-ro-head p{margin:0;color:#64748b}.kp-ro-kicker{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0f766e}.kp-ro-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}.kp-ro-meta div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px}.kp-ro-meta span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}.kp-ro-meta strong{color:#0f172a}.kp-ro-table{overflow:auto;border:1px solid #e2e8f0;border-radius:12px}.kp-ro-table table{width:100%;border-collapse:collapse}.kp-ro-table th,.kp-ro-table td{padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap}.kp-ro-table th{background:#f8fafc}.kp-ro-total{text-align:right;font-weight:800;font-size:18px;padding:16px 4px}.kp-ro-actions{display:flex;justify-content:flex-end}.kp-invoice-excel-panel{margin-bottom:18px;border:1px solid #cbd5e1;border-radius:16px;overflow:hidden}.kp-invoice-excel-intro{padding:14px 16px;background:linear-gradient(135deg,#f0fdfa,#f8fafc);border-bottom:1px solid #dbe5e7}.kp-invoice-excel-intro strong{display:block;color:#115e59;margin-bottom:4px}.kp-invoice-excel-intro span{color:#475569;font-size:13px}.kp-excel-only-note{margin:10px 0;padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:13px}.kp-hidden-at08{display:none!important}`;document.head.appendChild(style);
  wrap.querySelectorAll('[data-ro-close]').forEach(b=>b.addEventListener('click',()=>{wrap.hidden=true;}));
  wrap.querySelector('.kp-ro-backdrop').addEventListener('click',()=>{wrap.hidden=true;});
}

function openReadOnly(id){
  const inv=invoices().find(x=>String(x.id)===String(id));if(!inv)return dialog()?.error?.('Faktur Tidak Ditemukan','Data faktur tidak tersedia.');
  installReadOnlyModal();const wrap=document.getElementById('kp-invoice-readonly');
  wrap.querySelector('[data-ro-title]').textContent=`Faktur ${text(inv.number)||'—'}`;
  wrap.querySelector('[data-ro-subtitle]').textContent='Data berasal dari Excel dan bersifat read-only di aplikasi.';
  const status=inv.stockApplied||norm(inv.status)==='confirmed'?'Terkonfirmasi':'Draft';
  wrap.querySelector('[data-ro-meta]').innerHTML=`<div><span>Tanggal</span><strong>${dateOnly(inv.date)||'—'}</strong></div><div><span>Supplier</span><strong>${text(inv.supplierName||inv.supplierCode)||'—'}</strong></div><div><span>Pembayaran</span><strong>${text(inv.paymentType)||'—'}</strong></div><div><span>Jatuh Tempo</span><strong>${dateOnly(inv.dueDate)||'—'}</strong></div><div><span>Status</span><strong>${status}</strong></div><div><span>Jumlah Item</span><strong>${(inv.items||[]).length}</strong></div>`;
  wrap.querySelector('[data-ro-items]').innerHTML=(inv.items||[]).map(i=>`<tr><td>${text(i.code)||'—'}</td><td>${text(i.name)||'—'}</td><td>${num(i.qty)}</td><td>${rupiah(i.buyPrice)}</td><td>${rupiah(i.discount)}</td><td>${num(i.taxPercent)}%</td><td>${rupiah(invoiceSubtotal(i)+invoiceSubtotal(i)*num(i.taxPercent)/100)}</td></tr>`).join('')||'<tr><td colspan="7">Tidak ada item.</td></tr>';
  wrap.querySelector('[data-ro-total]').textContent=`Total Faktur: ${rupiah(invoiceTotal(inv))}`;wrap.hidden=false;
}

async function parseWorkbook(){
  const file=fileInput()?.files?.[0];if(!file)throw new Error('Pilih file Excel faktur terlebih dahulu.');if(!window.XLSX?.read)throw new Error('SheetJS/XLSX belum tersedia.');
  const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});const sheetName=wb.SheetNames.find(n=>norm(n).replace(/\s+/g,'_')==='faktur_pembelian');if(!sheetName)throw new Error('Sheet FAKTUR_PEMBELIAN tidak ditemukan.');
  const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''}).filter(r=>Object.values(r).some(v=>text(v)!==''));const m=master(),map=new Map(),issues=[];
  rows.forEach((row,index)=>{const line=index+2,number=text(row['Nomor Faktur']),supplier=canonicalSupplier(row.Supplier,m),qty=num(row.Qty);if(!number){issues.push(`Baris ${line}: Nomor Faktur wajib diisi.`);return;}if(!supplier){issues.push(`Baris ${line}: Supplier harus Supplier 1 sampai Supplier 6.`);return;}if(qty<=0){issues.push(`Baris ${line}: Qty harus lebih dari 0.`);return;}const code=text(row['Kode Produk']),existing=byCode(code,m),name=text(existing?.['Nama Produk'])||text(row['Nama Produk']);if(!existing&&!name){issues.push(`Baris ${line}: Produk baru wajib memiliki Nama Produk.`);return;}const key=norm(number);if(!map.has(key))map.set(key,{id:uid('INV'),number,date:dateOnly(row['Tanggal Faktur']),supplierCode:supplier,supplierName:supplierName(supplier,m),paymentType:text(row['Jenis Pembayaran'])||'Cash',dueDate:dateOnly(row['Tanggal Jatuh Tempo']),taxMethod:text(row['Metode PPN']),taxPercent:num(row['PPN Global (%)']),discount:num(row['Diskon Faktur']),otherCost:num(row['Biaya Lain']),notes:text(row.Catatan),status:'draft',stockApplied:false,source:'excel-v2-single-sheet',items:[],createdAt:nowIso()});const inv=map.get(key);if(norm(inv.supplierCode)!==norm(supplier))issues.push(`Faktur ${number}: Supplier berbeda pada beberapa baris.`);inv.items.push({code:existing?text(existing['Kode Produk']):code,originalCode:code,name,qty,unit:text(row.Satuan)||text(existing?.Satuan),buyPrice:num(row['Harga Beli']),discount:num(row['Diskon Item']),taxPercent:num(row['PPN Item (%)']),sellPrice:num(row['Harga Jual']),batch:text(row.Batch),expired:dateOnly(row['Tanggal Expired']),notes:text(row.Catatan),supplier:inv.supplierCode,productStatus:existing?'existing':'new',reviewRequired:!existing});});
  return {incoming:[...map.values()],issues};
}

async function saveExcelDraft(){
  const parsed=await parseWorkbook();if(parsed.issues.length)return dialog().warning('Periksa Data Faktur',parsed.issues.slice(0,12).join('\n'),{confirmText:'Perbaiki'});
  const list=invoices();let added=0,replaced=0,rejected=0;
  for(const incoming of parsed.incoming){const idx=list.findIndex(x=>norm(x.number)===norm(incoming.number));if(idx<0){list.unshift(incoming);added++;continue;}const old=list[idx];if(old.stockApplied||norm(old.status)==='confirmed'){rejected++;continue;}incoming.id=old.id;incoming.createdAt=old.createdAt||incoming.createdAt;incoming.updatedAt=nowIso();list[idx]=incoming;replaced++;}
  await writeStore(STORE_KEYS.invoices,list);
  await dialog().success('Faktur Draft Berhasil Disimpan',`Faktur baru: ${added}\nDraft diganti dari Excel: ${replaced}\nDitolak karena sudah Barang Masuk: ${rejected}\n\nTidak ada mode Gabungkan. Stok belum berubah.`,{confirmText:'Selesai'});
  if(fileInput())fileInput().value='';document.querySelector('[data-view="purchase-invoices"]')?.click();
}

function hideCsv(){document.querySelectorAll('button,a').forEach(el=>{if(/\bcsv\b/i.test(el.textContent||'')){el.classList.add('kp-hidden-at08');el.setAttribute('aria-hidden','true');}});}
function configureUi(){
  const imp=importSection(),target=invoiceSection();if(!imp||!target)return;
  document.querySelectorAll('[data-view="import-faktur"]').forEach(el=>el.classList.add('kp-hidden-at08'));
  if(!document.getElementById('kp-invoice-excel-workflow')){const box=document.createElement('div');box.id='kp-invoice-excel-workflow';box.className='kp-invoice-excel-panel';box.innerHTML='<div class="kp-invoice-excel-intro"><strong>Satu Pintu Faktur Pembelian — Excel</strong><span>Download template, isi faktur di Excel, preview, lalu simpan sebagai Draft. Data faktur tidak diketik ulang di aplikasi.</span></div>';Array.from(imp.children).forEach(ch=>box.appendChild(ch));target.prepend(box);}
  const dup=document.getElementById('invoice-duplicate-mode');if(dup){dup.value='overwrite';const holder=dup.closest('label,.form-field,.field,.input-group')||dup.parentElement;if(holder)holder.classList.add('kp-hidden-at08');}
  target.querySelectorAll('button,a').forEach(el=>{if(/faktur baru|tambah faktur/i.test(el.textContent||'')){el.classList.add('kp-hidden-at08');el.setAttribute('aria-hidden','true');}});
  const editor=document.getElementById('invoice-editor-overlay');if(editor)editor.dataset.excelOnly='true';
  if(!target.querySelector('.kp-excel-only-note')){const note=document.createElement('div');note.className='kp-excel-only-note';note.textContent='Excel adalah source of truth Faktur Pembelian. Jika Draft salah, perbaiki Excel lalu import ulang Nomor Faktur yang sama. Faktur yang sudah Barang Masuk tidak dapat ditimpa.';const table=target.querySelector('table');(table?.parentElement||target).insertAdjacentElement('beforebegin',note);}
  hideCsv();decorateInvoiceActions();
}
function decorateInvoiceActions(){const body=document.getElementById('invoice-table-body');if(!body)return;body.querySelectorAll('[data-invoice-edit]').forEach(b=>{b.title='Lihat Detail';const i=b.querySelector('i');if(i)i.className='fa-solid fa-eye';});}

window.addEventListener('click',async e=>{const action=e.target.closest('button,a');if(!action)return;
  if(action.closest('[data-view-section="purchase-invoices"]')&&/faktur baru|tambah faktur/i.test(action.textContent||'')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();await dialog().info('Input Faktur Melalui Excel','Faktur baru tidak diinput manual di aplikasi. Gunakan Download Template dan Import Excel pada halaman Faktur Pembelian.');return;}
  const edit=action.closest('[data-invoice-edit]');if(edit){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openReadOnly(edit.dataset.invoiceEdit);return;}
  if(action.id==='save-invoice-draft'||action.closest('#save-invoice-draft')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();await dialog().warning('Input Manual Dinonaktifkan','Draft Faktur hanya dibuat melalui Import Excel.');return;}
  if(action.closest('[data-view-section="purchase-invoices"]')&&/simpan draft import/i.test(action.textContent||'')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();try{await saveExcelDraft();}catch(err){console.error(err);await dialog().error('Faktur Tidak Dapat Disimpan',err?.message||String(err));}return;}
},true);

installReadOnlyModal();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',configureUi,{once:true});else configureUi();
const tableBody=document.getElementById('invoice-table-body');if(tableBody)new MutationObserver(()=>decorateInvoiceActions()).observe(tableBody,{childList:true,subtree:true});
window.addEventListener('kasirpro:operational-ready',configureUi);
window.KasirProInvoiceWorkflowAT08=Object.freeze({configureUi,openReadOnly,saveExcelDraft});
