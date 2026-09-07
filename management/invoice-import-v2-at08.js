/* KasirPro AT-08 — Faktur Pembelian V2, single-sheet + formula template */
import { STORE_KEYS, readStore, writeStore } from '../modules/database/database-store.js';

const text = v => String(v ?? '').trim();
const norm = v => text(v).toLowerCase();
const num = v => Number(String(v ?? 0).replace(/[^0-9.-]/g,'')) || 0;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const nowIso = () => new Date().toISOString();
const allowedSuppliers = new Set(['supplier 1','supplier 2','supplier 3','supplier 4','supplier 5','supplier 6']);
let preview = [];
let issues = [];

function dialog(){ return window.KasirProDialog; }
function master(){ return readStore(STORE_KEYS.master,{produk:[],supplier:[],kategori:[],pengaturan_toko:[]}); }
function invoices(){ return readStore(STORE_KEYS.invoices,[]); }
function products(m=master()){ return Array.isArray(m.produk) ? m.produk : []; }
function suppliers(m=master()){ return Array.isArray(m.supplier) ? m.supplier : []; }
function canonicalSupplier(value,m=master()){
  const key=norm(value);
  if(allowedSuppliers.has(key)) return `Supplier ${Number(key.replace(/\D/g,''))}`;
  const row=suppliers(m).find(x=>norm(x?.['Nama Supplier'])===key || norm(x?.Supplier)===key);
  const label=text(row?.Supplier);
  return allowedSuppliers.has(norm(label)) ? label : '';
}
function supplierName(label,m=master()){
  const row=suppliers(m).find(x=>norm(x?.Supplier)===norm(label));
  return text(row?.['Nama Supplier']) || label;
}
function byCode(code,m=master()){
  const key=norm(code); if(!key) return null;
  return products(m).find(x=>norm(x?.['Kode Produk'])===key) || null;
}
function dateOnly(value){
  if(!value) return '';
  if(value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const d=new Date(value); return Number.isNaN(d.getTime()) ? text(value) : d.toISOString().slice(0,10);
}
function subtotal(item){ return Math.max(0,num(item.qty)*num(item.buyPrice)-num(item.discount)); }
function total(inv){ const s=(inv.items||[]).reduce((a,x)=>a+subtotal(x),0); const base=Math.max(0,s-num(inv.discount)); return base+(base*num(inv.taxPercent)/100)+num(inv.otherCost); }
function rupiah(v){ return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(num(v)); }

function fileInput(){ return document.getElementById('invoice-import-file'); }
function findImportSection(){
  const input=fileInput();
  if(!input) return null;
  let el=input.parentElement;
  while(el && el!==document.body){
    if(/Import Faktur Pembelian/i.test(el.textContent||'')) return el;
    el=el.parentElement;
  }
  return input.parentElement;
}
function inInvoiceSection(el){ const root=findImportSection(); return !!(root && el && root.contains(el)); }

function makeTemplate(){
  if(!window.XLSX?.utils) throw new Error('SheetJS/XLSX belum tersedia. Muat ulang aplikasi lalu coba kembali.');
  const headers=['Nomor Faktur','Tanggal Faktur','Supplier','Jenis Pembayaran','Tanggal Jatuh Tempo','Metode PPN','PPN Global (%)','Diskon Faktur','Biaya Lain','Kode Produk','Nama Produk','Qty','Satuan','Harga Beli','Diskon Item','PPN Item (%)','Harga Jual','Batch','Tanggal Expired','Catatan','Subtotal Item','Nilai PPN Item','Total Item','Subtotal Faktur','Nilai PPN Global','Total Faktur'];
  const rows=[headers];
  rows.push(['INV-001',new Date(),'Supplier 1','Cash','','Global',11,0,0,'','Contoh Produk Baru',10,'Strip',8500,0,0,11000,'B26001','','Contoh']);
  rows.push(['INV-001',new Date(),'Supplier 1','Cash','','Global',11,0,0,'PRD001','',5,'Strip',9000,0,0,12500,'B26002','','Contoh produk existing']);
  for(let r=2;r<=1001;r++){
    if(!rows[r-1]) rows[r-1]=Array(20).fill('');
    rows[r-1][20]={f:`IF(OR(A${r}="",L${r}=""),"",MAX(0,L${r}*N${r}-O${r}))`};
    rows[r-1][21]={f:`IF(U${r}="","",IF(P${r}>0,U${r}*P${r}/100,0))`};
    rows[r-1][22]={f:`IF(U${r}="","",U${r}+V${r})`};
    rows[r-1][23]={f:`IF(A${r}="","",SUMIF($A$2:$A$1001,A${r},$U$2:$U$1001))`};
    rows[r-1][24]={f:`IF(A${r}="","",IF(COUNTIFS($A$2:$A$1001,A${r},$P$2:$P$1001,">0")>0,0,MAX(0,X${r}-H${r})*G${r}/100))`};
    rows[r-1][25]={f:`IF(A${r}="","",MAX(0,X${r}-H${r})+Y${r}+I${r})`};
  }
  const ws=window.XLSX.utils.aoa_to_sheet(rows,{cellDates:true});
  ws['!freeze']={xSplit:0,ySplit:1};
  ws['!cols']=[18,14,14,16,18,14,14,16,14,15,28,10,12,14,14,14,14,14,16,28,16,16,16,18,18,18].map(w=>({wch:w}));
  for(let r=2;r<=1001;r++){
    ['B','E','S'].forEach(c=>{ if(ws[`${c}${r}`]) ws[`${c}${r}`].z='dd/mm/yyyy'; });
    ['G','P'].forEach(c=>{ if(ws[`${c}${r}`]) ws[`${c}${r}`].z='0.00'; });
    ['H','I','N','O','Q','U','V','W','X','Y','Z'].forEach(c=>{ if(ws[`${c}${r}`]) ws[`${c}${r}`].z='#,##0'; });
  }
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,'FAKTUR_PEMBELIAN');
  window.XLSX.writeFile(wb,'Template_Faktur_KasirPro.xlsx',{compression:true});
}

