/* KasirPro Excel Import - Supplier Name Only + Mojibake Safe */

const MASTER_SCHEMAS = Object.freeze({
  produk: { headers: ["Kode Produk","Nama Produk","Kategori","Satuan","Supplier","Harga Beli","Harga Jual","Stok Awal","Stok Minimum","Lokasi Rak","Batch","Tanggal Expired","Status Produk","Catatan"] },
  supplier: { headers: ["Supplier","Nama Supplier","Alamat","Telepon","Email","Kontak Person","NPWP","Termin Default","Status","Catatan"] },
  kategori: { headers: ["Kode Kategori","Nama Kategori","Deskripsi","Status"] },
  pengaturan_toko: { headers: ["Nama Toko","Alamat","Telepon","Email","NPWP","Logo","Footer Struk","Prefix Transaksi","Prefix Faktur","Format Nomor Transaksi","Format Nomor Faktur","Mata Uang","Zona Waktu","Pajak Default (%)","Ukuran Struk","Printer Default","Lebar Kertas","Tampilkan Logo di Struk","Tampilkan Nama Kasir di Struk","Tampilkan Pajak di Struk","Tampilkan Diskon di Struk","Status Toko","Catatan"] }
});

const REQUIRED_PRODUCT_HEADERS = ["Kode Produk","Nama Produk","Satuan","Supplier"];
const EMPTY_MARKERS = new Set(["-","--","---","—","–","â€”","â€“","ã¢â","ã¢â","Ã¢ÂÂ","Ã¢ÂÂ","Â—","Â–"]);

function key(v){ return String(v ?? "").trim().toLowerCase().replace(/\s+/g,"_"); }
function headerKey(v){ return String(v ?? "").trim().toLowerCase().replace(/[\s_\-]+/g,""); }
function comparable(v){ return sanitizeText(v).toLowerCase(); }
function isEmpty(v){ return v === null || v === undefined || sanitizeText(v) === ""; }
function clone(v){ return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }

function latin1ToUtf8Once(text){
  try {
    const bytes = Uint8Array.from([...text].map(ch => ch.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return text; }
}

export function sanitizeText(value){
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString().slice(0,10) : String(value);
  text = text.replace(/\uFEFF/g,"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").replace(/\u00A0/g," ");
  for (let i=0;i<4 && /[ÃÂâ]/.test(text);i++) {
    const decoded = latin1ToUtf8Once(text);
    if (decoded === text) break;
    text = decoded;
  }
  text = text.replace(/â€™/g,"’").replace(/â€˜/g,"‘").replace(/â€œ/g,"“").replace(/â€/g,"”")
    .replace(/â€¦/g,"…").replace(/â€¢/g,"•").replace(/â€”/g,"—").replace(/â€“/g,"–").replace(/Ã—/g,"×");
  text = text.split(/\s+/).filter(token => !/[ÃÂâ�]/.test(token)).join(" ");
  text = text.normalize("NFC").replace(/\s+/g," ").trim();
  if (EMPTY_MARKERS.has(text) || EMPTY_MARKERS.has(text.toLowerCase())) return "";
  return text;
}

function normalizeCell(value){
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0,10);
  if (typeof value === "number") return value;
  return sanitizeText(value);
}

function canonicalHeader(sheetKey, raw){
  const h = sanitizeText(raw);
  const hk = headerKey(h);
  if (sheetKey === "produk" && ["supplier","kodesupplier","namasupplier"].includes(hk)) return "Supplier";
  if (sheetKey === "supplier") {
    if (hk === "supplier") return "Supplier";
    if (hk === "namasupplier") return "Nama Supplier";
    if (hk === "kodesupplier") return "_Legacy Kode Supplier";
  }
  const schema = MASTER_SCHEMAS[sheetKey];
  return schema?.headers.find(x => headerKey(x) === hk) || h;
}

function findHeaderRow(matrix, sheetKey){
  const expected = MASTER_SCHEMAS[sheetKey]?.headers || [];
  if (!expected.length) return 0;
  const wanted = new Set(expected.map(headerKey));
  if (sheetKey === "produk") wanted.add("kodesupplier");
  if (sheetKey === "supplier") { wanted.add("namasupplier"); wanted.add("kodesupplier"); }
  let best=0, score=0;
  matrix.slice(0,20).forEach((row,i)=>{
    const s=(row||[]).filter(v=>wanted.has(headerKey(v))).length;
    if(s>score){score=s;best=i;}
  });
  return score>=2?best:0;
}

function normalizeWorksheet(worksheet, sheetName=""){
  const sheetKey = key(sheetName);
  const matrix = window.XLSX.utils.sheet_to_json(worksheet,{header:1,defval:"",blankrows:true,raw:false});
  if(!matrix.length) return {headers:[],rows:[],totalRows:0,emptyRows:0};
  const headerRowIndex=findHeaderRow(matrix,sheetKey);
  const headerRow=matrix[headerRowIndex]||[];
  const columnCount=Math.max(0,...matrix.map(r=>Array.isArray(r)?r.length:0));
  const headers=Array.from({length:columnCount},(_,i)=>canonicalHeader(sheetKey,headerRow[i])||`Kolom ${i+1}`);
  const rows=[]; let emptyRows=0;
  matrix.slice(headerRowIndex+1).forEach((row,index)=>{
    const values=Array.from({length:columnCount},(_,i)=>normalizeCell(row?.[i]));
    if(values.every(isEmpty)){emptyRows++;return;}
    rows.push({sourceRow:headerRowIndex+index+2,values});
  });
  return {headers,rows,totalRows:rows.length,emptyRows};
}

export async function readExcelWorkbook(file){
  if(!file) throw new Error("File Excel belum dipilih.");
  if(!window.XLSX) throw new Error("SheetJS belum tersedia.");
  const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true,raw:false});
  const sheets={}; wb.SheetNames.forEach(name=>{sheets[name]=normalizeWorksheet(wb.Sheets[name],name);});
  return {sheetNames:[...wb.SheetNames],sheets};
}

