/* KasirPro database facade FINAL
 * Master statis: IndexedDB + Master Snapshot Firestore.
 * Operasional: Firestore (FakturPembelian, TransaksiPenjualan, MutasiStok, StockOpname).
 * Stok berjalan: dihitung dari MutasiStok. Field "Stok Awal" hanya overlay kompatibilitas UI lama.
 * Penulisan operasional memakai delta/fingerprint agar hemat kuota Spark.
 */
import * as legacy from "./database-store-core.js";
import { firebaseDb } from "./firebase-client.js";
import { waitForFirebaseUser } from "./auth.js";
import {
    collectionSegments,
    documentSegments,
    readableDocumentId
} from "./database-paths.js";
import {
    collection,
    doc,
    getDocsFromServer,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
    readMasterSnapshot,
    readMasterVersion,
    installMasterSnapshot
} from "../local/master-repository.js";
import {
    ensureLocalMaster,
    inspectMasterSyncState,
    updateLocalMasterFromCentral
} from "../local/master-sync.js";
import { FIRESTORE_MASTER_SNAPSHOT_ENABLED } from "../local/master-firestore-config.js";

export * from "./database-store-core.js";
export const STORE_KEYS = legacy.STORE_KEYS;

const OPERATIONAL_COLLECTIONS = Object.freeze({
    [STORE_KEYS.invoices]: "purchaseInvoices",
    [STORE_KEYS.sales]: "sales",
    [STORE_KEYS.movements]: "stockMovements",
    [STORE_KEYS.opnames]: "stockOpnames"
});

let initializationPromise = null;
let localMasterMode = false;
let masterCache = null;
let operationalRemoteReady = false;
let lastMasterSyncState = null;
let operationalState = new Map();
let operationalFingerprints = new Map();
let operationalWriteQueue = Promise.resolve();

