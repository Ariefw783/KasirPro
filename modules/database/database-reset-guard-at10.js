/* KasirPro AT-10 — Cross-device Factory Reset Guard
 * Membaca satu reset token pada root document toko. Jika token berubah,
 * seluruh cache Master/Operational perangkat dibersihkan sebelum database aktif dibuka.
 */
import { firebaseDb } from "./firebase-client.js";
import { waitForFirebaseUser } from "./auth.js";
import { ROOT_DOCUMENT_PATH } from "./database-paths.js";
import { clearKasirProLocalMaster } from "../local/indexeddb-store.js";
import { clearOperationalCache } from "../local/operational-indexeddb.js";
import {
  doc,
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const RESET_TOKEN_LOCAL_KEY = "kasirpro_database_reset_token_v1";
const LEGACY_KEYS = [
  "kasirpro_master_store_v1",
  "kasirpro_purchase_invoices_v1",
  "kasirpro_sales_v1",
  "kasirpro_stock_movements_v1",
  "kasirpro_stock_opname_v1"
];

let guardPromise = null;

function cleanLegacyCaches() {
  try {
    LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
    sessionStorage.removeItem("kasirpro_preload_session_v1");
  } catch {}
}

export function getLocalDatabaseResetToken() {
  try { return String(localStorage.getItem(RESET_TOKEN_LOCAL_KEY) || "").trim(); }
  catch { return ""; }
}

export function setLocalDatabaseResetToken(token) {
  try { localStorage.setItem(RESET_TOKEN_LOCAL_KEY, String(token || "").trim()); }
  catch {}
}

export async function applyDatabaseResetMarker() {
  if (guardPromise) return guardPromise;
  guardPromise = (async () => {
    const user = await waitForFirebaseUser();
    if (!user) return { checked: false, cleared: false, reason: "firebase-user-unavailable" };

    try {
      const ref = doc(firebaseDb, ...ROOT_DOCUMENT_PATH);
      const snap = await getDocFromServer(ref);
      if (!snap.exists()) return { checked: true, cleared: false, reason: "root-document-missing" };

      const remoteToken = String(snap.data()?.databaseResetToken || "").trim();
      if (!remoteToken) return { checked: true, cleared: false, reason: "no-reset-token" };

      const localToken = getLocalDatabaseResetToken();
      if (remoteToken === localToken) {
        return { checked: true, cleared: false, reason: "token-current", token: remoteToken };
      }

      await clearOperationalCache();
      await clearKasirProLocalMaster();
      cleanLegacyCaches();
      setLocalDatabaseResetToken(remoteToken);

      window.dispatchEvent(new CustomEvent("kasirpro:database-reset-applied", {
        detail: { token: remoteToken, source: "central-reset-marker" }
      }));

      return { checked: true, cleared: true, reason: "new-reset-token", token: remoteToken };
    } catch (error) {
      console.warn("AT-10 reset marker tidak dapat diperiksa; startup dilanjutkan dengan mekanisme AT-09:", error);
      return { checked: false, cleared: false, reason: "marker-read-failed", error: error?.message || String(error) };
    }
  })();
  return guardPromise;
}

export { RESET_TOKEN_LOCAL_KEY };
