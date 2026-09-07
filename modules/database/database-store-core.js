import {
    collection,
    doc,
    getDocFromServer,
    getDocsFromServer,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseDb } from "./firebase-client.js";
import {
    collectionSegments,
    documentSegments,
    readableDocumentId
} from "./database-paths.js";
import { waitForFirebaseUser } from "./auth.js";

export const STORE_KEYS = Object.freeze({
    master: "kasirpro_master_store_v1",
    invoices: "kasirpro_purchase_invoices_v1",
    movements: "kasirpro_stock_movements_v1",
    opnames: "kasirpro_stock_opname_v1",
    sales: "kasirpro_sales_v1"
});

const state = new Map();
const fingerprints = new Map();
let initializationPromise = null;
let remoteEnabled = false;
let syncQueue = Promise.resolve();
let activeFirestoreReads = 0;
const BATCH_SIZE = 400;
const LEGACY_PRELOAD_SESSION_KEY = "kasirpro_preload_session_v1";
const FIRESTORE_READ_TIMEOUT_MS = 20000;
let preloadProgress = { loaded: 0, total: 0 };

function withTimeout(promise, message, timeoutMs = FIRESTORE_READ_TIMEOUT_MS) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = window.setTimeout(() => {
            reject(new Error(`${message} melewati batas waktu ${Math.round(timeoutMs / 1000)} detik.`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function resetPreloadProgress(total) {
    preloadProgress = { loaded: 0, total: Math.max(0, Number(total) || 0) };
}

function reportPreloadProgress(message, collectionKey, status = "success") {
    preloadProgress.loaded = Math.min(preloadProgress.total, preloadProgress.loaded + 1);
    const percent = preloadProgress.total
        ? Math.round((preloadProgress.loaded / preloadProgress.total) * 100)
        : null;
    window.dispatchEvent(new CustomEvent("kasirpro:database-preload-progress", {
        detail: {
            loaded: preloadProgress.loaded,
            total: preloadProgress.total,
            percent,
            message,
            collection: collectionKey,
            status
        }
    }));
}

function pageMode() {
    const path = location.pathname.toLowerCase();
    if (path.includes("/management/")) return "management";
    if (path.includes("/pos/")) return "pos";
    return "login";
}

function clone(value) {
    if (value === undefined) return undefined;
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function beginFirestoreRead(message = "Mengambil data langsung dari Firestore\u2026") {
    activeFirestoreReads++;
    window.dispatchEvent(new CustomEvent("kasirpro:database-loading", {
        detail: { message, activeReads: activeFirestoreReads }
    }));
}

function endFirestoreRead() {
    activeFirestoreReads = Math.max(0, activeFirestoreReads - 1);
    if (!activeFirestoreReads) window.dispatchEvent(new CustomEvent("kasirpro:database-idle"));
}

function clearLegacyDataCache() {
    try {
        Object.values(STORE_KEYS).forEach((key) => localStorage.removeItem(key));
        sessionStorage.removeItem(LEGACY_PRELOAD_SESSION_KEY);
    } catch (error) {
        console.warn("Cache data lama KasirPro tidak dapat dibersihkan:", error);
    }
}

function withoutPassword(record) {
    const clean = { ...record };
    delete clean["Password Awal"];
    delete clean.password;
    return clean;
}

function recordIdentity(collectionKey, record) {
    const rules = {
        products: ["Kode Produk", "Nama Produk"],
        categories: ["Kode Kategori", "Nama Kategori"],
        suppliers: ["Kode Supplier", "Nama Supplier"],
        storeSettings: ["Nama Toko"],
        purchaseInvoices: ["number", "id"],
        sales: ["number", "id"],
        stockMovements: ["reference", "productCode", "at"],
        stockOpnames: ["id", "at"],
        loginDirectory: ["Username", "username", "ID Pengguna", "Nama"]
    };
    return (rules[collectionKey] || []).map((field) => record?.[field]).filter(Boolean).join("-");
}

function recordPrefix(collectionKey) {
    return {
        products: "produk",
        categories: "kategori",
        suppliers: "supplier",
        storeSettings: "profil-toko",
        purchaseInvoices: "faktur",
        sales: "penjualan",
        stockMovements: "mutasi",
        stockOpnames: "opname",
        loginDirectory: "akun"
    }[collectionKey];
}

function docId(collectionKey, record) {
    if (collectionKey === "storeSettings") return "profil-toko-utama";
    return readableDocumentId(recordPrefix(collectionKey), recordIdentity(collectionKey, record));
}

function cleanForFirestore(record) {
    const clean = clone(record) || {};
    delete clean._firestoreDocumentId;
    Object.keys(clean).forEach((key) => key.startsWith("_local") && delete clean[key]);
    Object.keys(clean).forEach((key) => clean[key] === undefined && delete clean[key]);
    return clean;
}

function recordsForStore(key, value) {
    if (key === STORE_KEYS.master) {
        const master = value || {};
        return {
            products: Array.isArray(master.produk) ? master.produk : [],
            suppliers: Array.isArray(master.supplier) ? master.supplier : [],
            categories: Array.isArray(master.kategori) ? master.kategori : [],
            loginDirectory: (Array.isArray(master.pengguna) ? master.pengguna : []).map(withoutPassword),
            storeSettings: Array.isArray(master.pengaturan_toko) ? master.pengaturan_toko : []
        };
    }
    if (key === STORE_KEYS.invoices) return { purchaseInvoices: Array.isArray(value) ? value : [] };
    if (key === STORE_KEYS.movements) return { stockMovements: Array.isArray(value) ? value : [] };
    if (key === STORE_KEYS.opnames) return { stockOpnames: Array.isArray(value) ? value : [] };
    if (key === STORE_KEYS.sales) return { sales: Array.isArray(value) ? value : [] };
    throw new Error(`Penyimpanan KasirPro tidak dikenal: ${key}`);
}

function fingerprint(value) { return JSON.stringify(value); }

async function readCollectionFromServer(collectionKey, message) {
    const label = message || `Membaca ${collectionKey} dari Firestore\u2026`;
    beginFirestoreRead(label);
    let status = "success";
    try {
        const request = getDocsFromServer(collection(firebaseDb, ...collectionSegments(collectionKey)));
        const snapshot = await withTimeout(request, label);
        return snapshot.docs.map((item) => {
            const data = item.data();
            fingerprints.set(`${collectionKey}/${item.id}`, fingerprint(data));
            return { ...data, _firestoreDocumentId: item.id };
        });
    } catch (error) {
        status = "error";
        throw new Error(`${label} gagal: ${error?.message || error}`, { cause: error });
    } finally {
        reportPreloadProgress(label, collectionKey, status);
        endFirestoreRead();
    }
}

async function readCurrentProfileFromServer(user) {
    if (!user?.uid) throw new Error("Sesi Firebase belum tersedia. Silakan login kembali.");
    beginFirestoreRead("Memeriksa profil pengguna\u2026");
    try {
        const snapshot = await withTimeout(
            getDocFromServer(doc(firebaseDb, ...documentSegments("users", user.uid))),
            "Memeriksa profil pengguna"
        );
        if (!snapshot.exists()) throw new Error("Profil pengguna Firebase tidak ditemukan.");
        return snapshot.data();
    } finally { endFirestoreRead(); }
}

function applyRuntimeSnapshot(snapshot) {
    Object.entries(snapshot).forEach(([key, value]) => state.set(key, clone(value)));
}

async function loadPageSnapshot(mode, isAdmin) {
    if (mode === "login") return {};

    const totalCollections = mode === "pos" ? 4 : (isAdmin ? 10 : 9);
    resetPreloadProgress(totalCollections);
    window.dispatchEvent(new CustomEvent("kasirpro:database-preload-start", {
        detail: {
            message: mode === "pos" ? "Menyiapkan produk POS\u2026" : "Menyiapkan data Management\u2026",
            total: totalCollections
        }
    }));

    if (mode === "pos") {
        const [products, storeSettings, sales, movements] = await Promise.all([
            readCollectionFromServer("products", "Memuat produk POS\u2026"),
            readCollectionFromServer("storeSettings", "Memuat pengaturan toko\u2026"),
            readCollectionFromServer("sales", "Memuat riwayat transaksi\u2026"),
            readCollectionFromServer("stockMovements", "Memuat mutasi stok\u2026")
        ]);
        return {
            [STORE_KEYS.master]: { produk: products, kategori: [], supplier: [], pengguna: [], pengaturan_toko: storeSettings },
            [STORE_KEYS.sales]: sales,
            [STORE_KEYS.movements]: movements,
            [STORE_KEYS.invoices]: [],
            [STORE_KEYS.opnames]: []
        };
    }

    const reads = [
        readCollectionFromServer("products", "Memuat master produk\u2026"),
        readCollectionFromServer("categories", "Memuat kategori\u2026"),
        readCollectionFromServer("suppliers", "Memuat supplier\u2026"),
        readCollectionFromServer("loginDirectory", "Memuat direktori akun\u2026"),
        readCollectionFromServer("storeSettings", "Memuat pengaturan toko\u2026"),
        readCollectionFromServer("purchaseInvoices", "Memuat faktur pembelian\u2026"),
        readCollectionFromServer("sales", "Memuat transaksi penjualan\u2026"),
        readCollectionFromServer("stockMovements", "Memuat mutasi stok\u2026"),
        readCollectionFromServer("stockOpnames", "Memuat stock opname\u2026"),
        isAdmin ? readCollectionFromServer("users", "Memuat pengguna\u2026") : Promise.resolve([])
    ];

    const [products, categories, suppliers, loginDirectory, storeSettings, invoices, sales, movements, opnames, userProfiles] = await Promise.all(reads);
    const pengguna = isAdmin ? userProfiles.map((profile) => ({
        "ID Pengguna": profile._firestoreDocumentId,
        "Nama": profile.name || profile.username,
        "Role": String(profile.role || "").toLowerCase() === "cashier" ? "Kasir" : "Admin",
        "Username": profile.username,
        "Status": profile.status,
        "Email": profile.authEmail || profile.email || "",
        "Nomor Telepon": profile.phone || "",
        "Catatan": "Akun Firebase aktif",
        _firestoreDocumentId: profile._firestoreDocumentId
    })) : loginDirectory;

    return {
        [STORE_KEYS.master]: { produk: products, kategori: categories, supplier: suppliers, pengguna, pengaturan_toko: storeSettings },
        [STORE_KEYS.invoices]: invoices,
        [STORE_KEYS.sales]: sales,
        [STORE_KEYS.movements]: movements,
        [STORE_KEYS.opnames]: opnames
    };
}

async function commitChanges(groups) {
    const changes = [];
    for (const [collectionKey, records] of Object.entries(groups)) {
        for (const record of Array.isArray(records) ? records : []) {
            const clean = cleanForFirestore(record);
            const id = record._firestoreDocumentId || docId(collectionKey, clean);
            const key = `${collectionKey}/${id}`;
            const nextFingerprint = fingerprint(clean);
            if (fingerprints.get(key) !== nextFingerprint) changes.push({ collectionKey, id, clean, key, nextFingerprint });
        }
    }

    const totalRecords = changes.length;
    const totalBatches = Math.ceil(totalRecords / BATCH_SIZE);
    window.dispatchEvent(new CustomEvent("kasirpro:database-sync-start", {
        detail: { message: "Mengirim perubahan ke Firestore\u2026", totalRecords, totalBatches }
    }));

    for (let index = 0; index < totalRecords; index += BATCH_SIZE) {
        const chunk = changes.slice(index, index + BATCH_SIZE);
        const batch = writeBatch(firebaseDb);
        chunk.forEach((change) => batch.set(
            doc(firebaseDb, ...documentSegments(change.collectionKey, change.id)),
            change.clean,
            { merge: true }
        ));
        await batch.commit();
        chunk.forEach((change) => fingerprints.set(change.key, change.nextFingerprint));
        const completedRecords = Math.min(index + chunk.length, totalRecords);
        window.dispatchEvent(new CustomEvent("kasirpro:database-sync-progress", {
            detail: {
                phase: "write",
                currentBatch: Math.floor(index / BATCH_SIZE) + 1,
                totalBatches,
                completedRecords,
                totalRecords,
                percent: totalRecords ? Math.round((completedRecords / totalRecords) * 100) : 100
            }
        }));
    }
    return { mode: "firebase-server", totalRecords, totalBatches };
}

function norm(value) { return String(value ?? "").trim().toLowerCase(); }

function businessKey(collectionKey, record) {
    if (collectionKey === "products") return norm(record?.["Kode Produk"] || record?.["Nama Produk"]);
    if (collectionKey === "suppliers") return norm(record?.["Kode Supplier"] || record?.["Nama Supplier"]);
    if (collectionKey === "categories") return norm(record?.["Kode Kategori"] || record?.["Nama Kategori"]);
    return "";
}

function installReplaceAllImportMode() {
    if (pageMode() !== "management") return;
    const install = () => {
        const radios = [...document.querySelectorAll('input[name="existingDataMode"]')];
        if (!radios.length || document.querySelector('[data-kp-replace-master="true"]')) return;
        const source = radios[radios.length - 1];
        const sourceLabel = source.closest("label") || source.parentElement;
        if (!sourceLabel?.parentElement) return;

        const cloneNode = sourceLabel.cloneNode(true);
        const input = cloneNode.querySelector('input[name="existingDataMode"]');
        if (!input) return;
        input.checked = false;
        input.value = "update";
        input.dataset.kpReplaceMaster = "true";
        input.removeAttribute("id");

        const walker = document.createTreeWalker(cloneNode, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let titleChanged = false;
        let descriptionChanged = false;
        nodes.forEach((node) => {
            const text = node.nodeValue || "";
            if (!titleChanged && /Lewati Data Lama|Perbarui Data Lama/i.test(text)) {
                node.nodeValue = text.replace(/Lewati Data Lama|Perbarui Data Lama/i, "Ganti Seluruh Master");
                titleChanged = true;
            } else if (!descriptionChanged && /Data yang sudah ada|Data sistem diperbarui/i.test(text)) {
                node.nodeValue = " Produk, Supplier, dan Kategori pada sheet yang ada akan diganti penuh oleh isi Excel. ";
                descriptionChanged = true;
            }
        });
        sourceLabel.parentElement.appendChild(cloneNode);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
}

function replaceAllSelected() {
    return !!document.querySelector('input[name="existingDataMode"]:checked[data-kp-replace-master="true"]');
}

function findHeaderRow(matrix, headerName) {
    const target = norm(headerName);
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
        if ((matrix[i] || []).some((cell) => norm(cell) === target)) return i;
    }
    return -1;
}

async function readReplaceKeepSetsFromWorkbook() {
    const fileInput = document.getElementById("master-file-input");
    const file = fileInput?.files?.[0];
    if (!file) throw new Error("File Excel untuk Ganti Seluruh Master tidak ditemukan.");
    if (!window.XLSX) throw new Error("SheetJS belum tersedia untuk membaca master pengganti.");

    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
    const config = {
        PRODUK: { collectionKey: "products", storeKey: "produk", identity: "Kode Produk", fallback: "Nama Produk" },
        SUPPLIER: { collectionKey: "suppliers", storeKey: "supplier", identity: "Kode Supplier", fallback: "Nama Supplier" },
        KATEGORI: { collectionKey: "categories", storeKey: "kategori", identity: "Kode Kategori", fallback: "Nama Kategori" }
    };
    const result = {};

    for (const [sheetKey, cfg] of Object.entries(config)) {
        const sheetName = workbook.SheetNames.find((name) => norm(name).replace(/\s+/g, "_") === sheetKey.toLowerCase());
        if (!sheetName) continue;
        const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false, raw: false });
        const headerRowIndex = findHeaderRow(matrix, cfg.identity);
        if (headerRowIndex < 0) throw new Error(`Header ${cfg.identity} tidak ditemukan pada sheet ${sheetName}.`);
        const headers = (matrix[headerRowIndex] || []).map((cell) => String(cell ?? "").trim());
        const primaryIndex = headers.findIndex((h) => norm(h) === norm(cfg.identity));
        const fallbackIndex = headers.findIndex((h) => norm(h) === norm(cfg.fallback));
        const keep = new Set();
        matrix.slice(headerRowIndex + 1).forEach((row) => {
            const key = norm(row?.[primaryIndex] || (fallbackIndex >= 0 ? row?.[fallbackIndex] : ""));
            if (key) keep.add(key);
        });
        result[cfg.collectionKey] = { ...cfg, keep, sheetName };
    }

    if (!Object.keys(result).length) throw new Error("Workbook tidak memiliki sheet PRODUK, SUPPLIER, atau KATEGORI yang dapat diganti.");
    return result;
}

async function deleteMissingMasterDocuments(replaceSets) {
    const deletions = [];
    for (const [collectionKey, cfg] of Object.entries(replaceSets)) {
        beginFirestoreRead(`Memverifikasi ${cfg.sheetName} untuk penggantian penuh\u2026`);
        try {
            const snapshot = await getDocsFromServer(collection(firebaseDb, ...collectionSegments(collectionKey)));
            snapshot.docs.forEach((item) => {
                const data = item.data();
                if (!cfg.keep.has(businessKey(collectionKey, data))) {
                    deletions.push({ collectionKey, id: item.id });
                }
            });
        } finally { endFirestoreRead(); }
    }

    const totalRecords = deletions.length;
    const totalBatches = Math.ceil(totalRecords / BATCH_SIZE);
    for (let index = 0; index < totalRecords; index += BATCH_SIZE) {
        const chunk = deletions.slice(index, index + BATCH_SIZE);
        const batch = writeBatch(firebaseDb);
        chunk.forEach((item) => batch.delete(doc(firebaseDb, ...documentSegments(item.collectionKey, item.id))));
        await batch.commit();
        chunk.forEach((item) => fingerprints.delete(`${item.collectionKey}/${item.id}`));
        const completedRecords = Math.min(index + chunk.length, totalRecords);
        window.dispatchEvent(new CustomEvent("kasirpro:database-sync-progress", {
            detail: {
                phase: "replace-delete",
                currentBatch: Math.floor(index / BATCH_SIZE) + 1,
                totalBatches,
                completedRecords,
                totalRecords,
                percent: totalRecords ? Math.round((completedRecords / totalRecords) * 100) : 100
            }
        }));
    }
    return { deletedRecords: totalRecords, deletedBatches: totalBatches };
}

function filterRuntimeMaster(value, replaceSets) {
    const master = clone(value) || {};
    Object.values(replaceSets).forEach((cfg) => {
        const rows = Array.isArray(master[cfg.storeKey]) ? master[cfg.storeKey] : [];
        master[cfg.storeKey] = rows.filter((record) => cfg.keep.has(businessKey(cfg.collectionKey, record)));
    });
    return master;
}

export function initializeDatabase() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        clearLegacyDataCache();
        state.clear();
        fingerprints.clear();
        installReplaceAllImportMode();

        const user = await waitForFirebaseUser();
        if (!user) throw new Error("Sesi Firebase tidak ditemukan. Silakan login kembali.");
        const profile = await readCurrentProfileFromServer(user);
        const role = String(profile.role || "").trim().toLowerCase();
        const isAdmin = role === "admin";
        const mode = pageMode();
        const snapshot = await loadPageSnapshot(mode, isAdmin);
        applyRuntimeSnapshot(snapshot);
        remoteEnabled = true;

        window.dispatchEvent(new CustomEvent("kasirpro:database-ready", {
            detail: { mode: "firebase-server", page: mode, role: isAdmin ? "admin" : "cashier", cache: false }
        }));
        return { mode: "firebase-server", page: mode, user, profile, cache: false };
    })().catch((error) => {
        remoteEnabled = false;
        state.clear();
        window.dispatchEvent(new CustomEvent("kasirpro:database-error", { detail: { error } }));
        throw error;
    });
    return initializationPromise;
}

export function readStore(key, fallback) {
    return state.has(key) ? clone(state.get(key)) : clone(fallback);
}

export function writeStore(key, value) {
    const previous = state.has(key) ? clone(state.get(key)) : undefined;
    const useReplaceAll = key === STORE_KEYS.master && replaceAllSelected();
    state.set(key, clone(value));

    if (!remoteEnabled) {
        if (previous === undefined) state.delete(key); else state.set(key, previous);
        return Promise.reject(new Error("Firestore belum siap. Tidak ada penyimpanan lokal cadangan."));
    }

    syncQueue = syncQueue.catch(() => {}).then(async () => {
        let replaceSets = null;
        if (useReplaceAll) replaceSets = await readReplaceKeepSetsFromWorkbook();
        const writeResult = await commitChanges(recordsForStore(key, value));
        let replaceResult = { deletedRecords: 0, deletedBatches: 0 };
        if (replaceSets) {
            replaceResult = await deleteMissingMasterDocuments(replaceSets);
            state.set(key, filterRuntimeMaster(value, replaceSets));
        }
        window.dispatchEvent(new CustomEvent("kasirpro:database-synced", {
            detail: { ...writeResult, ...replaceResult, replaceAll: !!replaceSets }
        }));
        return { ...writeResult, ...replaceResult, replaceAll: !!replaceSets };
    }).catch((error) => {
        if (previous === undefined) state.delete(key); else state.set(key, previous);
        window.dispatchEvent(new CustomEvent("kasirpro:database-error", { detail: { error, key } }));
        throw error;
    });
    return syncQueue;
}

export async function writeStoreBundle(entries) {
    const previousValues = entries.map(({ key }) => ({ key, existed: state.has(key), value: state.has(key) ? clone(state.get(key)) : undefined }));
    const groups = {};
    entries.forEach(({ key, value }) => {
        state.set(key, clone(value));
        Object.assign(groups, recordsForStore(key, value));
    });
    if (!remoteEnabled) {
        previousValues.forEach(({ key, existed, value }) => existed ? state.set(key, value) : state.delete(key));
        throw new Error("Firestore belum siap. Tidak ada penyimpanan lokal cadangan.");
    }
    syncQueue = syncQueue.catch(() => {}).then(() => commitChanges(groups));
    try {
        const result = await syncQueue;
        window.dispatchEvent(new CustomEvent("kasirpro:database-synced", { detail: result }));
        return result;
    } catch (error) {
        previousValues.forEach(({ key, existed, value }) => existed ? state.set(key, value) : state.delete(key));
        window.dispatchEvent(new CustomEvent("kasirpro:database-error", { detail: { error } }));
        throw error;
    }
}

export async function refreshStoreFromServer() {
    if (!remoteEnabled) throw new Error("Firestore belum siap.");
    const user = await waitForFirebaseUser();
    if (!user) throw new Error("Sesi Firebase tidak ditemukan.");
    const profile = await readCurrentProfileFromServer(user);
    const snapshot = await loadPageSnapshot(pageMode(), String(profile.role || "").toLowerCase() === "admin");
    state.clear();
    applyRuntimeSnapshot(snapshot);
    return clone(snapshot);
}

installReplaceAllImportMode();

