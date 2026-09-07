/* KasirPro Master Snapshot
 * Membentuk paket Master Aktif canonical + chunk Firestore.
 * Tidak melakukan network I/O; hasil disimpan sebagai pending publish di IndexedDB.
 */
import { getLocalMetadata, setLocalMetadata } from "./indexeddb-store.js";
import {
    MASTER_SNAPSHOT_SCHEMA_VERSION,
    MASTER_CHUNK_TARGET_BYTES
} from "./master-firestore-config.js";
import { masterSnapshotChunkId } from "../database/database-paths.js";

function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).sort().forEach((key) => {
            if (key === "_localKey" || key === "_firestoreDocumentId") return;
            const v = clean(value[key]);
            if (v !== undefined) out[key] = v;
        });
        return out;
    }
    return value;
}

function normalizeMaster(master = {}) {
    return {
        produk: Array.isArray(master.produk) ? master.produk.map(clean) : [],
        supplier: Array.isArray(master.supplier) ? master.supplier.map(clean) : [],
        kategori: Array.isArray(master.kategori) ? master.kategori.map(clean) : [],
        pengguna: [],
        pengaturan_toko: Array.isArray(master.pengaturan_toko) ? master.pengaturan_toko.map(clean) : []
    };
}

async function sha256(text) {
    if (!globalThis.crypto?.subtle) return "";
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function splitUtf8Text(text, maxBytes = MASTER_CHUNK_TARGET_BYTES) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return [text];

    const chunks = [];
    let start = 0;
    while (start < bytes.length) {
        let end = Math.min(start + maxBytes, bytes.length);
        if (end < bytes.length) {
            while (end > start && (bytes[end] & 0xC0) === 0x80) end -= 1;
            if (end === start) end = Math.min(start + maxBytes, bytes.length);
        }
        chunks.push(decoder.decode(bytes.slice(start, end)));
        start = end;
    }
    return chunks;
}

export async function buildMasterPublishPackage(master, options = {}) {
    const normalized = normalizeMaster(master);
    const masterVersion = Number(options.version ?? options.masterVersion ?? 1) || 1;
    const generatedAt = options.generatedAt || new Date().toISOString();
    const payload = {
        schemaVersion: MASTER_SNAPSHOT_SCHEMA_VERSION,
        masterVersion,
        generatedAt,
        master: normalized
    };
    const dataText = JSON.stringify(payload);
    const checksum = await sha256(dataText);
    const parts = splitUtf8Text(dataText, MASTER_CHUNK_TARGET_BYTES);
    const chunks = parts.map((data, index) => ({
        id: masterSnapshotChunkId(masterVersion, index),
        schemaVersion: MASTER_SNAPSHOT_SCHEMA_VERSION,
        masterVersion,
        index,
        chunkNumber: index + 1,
        chunkCount: parts.length,
        checksum,
        data,
        byteLength: new TextEncoder().encode(data).length
    }));

    const manifest = {
        schemaVersion: MASTER_SNAPSHOT_SCHEMA_VERSION,
        masterVersion,
        generatedAt,
        checksum,
        encoding: "json-utf8-chunks",
        chunkCount: chunks.length,
        chunkIds: chunks.map((chunk) => chunk.id),
        targetChunkBytes: MASTER_CHUNK_TARGET_BYTES,
        counts: {
            products: normalized.produk.length,
            suppliers: normalized.supplier.length,
            categories: normalized.kategori.length,
            storeSettings: normalized.pengaturan_toko.length
        },
        status: "ready"
    };

    return {
        schemaVersion: MASTER_SNAPSHOT_SCHEMA_VERSION,
        masterVersion,
        generatedAt,
        checksum,
        data: payload,
        dataText,
        chunks,
        manifest,
        manifestText: JSON.stringify(manifest, null, 2)
    };
}

export async function queueMasterPublish(master, options = {}) {
    const pkg = await buildMasterPublishPackage(master, options);
    const queuedAt = new Date().toISOString();
    await setLocalMetadata({
        pendingMasterPublish: pkg,
        pendingMasterPublishVersion: pkg.masterVersion,
        pendingMasterPublishAt: queuedAt,
        masterPublishStatus: "pending",
        masterPublishSource: options.source || "master-change"
    });
    window.dispatchEvent(new CustomEvent("kasirpro:master-snapshot-pending", {
        detail: {
            version: pkg.masterVersion,
            checksum: pkg.checksum,
            counts: pkg.manifest.counts,
            chunkCount: pkg.chunks.length,
            queuedAt
        }
    }));
    return pkg;
}

export async function readPendingMasterPublish() {
    return getLocalMetadata("pendingMasterPublish", null);
}

export async function markMasterPublishComplete(version) {
    await setLocalMetadata({
        masterPublishStatus: "published",
        lastPublishedMasterVersion: Number(version) || 0,
        lastPublishedMasterAt: new Date().toISOString(),
        pendingMasterPublish: null,
        pendingMasterPublishVersion: 0
    });
}

export async function readMasterPublishStatus() {
    return {
        status: await getLocalMetadata("masterPublishStatus", "idle"),
        pendingVersion: Number(await getLocalMetadata("pendingMasterPublishVersion", 0)) || 0,
        lastPublishedVersion: Number(await getLocalMetadata("lastPublishedMasterVersion", 0)) || 0,
        source: await getLocalMetadata("masterPublishSource", "")
    };
}

export { normalizeMaster, sha256, splitUtf8Text };
