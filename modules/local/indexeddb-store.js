/* KasirPro IndexedDB Store
 * Fondasi penyimpanan Master Aktif lokal.
 * Tidak membaca atau menulis Firebase.
 * Acceptance fix: object store dibuat tanpa index keyPath ber-spasi yang dapat membatalkan onupgradeneeded.
 */

const DB_NAME = "kasirpro_local_v1";
const DB_VERSION = 1;

const STORES = Object.freeze({
    products: "products",
    suppliers: "suppliers",
    categories: "categories",
    storeSettings: "storeSettings",
    metadata: "metadata"
});

let dbPromise = null;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Operasi IndexedDB gagal."));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Transaksi IndexedDB gagal."));
        transaction.onabort = () => reject(transaction.error || new Error("Transaksi IndexedDB dibatalkan."));
    });
}

function cleanText(value) {
    return String(value ?? "").trim();
}

function productKey(record) {
    return cleanText(record?.["Kode Produk"] || record?.code);
}

function supplierKey(record) {
    return cleanText(record?.["Supplier"] || record?.supplier);
}

function categoryKey(record) {
    return cleanText(record?.["Kode Kategori"] || record?.["Nama Kategori"] || record?.category);
}

function settingKey(record, index = 0) {
    return cleanText(record?.["Nama Toko"] || record?.id) || `store-${index + 1}`;
}

function prepareRecord(record, keyField, keyValue) {
    const copy = { ...(record || {}) };
    copy[keyField] = keyValue;
    return copy;
}

export function openKasirProLocalDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            try {
                if (!db.objectStoreNames.contains(STORES.products)) {
                    db.createObjectStore(STORES.products, { keyPath: "_localKey" });
                }

                if (!db.objectStoreNames.contains(STORES.suppliers)) {
                    db.createObjectStore(STORES.suppliers, { keyPath: "_localKey" });
                }

                if (!db.objectStoreNames.contains(STORES.categories)) {
                    db.createObjectStore(STORES.categories, { keyPath: "_localKey" });
                }

                if (!db.objectStoreNames.contains(STORES.storeSettings)) {
                    db.createObjectStore(STORES.storeSettings, { keyPath: "_localKey" });
                }

                if (!db.objectStoreNames.contains(STORES.metadata)) {
                    db.createObjectStore(STORES.metadata, { keyPath: "key" });
                }
            } catch (error) {
                console.error("Upgrade IndexedDB KasirPro gagal:", error);
                throw error;
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };

        request.onerror = () => {
            dbPromise = null;
            reject(request.error || new Error("IndexedDB KasirPro tidak dapat dibuka."));
        };

        request.onblocked = () => {
            dbPromise = null;
            reject(new Error("Pembaruan IndexedDB tertahan oleh tab KasirPro lain. Tutup tab lama lalu coba lagi."));
        };
    });

    return dbPromise;
}

async function replaceStore(storeName, records, keyBuilder) {
    const db = await openKasirProLocalDb();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();

    (Array.isArray(records) ? records : []).forEach((record, index) => {
        const key = cleanText(keyBuilder(record, index));
        if (!key) return;
        store.put(prepareRecord(record, "_localKey", key));
    });

    await transactionDone(tx);
}

export async function replaceLocalMaster(master, metadata = {}) {
    const source = master || {};
    await replaceStore(STORES.products, source.produk, productKey);
    await replaceStore(STORES.suppliers, source.supplier, supplierKey);
    await replaceStore(STORES.categories, source.kategori, categoryKey);
    await replaceStore(STORES.storeSettings, source.pengaturan_toko, settingKey);

    await setLocalMetadata({
        masterVersion: metadata.masterVersion ?? metadata.version ?? 1,
        updatedAt: metadata.updatedAt || new Date().toISOString(),
        source: metadata.source || "unknown",
        productCount: Array.isArray(source.produk) ? source.produk.length : 0,
        supplierCount: Array.isArray(source.supplier) ? source.supplier.length : 0,
        categoryCount: Array.isArray(source.kategori) ? source.kategori.length : 0
    });
}

async function getAll(storeName) {
    const db = await openKasirProLocalDb();
    const tx = db.transaction(storeName, "readonly");
    const result = await requestToPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return result.map(({ _localKey, ...record }) => record);
}

export async function getLocalProducts() {
    return getAll(STORES.products);
}

export async function getLocalSuppliers() {
    return getAll(STORES.suppliers);
}

export async function getLocalCategories() {
    return getAll(STORES.categories);
}

export async function getLocalStoreSettings() {
    return getAll(STORES.storeSettings);
}

export async function getLocalProductByCode(code) {
    const key = cleanText(code);
    if (!key) return null;
    const db = await openKasirProLocalDb();
    const tx = db.transaction(STORES.products, "readonly");
    const value = await requestToPromise(tx.objectStore(STORES.products).get(key));
    await transactionDone(tx);
    if (!value) return null;
    const { _localKey, ...record } = value;
    return record;
}

export async function upsertLocalProduct(record) {
    const key = productKey(record);
    if (!key) throw new Error("Kode Produk wajib tersedia untuk menyimpan produk ke IndexedDB.");
    const db = await openKasirProLocalDb();
    const tx = db.transaction(STORES.products, "readwrite");
    tx.objectStore(STORES.products).put(prepareRecord(record, "_localKey", key));
    await transactionDone(tx);
    return key;
}

export async function setLocalMetadata(values = {}) {
    const db = await openKasirProLocalDb();
    const tx = db.transaction(STORES.metadata, "readwrite");
    const store = tx.objectStore(STORES.metadata);
    Object.entries(values).forEach(([key, value]) => store.put({ key, value }));
    await transactionDone(tx);
}

export async function getLocalMetadata(key, fallback = null) {
    const db = await openKasirProLocalDb();
    const tx = db.transaction(STORES.metadata, "readonly");
    const row = await requestToPromise(tx.objectStore(STORES.metadata).get(key));
    await transactionDone(tx);
    return row ? row.value : fallback;
}

export async function getLocalMasterSnapshot() {
    const [produk, supplier, kategori, pengaturan_toko] = await Promise.all([
        getLocalProducts(),
        getLocalSuppliers(),
        getLocalCategories(),
        getLocalStoreSettings()
    ]);
    return { produk, supplier, kategori, pengaturan_toko, pengguna: [] };
}

export async function hasLocalMaster() {
    const count = Number(await getLocalMetadata("productCount", 0)) || 0;
    if (count > 0) return true;
    const db = await openKasirProLocalDb();
    const tx = db.transaction(STORES.products, "readonly");
    const actual = await requestToPromise(tx.objectStore(STORES.products).count());
    await transactionDone(tx);
    return actual > 0;
}

export async function clearKasirProLocalMaster() {
    const db = await openKasirProLocalDb();
    const names = [STORES.products, STORES.suppliers, STORES.categories, STORES.storeSettings, STORES.metadata];
    const tx = db.transaction(names, "readwrite");
    names.forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
}

export { DB_NAME, DB_VERSION, STORES };
