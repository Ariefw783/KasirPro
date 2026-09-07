/* KasirPro Master Sync & Recovery — Firestore Spark chunked
 * Saat feature gate false, fungsi ini tidak melakukan request Firestore.
 */
import {
    masterReady,
    readMasterVersion,
    installMasterSnapshot
} from "./master-repository.js";
import { firebaseDb } from "../database/firebase-client.js";
import {
    masterSnapshotManifestSegments,
    documentSegments
} from "../database/database-paths.js";
import { FIRESTORE_MASTER_SNAPSHOT_ENABLED } from "./master-firestore-config.js";
import { sha256 } from "./master-snapshot.js";
import {
    doc,
    getDocFromServer
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function unavailableManifest(reason = "feature-gate-disabled") {
    return {
        schemaVersion: 2,
        masterVersion: 0,
        generatedAt: null,
        checksum: "",
        chunkCount: 0,
        chunkIds: [],
        counts: {},
        status: "unavailable",
        provider: "firestore-spark-chunks",
        reason
    };
}

export async function readCentralMasterManifest(options = {}) {
    const allowNetwork = options.allowNetwork === true;
    if (!FIRESTORE_MASTER_SNAPSHOT_ENABLED || !allowNetwork) {
        return unavailableManifest(FIRESTORE_MASTER_SNAPSHOT_ENABLED ? "network-not-authorized-by-call" : "feature-gate-disabled");
    }

    try {
        const ref = doc(firebaseDb, ...masterSnapshotManifestSegments());
        const snap = await getDocFromServer(ref);
        if (!snap.exists()) return unavailableManifest("manifest-not-found");
        const manifest = snap.data() || {};
        return {
            schemaVersion: asNumber(manifest.schemaVersion, 2),
            masterVersion: asNumber(manifest.masterVersion, 0),
            generatedAt: manifest.generatedAt || null,
            checksum: String(manifest.checksum || "").trim(),
            encoding: String(manifest.encoding || "json-utf8-chunks"),
            chunkCount: asNumber(manifest.chunkCount, 0),
            chunkIds: Array.isArray(manifest.chunkIds) ? manifest.chunkIds.map(String) : [],
            counts: manifest.counts || {},
            status: String(manifest.status || "unavailable").toLowerCase(),
            provider: "firestore-spark-chunks"
        };
    } catch (error) {
        return { ...unavailableManifest("manifest-read-error"), error: error?.message || String(error) };
    }
}

async function downloadCentralSnapshot(manifest, options = {}) {
    if (!manifest || manifest.status !== "ready" || !manifest.masterVersion) {
        throw new Error("Snapshot Master pusat belum tersedia.");
    }
    if (!FIRESTORE_MASTER_SNAPSHOT_ENABLED || options.allowNetwork !== true) {
        throw new Error("Network Master Snapshot masih dinonaktifkan.");
    }
    if (!manifest.chunkIds.length || manifest.chunkIds.length !== manifest.chunkCount) {
        throw new Error("Manifest Master memiliki daftar chunk yang tidak valid.");
    }

    const chunkDocs = await Promise.all(manifest.chunkIds.map(async (chunkId) => {
        const ref = doc(firebaseDb, ...documentSegments("masterSnapshotChunks", chunkId));
        const snap = await getDocFromServer(ref);
        if (!snap.exists()) throw new Error(`Chunk Master tidak ditemukan: ${chunkId}`);
        return snap.data() || {};
    }));

    chunkDocs.sort((a, b) => asNumber(a.index) - asNumber(b.index));
    chunkDocs.forEach((chunk, index) => {
        if (asNumber(chunk.masterVersion) !== manifest.masterVersion) throw new Error(`Versi chunk ${index + 1} tidak cocok.`);
        if (String(chunk.checksum || "") !== manifest.checksum) throw new Error(`Checksum metadata chunk ${index + 1} tidak cocok.`);
        if (asNumber(chunk.index, -1) !== index) throw new Error(`Urutan chunk ${index + 1} tidak valid.`);
    });

    const dataText = chunkDocs.map((chunk) => String(chunk.data || "")).join("");
    const actualChecksum = await sha256(dataText);
    if (manifest.checksum && actualChecksum !== manifest.checksum) {
        throw new Error("Checksum snapshot Master pusat tidak cocok.");
    }

    const payload = JSON.parse(dataText);
    if (asNumber(payload.masterVersion) !== manifest.masterVersion) throw new Error("Versi payload Master tidak cocok dengan manifest.");
    const master = payload?.master;
    if (!master || !Array.isArray(master.produk)) throw new Error("Snapshot Master tidak memiliki data produk yang valid.");
    return master;
}

export async function inspectMasterSyncState(options = {}) {
    const [hasLocal, localVersion, manifest] = await Promise.all([
        masterReady().catch(() => false),
        readMasterVersion().catch(() => 0),
        readCentralMasterManifest(options)
    ]);

    const centralVersion = asNumber(manifest.masterVersion, 0);
    let state = "local-empty";
    if (hasLocal) {
        if (manifest.status === "ready" && centralVersion > asNumber(localVersion, 0)) state = "update-available";
        else if (manifest.status === "ready" && centralVersion === asNumber(localVersion, 0)) state = "up-to-date";
        else state = "local-ready-central-unavailable";
    } else if (manifest.status === "ready" && centralVersion > 0) {
        state = "recovery-available";
    } else {
        state = "recovery-unavailable";
    }

    return { state, hasLocal, localVersion: asNumber(localVersion, 0), centralVersion, manifest };
}

export async function ensureLocalMaster(options = {}) {
    const status = await inspectMasterSyncState(options);
    if (status.hasLocal) return { ...status, recovered: false };
    if (status.state !== "recovery-available") return { ...status, recovered: false };

    const master = await downloadCentralSnapshot(status.manifest, options);
    const installed = await installMasterSnapshot(master, {
        version: status.centralVersion,
        updatedAt: status.manifest.generatedAt || new Date().toISOString(),
        source: "central-master-recovery"
    });

    window.dispatchEvent(new CustomEvent("kasirpro:local-master-recovered", {
        detail: { version: installed.version, products: installed.master?.produk?.length || 0 }
    }));
    return { ...status, state: "recovered", hasLocal: true, localVersion: installed.version, recovered: true, master: installed.master };
}

export async function updateLocalMasterFromCentral(options = {}) {
    const status = await inspectMasterSyncState(options);
    if (status.state !== "update-available") return { ...status, updated: false };

    const master = await downloadCentralSnapshot(status.manifest, options);
    const installed = await installMasterSnapshot(master, {
        version: status.centralVersion,
        updatedAt: status.manifest.generatedAt || new Date().toISOString(),
        source: "central-master-sync"
    });

    window.dispatchEvent(new CustomEvent("kasirpro:local-master-updated", {
        detail: { version: installed.version, products: installed.master?.produk?.length || 0, source: "central-sync" }
    }));
    return { ...status, state: "updated", updated: true, master: installed.master };
}