export function getWorkbookStats(workbookData){
  let totalRows=0,emptyRows=0;
  (workbookData?.sheetNames||[]).forEach(name=>{totalRows+=workbookData.sheets[name]?.totalRows||0;emptyRows+=workbookData.sheets[name]?.emptyRows||0;});
  return {sheetCount:workbookData?.sheetNames?.length||0,totalRows,emptyRows};
}

export function searchSheetRows(sheet,keyword){
  const q=comparable(keyword); if(!q) return sheet?.rows||[];
  return (sheet?.rows||[]).filter(row=>row.values.some(v=>comparable(v).includes(q)));
}

export function formatFileSize(bytes){
  const n=Number(bytes)||0; if(n<1024)return `${n} B`; if(n<1048576)return `${(n/1024).toFixed(1)} KB`; return `${(n/1048576).toFixed(1)} MB`;
}

export function analyzeMasterWorkbook(workbookData){
  const result={totalDataRows:0,emptyRows:0,partialRows:0,totalWarnings:0,items:[]};
  (workbookData?.sheetNames||[]).forEach(sheetName=>{
    const k=key(sheetName); if(k==="petunjuk_import") return;
    const sheet=workbookData.sheets[sheetName]; const schema=MASTER_SCHEMAS[k];
    if(!schema){if(sheet?.totalRows)result.items.push({severity:"info",sheet:sheetName,title:"Sheet tidak dikenali",count:sheet.totalRows,message:"Sheet tidak termasuk master standar."});return;}
    result.totalDataRows+=sheet.totalRows||0; result.emptyRows+=sheet.emptyRows||0;
    const partial=(sheet.rows||[]).filter(r=>r.values.some(isEmpty)).length; result.partialRows+=partial;
    if(partial)result.items.push({severity:"warning",sheet:sheetName,title:"Data parsial",count:partial,message:"Terdapat kolom kosong. Data tetap dapat diproses."});
    if(sheet.emptyRows)result.items.push({severity:"info",sheet:sheetName,title:"Baris kosong diabaikan",count:sheet.emptyRows,message:"Baris kosong tidak diproses."});
  });
  result.totalWarnings=result.items.filter(i=>i.severity==="warning").reduce((a,i)=>a+(i.count||0),0); return result;
}

