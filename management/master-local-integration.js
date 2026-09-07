/* KasirPro Management - Integrasi Import Master ke IndexedDB
 * Menangkap commit Import Master sebelum handler legacy menulis ke database-store.
 * IndexedDB-first: Master disimpan lokal; repository menangani antre/publish Master Snapshot pusat.
 */

import { readExcelWorkbook } from "../modules/excel/excel-import.js";
import {
    prepareLocalMasterImport,
    commitLocalMasterImport
} from "../modules/local/master-import-local.js";
import { readMasterSnapshot, readMasterVersion } from "../modules/local/master-repository.js";

function $(id) {
    return document.getElementById(id);
}

function selectedMode() {
    const value = document.querySelector('input[name="existingDataMode"]:checked')?.value;
    return value === "skip" ? "skip" : "update";
}

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value ?? 0);
}

function showValidationError(prepared) {
    const header = prepared.validation.headerErrors || [];
    const supplier = prepared.validation.supplierIssues || [];
    const required = prepared.validation.requiredFieldIssues || [];
    const messages = [
        ...header.map(item => item.message || `Masalah struktur pada ${item.sheet || "workbook"}.`),
        ...required.slice(0, 8).map(item => `Baris ${item.sourceRow || "-"}: ${item.message}`),
        ...supplier.slice(0, 8).map(item => `Baris ${item.sourceRow || "-"}: ${item.message}`)
    ];

    if (required.length > 8) messages.push(`Dan ${required.length - 8} masalah field wajib lainnya.`);
    if (supplier.length > 8) messages.push(`Dan ${supplier.length - 8} masalah supplier lainnya.`);
    if (!messages.length) messages.push("Workbook belum memenuhi kontrak Import Master KasirPro.");

    alert(`Import Master belum dapat disimpan:\n\n${messages.join("\n")}`);
}

async function executeLocalImport(event) {
    const button = event.target.closest("#confirm-master-import");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const file = $("master-file-input")?.files?.[0];
    if (!file) {
        alert("Pilih file Master Excel terlebih dahulu.");
        return;
    }

    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Menyimpan Master Lokal...";

    try {
        const workbook = await readExcelWorkbook(file);
        const prepared = await prepareLocalMasterImport(workbook);
        if (!prepared.validation.canContinue) {
            showValidationError(prepared);
            return;
        }

        const result = await commitLocalMasterImport(workbook, { mode: selectedMode() });
        const snapshot = await readMasterSnapshot();
        const version = await readMasterVersion();

        setText("result-added-count", result.added || 0);
        setText("result-updated-count", result.updated || 0);
        setText("result-skipped-count", result.skipped || 0);
        setText("result-review-count", result.review || 0);

        const resultText = $("master-import-result-text");
        if (resultText) {
            resultText.textContent = `Master Aktif v${version} tersimpan di IndexedDB: ${snapshot.produk.length} produk, ${snapshot.supplier.length} supplier, ${snapshot.kategori.length} kategori.`;
        }

        const resultBox = $("master-import-result");
        if (resultBox) resultBox.hidden = false;

        window.dispatchEvent(new CustomEvent("kasirpro:local-master-updated", {
            detail: {
                version,
                products: snapshot.produk.length,
                suppliers: snapshot.supplier.length,
                categories: snapshot.kategori.length
            }
        }));

        alert(
            `Import Master selesai.\n` +
            `Master Aktif v${version}\n` +
            `Produk: ${snapshot.produk.length}\n` +
            `Supplier: ${snapshot.supplier.length}\n` +
            `Kategori: ${snapshot.kategori.length}\n\n` +
            `Master tersimpan di perangkat ini. Snapshot pusat akan dipublish ke Firestore atau tetap diantrekan sesuai koneksi, kuota, dan hak akses.`
        );
    } catch (error) {
        console.error("Import Master IndexedDB gagal:", error);
        alert(`Import Master gagal: ${error?.message || error}`);
    } finally {
        button.disabled = false;
        button.textContent = previousLabel || "Import Sekarang";
    }
}

document.addEventListener("click", executeLocalImport, true);

window.KasirProLocalMaster = Object.freeze({
    readSnapshot: readMasterSnapshot,
    readVersion: readMasterVersion
});
