/* KasirPro AT-12 — Management Display Mapping & Responsive Tables
 * Display-only enhancement.
 * - Internal category/supplier values remain unchanged.
 * - Visible category codes are mapped to Nama Kategori.
 * - Visible Supplier N labels are mapped to Nama Supplier.
 * - Management tables become stacked record cards on mobile.
 * - Filter controls stack cleanly on mobile.
 */

import { readStore } from "../modules/database/database-store.js";

const MASTER_KEY = "kasirpro_master_store_v1";
const MOBILE_BREAKPOINT = 820;

let categoryNameByKey = new Map();
let supplierNameByKey = new Map();
let masterSignature = "";
let scanTimer = null;
let mapsReady = false;
let pendingScanRoot = document;

const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).toLowerCase();

function master() {
    return readStore(MASTER_KEY, {}) || {};
}

function masterArrays(data) {
    return {
        categories: Array.isArray(data?.kategori) ? data.kategori : [],
        suppliers: Array.isArray(data?.supplier) ? data.supplier : []
    };
}

function signatureFor(data) {
    const { categories, suppliers } = masterArrays(data);
    const cFirst = categories[0]?.["Kode Kategori"] || categories[0]?.["Nama Kategori"] || "";
    const cLast = categories.at(-1)?.["Kode Kategori"] || categories.at(-1)?.["Nama Kategori"] || "";
    const sFirst = suppliers[0]?.["Supplier"] || suppliers[0]?.["Nama Supplier"] || "";
    const sLast = suppliers.at(-1)?.["Supplier"] || suppliers.at(-1)?.["Nama Supplier"] || "";
    return `${categories.length}:${suppliers.length}:${cFirst}:${cLast}:${sFirst}:${sLast}`;
}

function addAlias(map, key, display) {
    const k = norm(key);
    const d = text(display);
    if (!k || !d) return;
    map.set(k, d);
    map.set(norm(d), d);
}

function rebuildMapsIfNeeded(force = false) {
    if (mapsReady && !force) return false;
    const data = master();
    const signature = signatureFor(data);
    if (!force && signature === masterSignature && (categoryNameByKey.size || supplierNameByKey.size)) return false;

    const { categories, suppliers } = masterArrays(data);
    const nextCategories = new Map();
    const nextSuppliers = new Map();

    for (const category of categories) {
        const display = text(category?.["Nama Kategori"] || category?.["Kategori"] || category?.["Kode Kategori"]);
        addAlias(nextCategories, category?.["Kode Kategori"], display);
        addAlias(nextCategories, category?.["Kategori"], display);
        addAlias(nextCategories, category?.["Nama Kategori"], display);
    }

    for (const supplier of suppliers) {
        const display = text(supplier?.["Nama Supplier"] || supplier?.["Supplier"] || supplier?.["Kode Supplier"]);
        addAlias(nextSuppliers, supplier?.["Supplier"], display);
        addAlias(nextSuppliers, supplier?.["Kode Supplier"], display);
        addAlias(nextSuppliers, supplier?.["Nama Supplier"], display);
    }

    categoryNameByKey = nextCategories;
    supplierNameByKey = nextSuppliers;
    masterSignature = signature;
    mapsReady = true;
    return true;
}

function categoryDisplay(value) {
    return categoryNameByKey.get(norm(value)) || "";
}

function supplierDisplay(value) {
    return supplierNameByKey.get(norm(value)) || "";
}

function replaceSimpleText(element, resolver) {
    if (!(element instanceof HTMLElement)) return;
    const current = text(element.textContent);
    if (!current) return;
    const display = resolver(current);
    if (!display || display === current) return;

    if (element.childElementCount === 0) {
        element.textContent = display;
        element.title = display;
        return;
    }

    const leaves = element.querySelectorAll("span,strong,small,div");
    for (const leaf of leaves) {
        if (!(leaf instanceof HTMLElement) || leaf.childElementCount) continue;
        const leafText = text(leaf.textContent);
        const leafDisplay = resolver(leafText);
        if (!leafDisplay || leafDisplay === leafText) continue;
        leaf.textContent = leafDisplay;
        leaf.title = leafDisplay;
    }
}

function headerKind(label) {
    const key = norm(label);
    if (key.includes("kategori") || key.includes("category")) return "category";
    if (key.includes("supplier") || key.includes("pemasok")) return "supplier";
    return "";
}

function tableHeaders(table) {
    let headers = [...table.querySelectorAll("thead th")];
    if (!headers.length) headers = [...table.querySelectorAll("tr:first-child th")];
    return headers.map((th) => text(th.textContent) || "Data");
}

