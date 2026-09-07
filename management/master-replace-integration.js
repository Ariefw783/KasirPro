/* KasirPro AT-07 — Full Replace Master integration via workbook session */
import { getMasterWorkbook } from "./master-import-session.js";
import { commitMasterReplacement, prepareMasterReplacement } from "../modules/local/master-import-replace.js";
import { readMasterSnapshot, readMasterVersion } from "../modules/local/master-repository.js";
import { showDialog } from "./management-dialog.js";

const $ = (id) => document.getElementById(id);

async function executeMasterReplace(event) {
  const button = event.target?.closest?.("#confirm-master-import");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const consent = $("kp-master-replace-consent");
  if (!consent?.checked) {
    await showDialog({ type: "warning", title: "Konfirmasi Diperlukan", message: "Centang persetujuan terlebih dahulu sebelum menyimpan Master baru.", confirmText: "Oke" });
    return;
  }

  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Menyimpan Master Baru...";

  try {
    const workbook = await getMasterWorkbook();
    const prepared = await prepareMasterReplacement(workbook);
    if (!prepared.validation.canContinue) {
      const list = (prepared.validation.issues || []).slice(0, 12);
      await showDialog({ type: "warning", title: "Master Belum Dapat Disimpan", message: list.join("\n"), confirmText: "Perbaiki File" });
      return;
    }

    const result = await commitMasterReplacement(workbook);
    const snapshot = await readMasterSnapshot();
    const version = await readMasterVersion();

    const resultText = $("master-import-result-text");
    if (resultText) resultText.textContent = `Master Aktif v${version} telah diganti dengan isi file terbaru: ${snapshot.produk.length} produk, ${snapshot.supplier.length} supplier, ${snapshot.kategori.length} kategori.`;
    const resultBox = $("master-import-result");
    if (resultBox) resultBox.hidden = false;

    window.dispatchEvent(new CustomEvent("kasirpro:local-master-updated", {
      detail: { version, products: snapshot.produk.length, suppliers: snapshot.supplier.length, categories: snapshot.kategori.length, replacement: true, publish: result.publish }
    }));

    await showDialog({
      type: "success",
      title: "Master Baru Berhasil Disimpan",
      message: `Master v${version}\n${snapshot.produk.length} produk • ${snapshot.supplier.length} supplier • ${snapshot.kategori.length} kategori\n\nData transaksi, faktur, Mutasi Stok, dan Stock Opname tetap dipertahankan.`,
      confirmText: "Selesai"
    });

    window.dispatchEvent(new CustomEvent("kasirpro:master-import-reset"));
  } catch (error) {
    console.error("Full Replace Master gagal:", error);
    await showDialog({ type: "error", title: "Master Gagal Disimpan", message: error?.message || String(error), confirmText: "Oke" });
  } finally {
    const consentNow = $("kp-master-replace-consent");
    button.disabled = !consentNow?.checked;
    button.textContent = oldLabel || "Simpan Master Baru";
  }
}

document.addEventListener("click", executeMasterReplace, true);

window.KasirProLocalMaster = Object.freeze({ readSnapshot: readMasterSnapshot, readVersion: readMasterVersion });
