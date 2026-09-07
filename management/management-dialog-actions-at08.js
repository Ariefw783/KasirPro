/* KasirPro AT-08 — Management professional confirm bridge */
import { STORE_KEYS, readStore } from '../modules/database/database-store.js';

const replaying = new WeakSet();
const text = value => String(value ?? '').trim();
const norm = value => text(value).toLowerCase();

function dialog(){ return window.KasirProDialog; }
function master(){ return readStore(STORE_KEYS.master,{produk:[],supplier:[],kategori:[],pengaturan_toko:[]}) || {}; }
function invoices(){ return readStore(STORE_KEYS.invoices,[]) || []; }
function products(m=master()){ return Array.isArray(m.produk) ? m.produk : []; }

function byCode(code,m=master()){
  const key = norm(code);
  if(!key) return null;
  return products(m).find(item => norm(item?.['Kode Produk']) === key) || null;
}

function possibleProduct(name,supplier,m=master()){
  const n = norm(name), s = norm(supplier);
  if(!n || !s) return null;
  const matches = products(m).filter(item => norm(item?.['Nama Produk']) === n && norm(item?.Supplier) === s);
  return matches.length === 1 ? matches[0] : null;
}

function replayLegacyClick(element,{confirmQueue=[]}={}){
  if(!element) return;
  const oldConfirm = window.confirm;
  const queue = [...confirmQueue];
  window.confirm = () => queue.length ? !!queue.shift() : false;
  replaying.add(element);
  try { element.click(); }
  finally {
    setTimeout(() => {
      replaying.delete(element);
      window.confirm = oldConfirm;
    },0);
  }
}

async function buildInvoiceDecisionQueue(invoice){
  const m = master();
  const queue = [];
  const supplier = text(invoice?.supplierCode);

  for(const item of (invoice?.items || [])){
    if(byCode(item?.code,m)) continue;

    const candidate = possibleProduct(item?.name,supplier,m);
    if(candidate){
      const useExisting = await dialog()?.confirm?.(
        'Review Produk Faktur',
        `Produk "${text(item?.name) || 'Tanpa nama'}" belum memiliki Kode Produk valid pada faktur.\n\nDitemukan produk Master:\n${text(candidate?.['Nama Produk'])}\nKode: ${text(candidate?.['Kode Produk'])}\n\nGunakan produk Master ini?`,
        {confirmText:'Gunakan Produk Master',cancelText:'Jadikan Produk Baru',type:'warning'}
      );
      queue.push(!!useExisting);
      if(useExisting) continue;
    }

    const approveNew = await dialog()?.confirm?.(
      'Produk Baru dari Faktur',
      `Nama: ${text(item?.name) || '—'}\nSupplier: ${supplier || '—'}\n\nProduk akan ditambahkan sebagai Produk Baru saat Barang Masuk dikonfirmasi. Jika Kode Produk belum tersedia, sistem menggunakan kode ADDxxxx.`,
      {confirmText:'Setujui Produk Baru',cancelText:'Batalkan Barang Masuk',type:'warning'}
    );
    queue.push(!!approveNew);
    if(!approveNew) return {approved:false,queue};
  }

  const finalApproval = await dialog()?.confirm?.(
    'Konfirmasi Barang Masuk',
    `Faktur ${text(invoice?.number) || '—'} akan dikonfirmasi.\n\n${(invoice?.items || []).length} item akan menambah stok operasional dan transaksi tidak dapat diperlakukan sebagai Draft lagi.`,
    {confirmText:'Konfirmasi Barang Masuk',cancelText:'Batal',type:'warning'}
  );
  if(!finalApproval) return {approved:false,queue:[]};
  queue.push(true);
  return {approved:true,queue};
}

async function handleInvoiceConfirm(button){
  const id = button.dataset.invoiceConfirm || document.getElementById('invoice-editor-id')?.value || '';
  const invoice = invoices().find(item => String(item?.id) === String(id));
  if(!invoice){
    await dialog()?.error?.('Faktur Tidak Ditemukan','Data Faktur Pembelian tidak tersedia.');
    return;
  }
  if(invoice.stockApplied || norm(invoice.status) === 'confirmed'){
    await dialog()?.info?.('Barang Sudah Masuk','Faktur ini sudah pernah dikonfirmasi sebagai Barang Masuk.');
    return;
  }

  const decisions = await buildInvoiceDecisionQueue(invoice);
  if(!decisions.approved){
    await dialog()?.info?.('Barang Masuk Dibatalkan','Tidak ada perubahan stok yang dilakukan.');
    return;
  }
  replayLegacyClick(button,{confirmQueue:decisions.queue});
}

async function handleOpnameConfirm(button){
  const approved = await dialog()?.confirm?.(
    'Konfirmasi Stock Opname',
    'Selisih stok pada preview akan diterapkan sebagai adjustment MutasiStok. Pastikan hasil hitung fisik sudah diperiksa.',
    {confirmText:'Terapkan Adjustment',cancelText:'Batal',type:'warning'}
  );
  if(!approved) return;
  replayLegacyClick(button,{confirmQueue:[true]});
}

async function capture(event){
  const button = event.target.closest?.('[data-invoice-confirm], #confirm-invoice, #confirm-opname-import');
  if(!button || replaying.has(button)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  try {
    if(button.matches('#confirm-opname-import')) await handleOpnameConfirm(button);
    else await handleInvoiceConfirm(button);
  } catch(error) {
    console.error('AT-08 Management dialog bridge:',error);
    await dialog()?.error?.('Tindakan Tidak Dapat Dilanjutkan',error?.message || String(error));
  }
}

document.addEventListener('click',capture,true);

window.KasirProManagementDialogAT08 = Object.freeze({replayLegacyClick});