function clone(value) {
    if (value === undefined) return undefined;
    return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function norm(value) {
    return String(value ?? "").trim().toLowerCase();
}

function num(value) {
    return Number(String(value ?? 0).replace(/[^0-9.-]/g, "")) || 0;
}

function fingerprint(value) {
    return JSON.stringify(value);
}

function emptyMaster() {
    return { produk: [], supplier: [], kategori: [], pengguna: [], pengaturan_toko: [] };
}

function pageMode() {
    const path = location.pathname.toLowerCase();
    if (path.includes("/management/")) return "management";
    if (path.includes("/pos/")) return "pos";
    return "login";
}

function emitReady(master, syncState = null) {
    const products = Array.isArray(master?.produk) ? master.produk.length : 0;
    const recovered = syncState?.recovered === true || syncState?.state === "recovered";
    window.dispatchEvent(new CustomEvent("kasirpro:database-preload-start", {
        detail: { message: recovered ? "Memulihkan Master Aktif lokal…" : "Membuka Master Aktif lokal…", total: 1 }
    }));
    window.dispatchEvent(new CustomEvent("kasirpro:database-preload-progress", {
        detail: {
            loaded: 1,
            total: 1,
            percent: 100,
            message: recovered ? `Master lokal dipulihkan (${products} produk)` : `Master lokal siap (${products} produk)`,
            collection: "indexeddb-master",
            status: "success"
        }
    }));
    window.dispatchEvent(new CustomEvent("kasirpro:database-idle"));
}

function emitSyncState(state) {
    lastMasterSyncState = state || null;
    window.dispatchEvent(new CustomEvent("kasirpro:master-sync-state", {
        detail: clone(lastMasterSyncState)
    }));
}

async function refreshMasterCacheFromIndexedDb() {
    masterCache = await readMasterSnapshot();
    localMasterMode = true;
    return masterCache;
}

async function prepareLocalMaster() {
    const networkOptions = { allowNetwork: FIRESTORE_MASTER_SNAPSHOT_ENABLED };
    let syncState;
    try {
        syncState = await ensureLocalMaster(networkOptions);
    } catch (error) {
        console.warn("Recovery Master lokal gagal:", error);
        syncState = {
            state: "recovery-error",
            hasLocal: false,
            localVersion: 0,
            centralVersion: 0,
            recovered: false,
            error: error?.message || String(error)
        };
    }

    if (syncState?.hasLocal && syncState?.state === "update-available") {
        try {
            const updated = await updateLocalMasterFromCentral(networkOptions);
            if (updated?.updated) syncState = updated;
        } catch (error) {
            console.warn("Sinkronisasi Master pusat gagal; tetap memakai Master lokal:", error);
            syncState = {
                ...syncState,
                state: "update-failed-local-kept",
                error: error?.message || String(error)
            };
        }
    }

    emitSyncState(syncState);
    return syncState;
}

function operationalKeysForPage(mode) {
    if (mode === "pos") return [STORE_KEYS.sales, STORE_KEYS.movements];
    if (mode === "management") return [STORE_KEYS.invoices, STORE_KEYS.sales, STORE_KEYS.movements, STORE_KEYS.opnames];
    return [];
}

function operationalDocumentId(storeKey, record) {
    if (record?._firestoreDocumentId) return String(record._firestoreDocumentId);
    if (storeKey === STORE_KEYS.invoices) return readableDocumentId("faktur", record?.number || record?.id);
    if (storeKey === STORE_KEYS.sales) return readableDocumentId("penjualan", record?.number || record?.id);
    if (storeKey === STORE_KEYS.opnames) return readableDocumentId("opname", record?.id || record?.at);
    if (storeKey === STORE_KEYS.movements) {
        return readableDocumentId("mutasi", [record?.reference, record?.productCode, record?.at, record?.id].filter(Boolean).join("-"));
    }
    throw new Error(`Store operasional tidak dikenal: ${storeKey}`);
}

function cleanOperationalRecord(record) {
    const clean = clone(record) || {};
    delete clean._firestoreDocumentId;
    Object.keys(clean).forEach(key => {
        if (key.startsWith("_local") || clean[key] === undefined) delete clean[key];
    });
    return clean;
}

function operationalFingerprintKey(storeKey, record) {
    return `${storeKey}/${operationalDocumentId(storeKey, record)}`;
}

async function readOperationalCollection(storeKey) {
    const collectionKey = OPERATIONAL_COLLECTIONS[storeKey];
    if (!collectionKey) return [];
    const snapshot = await getDocsFromServer(collection(firebaseDb, ...collectionSegments(collectionKey)));
    return snapshot.docs.map(item => {
        const record = { ...item.data(), _firestoreDocumentId: item.id };
        operationalFingerprints.set(`${storeKey}/${item.id}`, fingerprint(cleanOperationalRecord(record)));
        return record;
    });
}

async function initializeOperationalState() {
    const mode = pageMode();
    const keys = operationalKeysForPage(mode);
    if (!keys.length) {
        operationalRemoteReady = false;
        return { ready: false, reason: "login-page" };
    }

    const user = await waitForFirebaseUser();
    if (!user) {
        operationalRemoteReady = false;
        return { ready: false, reason: "firebase-user-unavailable" };
    }

    try {
        operationalFingerprints.clear();
        const rows = await Promise.all(keys.map(async key => [key, await readOperationalCollection(key)]));
        rows.forEach(([key, value]) => operationalState.set(key, value));
        operationalRemoteReady = true;
        window.dispatchEvent(new CustomEvent("kasirpro:operational-ready", {
            detail: { page: mode, collections: keys.length }
        }));
        return { ready: true, page: mode, collections: keys.length };
    } catch (error) {
        operationalRemoteReady = false;
        console.warn("Data operasional Firestore belum dapat dimuat:", error);
        window.dispatchEvent(new CustomEvent("kasirpro:operational-unavailable", {
            detail: { page: mode, error: error?.message || String(error) }
        }));
        return { ready: false, page: mode, reason: "firestore-read-failed", error: error?.message || String(error) };
    }
}

function movementStock(code, movementList = operationalState.get(STORE_KEYS.movements) || []) {
    const key = norm(code);
    if (!key) return 0;
    const matching = movementList.filter(movement => norm(movement?.productCode) === key);
    if (!matching.length) return 0;

    const latest = matching
        .filter(movement => Number.isFinite(Number(movement?.stockAfter)))
        .sort((a, b) => (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0))[0];
    if (latest) return num(latest.stockAfter);
    return matching.reduce((sum, movement) => sum + num(movement.delta), 0);
}

function masterWithOperationalStock(master) {
    const out = clone(master || emptyMaster());
    out.produk = (Array.isArray(out.produk) ? out.produk : []).map(product => ({
        ...product,
        "Stok Awal": movementStock(product?.["Kode Produk"])
    }));
    return out;
}

function stripOperationalStockFromMaster(incoming, currentStatic) {
    const next = clone(incoming || emptyMaster());
    const currentProducts = Array.isArray(currentStatic?.produk) ? currentStatic.produk : [];
    const currentMap = new Map(currentProducts.map(product => [norm(product?.["Kode Produk"]), product]));
    next.produk = (Array.isArray(next.produk) ? next.produk : []).map(product => {
        const clean = { ...product };
        const existing = currentMap.get(norm(clean?.["Kode Produk"]));
        clean["Stok Awal"] = existing ? existing["Stok Awal"] : 0;
        return clean;
    });
    return next;
}

function collectOperationalChanges(entries) {
    const changes = [];
    for (const entry of entries) {
        const rows = Array.isArray(entry.value) ? entry.value : [];
        const collectionKey = OPERATIONAL_COLLECTIONS[entry.key];
        if (!collectionKey) continue;
        for (const record of rows) {
            const clean = cleanOperationalRecord(record);
            const id = operationalDocumentId(entry.key, record);
            const fpKey = `${entry.key}/${id}`;
            const nextFingerprint = fingerprint(clean);
            if (operationalFingerprints.get(fpKey) === nextFingerprint) continue;
            changes.push({ storeKey: entry.key, collectionKey, id, clean, fpKey, nextFingerprint });
        }
    }
    return changes;
}

async function commitOperationalEntries(entries) {
    if (!operationalRemoteReady) {
        throw new Error("Data operasional pusat belum siap. Perubahan dibatalkan agar tidak hanya tersimpan di perangkat ini.");
    }

    const list = Array.isArray(entries) ? entries : [];
    const previousState = new Map(list.map(entry => [entry.key, clone(operationalState.get(entry.key) || [])]));
    list.forEach(entry => operationalState.set(entry.key, clone(Array.isArray(entry.value) ? entry.value : [])));
    const changes = collectOperationalChanges(list);

    operationalWriteQueue = operationalWriteQueue.then(async () => {
        try {
            for (let start = 0; start < changes.length; start += 400) {
                const chunk = changes.slice(start, start + 400);
                const batch = writeBatch(firebaseDb);
                chunk.forEach(change => {
                    batch.set(
                        doc(firebaseDb, ...documentSegments(change.collectionKey, change.id)),
                        change.clean,
                        { merge: true }
                    );
                });
                await batch.commit();
                chunk.forEach(change => operationalFingerprints.set(change.fpKey, change.nextFingerprint));
            }
            return {
                mode: "firestore-operational-delta",
                changedRecords: changes.length,
                batches: Math.ceil(changes.length / 400)
            };
        } catch (error) {
            previousState.forEach((value, key) => operationalState.set(key, value));
            throw error;
        }
    });

    return operationalWriteQueue;
}

export function initializeDatabase() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        const syncState = await prepareLocalMaster();
        if (syncState?.hasLocal) await refreshMasterCacheFromIndexedDb();
        else {
            masterCache = emptyMaster();
            localMasterMode = true;
        }
        emitReady(masterCache, syncState);

        const operational = await initializeOperationalState();
        return {
            mode: syncState?.hasLocal ? "indexeddb-master" : "indexeddb-master-empty",
            remoteEnabled: operational.ready,
            operationalRemoteReady: operational.ready,
            masterSnapshotNetworkEnabled: FIRESTORE_MASTER_SNAPSHOT_ENABLED,
            masterVersion: await readMasterVersion(),
            centralMasterVersion: Number(syncState?.centralVersion) || 0,
            syncState: syncState?.state || "recovery-unavailable",
            productCount: masterCache.produk?.length || 0
        };
    })();
    return initializationPromise;
}

