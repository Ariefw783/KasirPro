/* KasirPro AT-07 — Step 3 Validation memakai workbook session */
import { getMasterWorkbook } from "./master-import-session.js";
import { prepareMasterReplacement } from "../modules/local/master-import-replace.js";
import { showDialog } from "./management-dialog.js";
import { goToMasterStep } from "./master-import-wizard.js";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
let checking = false;

function setText(element, value) {
  if (!element || String(element.textContent ?? "") === value) return;
  element.textContent = value;
}

function refreshLanguage() {
  const button = $("continue-master-confirm");
  if (button && !checking) {
    button.disabled = false;
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");
    setText(button, "Lanjut ke Simpan Master");
  }
  const root = $("master-warning-body")?.closest("section,div")?.parentElement || document;
  root.querySelectorAll("p,small,span,strong,h2,h3,h4,th,td").forEach((el) => {
    const value = norm(el.textContent);
    if (value === "pemeriksaan data") setText(el, "Periksa Data");
    else if (value === "warning tidak otomatis membatalkan proses import.") setText(el, "Informasi tidak menghalangi penyimpanan Master.");
    else if (value === "total peringatan") setText(el, "Total Informasi");
    else if (value === "data parsial") setText(el, "Kolom Opsional Kosong");
    else if (value === "peringatan") setText(el, "Informasi");
    else if (value === "validasi") setText(el, "Periksa Data");
    else if (value === "terdapat kolom kosong. data tetap dapat diproses.") setText(el, "Beberapa kolom opsional belum diisi. File tetap dapat digunakan.");
  });
}

async function handleContinue(event) {
  const button = event.target?.closest?.("#continue-master-confirm");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (checking) return;

  checking = true;
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  setText(button, "Memeriksa file...");

  try {
    const workbook = await getMasterWorkbook();
    const prepared = await prepareMasterReplacement(workbook);
    if (!prepared.validation.canContinue) {
      const issues = prepared.validation.issues || [];
      const shown = issues.slice(0, 10);
      if (issues.length > 10) shown.push(`Dan ${issues.length - 10} masalah lainnya.`);
      await showDialog({
        type: "warning",
        title: "Data Wajib Belum Lengkap",
        message: shown.join("\n"),
        confirmText: "Perbaiki File"
      });
      return;
    }
    goToMasterStep(4);
  } catch (error) {
    console.error("AT-07 validasi Step 3 gagal:", error);
    await showDialog({
      type: "error",
      title: "File Excel Tidak Dapat Dibaca",
      message: `${error?.message || error}\n\nRak, Batch, Tanggal Expired, dan Satuan boleh dikosongkan. Jika file berasal dari penyimpanan ponsel, pilih kembali file lalu coba lagi.`,
      confirmText: "Oke"
    });
  } finally {
    checking = false;
    refreshLanguage();
  }
}

document.addEventListener("click", handleContinue, true);

function install() {
  refreshLanguage();
  const button = $("continue-master-confirm");
  if (button) {
    new MutationObserver(refreshLanguage).observe(button, { attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
  }
  const body = $("master-warning-body");
  if (body) new MutationObserver(refreshLanguage).observe(body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
