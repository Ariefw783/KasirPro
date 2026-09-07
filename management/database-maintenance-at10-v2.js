/* KasirPro AT-10 V2 — Admin Factory Reset + cross-device reset token */
import { firebaseDb } from "../modules/database/firebase-client.js";
import { collectionSegments, ROOT_DOCUMENT_PATH } from "../modules/database/database-paths.js";
import { signOutKasirPro } from "../modules/database/auth.js";
import { clearKasirProLocalMaster } from "../modules/local/indexeddb-store.js";
import { clearOperationalCache } from "../modules/local/operational-indexeddb.js";
import { setLocalDatabaseResetToken } from "../modules/database/database-reset-guard-at10.js";
import {
  collection, doc, getCountFromServer, getDocsFromServer, limit, query,
  serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const SESSION_KEY = "kasirpro_session";
const CONFIRM_PHRASE = "RESET KASIRPRO";
const BATCH_SIZE = 400;
const RESET_COLLECTIONS = Object.freeze([
  ["purchaseInvoices", "Faktur Pembelian"],
  ["sales", "Transaksi Penjualan"],
  ["stockMovements", "Mutasi Stok"],
  ["activeStocks", "Stok Aktif"],
  ["stockOpnames", "Stock Opname"],
  ["masterSnapshots", "Master Snapshot"],
  ["masterSnapshotChunks", "Master Snapshot Chunks"],
  ["products", "Produk"],
  ["categories", "Kategori"],
  ["suppliers", "Supplier"]
].map(([key, label]) => ({ key, label })));

function session() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}
function isAdmin() { return String(session()?.role || "").toLowerCase() === "admin"; }
function esc(v) { return String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function resetToken() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function styles() {
  if (document.getElementById("kp-at10-v2-style")) return;
  const s = document.createElement("style");
  s.id = "kp-at10-v2-style";
  s.textContent = `
  .kp10-card{margin-top:18px;padding:18px;border:1px solid #fecaca;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.05)}
  .kp10-top{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}.kp10-top h3{margin:0;color:#991b1b;font-size:17px}.kp10-top p{margin:6px 0 0;max-width:760px;color:#64748b;font-size:13px;line-height:1.55}.kp10-tag{padding:5px 9px;border-radius:999px;background:#fee2e2;color:#991b1b;font:800 11px system-ui}
  .kp10-btn{margin-top:14px;border:0;border-radius:10px;padding:10px 14px;font:700 13px system-ui;cursor:pointer}.kp10-btn:disabled{opacity:.5;cursor:not-allowed}.kp10-soft{background:#f1f5f9;color:#0f172a}.kp10-danger{background:#b91c1c;color:#fff}.kp10-note{margin-top:10px;color:#64748b;font-size:12px}
  .kp10-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.kp10-modal{width:min(620px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
  .kp10-h,.kp10-b,.kp10-f{padding:18px 20px}.kp10-h{border-bottom:1px solid #e2e8f0}.kp10-h h3{margin:0;color:#991b1b}.kp10-h p{margin:6px 0 0;color:#64748b;font-size:13px}.kp10-f{border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px}.kp10-f .kp10-btn{margin:0}
  .kp10-row{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;margin-bottom:6px;border-radius:9px;background:#f8fafc;font-size:13px}.kp10-total{display:flex;justify-content:space-between;padding:11px 12px;margin-top:10px;border-radius:10px;background:#fff1f2;color:#9f1239;font-weight:800}.kp10-protected{margin-top:13px;padding:11px 12px;border-radius:10px;background:#ecfdf5;color:#166534;font-size:12px;line-height:1.5}
  .kp10-label{display:block;margin-top:15px;color:#334155;font:700 13px system-ui}.kp10-input{width:100%;box-sizing:border-box;margin-top:7px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font:700 14px system-ui;text-transform:uppercase}.kp10-progress{margin-top:13px;padding:11px 12px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:12px;line-height:1.5}
  @media(max-width:640px){.kp10-f{flex-direction:column-reverse}.kp10-f .kp10-btn{width:100%}}
  `;
  document.head.appendChild(s);
}

async function previewCounts() {
  const rows = [];
  for (const item of RESET_COLLECTIONS) {
    const snap = await getCountFromServer(collection(firebaseDb, ...collectionSegments(item.key)));
    rows.push({ ...item, count: Number(snap.data()?.count) || 0 });
  }
  return rows;
}

async function deleteCollection(key, progress) {
  const ref = collection(firebaseDb, ...collectionSegments(key));
  let deleted = 0;
  while (true) {
    const snap = await getDocsFromServer(query(ref, limit(BATCH_SIZE)));
    if (snap.empty) return deleted;
    const batch = writeBatch(firebaseDb);
    snap.docs.forEach(row => batch.delete(row.ref));
    await batch.commit();
    deleted += snap.size;
    progress?.(deleted);
    if (snap.size < BATCH_SIZE) return deleted;
  }
}

function clearLegacy() {
  try {
    ["kasirpro_master_store_v1","kasirpro_purchase_invoices_v1","kasirpro_sales_v1","kasirpro_stock_movements_v1","kasirpro_stock_opname_v1"].forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem("kasirpro_preload_session_v1");
  } catch {}
}

async function publishResetMarker(token) {
  await setDoc(doc(firebaseDb, ...ROOT_DOCUMENT_PATH), {
    databaseResetToken: token,
    databaseResetAt: serverTimestamp(),
    databaseResetSchemaVersion: 1,
    databaseResetByUid: session()?.userId || null
  }, { merge: true });
  setLocalDatabaseResetToken(token);
}

function closeModal() { document.getElementById("kp10-overlay")?.remove(); }

async function execute(rows, ui) {
  if (!isAdmin() || ui.input.value.trim().toUpperCase() !== CONFIRM_PHRASE) return;
  ui.go.disabled = true; ui.cancel.disabled = true; ui.input.disabled = true; ui.progress.hidden = false;
  try {
    for (let i = 0; i < RESET_COLLECTIONS.length; i++) {
      const item = RESET_COLLECTIONS[i];
      ui.progress.textContent = `Menghapus ${item.label} (${i + 1}/${RESET_COLLECTIONS.length})…`;
      await deleteCollection(item.key, n => ui.progress.textContent = `Menghapus ${item.label}: ${n.toLocaleString("id-ID")} dokumen…`);
    }

    const token = resetToken();
    ui.progress.textContent = "Menerbitkan reset token ke seluruh perangkat…";
    await publishResetMarker(token);

    ui.progress.textContent = "Membersihkan IndexedDB dan cursor sinkronisasi perangkat ini…";
    await clearOperationalCache();
    await clearKasirProLocalMaster();
    clearLegacy();

    window.__kasirproAT10LastResetReport = {
      completedAt: new Date().toISOString(), token,
      plannedCounts: rows.map(r => ({ key: r.key, count: r.count }))
    };

    ui.progress.textContent = "Reset selesai. Keluar dari sesi Administrator…";
    await signOutKasirPro();
    sessionStorage.removeItem(SESSION_KEY);
    await new Promise(r => setTimeout(r, 600));
    location.replace("../index.html?reset=completed");
  } catch (error) {
    console.error("AT-10 Factory Reset gagal:", error);
    ui.progress.textContent = `Reset berhenti: ${error?.message || String(error)}. Data yang sudah terhapus tidak dipulihkan otomatis. Jalankan Preview kembali untuk melihat data yang masih tersisa.`;
    ui.cancel.disabled = false; ui.cancel.textContent = "Tutup";
  }
}

function modal(rows) {
  closeModal();
  const total = rows.reduce((s, r) => s + r.count, 0);
  const el = document.createElement("div"); el.id = "kp10-overlay"; el.className = "kp10-overlay";
  el.innerHTML = `<div class="kp10-modal" role="dialog" aria-modal="true">
    <div class="kp10-h"><h3>Reset Data Aplikasi</h3><p>Preview data pusat yang akan dihapus permanen dari database aktif.</p></div>
    <div class="kp10-b">${rows.map(r => `<div class="kp10-row"><span>${esc(r.label)}</span><strong>${r.count.toLocaleString("id-ID")}</strong></div>`).join("")}
      <div class="kp10-total"><span>Total dokumen</span><span>${total.toLocaleString("id-ID")}</span></div>
      <div class="kp10-protected"><strong>Tetap dipertahankan:</strong> Pengguna, Daftar Akun Login, Pengaturan Toko, Riwayat Migrasi, Firebase Authentication, dan file/checkpoint aplikasi.</div>
      <label class="kp10-label">Ketik <strong>${CONFIRM_PHRASE}</strong> untuk mengaktifkan reset.</label>
      <input id="kp10-input" class="kp10-input" autocomplete="off" spellcheck="false" placeholder="${CONFIRM_PHRASE}">
      <div id="kp10-progress" class="kp10-progress" hidden></div>
    </div>
    <div class="kp10-f"><button id="kp10-cancel" class="kp10-btn kp10-soft" type="button">Batal</button><button id="kp10-go" class="kp10-btn kp10-danger" type="button" disabled>Reset Permanen Data Aktif</button></div>
  </div>`;
  document.body.appendChild(el);
  const input = el.querySelector("#kp10-input"), go = el.querySelector("#kp10-go"), cancel = el.querySelector("#kp10-cancel"), progress = el.querySelector("#kp10-progress");
  input.oninput = () => go.disabled = input.value.trim().toUpperCase() !== CONFIRM_PHRASE;
  cancel.onclick = closeModal; el.onclick = e => { if (e.target === el) closeModal(); };
  go.onclick = () => execute(rows, { input, go, cancel, progress }); input.focus();
}

async function openPreview(button) {
  button.disabled = true; const old = button.textContent; button.textContent = "Menghitung data…";
  try { modal(await previewCounts()); }
  catch (error) { console.error(error); alert(`Preview reset gagal: ${error?.message || error}`); }
  finally { button.disabled = false; button.textContent = old; }
}

function injectCard() {
  if (!isAdmin() || document.getElementById("kp10-card")) return;
  const form = document.getElementById("store-settings-form"); if (!form) return;
  styles();
  const card = document.createElement("section"); card.id = "kp10-card"; card.className = "kp10-card";
  card.innerHTML = `<div class="kp10-top"><div><h3>Maintenance Database</h3><p>Reset seluruh Master dan data operasional untuk memulai database produksi dari kondisi kosong. Reset akan disinkronkan ke perangkat KasirPro lain melalui reset token pusat.</p></div><span class="kp10-tag">ADMIN ONLY</span></div><button id="kp10-preview" class="kp10-btn kp10-soft" type="button">Preview Data Reset</button><div class="kp10-note">Akun Admin/Kasir dan Pengaturan Toko tidak ikut dihapus. Batch delete maksimum ${BATCH_SIZE} dokumen per commit.</div>`;
  const host = form.closest(".content-card,.settings-card,.card") || form.parentElement;
  (host?.parentElement ? host : form).insertAdjacentElement("afterend", card);
  card.querySelector("#kp10-preview").onclick = e => openPreview(e.currentTarget);
}

function install() {
  if (!isAdmin()) return;
  injectCard();
  if (document.getElementById("kp10-card")) return;
  const observer = new MutationObserver(() => { injectCard(); if (document.getElementById("kp10-card")) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}
install();