export function readStore(key, fallback) {
    if (key === STORE_KEYS.master && localMasterMode) {
        return masterWithOperationalStock(masterCache ?? fallback ?? emptyMaster());
    }
    if (Object.prototype.hasOwnProperty.call(OPERATIONAL_COLLECTIONS, key)) {
        return clone(operationalState.has(key) ? operationalState.get(key) : (fallback ?? []));
    }
    return legacy.readStore(key, fallback);
}

export function writeStore(key, value) {
    if (key === STORE_KEYS.master && localMasterMode) {
        const staticMaster = stripOperationalStockFromMaster(value, masterCache);
        masterCache = clone(staticMaster);
        return (async () => {
            const currentVersion = Number(await readMasterVersion()) || 0;
            const installed = await installMasterSnapshot(masterCache, {
                version: currentVersion + 1,
                source: "database-facade-write"
            });
            masterCache = clone(installed.master);
            window.dispatchEvent(new CustomEvent("kasirpro:local-master-updated", {
                detail: {
                    version: installed.version,
                    products: masterCache.produk?.length || 0,
                    suppliers: masterCache.supplier?.length || 0,
                    categories: masterCache.kategori?.length || 0
                }
            }));
            return { mode: "indexeddb-master", version: installed.version };
        })();
    }

    if (Object.prototype.hasOwnProperty.call(OPERATIONAL_COLLECTIONS, key)) {
        return commitOperationalEntries([{ key, value }]);
    }
    return legacy.writeStore(key, value);
}

