/* KasirPro AT-09 — Operational IndexedDB Cache
 * Database terpisah dari Master IndexedDB agar schema Master AT-08 tidak berubah.
 * Tidak melakukan request Firebase.
 */

const DB_NAME = "kasirpro_operational_v1";
const DB_VERSION = 3;

const STORES = Object.freeze({
    purchaseInvoices: "purchaseInvoices",
    sales: "sales",
    stockMovements: "stockMovements",
    stockOpnames: "stockOpnames",
    stockLevels: "stockLevels",
    syncMetadata: "syncMetadata"
});

let dbPromise = null;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Operasi IndexedDB operasional gagal."));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Transaksi IndexedDB operasional gagal."));
        transaction.onabort = () => reject(transaction.error || new Error("Transaksi IndexedDB operasional dibatalkan."));
    });
}

function validStoreName(name) {
    const value = String(name || "").trim();
    if (![STORES.purchaseInvoices, STORES.sales, STORES.stockMovements, STORES.stockOpnames, STORES.stockLevels].includes(value)) {
        throw new Error(`Store operasional tidak dikenal: ${value}`);
    }
    return value;
}

function cleanRecord(record) {
    const out = { ...(record || {}) };
    const id = String(out._firestoreDocumentId || "").trim();
    if (!id) return null;
    out._firestoreDocumentId = id;
    if (out.syncUpdatedAt && typeof out.syncUpdatedAt.toMillis === "function") {
        out._syncUpdatedAtMillis = Number(out.syncUpdatedAt.toMillis()) || 0;
        delete out.syncUpdatedAt;
    }
    return out;
}

function ensureIndex(store, name, keyPath) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

export function openOperationalDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            [STORES.purchaseInvoices, STORES.sales, STORES.stockMovements, STORES.stockOpnames, STORES.stockLevels].forEach(name => {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name, { keyPath: "_firestoreDocumentId" });
                }
                const store = request.transaction.objectStore(name);
                ensureIndex(store, "bySyncUpdatedAt", "_syncUpdatedAtMillis");
                if (name === STORES.purchaseInvoices) {
                    ensureIndex(store, "byDate", "date");
                    ensureIndex(store, "byStatus", "status");
                    ensureIndex(store, "bySupplier", "supplierCode");
                } else if (name === STORES.sales) {
                    ensureIndex(store, "byDate", "at");
                    ensureIndex(store, "byStatus", "status");
                    ensureIndex(store, "byCashier", "cashierUsername");
                } else if (name === STORES.stockMovements) {
                    ensureIndex(store, "byDate", "at");
                    ensureIndex(store, "byProductCode", "productCode");
                    ensureIndex(store, "byReference", "reference");
                } else if (name === STORES.stockOpnames) {
                    ensureIndex(store, "byDate", "at");
                } else if (name === STORES.stockLevels) {
                    ensureIndex(store, "byProductCode", "productCode");
                }
            });
            if (!db.objectStoreNames.contains(STORES.syncMetadata)) {
                db.createObjectStore(STORES.syncMetadata, { keyPath: "key" });
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };

        request.onerror = () => {
            dbPromise = null;
            reject(request.error || new Error("IndexedDB operasional KasirPro tidak dapat dibuka."));
        };

        request.onblocked = () => {
            dbPromise = null;
            reject(new Error("Pembaruan cache operasional tertahan oleh tab KasirPro lain. Tutup tab lama lalu coba lagi."));
        };
    });

    return dbPromise;
}

export async function readOperationalRecords(storeName) {
    const name = validStoreName(storeName);
    const db = await openOperationalDb();
    const tx = db.transaction(name, "readonly");
    const rows = await requestToPromise(tx.objectStore(name).getAll());
    await transactionDone(tx);
    return Array.isArray(rows) ? rows : [];
}

export async function replaceOperationalRecords(storeName, records) {
    const name = validStoreName(storeName);
    const db = await openOperationalDb();
    const tx = db.transaction(name, "readwrite");
    const store = tx.objectStore(name);
    store.clear();
    (Array.isArray(records) ? records : []).forEach(record => {
        const clean = cleanRecord(record);
        if (clean) store.put(clean);
    });
    await transactionDone(tx);
}

export async function mergeOperationalRecords(storeName, records) {
    const name = validStoreName(storeName);
    const db = await openOperationalDb();
    const tx = db.transaction(name, "readwrite");
    const store = tx.objectStore(name);
    (Array.isArray(records) ? records : []).forEach(record => {
        const clean = cleanRecord(record);
        if (clean) store.put(clean);
    });
    await transactionDone(tx);
}

export async function getOperationalSyncMeta(storeName) {
    const name = validStoreName(storeName);
    const db = await openOperationalDb();
    const tx = db.transaction(STORES.syncMetadata, "readonly");
    const row = await requestToPromise(tx.objectStore(STORES.syncMetadata).get(`sync:${name}`));
    await transactionDone(tx);
    return row?.value || {
        seeded: false,
        lastSyncMillis: 0,
        lastFullSeedAt: null,
        lastIncrementalSyncAt: null,
        recordCount: 0
    };
}

export async function setOperationalSyncMeta(storeName, values = {}) {
    const name = validStoreName(storeName);
    const previous = await getOperationalSyncMeta(name);
    const normalized = { ...values };

    /*
     * database-store-at09-base memakai cursor konservatif maxTimestamp-1 ms.
     * Metadata menyimpan kembali timestamp maksimum aktual agar dokumen pada
     * batch terakhir tidak dibaca ulang pada setiap startup berikutnya.
     */
    if (Object.prototype.hasOwnProperty.call(normalized, "lastSyncMillis")) {
        const cursor = Number(normalized.lastSyncMillis) || 0;
        normalized.lastSyncMillis = cursor > 0 ? cursor + 1 : 0;
    }

    const next = { ...previous, ...normalized };
    const db = await openOperationalDb();
    const tx = db.transaction(STORES.syncMetadata, "readwrite");
    tx.objectStore(STORES.syncMetadata).put({ key: `sync:${name}`, value: next });
    await transactionDone(tx);
    return next;
}

export async function resetOperationalCollection(storeName) {
    const name = validStoreName(storeName);
    const db = await openOperationalDb();
    const tx = db.transaction([name, STORES.syncMetadata], "readwrite");
    tx.objectStore(name).clear();
    tx.objectStore(STORES.syncMetadata).delete(`sync:${name}`);
    await transactionDone(tx);
}

export async function clearOperationalCache() {
    const db = await openOperationalDb();
    const names = [STORES.purchaseInvoices, STORES.sales, STORES.stockMovements, STORES.stockOpnames, STORES.stockLevels, STORES.syncMetadata];
    const tx = db.transaction(names, "readwrite");
    names.forEach(name => tx.objectStore(name).clear());
    await transactionDone(tx);
}

export { DB_NAME, DB_VERSION, STORES };
