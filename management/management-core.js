/* KasirPro Management Core — AT-06 Interaction Recovery
 * Core legacy tetap menjadi sumber event/navigasi Management.
 * Loader persen disembunyikan hanya pada halaman Management tanpa monkeypatch global.
 */

function installNoPercentLoaderStyle() {
  if (document.getElementById("kasirpro-management-no-percent-loader")) return;
  const style = document.createElement("style");
  style.id = "kasirpro-management-no-percent-loader";
  style.textContent = `
    #app-loading,
    #app-loading .app-loading-progress,
    #app-loading [data-app-loading-progress],
    #app-loading [data-app-loading-percent],
    #app-loading [role="progressbar"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function forceHideLegacyLoader() {
  const loading = document.getElementById("app-loading");
  if (!loading) return;
  if (!loading.hidden) loading.hidden = true;
  if (loading.getAttribute("aria-hidden") !== "true") loading.setAttribute("aria-hidden", "true");
  loading.style.setProperty("display", "none", "important");
  loading.style.setProperty("visibility", "hidden", "important");
  loading.style.setProperty("pointer-events", "none", "important");
}

installNoPercentLoaderStyle();
forceHideLegacyLoader();

// Muat core asli terlebih dahulu. Tidak ada lagi penggantian window.addEventListener.
await import("./management-core-base.js");

forceHideLegacyLoader();

// Amati hanya elemen loader, bukan seluruh halaman, sehingga tidak mengganggu interaksi UI.
const loading = document.getElementById("app-loading");
if (loading) {
  const loaderObserver = new MutationObserver(() => forceHideLegacyLoader());
  loaderObserver.observe(loading, {
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden"],
    childList: true,
    subtree: true
  });
}

window.addEventListener("pageshow", forceHideLegacyLoader);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) forceHideLegacyLoader();
});
