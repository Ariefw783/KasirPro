/* KasirPro Master Repository
 * Satu pintu akses Master Aktif lokal + snapshot/publish pusat.
 */
import {
    getLocalMasterSnapshot,
    getLocalProducts,
    getLocalProductByCode,
    getLocalSuppliers,
    getLocalCategories,
    getLocalStoreSettings,
    getLocalMetadata,
    hasLocalMaster,
    replaceLocalMaster,
    upsertLocalProduct,
    setLocalMetadata
} from "./indexeddb-store.js";
import {
    queueMasterPublish,
    readPendingMasterPublish,
    readMasterPublishStatus
} from "./master-snapshot.js";
import { publishPendingMasterPackage } from "./master-publisher.js";
import { FIRESTORE_MASTER_SNAPSHOT_ENABLED } from "./master-firestore-config.js";

export async function masterReady() { return hasLocalMaster(); }
export async function readMasterSnapshot() { return getLocalMasterSnapshot(); }
export async function readProducts() { return getLocalProducts(); }
export async function readProductByCode(code) { return getLocalProductByCode(code); }
export async function readSuppliers() { return getLocalSuppliers(); }
export async function readCategories() { return getLocalCategories(); }
export async function readStoreSettings() { return getLocalStoreSettings(); }
export async function readMasterVersion() { return getLocalMetadata("masterVersion", 0); }

function isCentralSource(source) {
    return String(source || "").startsWith("central-master-");
}

async function queueAndTryPublish(master, options = {}) {
    const pkg = await queueMasterPublish(master, options);
    const publishResult = await publishPendingMasterPackage({
        allowNetwork: FIRESTORE_MASTER_SNAPSHOT_ENABLED
    }).catch((error) => ({
        published: false,
        queued: true,
        reason: "publish-error",
        error: error?.message || String(error)
    }));
    return { pkg, publishResult };
}

export async function installMasterSnapshot(master, options = {}) {
    const nextVersion = Number(options.version ?? options.masterVersion ?? 1) || 1;
    const updatedAt = options.updatedAt || new Date().toISOString();
    const source = options.source || "master-import";

    await replaceLocalMaster(master, {
        masterVersion: nextVersion,
        updatedAt,
        source
    });

    const installedMaster = await getLocalMasterSnapshot();
    let publish = null;
    if (options.queuePublish !== false && !isCentralSource(source)) {
        publish = await queueAndTryPublish(installedMaster, {
            version: nextVersion,
            generatedAt: updatedAt,
            source
        });
    }
    return { version: nextVersion, master: installedMaster, publish };
}

export async function registerProductFromInvoice(product, options = {}) {
    const code = String(product?.["Kode Produk"] ?? "").trim();
    const name = String(product?.["Nama Produk"] ?? "").trim();
    const supplier = String(product?.["Supplier"] ?? "").trim();
    if (!code) throw new Error("Kode Produk wajib diisi.");
    if (!name) throw new Error("Nama Produk wajib diisi.");
    if (!supplier) throw new Error("Supplier wajib diisi.");

    const record = {
        ...product,
        "Kode Produk": code,
        "Nama Produk": name,
        "Supplier": supplier,
        "Stok Awal": 0
    };
    await upsertLocalProduct(record);

    const currentVersion = Number(await readMasterVersion()) || 0;
    const nextVersion = Number(options.version) || currentVersion + 1 || 1;
    const updatedAt = new Date().toISOString();
    await setLocalMetadata({ masterVersion: nextVersion, updatedAt, source: "invoice-new-product" });

    const master = await getLocalMasterSnapshot();
    const publish = await queueAndTryPublish(master, {
        version: nextVersion,
        generatedAt: updatedAt,
        source: "invoice-new-product"
    });
    return { product: record, version: nextVersion, publish };
}

export async function readPendingCentralMasterPackage() { return readPendingMasterPublish(); }
export async function readCentralPublishStatus() { return readMasterPublishStatus(); }