function decorateTable(table) {
    if (!(table instanceof HTMLTableElement)) return;
    const headers = tableHeaders(table);
    if (!headers.length) return;

    table.classList.add("at12-responsive-table");
    const bodyId = table.tBodies?.[0]?.id || "";
    if (bodyId === "products-table-body") table.classList.add("at13-products-table");

    const rows = table.querySelectorAll("tbody tr");
    rows.forEach((row) => {
        const cells = [...row.children].filter((cell) => cell.tagName === "TD");
        if (!cells.length) return;

        cells.forEach((cell, index) => {
            const label = headers[index] || `Data ${index + 1}`;
            cell.dataset.at12Label = label;

            if (cell.hasAttribute("colspan")) return;
            const kind = headerKind(label);
            if (kind === "category") replaceSimpleText(cell, categoryDisplay);
            if (kind === "supplier") replaceSimpleText(cell, supplierDisplay);
        });
    });
}

function decorateTables(root = document) {
    const tables = [];
    if (root instanceof HTMLTableElement) tables.push(root);
    root.querySelectorAll?.("table").forEach((table) => tables.push(table));
    tables.forEach(decorateTable);
}

function optionKind(select) {
    const identity = norm(`${select.id} ${select.name} ${select.getAttribute("aria-label") || ""}`);
    if (identity.includes("kategori") || identity.includes("category")) return "category";
    if (identity.includes("supplier") || identity.includes("pemasok")) return "supplier";

    let categoryHits = 0;
    let supplierHits = 0;
    [...select.options].forEach((option) => {
        const key = norm(option.value || option.textContent);
        if (categoryNameByKey.has(key)) categoryHits += 1;
        if (supplierNameByKey.has(key)) supplierHits += 1;
    });
    if (categoryHits > supplierHits && categoryHits > 0) return "category";
    if (supplierHits > categoryHits && supplierHits > 0) return "supplier";
    return "";
}

function decorateSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    const kind = optionKind(select);
    if (kind) {
        select.dataset.at12DisplayKind = kind;
        const resolver = kind === "category" ? categoryDisplay : supplierDisplay;
        [...select.options].forEach((option) => {
            const display = resolver(option.value) || resolver(option.textContent);
            if (display) option.textContent = display;
        });
    }

    if (select.id?.toLowerCase().includes("filter") || kind) {
        select.parentElement?.classList.add("at12-mobile-filter-field");
    }
}

function decorateFilters(root = document) {
    const selects = [];
    if (root instanceof HTMLSelectElement) selects.push(root);
    root.querySelectorAll?.("select").forEach((select) => selects.push(select));
    selects.forEach(decorateSelect);

    root.querySelectorAll?.('input[id*="search" i], input[id*="filter" i]').forEach((input) => {
        input.parentElement?.classList.add("at12-mobile-filter-field");
    });
}

function decorateStandaloneMappedFields(root = document) {
    const candidates = root.querySelectorAll?.('[id*="category" i], [id*="kategori" i], [id*="supplier" i], [data-field*="category" i], [data-field*="kategori" i], [data-field*="supplier" i]') || [];
    candidates.forEach((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || element instanceof HTMLOptionElement) return;
        const identity = norm(`${element.id || ""} ${element.getAttribute("data-field") || ""}`);
        if (identity.includes("kategori") || identity.includes("category")) replaceSimpleText(element, categoryDisplay);
        if (identity.includes("supplier")) replaceSimpleText(element, supplierDisplay);
    });
}

