/* KasirPro Management bootstrap — AT-07 Import Master Wizard */
const bootErrors = [];
window.__kasirproManagementBootErrors = bootErrors;

async function loadModule(path, label, required = false) {
  try {
    return await import(path);
  } catch (error) {
    console.error(`[KasirPro Management] Gagal memuat ${label}:`, error);
    bootErrors.push({ label, path, message: error?.message || String(error) });
    if (required) {
      const banner = document.createElement("div");
      banner.setAttribute("role", "alert");
      banner.style.cssText = "position:fixed;left:16px;right:16px;top:16px;z-index:99999;padding:12px 14px;border-radius:10px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;font:600 13px/1.45 system-ui,sans-serif";
      banner.textContent = `Management gagal dimuat pada modul ${label}. Muat ulang halaman.`;
      document.body?.appendChild(banner);
    }
    return null;
  }
}

const core = await loadModule("./management-core.js", "Core Management", true);

if (core) {
  const dialog = await loadModule("./management-dialog.js", "Dialog Management");
  dialog?.installManagementAlertBridge?.();

  await loadModule("./master-import-session.js", "Master File Session");
  await loadModule("./master-import-wizard.js", "Import Master Wizard");
  await loadModule("./master-replace-integration.js", "Master Full Replacement");
  await loadModule("./master-export-local.js", "Export Master Aktif");
  await loadModule("./invoice-operational-v2.js", "Faktur Pembelian V2");
  await loadModule("./stock-opname-v2.js", "Stock Opname V2");
  await loadModule("./master-import-ux-v3.js", "UX Import Master");
  await loadModule("./master-step3-validation-v4.js", "Validasi Step 3 Import Master");
}
