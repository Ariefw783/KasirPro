/* KasirPro Master Snapshot Firestore — feature gate FINAL
 * Snapshot chunked aktif. Jika Firestore/rules/quota belum siap, repository tetap mempertahankan Master lokal
 * dan paket publish tetap berada di antrean pending.
 */
export const FIRESTORE_MASTER_SNAPSHOT_ENABLED = true;
export const MASTER_SNAPSHOT_SCHEMA_VERSION = 2;
export const MASTER_CHUNK_TARGET_BYTES = 650 * 1024;
export const MASTER_CHUNK_BATCH_SIZE = 400;
