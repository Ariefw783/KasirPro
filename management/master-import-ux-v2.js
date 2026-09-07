/* KasirPro Acceptance — Import Master UX V2
 * Merapikan langkah Konfirmasi Import tanpa mengubah logika import.
 * Opsi kloning "Ganti Seluruh Master" legacy dihapus karena belum memiliki perilaku berbeda dari update.
 */

function norm(v){return String(v??"").replace(/\s+/g," ").trim().toLowerCase()}

function replaceExactText(from,to){
  [...document.querySelectorAll("p,small,span,strong,h2,h3,h4")].forEach(el=>{
    if(norm(el.textContent)===norm(from)) el.textContent=to;
  });
}

function installStyle(){
  if(document.getElementById("kp-master-import-ux-style")) return;
  const style=document.createElement("style");
  style.id="kp-master-import-ux-style";
  style.textContent=`
    .kp-import-mode-heading{margin:2px 0 10px;font-size:.72rem;font-weight:850;color:var(--text-main,#1e293b)}
    .kp-import-mode-helper{margin:-4px 0 12px;color:var(--text-muted,#64748b);font-size:.62rem;line-height:1.5}
    .kp-import-mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}
    .kp-import-mode-card{position:relative;display:grid!important;grid-template-columns:24px minmax(0,1fr);gap:9px;align-items:start;margin:0!important;padding:13px!important;border:1px solid var(--border,#e2e8f0)!important;border-radius:11px!important;background:#fff!important;cursor:pointer;transition:.18s ease}
    .kp-import-mode-card:hover{border-color:#bfdbfe!important;background:#f8fbff!important}
    .kp-import-mode-card:has(input:checked){border-color:var(--primary,#2563eb)!important;box-shadow:0 0 0 2px rgba(37,99,235,.08);background:#f8fbff!important}
    .kp-import-mode-card input{width:17px;height:17px;margin:2px 0 0;accent-color:var(--primary,#2563eb)}
    .kp-import-mode-card strong{display:block;color:var(--text-main,#1e293b);font-size:.7rem;line-height:1.3}
    .kp-import-mode-card small{display:block;margin-top:4px;color:var(--text-muted,#64748b);font-size:.59rem;line-height:1.45}
    .kp-import-mode-badge{display:inline-flex;margin-top:7px;padding:3px 7px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:.52rem;font-weight:800}
    .kp-import-safety-note{margin:0 0 14px;padding:10px 12px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:.59rem;line-height:1.5}
    @media(max-width:720px){.kp-import-mode-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function enhanceModes(){
  const radios=[...document.querySelectorAll('input[name="existingDataMode"]')];
  if(!radios.length) return false;

  // Hapus opsi legacy hasil clone yang sebenarnya masih mode update.
  radios.filter(r=>r.dataset.kpReplaceMaster==="true").forEach(r=>{
    const card=r.closest("label")||r.parentElement;
    const outer=card?.parentElement;
    if(outer && outer.querySelectorAll('input[name="existingDataMode"]').length===1) outer.remove();
    else card?.remove();
  });

  const live=[...document.querySelectorAll('input[name="existingDataMode"]')].filter(r=>r.value==="update"||r.value==="skip");
  if(!live.length) return false;
  const labels=live.map(r=>r.closest("label")||r.parentElement).filter(Boolean);
  const first=labels[0];
  if(!first || first.closest(".kp-import-mode-grid")) return true;

  labels.forEach((label,index)=>{
    label.classList.add("kp-import-mode-card");
    const input=live[index];
    const textWrap=document.createElement("span");
    const isUpdate=input.value==="update";
    textWrap.innerHTML=isUpdate
      ? '<strong>Perbarui data yang cocok</strong><small>Jika Kode Produk sudah ada, isi Excel memperbarui field yang terisi. Sel kosong tetap mempertahankan nilai lama.</small><span class="kp-import-mode-badge">Disarankan</span>'
      : '<strong>Lewati data yang sudah ada</strong><small>Produk dengan Kode Produk yang sudah tersedia tidak diubah. Hanya data baru yang ditambahkan.</small>';
    [...label.childNodes].forEach(node=>{if(node!==input) node.remove()});
    label.appendChild(textWrap);
  });

  const grid=document.createElement("div");
  grid.className="kp-import-mode-grid";
  first.parentNode.insertBefore(grid,first);
  labels.forEach(label=>grid.appendChild(label));

  const heading=document.createElement("div");
  heading.className="kp-import-mode-heading";
  heading.textContent="Jika Kode Produk sudah ada";
  grid.parentNode.insertBefore(heading,grid);
  const helper=document.createElement("p");
  helper.className="kp-import-mode-helper";
  helper.textContent="Pilih cara KasirPro menangani data yang sudah ada. Untuk penggunaan normal, gunakan Perbarui data yang cocok.";
  heading.after(helper);
  const note=document.createElement("div");
  note.className="kp-import-safety-note";
  note.innerHTML="<strong>Aman untuk update parsial:</strong> pada mode Perbarui, sel Excel yang kosong tidak menghapus nilai lama.";
  grid.after(note);
  return true;
}

function refreshCopy(){
  replaceExactText("Semua kolom bersifat opsional. Data parsial tetap dapat diproses dengan peringatan.","Produk baru hanya wajib Nama Produk + Supplier. Kode Produk boleh kosong dan dibuat otomatis ADDxxxx.");
  replaceExactText("Data masih disimpan menggunakan localStorage untuk simulasi. Data dengan status Perlu Ditinjau tidak dimasukkan otomatis.","Master disimpan di IndexedDB. Data berstatus Perlu Ditinjau tidak dimasukkan otomatis sampai diperiksa Admin.");
  replaceExactText("Import Simulasi Selesai","Import Master Selesai");
  replaceExactText("Data telah diproses.","Master telah diproses dan disimpan sesuai pilihan import.");
}

function install(){installStyle();refreshCopy();enhanceModes()}
install();
let attempts=0;
const timer=setInterval(()=>{install(); if(++attempts>20) clearInterval(timer)},250);
const observer=new MutationObserver(()=>install());
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(()=>observer.disconnect(),8000);