async function readWorkbook(){
  const file=fileInput()?.files?.[0];
  if(!file) throw new Error('Pilih file Excel faktur terlebih dahulu.');
  if(!window.XLSX?.read) throw new Error('SheetJS/XLSX belum tersedia.');
  const buffer=await file.arrayBuffer();
  return window.XLSX.read(buffer,{type:'array',cellDates:true});
}

async function buildPreview(){
  const wb=await readWorkbook();
  const sheetName=wb.SheetNames.find(n=>norm(n).replace(/\s+/g,'_')==='faktur_pembelian');
  if(!sheetName) throw new Error('Sheet FAKTUR_PEMBELIAN tidak ditemukan. Gunakan template Faktur V2 terbaru.');
  const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''}).filter(row=>Object.values(row).some(v=>text(v)!==''));
  const m=master(); const map=new Map(); const found=[];
  rows.forEach((row,index)=>{
    const line=index+2; const number=text(row['Nomor Faktur']); const supplier=canonicalSupplier(row.Supplier,m); const qty=num(row.Qty);
    if(!number){ found.push(`Baris ${line}: Nomor Faktur wajib diisi.`); return; }
    if(!supplier){ found.push(`Baris ${line}: Supplier wajib menggunakan Supplier 1 sampai Supplier 6.`); return; }
    if(qty<=0){ found.push(`Baris ${line}: Qty harus lebih dari 0.`); return; }
    const code=text(row['Kode Produk']); const existing=byCode(code,m); const name=text(existing?.['Nama Produk']) || text(row['Nama Produk']);
    if(!existing && !name){ found.push(`Baris ${line}: Produk baru tanpa Kode Produk wajib memiliki Nama Produk.`); return; }
    const key=norm(number);
    if(!map.has(key)) map.set(key,{id:uid('INV'),number,date:dateOnly(row['Tanggal Faktur']),supplierCode:supplier,supplierName:supplierName(supplier,m),paymentType:text(row['Jenis Pembayaran'])||'Cash',dueDate:dateOnly(row['Tanggal Jatuh Tempo']),taxMethod:text(row['Metode PPN']),taxPercent:num(row['PPN Global (%)']),discount:num(row['Diskon Faktur']),otherCost:num(row['Biaya Lain']),notes:text(row.Catatan),status:'draft',stockApplied:false,source:'excel-v2-single-sheet',items:[],createdAt:nowIso()});
    const inv=map.get(key);
    if(norm(inv.supplierCode)!==norm(supplier)) found.push(`Faktur ${number}: Supplier berbeda pada beberapa baris.`);
    inv.items.push({code:existing?text(existing['Kode Produk']):code,originalCode:code,name,qty,unit:text(row.Satuan)||text(existing?.Satuan),buyPrice:num(row['Harga Beli']),discount:num(row['Diskon Item']),taxPercent:num(row['PPN Item (%)']),sellPrice:num(row['Harga Jual']),batch:text(row.Batch),expired:dateOnly(row['Tanggal Expired']),notes:text(row.Catatan),supplier:inv.supplierCode,productStatus:existing?'existing':'new',reviewRequired:!existing});
  });
  preview=[...map.values()]; issues=found;
  const body=document.getElementById('invoice-import-preview-body');
  if(body) body.innerHTML=preview.length?preview.map(inv=>`<tr><td>${escapeHtml(inv.number)}</td><td>${escapeHtml(inv.date||'—')}</td><td>${escapeHtml(inv.supplierName||inv.supplierCode)}</td><td>${inv.items.length}</td><td>${rupiah(total(inv))}</td><td><span class="ops-badge warn">Draft</span>${inv.items.some(i=>i.productStatus==='new')?' <span class="ops-badge neutral">Produk Baru</span>':''}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-table-state">Tidak ada faktur valid.</td></tr>';
  const summary=document.getElementById('invoice-import-summary');
  if(summary){ summary.hidden=false; summary.innerHTML=`<strong>${preview.length} faktur</strong> terbaca dari ${rows.length} baris. Semua akan disimpan sebagai Draft.${issues.length?`<br><strong>${issues.length} masalah validasi perlu diperbaiki.</strong>`:''}`; }
  const previewBox=document.getElementById('invoice-import-preview'); if(previewBox) previewBox.hidden=false;
  const actions=document.getElementById('invoice-import-actions'); if(actions) actions.hidden=false;
  if(issues.length) await dialog().warning('Periksa Data Faktur',issues.slice(0,10).join('\n')+(issues.length>10?`\nDan ${issues.length-10} masalah lainnya.`:''),{confirmText:'Perbaiki'});
}

async function saveDraft(){
  if(!preview.length) return dialog().warning('Belum Ada Preview','Baca dan preview file Faktur V2 terlebih dahulu.');
  if(issues.length) return dialog().warning('Import Belum Dapat Dilakukan','Masih ada masalah validasi pada preview. Perbaiki file Excel lalu baca ulang.');
  const mode=document.getElementById('invoice-duplicate-mode')?.value || 'skip';
  const list=invoices(); let added=0,updated=0,skipped=0;
  for(const incoming of preview){
    const idx=list.findIndex(x=>norm(x.number)===norm(incoming.number));
    if(idx<0){ list.unshift(incoming); added++; continue; }
    const old=list[idx];
    if(mode==='skip' || old.stockApplied){ skipped++; continue; }
    if(mode==='overwrite'){ incoming.id=old.id; incoming.createdAt=old.createdAt; list[idx]=incoming; updated++; continue; }
    old.items=[...(old.items||[]),...(incoming.items||[])]; old.updatedAt=nowIso(); old.status='draft'; old.stockApplied=false; updated++;
  }
  await writeStore(STORE_KEYS.invoices,list);
  await dialog().success('Faktur Draft Berhasil Disimpan',`Baru: ${added}\nDiperbarui: ${updated}\nDilewati: ${skipped}\n\nStok belum berubah. Stok baru berubah setelah Barang Masuk dikonfirmasi.`,{confirmText:'Selesai'});
  preview=[]; issues=[];
  if(fileInput()) fileInput().value='';
  const body=document.getElementById('invoice-import-preview-body'); if(body) body.innerHTML='<tr><td colspan="6" class="empty-table-state">Belum ada preview faktur.</td></tr>';
  const summary=document.getElementById('invoice-import-summary'); if(summary){ summary.hidden=true; summary.textContent=''; }
  document.querySelector('[data-view="purchase-invoices"]')?.click();
}

function labelOf(el){ return norm(el?.textContent); }
document.addEventListener('click',async event=>{
  const action=event.target.closest('button,a');
  if(!action || !inInvoiceSection(action)) return;
  const label=labelOf(action);
  try{
    if(label.includes('download template')){ event.preventDefault(); event.stopImmediatePropagation(); makeTemplate(); return; }
    if(label.includes('baca & preview')){ event.preventDefault(); event.stopImmediatePropagation(); await buildPreview(); return; }
    if(label.includes('simpan draft import')){ event.preventDefault(); event.stopImmediatePropagation(); await saveDraft(); return; }
  }catch(err){ console.error('AT-08 Faktur:',err); await dialog().error('Faktur Tidak Dapat Diproses',err?.message||String(err),{confirmText:'Tutup'}); }
},true);

window.KasirProInvoiceAT08=Object.freeze({downloadTemplate:makeTemplate,preview:buildPreview,saveDraft});
