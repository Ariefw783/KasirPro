/* KasirPro — Full Replace Master Import
 * Setiap import Master mengganti seluruh Master lama dengan isi workbook terbaru.
 * Data operasional (penjualan, faktur, mutasi stok, stock opname) tidak disentuh.
 */
import {
  masterReady,
  readMasterSnapshot,
  readMasterVersion,
  installMasterSnapshot
} from "./master-repository.js";

const REQUIRED_SHEETS = ["SUPPLIER", "KATEGORI", "PRODUK", "PENGATURAN_TOKO"];
const ALLOWED_SUPPLIERS = ["Supplier 1", "Supplier 2", "Supplier 3", "Supplier 4", "Supplier 5", "Supplier 6"];
const ALLOWED_SUPPLIER_SET = new Set(ALLOWED_SUPPLIERS.map(v => v.toLowerCase()));

const text = v => String(v ?? "").trim();
const norm = v => text(v).toLowerCase();
const headerKey = v => norm(v).replace(/[\s_\-]+/g, "");
const clone = v => typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));

function normalizeMaster(master) {
  const src = master || {};
  return {
    produk: Array.isArray(src.produk) ? src.produk : [],
    supplier: Array.isArray(src.supplier) ? src.supplier : [],
    kategori: Array.isArray(src.kategori) ? src.kategori : [],
    pengguna: [],
    pengaturan_toko: Array.isArray(src.pengaturan_toko) ? src.pengaturan_toko : []
  };
}

function sheetByName(workbook, wanted) {
  const actual = (workbook?.sheetNames || []).find(name => norm(name) === norm(wanted));
  return actual ? workbook.sheets?.[actual] : null;
}

function rowsAsObjects(sheet) {
  if (!sheet) return [];
  const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
  return (sheet.rows || []).map(row => {
    const record = {};
    headers.forEach((header, i) => { record[header] = row.values?.[i] ?? ""; });
    return { sourceRow: row.sourceRow, record };
  }).filter(({record}) => Object.values(record).some(v => text(v) !== ""));
}

function getField(record, wanted) {
  const key = Object.keys(record || {}).find(k => headerKey(k) === headerKey(wanted));
  return key ? record[key] : "";
}

function sanitizeRecord(record) {
  const out = { ...(record || {}) };
  delete out._firestoreDocumentId;
  delete out._localKey;
  return out;
}

function sanitizeProduct(record) {
  const out = sanitizeRecord(record);
  out["Kode Produk"] = text(getField(record, "Kode Produk"));
  out["Nama Produk"] = text(getField(record, "Nama Produk"));
  out["Supplier"] = text(getField(record, "Supplier"));
  delete out["Kode Supplier"];
  delete out["Nama Supplier"];
  delete out["Stok Awal"];
  return out;
}

function sanitizeSupplier(record) {
  const out = sanitizeRecord(record);
  out["Supplier"] = text(getField(record, "Supplier"));
  out["Nama Supplier"] = text(getField(record, "Nama Supplier"));
  delete out["Kode Supplier"];
  return out;
}

