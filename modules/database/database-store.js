/* KasirPro AT-10 facade — AT-09 incremental sync + cross-device reset guard + Master acceptance guard */
import * as base from "./database-store-at09-base.js";
import { applyDatabaseResetMarker } from "./database-reset-guard-at10.js";

export * from "./database-store-at09-base.js";

const MASTER_KEY = base.STORE_KEYS.master;
let initializationPromise = null;

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function normalizeStaticMaster(master) {
  const out = clone(master || {});
  const products = Array.isArray(out.produk) ? out.produk : [];
  out.produk = products.map(product => {
    const clean = { ...(product || {}) };
    delete clean["Stok Awal"];
    delete clean._firestoreDocumentId;
    delete clean._localKey;
    return clean;
  });
  return out;
}

function sameStaticMaster(a, b) {
  return JSON.stringify(normalizeStaticMaster(a)) === JSON.stringify(normalizeStaticMaster(b));
}

export function initializeDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const resetGuard = await applyDatabaseResetMarker();
    const result = await base.initializeDatabase();
    return { ...result, resetGuard };
  })();
  return initializationPromise;
}

export async function writeStoreBundle(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const masterEntry = list.find(entry => entry?.key === MASTER_KEY);

  if (!masterEntry) return base.writeStoreBundle(list);

  const currentMaster = base.readStore(MASTER_KEY, {});
  if (!sameStaticMaster(masterEntry.value, currentMaster)) {
    return base.writeStoreBundle(list);
  }

  const operationalOnly = list.filter(entry => entry?.key !== MASTER_KEY);
  if (!operationalOnly.length) {
    return {
      mode: "master-static-unchanged",
      masterSkipped: true,
      results: []
    };
  }

  const result = await base.writeStoreBundle(operationalOnly);
  return {
    ...result,
    masterSkipped: true,
    masterSkipReason: "only-operational-stock-overlay-changed"
  };
}