export function validateMasterWorkbookHeaders(workbookData){
  const userSheet=(workbookData?.sheetNames||[]).find(n=>key(n)==="pengguna");
  if(userSheet)return[{sheet:userSheet,message:"Sheet PENGGUNA tidak dapat diimpor. Kelola admin dan kasir melalui aplikasi."}];
  const sheetName=(workbookData?.sheetNames||[]).find(n=>key(n)==="produk"); if(!sheetName)return[];
  const headers=(workbookData.sheets[sheetName]?.headers||[]).map(headerKey);
  const missing=REQUIRED_PRODUCT_HEADERS.filter(h=>!headers.includes(headerKey(h)));
  return missing.length?[{sheet:sheetName,missing}]:[];
}

export function createEmptyMasterStore(){return{produk:[],supplier:[],kategori:[],pengguna:[],pengaturan_toko:[]};}

export function validateSupplierReferences(workbookData, store){
  const supplierSheet=(workbookData?.sheetNames||[]).find(name=>key(name)==="supplier");
  const productSheet=(workbookData?.sheetNames||[]).find(name=>key(name)==="produk");
  if(!productSheet)return [];
  const known=new Set();
  if(supplierSheet){
    sheetRecords(workbookData.sheets[supplierSheet],"supplier").forEach(({record})=>{
      const label=comparable(record["Supplier"]); if(label)known.add(label);
    });
  }
  (store?.supplier||[]).forEach(record=>{
    const label=comparable(record["Supplier"]); if(label)known.add(label);
  });
  return sheetRecords(workbookData.sheets[productSheet],"produk")
    .map(({sourceRow,record})=>({sourceRow,label:sanitizeText(record["Supplier"])}))
    .filter(({label})=>!label||!known.has(comparable(label)));
}

function internalSupplierCode(name){
  const clean=sanitizeText(name).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,36);
  return clean?`SUP-${clean}`:"";
}

function sheetRecords(sheet,collection){
  return (sheet?.rows||[]).map(row=>{
    const record={}; (sheet.headers||[]).forEach((h,i)=>{record[h]=normalizeCell(row.values[i]);});
    if(collection==="produk"){
      const supplier=sanitizeText(record["Supplier"]||record["Nama Supplier"]||record["Kode Supplier"]);
      record["Supplier"]=supplier; record["Kode Supplier"]=internalSupplierCode(supplier);
      delete record["Nama Supplier"];
    }
    if(collection==="supplier"){
      const supplier=sanitizeText(record["Supplier"]||record["_Legacy Kode Supplier"]||record["Kode Supplier"]);
      const supplierName=sanitizeText(record["Nama Supplier"]||supplier);
      record["Supplier"]=supplier; record["Nama Supplier"]=supplierName;
      record["Kode Supplier"]=internalSupplierCode(supplier);
      delete record["_Legacy Kode Supplier"];
    }
    return {sourceRow:row.sourceRow,record};
  }).filter(x=>Object.values(x.record).some(v=>!isEmpty(v)));
}

