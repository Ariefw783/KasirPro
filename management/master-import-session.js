/* KasirPro AT-07 — Master Import File Session
 * File fisik dibaca maksimal satu kali per pilihan file. Semua tahap berikutnya
 * memakai ArrayBuffer/workbook yang sudah berada di memori.
 */
import { readExcelWorkbook } from "../modules/excel/excel-import.js";

let activeFile = null;
let workbookPromise = null;
let activeWorkbook = null;

function wrapReadOnce(file) {
  if (!file || file.__kasirproReadOnce) return file;
  try {
    const original = file.arrayBuffer.bind(file);
    let bufferPromise = null;
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => {
        if (!bufferPromise) bufferPromise = original();
        const buffer = await bufferPromise;
        return buffer.slice(0);
      }
    });
    Object.defineProperty(file, "__kasirproReadOnce", { configurable: true, value: true });
  } catch (error) {
    console.warn("KasirPro AT-07: file object tidak dapat dibungkus read-once.", error);
  }
  return file;
}

export function setMasterFile(file) {
  if (activeFile === file && file) return file;
  activeFile = file ? wrapReadOnce(file) : null;
  workbookPromise = null;
  activeWorkbook = null;
  return activeFile;
}

export function getMasterFile() {
  const selected = document.getElementById("master-file-input")?.files?.[0] || null;
  if (selected && selected !== activeFile) setMasterFile(selected);
  return activeFile;
}

export async function getMasterWorkbook() {
  const file = getMasterFile();
  if (!file) throw new Error("File Master Excel belum dipilih.");
  if (activeWorkbook) return activeWorkbook;
  if (!workbookPromise) {
    workbookPromise = readExcelWorkbook(file).then((workbook) => {
      activeWorkbook = workbook;
      return workbook;
    }).catch((error) => {
      workbookPromise = null;
      throw error;
    });
  }
  return workbookPromise;
}

export function resetMasterSession() {
  activeFile = null;
  workbookPromise = null;
  activeWorkbook = null;
}

function bindInput() {
  const input = document.getElementById("master-file-input");
  if (!input || input.dataset.kpSessionBound === "1") return;
  input.dataset.kpSessionBound = "1";
  input.addEventListener("change", () => setMasterFile(input.files?.[0] || null), true);

  const readButton = document.getElementById("read-master-file");
  readButton?.addEventListener("click", () => {
    const file = input.files?.[0];
    if (!file) return;
    setMasterFile(file);
    // Mulai pembacaan ketika pengguna menekan Baca File. Core lama dapat membaca
    // bersamaan, tetapi keduanya memakai Promise ArrayBuffer yang sama.
    getMasterWorkbook().catch(() => {});
  }, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindInput, { once: true });
else bindInput();

window.KasirProMasterImportSession = Object.freeze({ getMasterFile, getMasterWorkbook, resetMasterSession });
