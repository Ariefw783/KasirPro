/* KasirPro AT-08 — Supplier filter display uses company names, values keep Supplier 1..6 */
import { STORE_KEYS, readStore } from '../modules/database/database-store.js';

const text = value => String(value ?? '').trim();
const norm = value => text(value).toLowerCase();

function master(){
  return readStore(STORE_KEYS.master, { produk: [], supplier: [], kategori: [], pengaturan_toko: [] }) || {};
}

function supplierRows(){
  const rows = Array.isArray(master()?.supplier) ? master().supplier : [];
  return rows;
}

function supplierNameFor(label){
  const row = supplierRows().find(item => norm(item?.Supplier) === norm(label));
  return text(row?.['Nama Supplier']) || label;
}

function rebuildSupplierFilter(){
  const select = document.getElementById('kp-final-supplier');
  if(!select) return;

  const current = select.value || 'all';
  const fragment = document.createDocumentFragment();

  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'Semua Supplier';
  fragment.appendChild(all);

  for(let i = 1; i <= 6; i += 1){
    const label = `Supplier ${i}`;
    const option = document.createElement('option');
    option.value = label;
    option.textContent = supplierNameFor(label);
    fragment.appendChild(option);
  }

  select.replaceChildren(fragment);
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
}

function install(){
  rebuildSupplierFilter();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

window.addEventListener('kasirpro:operational-ready', install);
window.addEventListener('kasirpro:master-updated', install);

window.KasirProInvoiceSupplierFilterAT08 = Object.freeze({ rebuild: rebuildSupplierFilter });
