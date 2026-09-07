/* KasirPro Master Publisher — Firestore Spark chunked
 * Network publish dinonaktifkan sampai feature gate diaktifkan setelah kuota pulih.
 */
import { firebaseDb } from "../database/firebase-client.js";
import {
    masterSnapshotManifestSegments,
    masterSnapshotChunkSegments
} from "../database/database-paths.js";
import {
    readPendingMasterPublish,
    readMasterPublishStatus,
    markMasterPublishComplete
} from "./master-snapshot.js";
import {
    FIRESTORE_MASTER_SNAPSHOT_ENABLED,
    MASTER_CHUNK_BATCH_SIZE
} from "./master-firestore-config.js";
import {
    doc,
    setDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let installed = false;

async function writeChunkBatch(chunks) {
    for (let start = 0; start < chunks.length; start += MASTER_CHUNK_BATCH_SIZE) {
        const batch = writeBatch(firebaseDb);
        const slice = chunks.slice(start, start + MASTER_CHUNK_BATCH_SIZE);
        slice.forEach((chunk) => {
            const ref = doc(firebaseDb, ...masterSnapshotChunkSegments(chunk.masterVersion, chunk.index));
            batch.set(ref, {
                schemaVersion: chunk.schemaVersion,
                masterVersion: chunk.masterVersion,
                index: chunk.index,
                chunkNumber: chunk.chunkNumber,
                chunkCount: chunk.chunkCount,
                checksum: chunk.checksum,
                data: chunk.data,
                byteLength: chunk.byteLength
            });
        });
        await batch.commit();
    }
}

export async function publishPendingMasterPackage(options = {}) {
    const pending = await readPendingMasterPublish();
    if (!pending) return { published: false, queued: false, reason: "no-pending-package" };

    const allowNetwork = options.allowNetwork === true;
    if (!FIRESTORE_MASTER_SNAPSHOT_ENABLED || !allowNetwork) {
        return {
            published: false,
            queued: true,
            provider: "firestore-spark-chunks",
            networkAttempted: false,
            reason: FIRESTORE_MASTER_SNAPSHOT_ENABLED ? "network-not-authorized-by-call" : "feature-gate-disabled",
            version: Number(pending.masterVersion) || 0,
            checksum: pending.checksum || "",
            chunkCount: pending.chunks?.length || 0
        };
    }

    const chunks = Array.isArray(pending.chunks) ? pending.chunks : [];
    if (!chunks.length) throw new Error("Paket Master tidak memiliki chunk.");

    // Commit chunks dulu. Manifest 'current' selalu ditulis terakhir sebagai commit marker.
    await writeChunkBatch(chunks);
    const manifestRef = doc(firebaseDb, ...masterSnapshotManifestSegments());
    await setDoc(manifestRef, {
        ...pending.manifest,
        publishedAt: new Date().toISOString()
    });

    await markMasterPublishComplete(pending.masterVersion);
    window.dispatchEvent(new CustomEvent("kasirpro:master-published", {
        detail: {
            provider: "firestore-spark-chunks",
            version: pending.masterVersion,
            checksum: pending.checksum,
            chunkCount: chunks.length
        }
    }));

    return {
        published: true,
        queued: false,
        provider: "firestore-spark-chunks",
        version: pending.masterVersion,
        checksum: pending.checksum,
        chunkCount: chunks.length
    };
}

export function installMasterPublisher() {
    if (installed) return;
    installed = true;

    window.addEventListener("kasirpro:master-snapshot-pending", (event) => {
        window.dispatchEvent(new CustomEvent("kasirpro:master-publish-queued", {
            detail: {
                provider: "firestore-spark-chunks",
                version: Number(event?.detail?.version) || 0,
                chunkCount: Number(event?.detail?.chunkCount) || 0,
                reason: FIRESTORE_MASTER_SNAPSHOT_ENABLED ? "awaiting-explicit-network-publish" : "feature-gate-disabled"
            }
        }));
    });
}

export async function getPublisherState() {
    return {
        provider: "firestore-spark-chunks",
        networkPublisherEnabled: FIRESTORE_MASTER_SNAPSHOT_ENABLED,
        paidServicesUsed: false,
        planTarget: "Firebase Spark",
        status: await readMasterPublishStatus()
    };
}