function addNumber(code) {
  const m = text(code).toUpperCase().match(/^ADD(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function findUniqueCurrentByNameSupplier(current, name, supplier) {
  const n = norm(name), s = norm(supplier);
  const matches = (current?.produk || []).filter(p => norm(p?.["Nama Produk"]) === n && norm(p?.["Supplier"]) === s);
  return matches.length === 1 ? matches[0] : null;
}

function validateStructure(workbook) {
  const issues = [];
  const names = (workbook?.sheetNames || []).map(norm);
  if (names.includes("pengguna")) issues.push("Sheet PENGGUNA tidak boleh ada. Pengguna dikelola langsung dari aplikasi.");
  for (const required of REQUIRED_SHEETS) {
    if (!names.includes(norm(required))) issues.push(`Sheet ${required} wajib tersedia.`);
  }
  const productSheet = sheetByName(workbook, "PRODUK");
  if (productSheet) {
    const headers = new Set((productSheet.headers || []).map(headerKey));
    for (const required of ["Nama Produk", "Supplier"]) {
      if (!headers.has(headerKey(required))) issues.push(`Sheet PRODUK wajib memiliki kolom ${required}.`);
    }
  }
  return issues;
}

function buildReplacementMaster(workbook, current) {
  const issues = validateStructure(workbook);
  const supplierRows = rowsAsObjects(sheetByName(workbook, "SUPPLIER"));
  const categoryRows = rowsAsObjects(sheetByName(workbook, "KATEGORI"));
  const productRows = rowsAsObjects(sheetByName(workbook, "PRODUK"));
  const settingRows = rowsAsObjects(sheetByName(workbook, "PENGATURAN_TOKO"));

  const suppliers = supplierRows.map(({record}) => sanitizeSupplier(record));
  const supplierLabels = new Set();
  suppliers.forEach((row, i) => {
    const label = text(row["Supplier"]);
    const name = text(row["Nama Supplier"]);
    if (!ALLOWED_SUPPLIER_SET.has(norm(label))) issues.push(`SUPPLIER baris ${supplierRows[i].sourceRow || i + 2}: gunakan label Supplier 1 sampai Supplier 6.`);
    if (!name) issues.push(`SUPPLIER baris ${supplierRows[i].sourceRow || i + 2}: Nama Supplier wajib diisi.`);
    if (supplierLabels.has(norm(label))) issues.push(`SUPPLIER: ${label || "label kosong"} tercatat lebih dari sekali.`);
    if (label) supplierLabels.add(norm(label));
  });
  ALLOWED_SUPPLIERS.forEach(label => {
    if (!supplierLabels.has(norm(label))) issues.push(`${label} wajib tetap tersedia pada sheet SUPPLIER.`);
  });

  const products = productRows.map(({record}) => sanitizeProduct(record));
  const incomingCodes = new Set();
  const nameSupplierPairs = new Set();
  let maxAdd = 0;
  (current?.produk || []).forEach(p => { maxAdd = Math.max(maxAdd, addNumber(p?.["Kode Produk"])); });
  products.forEach(p => { maxAdd = Math.max(maxAdd, addNumber(p["Kode Produk"])); });
  let nextAdd = maxAdd + 1;

  products.forEach((product, i) => {
    const rowNo = productRows[i].sourceRow || i + 2;
    const name = text(product["Nama Produk"]);
    const supplier = text(product["Supplier"]);
    if (!name) issues.push(`PRODUK baris ${rowNo}: Nama Produk wajib diisi.`);
    if (!supplier) issues.push(`PRODUK baris ${rowNo}: Supplier wajib diisi.`);
    else if (!ALLOWED_SUPPLIER_SET.has(norm(supplier))) issues.push(`PRODUK baris ${rowNo}: Supplier harus Supplier 1 sampai Supplier 6.`);
    else if (!supplierLabels.has(norm(supplier))) issues.push(`PRODUK baris ${rowNo}: ${supplier} tidak tersedia pada sheet SUPPLIER.`);

    const pair = `${norm(name)}|${norm(supplier)}`;
    if (name && supplier) {
      if (nameSupplierPairs.has(pair)) issues.push(`PRODUK baris ${rowNo}: kombinasi Nama Produk + Supplier tercatat lebih dari sekali.`);
      nameSupplierPairs.add(pair);
    }

    let code = text(product["Kode Produk"]);
    if (!code && name && supplier) {
      const existing = findUniqueCurrentByNameSupplier(current, name, supplier);
      const existingCode = text(existing?.["Kode Produk"]);
      if (existingCode && !incomingCodes.has(norm(existingCode))) code = existingCode;
      else {
        do { code = `ADD${String(nextAdd++).padStart(4, "0")}`; }
        while (incomingCodes.has(norm(code)));
      }
      product["Kode Produk"] = code;
    }
    if (!code) issues.push(`PRODUK baris ${rowNo}: Kode Produk tidak dapat dibuat karena Nama Produk/Supplier belum lengkap.`);
    else if (incomingCodes.has(norm(code))) issues.push(`PRODUK baris ${rowNo}: Kode Produk ${code} digunakan lebih dari sekali.`);
    else incomingCodes.add(norm(code));
  });

  const kategori = categoryRows.map(({record}) => sanitizeRecord(record));
  const pengaturan_toko = settingRows.map(({record}) => sanitizeRecord(record));
  if (!pengaturan_toko.length) issues.push("Sheet PENGATURAN_TOKO harus memiliki minimal satu baris data.");

  const master = { produk: products, supplier: suppliers, kategori, pengguna: [], pengaturan_toko };
  return { master, issues };
}

export async function prepareMasterReplacement(workbookData) {
  const current = (await masterReady()) ? normalizeMaster(await readMasterSnapshot()) : normalizeMaster({});
  const workbook = clone(workbookData || {sheetNames:[], sheets:{}});
  const built = buildReplacementMaster(workbook, current);
  const currentCodes = new Set((current.produk || []).map(p => norm(p?.["Kode Produk"])).filter(Boolean));
  const nextCodes = new Set((built.master.produk || []).map(p => norm(p?.["Kode Produk"])).filter(Boolean));
  return {
    current,
    workbook,
    master: built.master,
    validation: { issues: built.issues, canContinue: built.issues.length === 0 },
    summary: {
      products: built.master.produk.length,
      suppliers: built.master.supplier.length,
      categories: built.master.kategori.length,
      removedProducts: [...currentCodes].filter(code => !nextCodes.has(code)).length
    }
  };
}

export async function commitMasterReplacement(workbookData) {
  const prepared = await prepareMasterReplacement(workbookData);
  if (!prepared.validation.canContinue) {
    const error = new Error(prepared.validation.issues.join("\n"));
    error.code = "MASTER_REPLACE_VALIDATION_FAILED";
    error.validation = prepared.validation;
    throw error;
  }
  const currentVersion = Number(await readMasterVersion()) || 0;
  const version = currentVersion + 1 || 1;
  const installed = await installMasterSnapshot(prepared.master, {
    version,
    source: "master-full-replace"
  });
  return {
    version: installed.version,
    master: installed.master,
    publish: installed.publish,
    summary: prepared.summary
  };
}