function installStyle() {
    if (document.getElementById("kasirpro-at12-display-style")) return;
    const style = document.createElement("style");
    style.id = "kasirpro-at12-display-style";
    style.textContent = `
      /* AT-12 desktop: keep normal tables. */
      .at12-responsive-table td[data-at12-label] { vertical-align: middle; }

      @media (max-width:${MOBILE_BREAKPOINT}px) {
        .at12-mobile-filter-field {
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
          flex:1 1 100% !important;
          grid-column:1 / -1 !important;
        }
        .at12-mobile-filter-field > input,
        .at12-mobile-filter-field > select,
        .at12-mobile-filter-field input,
        .at12-mobile-filter-field select {
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
        }

        .table-wrapper:has(> table.at12-responsive-table),
        .table-wrapper:has(table.at12-responsive-table) {
          overflow:visible !important;
          width:100% !important;
          max-width:100% !important;
        }

        table.at12-responsive-table {
          display:block !important;
          width:100% !important;
          min-width:0 !important;
          max-width:100% !important;
          table-layout:auto !important;
          border:0 !important;
          background:transparent !important;
        }
        table.at12-responsive-table thead {
          position:absolute !important;
          width:1px !important;
          height:1px !important;
          padding:0 !important;
          margin:-1px !important;
          overflow:hidden !important;
          clip:rect(0,0,0,0) !important;
          white-space:nowrap !important;
          border:0 !important;
        }
        table.at12-responsive-table tbody {
          display:grid !important;
          width:100% !important;
          max-width:100% !important;
          gap:12px !important;
          background:transparent !important;
        }
        table.at12-responsive-table tbody tr {
          display:grid !important;
          grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important;
          gap:0 12px !important;
          width:100% !important;
          max-width:100% !important;
          min-width:0 !important;
          margin:0 !important;
          padding:8px 12px !important;
          border:1px solid #dce4ec !important;
          border-radius:12px !important;
          background:#fff !important;
          box-shadow:0 1px 3px rgba(15,42,67,.06) !important;
        }
        table.at12-responsive-table tbody tr[hidden] { display:none !important; }
        table.at12-responsive-table tbody td {
          display:grid !important;
          grid-template-columns:minmax(88px,38%) minmax(0,1fr) !important;
          align-items:start !important;
          gap:12px !important;
          width:100% !important;
          min-width:0 !important;
          max-width:100% !important;
          min-height:0 !important;
          padding:9px 0 !important;
          border:0 !important;
          border-bottom:1px solid #edf1f5 !important;
          font-size:.72rem !important;
          line-height:1.4 !important;
          text-align:left !important;
          white-space:normal !important;
          overflow:visible !important;
          overflow-wrap:anywhere !important;
          word-break:normal !important;
        }
        table.at13-products-table tbody td:nth-child(1),
        table.at13-products-table tbody td:nth-child(2) { grid-column:1 / -1 !important; }
        table.at13-products-table tbody td:nth-child(5),
        table.at13-products-table tbody td:nth-child(6),
        table.at13-products-table tbody td:nth-child(9) { display:none !important; }
        table.at13-products-table tbody td:nth-child(3),
        table.at13-products-table tbody td:nth-child(4),
        table.at13-products-table tbody td:nth-child(7),
        table.at13-products-table tbody td:nth-child(8),
        table.at13-products-table tbody td:nth-child(10) {
          display:block !important;
          padding:6px 0 !important;
        }
        table.at13-products-table tbody td::before { margin-bottom:2px !important; }
        table.at12-responsive-table tbody td:last-child { border-bottom:0 !important; }
        table.at12-responsive-table tbody td::before {
          content:attr(data-at12-label);
          display:block;
          min-width:0;
          color:#66788a;
          font-size:.64rem;
          font-weight:800;
          line-height:1.35;
          letter-spacing:.01em;
        }
        table.at12-responsive-table tbody td[colspan] {
          display:block !important;
          padding:16px 4px !important;
          text-align:center !important;
        }
        table.at12-responsive-table tbody td[colspan]::before { display:none !important; }
        table.at12-responsive-table tbody td > * {
          min-width:0 !important;
          max-width:100% !important;
        }
        table.at12-responsive-table tbody td button,
        table.at12-responsive-table tbody td .button,
        table.at12-responsive-table tbody td a {
          justify-self:start;
        }
        table.at12-responsive-table .status-badge,
        table.at12-responsive-table .stock-badge,
        table.at12-responsive-table .badge,
        table.at12-responsive-table [class*="status"],
        table.at12-responsive-table [class*="badge"] {
          max-width:100% !important;
          white-space:normal !important;
        }
      }

      @media (max-width:480px) {
        table.at12-responsive-table tbody tr { padding:7px 10px !important; border-radius:10px !important; }
        table.at12-responsive-table tbody td {
          grid-template-columns:minmax(96px,36%) minmax(0,1fr) !important;
          gap:10px !important;
          padding:8px 0 !important;
          font-size:.7rem !important;
        }
        table.at12-responsive-table tbody td::before { font-size:.61rem !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function applyDisplayLayer(root = document) {
    rebuildMapsIfNeeded();
    decorateFilters(root);
    decorateTables(root);
    decorateStandaloneMappedFields(root);
}

function scheduleScan(source = document) {
    const target = source instanceof Event ? source.target : source;
    pendingScanRoot = target?.closest?.(".table-wrapper, .filter-bar, [data-view], section, main") || document;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        scanTimer = null;
        const root = pendingScanRoot;
        pendingScanRoot = document;
        applyDisplayLayer(root);
    }, 60);
}

function start() {
    installStyle();
    rebuildMapsIfNeeded(true);
    applyDisplayLayer(document);

    document.addEventListener("click", scheduleScan, true);
    document.addEventListener("change", scheduleScan, true);
    document.addEventListener("input", scheduleScan, true);
    ["kasirpro:database-ready", "kasirpro:database-synced"].forEach(name => {
        window.addEventListener(name, () => {
            mapsReady = false;
            scheduleScan();
        });
    });
    window.addEventListener("kasirpro:operational-sync", scheduleScan);
    window.addEventListener("kasirpro:local-master-updated", () => {
        mapsReady = false;
        scheduleScan();
    });
    window.addEventListener("pageshow", scheduleScan);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once:true });
} else {
    start();
}