function primaryIdentity(collection,record){
  const fields={produk:["Kode Produk","Nama Produk"],supplier:["Supplier","Nama Supplier"],kategori:["Kode Kategori","Nama Kategori"],pengguna:["ID Pengguna","Username","Nama"],pengaturan_toko:["Nama Toko"]}[collection]||[];
  for(const f of fields){const v=comparable(record[f]);if(v)return v;} return "";
}
function displayIdentity(collection,record){
  const fields={produk:["Kode Produk","Nama Produk"],supplier:["Supplier"],kategori:["Kode Kategori","Nama Kategori"],pengguna:["Username","Nama"],pengaturan_toko:["Nama Toko"]}[collection]||[];
  return fields.map(f=>sanitizeText(record[f])).filter(Boolean).join(" — ")||"Tanpa identitas";
}
function existingMatch(collection,record,list){
  const exactFields={produk:["Kode Produk"],supplier:["Supplier","Nama Supplier"],kategori:["Kode Kategori"],pengguna:["ID Pengguna","Username"],pengaturan_toko:["Nama Toko"]}[collection]||[];
  for(const field of exactFields){const target=comparable(record[field]);if(!target)continue;const found=(list||[]).find(x=>comparable(x[field]||x["Supplier"]||x["Nama Supplier"])===target);if(found)return{status:"exact",matchBy:field,matchedId:found._id||found._firestoreDocumentId||null};}
  if(collection==="produk"){const name=comparable(record["Nama Produk"]);if(name&&(list||[]).some(x=>comparable(x["Nama Produk"])===name))return{status:"possible",matchBy:"Nama Produk sama, Kode Produk berbeda",matchedId:null};}
  return{status:"new",matchBy:"",matchedId:null};
}

export function buildMasterImportPlan(workbookData,store){
  const plan={items:[],summary:{total:0,new:0,exact:0,possible:0,duplicate:0}}; const seen={};
  (workbookData?.sheetNames||[]).forEach(sheetName=>{
    const collection=key(sheetName); if(!MASTER_SCHEMAS[collection])return; seen[collection]||=new Set();
    sheetRecords(workbookData.sheets[sheetName],collection).forEach(entry=>{
      const identity=primaryIdentity(collection,entry.record);const dupKey=identity?`${collection}:${identity}`:"";let match;
      if(dupKey&&seen[collection].has(dupKey))match={status:"duplicate",matchBy:"Duplikat dalam workbook",matchedId:null};
      else{if(dupKey)seen[collection].add(dupKey);match=existingMatch(collection,entry.record,store?.[collection]||[]);}
      const item={sheet:sheetName,collection,sourceRow:entry.sourceRow,record:entry.record,identity:displayIdentity(collection,entry.record),...match};
      plan.items.push(item);plan.summary[item.status]++;plan.summary.total++;
    });
  }); return plan;
}

function storedRecord(record,existing={}){
  const clean={...existing}; Object.entries(record).forEach(([k,v])=>{clean[k]=typeof v==="string"?sanitizeText(v):v;});
  clean._id=existing._id||clean._id||`local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  if(existing._firestoreDocumentId)clean._firestoreDocumentId=existing._firestoreDocumentId;
  clean._updatedAt=new Date().toISOString(); return clean;
}

export function applyMasterImportPlan(plan,sourceStore,options={}){
  const store=clone(sourceStore||createEmptyMasterStore()); let added=0,updated=0,skipped=0;
  for(const item of plan?.items||[]){
    const list=store[item.collection]; if(!Array.isArray(list)){skipped++;continue;}
    if(item.status==="duplicate"||item.status==="possible"){skipped++;continue;}
    if(item.status==="new"){list.push(storedRecord(item.record));added++;continue;}
    if(item.status==="exact"){
      if(options.existingMode!=="update"){skipped++;continue;}
      const idx=list.findIndex(x=>{
        if(item.collection==="produk")return comparable(x["Kode Produk"])===comparable(item.record["Kode Produk"]);
        if(item.collection==="supplier")return comparable(x["Supplier"]||x["Nama Supplier"])===comparable(item.record["Supplier"]);
        if(item.collection==="kategori")return comparable(x["Kode Kategori"])===comparable(item.record["Kode Kategori"]);
        if(item.collection==="pengguna")return comparable(x["ID Pengguna"])===comparable(item.record["ID Pengguna"])||comparable(x["Username"])===comparable(item.record["Username"]);
        if(item.collection==="pengaturan_toko")return comparable(x["Nama Toko"])===comparable(item.record["Nama Toko"]);
        return false;
      });
      if(idx>=0){list[idx]=storedRecord(item.record,list[idx]);updated++;}else{list.push(storedRecord(item.record));added++;}
    }
  }
  return{store,added,updated,skipped,total:added+updated+skipped};
}