export async function writeStoreBundle(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const masterEntry = list.find(entry => entry?.key === STORE_KEYS.master);
    const operationalEntries = list.filter(entry => Object.prototype.hasOwnProperty.call(OPERATIONAL_COLLECTIONS, entry?.key));

    const previousMaster = clone(masterCache);
    try {
        const results = [];
        if (operationalEntries.length) results.push(await commitOperationalEntries(operationalEntries));
        if (masterEntry) {
            const staticMaster = stripOperationalStockFromMaster(masterEntry.value, masterCache);
            results.push(await writeStore(STORE_KEYS.master, staticMaster));
        }
        return { mode: "indexeddb-master-firestore-operational", results };
    } catch (error) {
        masterCache = previousMaster;
        throw error;
    }
}

export function isLocalMasterMode() { return localMasterMode; }
export function isOperationalRemoteReady() { return operationalRemoteReady; }
export function getMasterSyncState() { return clone(lastMasterSyncState); }

export async function recheckMasterSync() {
    const state = await inspectMasterSyncState({ allowNetwork: FIRESTORE_MASTER_SNAPSHOT_ENABLED });
    emitSyncState(state);
    return state;
}

window.addEventListener("kasirpro:local-master-updated", () => {
    refreshMasterCacheFromIndexedDb().catch(error => {
        console.error("Gagal menyegarkan cache Master Aktif lokal:", error);
    });
});

window.addEventListener("kasirpro:local-master-recovered", () => {
    refreshMasterCacheFromIndexedDb().catch(error => {
        console.error("Gagal memuat hasil recovery Master Aktif:", error);
    });
});
