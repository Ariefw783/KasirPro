/* KasirPro AT-10 — Admin Factory Reset & Database Maintenance
 * Admin-only UI. Tidak menghapus Pengguna, DaftarAkunLogin, PengaturanToko, atau RiwayatMigrasi.
 */
import { firebaseDb } from "../modules/database/firebase-client.js";
import { collectionSegments } from "../modules/database/database-paths.js";
import { signOutKasirPro } from "../modules/database/auth.js";
import { clearKasirProLocalMaster } from "../modules/local/indexeddb-store.js";
import { clearOperationalCache } from "../modules/local/operational-indexeddb.js";
import {
  collection,
  doc,
  getCountFromServer,
  getDocsFromServer,
  limit,
  query,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const SESSION_KEY = "kasirpro_session";
const CONFIRM_PHRASE = "RESET KASIRPRO";
const DELETE_BATCH_SIZE = 400;

const RESET_COLLECTIONS = Object.freeze([
  { key: "purchaseInvoices", label: "Faktur Pembelian" },
  { key: "sales", label: "Transaksi Penjualan" },
  { key: "stockMovements", label: "Mutasi Stok" },
  { key: "stockOpnames", label: "Stock Opname" },
  { key: "masterSnapshots", label: "Master Snapshot" },
  { key: "masterSnapshotChunks", label: "Master Snapshot Chunks" },
  { key: "products", label: "Produk" },
  { key: "categories", label: "Kategori" },
  { key: "suppliers", label: "Supplier" }
]);

function currentSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function isAdminSession() {
  return String(currentSession()?.role || "").toLowerCase() === "admin";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function ensureStyles() {
  if (document.getElementById("kp-at10-maintenance-style")) return;
  const style = document.createElement("style");
  style.id = "kp-at10-maintenance-style";
  style.textContent = `
    .kp-at10-card{margin-top:18px;border:1px solid #fecaca;border-radius:16px;background:#fff;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
    .kp-at10-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
    .kp-at10-head h3{margin:0;color:#991b1b;font-size:17px}.kp-at10-head p{margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.55;max-width:720px}
    .kp-at10-badge{font-size:11px;font-weight:800;letter-spacing:.04em;padding:5px 9px;border-radius:999px;background:#fee2e2;color:#991b1b}
    .kp-at10-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
    .kp-at10-btn{border:0;border-radius:10px;padding:10px 14px;font:700 13px system-ui;cursor:pointer}.kp-at10-btn:disabled{opacity:.55;cursor:not-allowed}
    .kp-at10-preview{background:#f1f5f9;color:#0f172a}.kp-at10-danger{background:#b91c1c;color:white}
    .kp-at10-note{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;line-height:1.5}
    .kp-at10-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:18px}
    .kp-at10-modal{width:min(620px,100%);max-height:92vh;overflow:auto;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.28)}
    .kp-at10-modal-head{padding:18px 20px;border-bottom:1px solid #e2e8f0}.kp-at10-modal-head h3{margin:0;color:#991b1b}.kp-at10-modal-head p{margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.5}
    .kp-at10-modal-body{padding:18px 20px}.kp-at10-counts{display:grid;gap:7px}.kp-at10-count-row{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:9px;background:#f8fafc;font-size:13px}.kp-at10-count-row strong{font-variant-numeric:tabular-nums}
    .kp-at10-total{margin-top:10px;padding:11px 12px;border-radius:10px;background:#fff1f2;color:#9f1239;font-weight:800;display:flex;justify-content:space-between}
    .kp-at10-protected{margin-top:14px;padding:11px 12px;border-radius:10px;background:#ecfdf5;color:#166534;font-size:12px;line-height:1.5}
    .kp-at10-confirm-label{display:block;margin-top:16px;font-weight:700;font-size:13px;color:#334155}.kp-at10-confirm-input{width:100%;box-sizing:border-box;margin-top:7px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font:600 14px system-ui;text-transform:uppercase}
    .kp-at10-progress{margin-top:14px;padding:11px 12px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:12px;line-height:1.5}
    .kp-at10-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px 18px;border-top:1px solid #e2e8f0}
    @media(max-width:640px){.kp-at10-modal-foot{flex-direction:column-reverse}.kp-at10-modal-foot .kp-at10-btn{width:100%}}
  `;
  document.head.appendChild(style);
}

async function countResettableDocuments() {
  const rows = [];
  for (const item of RESET_COLLECTIONS) {
    const ref = collection(firebaseDb, ...collectionSegments(item.key));
    const snap = await getCountFromServer(ref);
    rows.push({ ...item, count: Number(snap.data()?.count) || 0 });
  }
  return rows;
}

async function deleteCollectionInBatches(collectionKey, onProgress) {
  const ref = collection(firebaseDb, ...collectionSegments(collectionKey));
  let deleted = 0;
  while (true) {
    const snap = await getDocsFromServer(query(ref, limit(DELETE_BATCH_SIZE)));
    if (snap.empty) break;
    const batch = writeBatch(firebaseDb);
    snap.docs.forEach(item => batch.delete(doc(firebaseDb, ...collectionSegments(collectionKey), item.id)));
    await batch.commit();
    deleted += snap.size;
    onProgress?.(deleted);
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

function removeOverlay() {
  document.getElementById("kp-at10-overlay")?.remove();
}

function renderPreviewModal(rows) {
  removeOverlay();
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const overlay = document.createElement("div");
  overlay.id = "kp-at10-overlay";
  overlay.className = "kp-at10-overlay";
  overlay.innerHTML = `
    <div class="kp-at10-modal" role="dialog" aria-modal="true" aria-labelledby="kp-at10-title">
      <div class="kp-at10-modal-head">
        <h3 id="kp-at10-title">Reset Data Aplikasi</h3>
        <p>Tindakan ini menghapus data Master dan operasional aktif dari Firestore serta cache lokal perangkat ini.</p>
      </div>
      <div class="kp-at10-modal-body">
        <div class="kp-at10-counts">
          ${rows.map(row => `<div class="kp-at10-count-row"><span>${escapeHtml(row.label)}</span><strong>${row.count.toLocaleString("id-ID")}</strong></div>`).join("")}
        </div>
        <div class="kp-at10-total"><span>Total dokumen yang akan dihapus</span><span>${total.toLocaleString("id-ID")}</span></div>
        <div class="kp-at10-protected"><strong>Tetap dipertahankan:</strong> Pengguna, Daftar Akun Login, Pengaturan Toko, Riwayat Migrasi, Firebase Authentication, dan seluruh file/checkpoint aplikasi.</div>
        <label class="kp-at10-confirm-label">Ketik <strong>${CONFIRM_PHRASE}</strong> untuk membuka tombol reset.</label>
        <input id="kp-at10-confirm-input" class="kp-at10-confirm-input" autocomplete="off" spellcheck="false" placeholder="${CONFIRM_PHRASE}">
        <div id="kp-at10-progress" class="kp-at10-progress" hidden></div>
      </div>
      <div class="kp-at10-modal-foot">
        <button id="kp-at10-cancel" class="kp-at10-btn kp-at10-preview" type="button">Batal</button>
        <button id="kp-at10-execute" class="kp-at10-btn kp-at10-danger" type="button" disabled>Reset Permanen Data Aktif</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#kp-at10-confirm-input");
  const execute = overlay.querySelector("#kp-at10-execute");
  const cancel = overlay.querySelector("#kp-at10-cancel");
  input.addEventListener("input", () => {
    execute.disabled = input.value.trim().toUpperCase() !== CONFIRM_PHRASE;
  });
  cancel.addEventListener("click", removeOverlay);
  overlay.addEventListener("click", event => { if (event.target === overlay) removeOverlay(); });
  execute.addEventListener("click", () => executeFactoryReset(rows, { overlay, execute, cancel, input }));
  input.focus();
}

async function executeFactoryReset(rows, ui) {
  if (!isAdminSession()) {
    alert("Factory Reset hanya dapat dijalankan oleh Administrator.");
    return;
  }
  if (ui.input.value.trim().toUpperCase() !== CONFIRM_PHRASE) return;

  const progress = ui.overlay.querySelector("#kp-at10-progress");
  ui.execute.disabled = true;
  ui.cancel.disabled = true;
  ui.input.disabled = true;
  progress.hidden = false;

  const report = [];
  try {
    for (let i = 0; i < RESET_COLLECTIONS.length; i++) {
      const item = RESET_COLLECTIONS[i];
      progress.textContent = `Menghapus ${item.label} (${i + 1}/${RESET_COLLECTIONS.length})…`;
      const deleted = await deleteCollectionInBatches(item.key, count => {
        progress.textContent = `Menghapus ${item.label}: ${count.toLocaleString("id-ID")} dokumen…`;
      });
      report.push({ ...item, deleted });
    }

    progress.textContent = "Membersihkan cache Master dan operasional pada perangkat ini…";
    await clearOperationalCache();
    await clearKasirProLocalMaster();

    try {
      localStorage.removeItem("kasirpro_master_store_v1");
      localStorage.removeItem("kasirpro_purchase_invoices_v1");
      localStorage.removeItem("kasirpro_sales_v1");
      localStorage.removeItem("kasirpro_stock_movements_v1");
      localStorage.removeItem("kasirpro_stock_opname_v1");
      sessionStorage.removeItem("kasirpro_preload_session_v1");
    } catch {}

    window.__kasirproAT10LastResetReport = {
      completedAt: new Date().toISOString(),
      rows: report,
      protectedCollections: ["Pengguna", "DaftarAkunLogin", "PengaturanToko", "RiwayatMigrasi"]
    };

    progress.textContent = "Reset selesai. Keluar dari sesi Administrator…";
    await signOutKasirPro();
    sessionStorage.removeItem(SESSION_KEY);
    await new Promise(resolve => setTimeout(resolve, 600));
    location.replace("../index.html?reset=completed");
  } catch (error) {
    console.error("AT-10 Factory Reset gagal:", error);
    progress.textContent = `Reset berhenti: ${error?.message || String(error)}. Data yang sudah terhapus tidak dipulihkan otomatis. Jalankan Preview lagi untuk melihat sisa data.`;
    ui.cancel.disabled = false;
    ui.cancel.textContent = "Tutup";
  }
}

async function openPreview(button) {
  if (!isAdminSession()) return;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "Menghitung data…";
  try {
    const rows = await countResettableDocuments();
    renderPreviewModal(rows);
  } catch (error) {
    console.error("Preview Factory Reset gagal:", error);
    alert(`Tidak dapat menghitung data reset: ${error?.message || error}`);
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function buildMaintenanceCard() {
  if (!isAdminSession() || document.getElementById("kp-at10-maintenance-card")) return;
  const form = document.getElementById("store-settings-form");
  if (!form) return;
  ensureStyles();

  const card = document.createElement("section");
  card.id = "kp-at10-maintenance-card";
  card.className = "kp-at10-card";
  card.innerHTML = `
    <div class="kp-at10-head">
      <div>
        <h3>Maintenance Database</h3>
        <p>Reset Master dan seluruh data operasional untuk memulai database produksi dari kondisi kosong. Akun pengguna dan Pengaturan Toko tidak ikut dihapus.</p>
      </div>
      <span class="kp-at10-badge">ADMIN ONLY</span>
    </div>
    <div class="kp-at10-actions">
      <button id="kp-at10-preview-reset" class="kp-at10-btn kp-at10-preview" type="button">Preview Data Reset</button>
    </div>
    <div class="kp-at10-note">Reset menggunakan batch maksimal ${DELETE_BATCH_SIZE} dokumen. Tombol eksekusi baru aktif setelah Admin mengetik frasa konfirmasi yang benar.</div>`;

  const host = form.closest(".content-card, .settings-card, .card") || form.parentElement;
  if (host?.parentElement) host.insertAdjacentElement("afterend", card);
  else form.insertAdjacentElement("afterend", card);

  card.querySelector("#kp-at10-preview-reset")?.addEventListener("click", event => openPreview(event.currentTarget));
}

function install() {
  if (!isAdminSession()) return;
  buildMaintenanceCard();
  if (document.getElementById("kp-at10-maintenance-card")) return;
  const observer = new MutationObserver(() => {
    buildMaintenanceCard();
    if (document.getElementById("kp-at10-maintenance-card")) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
}

install();
