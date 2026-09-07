/* KasirPro - Import Master ke IndexedDB
 * OFFLINE-SAFE: tidak mengakses Firebase/Firestore.
 * Blank-cell merge: sel kosong pada update tidak menghapus nilai lama.
 * Produk baru wajib hanya Nama Produk + Supplier.
 * Kode Produk opsional; bila kosong dibuat otomatis ADD0001, ADD0002, dst.
 */

import {
    createEmptyMasterStore,
    buildMasterImportPlan,
    applyMasterImportPlan
} from "../excel/excel-import.js";
import {
    masterReady,
    readMasterSnapshot,
    readMasterVersion,
    installMasterSnapshot
} from "./master-repository.js";

const ALLOWED_SUPPLIERS = new Set([
    "supplier 1", "supplier 2", "supplier 3",
    "supplier 4", "supplier 5", "supplier 6"
]);

function cleanText(value) {
    return String(value ?? "").trim();
}

function comparable(value) {
    return cleanText(value).toLowerCase();
}

function isBlankCell(value) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function headerKey(value) {
    return cleanText(value).toLowerCase().replace(/[\s_\-]+/g, "");
}

function clone(value) {
    return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function sheetByName(workbookData, wanted) {
    const name = (workbookData?.sheetNames || []).find(
        item => cleanText(item).toLowerCase() === wanted.toLowerCase()
    );
    return name ? workbookData.sheets?.[name] : null;
}

function normalizeMaster(master) {
    const src = master || {};
    return {
        produk: Array.isArray(src.produk) ? src.produk : [],
        supplier: Array.isArray(src.supplier) ? src.supplier : [],
        kategori: Array.isArray(src.kategori) ? src.kategori : [],
        pengguna: [],
        pengaturan_toko: Array.isArray(src.pengaturan_toko) ? src.pengaturan_toko : []
    };
}

function addSequenceNumber(code) {
    const match = cleanText(code).toUpperCase().match(/^ADD(\d+)$/);
    return match ? Number(match[1]) : 0;
}

function nextAddSequence(currentMaster, workbookRows = [], codeIndex = -1) {
    let max = 0;

    (currentMaster?.produk || []).forEach(product => {
        max = Math.max(max, addSequenceNumber(product?.["Kode Produk"]));
    });

    if (codeIndex >= 0) {
        workbookRows.forEach(row => {
            max = Math.max(max, addSequenceNumber(row?.values?.[codeIndex]));
        });
    }

    return max + 1;
}

function formatAddCode(number) {
    return `ADD${String(number).padStart(4, "0")}`;
}

function findExistingProductByNameSupplier(currentMaster, name, supplier) {
    const targetName = comparable(name);
    const targetSupplier = comparable(supplier);
    if (!targetName) return null;

    const matches = (currentMaster?.produk || []).filter(product => {
        if (comparable(product?.["Nama Produk"]) !== targetName) return false;
        if (!targetSupplier) return true;
        return comparable(product?.["Supplier"]) === targetSupplier;
    });

    return matches.length === 1 ? matches[0] : null;
}

function prepareWorkbookProductCodes(workbookData, currentMaster) {
    const prepared = clone(workbookData || { sheetNames: [], sheets: {} });
    const productName = (prepared.sheetNames || []).find(name => comparable(name) === "produk");
    if (!productName) return prepared;

    const sheet = prepared.sheets?.[productName];
    if (!sheet) return prepared;

    sheet.headers = Array.isArray(sheet.headers) ? [...sheet.headers] : [];
    sheet.rows = Array.isArray(sheet.rows)
        ? sheet.rows.map(row => ({ ...row, values: Array.isArray(row.values) ? [...row.values] : [] }))
        : [];

    let codeIndex = sheet.headers.findIndex(h => headerKey(h) === headerKey("Kode Produk"));
    if (codeIndex < 0) {
        codeIndex = sheet.headers.length;
        sheet.headers.push("Kode Produk");
        sheet.rows.forEach(row => row.values.push(""));
    }

    const nameIndex = sheet.headers.findIndex(h => headerKey(h) === headerKey("Nama Produk"));
    const supplierIndex = sheet.headers.findIndex(h => headerKey(h) === headerKey("Supplier"));
    const usedCodes = new Set(
        (currentMaster?.produk || [])
            .map(product => comparable(product?.["Kode Produk"]))
            .filter(Boolean)
    );

    let nextNumber = nextAddSequence(currentMaster, sheet.rows, codeIndex);

    sheet.rows.forEach(row => {
        const currentCode = cleanText(row.values?.[codeIndex]);
        if (currentCode) {
            usedCodes.add(comparable(currentCode));
            return;
        }

        const name = nameIndex >= 0 ? cleanText(row.values?.[nameIndex]) : "";
        const supplier = supplierIndex >= 0 ? cleanText(row.values?.[supplierIndex]) : "";
        if (!name) return;

        const existing = findExistingProductByNameSupplier(currentMaster, name, supplier);
        const existingCode = cleanText(existing?.["Kode Produk"]);
        if (existingCode) {
            row.values[codeIndex] = existingCode;
            usedCodes.add(comparable(existingCode));
            return;
        }

        let generated = formatAddCode(nextNumber);
        while (usedCodes.has(comparable(generated))) {
            nextNumber += 1;
            generated = formatAddCode(nextNumber);
        }

        row.values[codeIndex] = generated;
        usedCodes.add(comparable(generated));
        nextNumber += 1;
    });

    return prepared;
}

function validateHeaders(workbookData) {
    const errors = [];
    const userSheet = (workbookData?.sheetNames || []).find(
        item => cleanText(item).toLowerCase() === "pengguna"
    );
    if (userSheet) {
        errors.push({
            sheet: userSheet,
            message: "Sheet PENGGUNA tidak boleh diimpor. Pengguna dikelola melalui aplikasi."
        });
    }

    const productSheet = sheetByName(workbookData, "PRODUK");
    if (!productSheet) return errors;

    const headers = new Set((productSheet.headers || []).map(headerKey));
    const required = ["Nama Produk", "Supplier"];
    const missing = required.filter(item => !headers.has(headerKey(item)));
    if (missing.length) {
        errors.push({
            sheet: "PRODUK",
            missing,
            message: `Kolom wajib belum tersedia: ${missing.join(", ")}`
        });
    }
    return errors;
}

function rowsAsObjects(sheet) {
    if (!sheet) return [];
    return (sheet.rows || []).map(row => {
        const record = {};
        (sheet.headers || []).forEach((header, index) => {
            record[header] = row.values?.[index] ?? "";
        });
        return { sourceRow: row.sourceRow, record };
    });
}

function planItemForRow(plan, collection, sourceRow) {
    return (plan?.items || []).find(item =>
        item.collection === collection && Number(item.sourceRow) === Number(sourceRow)
    ) || null;
}

function validateSupplierContract(workbookData, currentMaster, plan) {
    const issues = [];
    const supplierSheet = sheetByName(workbookData, "SUPPLIER");
    const productSheet = sheetByName(workbookData, "PRODUK");
    const known = new Set();

    rowsAsObjects(supplierSheet).forEach(({ record, sourceRow }) => {
        const raw = cleanText(record["Supplier"]);
        const label = raw.toLowerCase();
        if (!raw) return;
        if (!ALLOWED_SUPPLIERS.has(label)) {
            issues.push({
                sheet: "SUPPLIER",
                sourceRow,
                supplier: raw,
                message: "Supplier harus menggunakan label Supplier 1 sampai Supplier 6."
            });
            return;
        }
        known.add(label);
    });

    (currentMaster?.supplier || []).forEach(record => {
        const label = cleanText(record["Supplier"]).toLowerCase();
        if (ALLOWED_SUPPLIERS.has(label)) known.add(label);
    });

    rowsAsObjects(productSheet).forEach(({ record, sourceRow }) => {
        const raw = cleanText(record["Supplier"]);
        const label = raw.toLowerCase();
        const item = planItemForRow(plan, "produk", sourceRow);

        if (!raw && item?.status === "exact") return;
        if (!raw && (item?.status === "duplicate" || item?.status === "possible")) return;

        if (!raw) {
            issues.push({
                sheet: "PRODUK",
                sourceRow,
                supplier: "",
                message: "Supplier wajib diisi untuk produk baru."
            });
        } else if (!ALLOWED_SUPPLIERS.has(label)) {
            issues.push({
                sheet: "PRODUK",
                sourceRow,
                supplier: raw,
                message: "Supplier harus menggunakan label Supplier 1 sampai Supplier 6."
            });
        } else if (known.size && !known.has(label)) {
            issues.push({
                sheet: "PRODUK",
                sourceRow,
                supplier: raw,
                message: "Supplier belum tersedia pada Master Supplier aktif/workbook."
            });
        }
    });

    return issues;
}

function validateNewProductRequiredFields(plan) {
    const issues = [];
    for (const item of plan?.items || []) {
        if (item.collection !== "produk" || item.status !== "new") continue;
        const record = item.record || {};
        const missing = ["Nama Produk", "Supplier"].filter(field => isBlankCell(record[field]));
        if (missing.length) {
            issues.push({
                sheet: item.sheet || "PRODUK",
                sourceRow: item.sourceRow,
                missing,
                message: `Produk baru wajib mengisi: ${missing.join(", ")}`
            });
        }
    }
    return issues;
}

function findCurrentRecord(collection, incoming, currentMaster) {
    const list = currentMaster?.[collection] || [];

    if (collection === "produk") {
        const code = comparable(incoming?.["Kode Produk"]);
        return list.find(row => code && comparable(row?.["Kode Produk"]) === code) || null;
    }

    if (collection === "supplier") {
        const supplier = comparable(incoming?.["Supplier"]);
        const supplierName = comparable(incoming?.["Nama Supplier"]);
        return list.find(row =>
            (supplier && comparable(row?.["Supplier"] || row?.["Nama Supplier"]) === supplier) ||
            (supplierName && comparable(row?.["Nama Supplier"]) === supplierName)
        ) || null;
    }

    if (collection === "kategori") {
        const code = comparable(incoming?.["Kode Kategori"]);
        return list.find(row => code && comparable(row?.["Kode Kategori"]) === code) || null;
    }

    if (collection === "pengaturan_toko") {
        const name = comparable(incoming?.["Nama Toko"]);
        return list.find(row => name && comparable(row?.["Nama Toko"]) === name) || null;
    }

    return null;
}

function mergeNonBlank(existing, incoming) {
    const merged = { ...(existing || {}) };
    for (const [field, value] of Object.entries(incoming || {})) {
        if (isBlankCell(value)) continue;
        merged[field] = value;
    }
    return merged;
}

function buildBlankSafePlan(plan, currentMaster) {
    let preservedBlankCells = 0;
    const items = (plan?.items || []).map(item => {
        if (item.status !== "exact") return item;
        const existing = findCurrentRecord(item.collection, item.record, currentMaster);
        if (!existing) return item;

        for (const value of Object.values(item.record || {})) {
            if (isBlankCell(value)) preservedBlankCells += 1;
        }

        return {
            ...item,
            record: mergeNonBlank(existing, item.record)
        };
    });

    return {
        ...plan,
        items,
        blankMerge: { enabled: true, preservedBlankCells }
    };
}

function sanitizeImportedProduct(product) {
    const out = { ...(product || {}) };
    out["Kode Produk"] = cleanText(out["Kode Produk"]);
    out["Nama Produk"] = cleanText(out["Nama Produk"]);
    out["Supplier"] = cleanText(out["Supplier"]);
    delete out["Kode Supplier"];
    delete out["Nama Supplier"];
    delete out._firestoreDocumentId;
    delete out._localKey;
    return out;
}

function sanitizeImportedSupplier(supplier) {
    const out = { ...(supplier || {}) };
    out["Supplier"] = cleanText(out["Supplier"]);
    out["Nama Supplier"] = cleanText(out["Nama Supplier"]);
    delete out["Kode Supplier"];
    delete out._firestoreDocumentId;
    delete out._localKey;
    return out;
}

function sanitizeMaster(master) {
    const out = normalizeMaster(master);
    out.produk = out.produk.map(sanitizeImportedProduct);
    out.supplier = out.supplier.map(sanitizeImportedSupplier);
    out.kategori = out.kategori.map(row => {
        const x = { ...row };
        delete x._firestoreDocumentId;
        delete x._localKey;
        return x;
    });
    out.pengaturan_toko = out.pengaturan_toko.map(row => {
        const x = { ...row };
        delete x._firestoreDocumentId;
        delete x._localKey;
        return x;
    });
    return out;
}

export async function prepareLocalMasterImport(workbookData) {
    const current = (await masterReady())
        ? normalizeMaster(await readMasterSnapshot())
        : createEmptyMasterStore();

    const preparedWorkbook = prepareWorkbookProductCodes(workbookData, current);
    const headerErrors = validateHeaders(preparedWorkbook);
    const rawPlan = buildMasterImportPlan(preparedWorkbook, current);
    const supplierIssues = validateSupplierContract(preparedWorkbook, current, rawPlan);
    const requiredFieldIssues = validateNewProductRequiredFields(rawPlan);

    return {
        current,
        workbook: preparedWorkbook,
        plan: rawPlan,
        validation: {
            headerErrors,
            supplierIssues,
            requiredFieldIssues,
            canContinue:
                headerErrors.length === 0 &&
                supplierIssues.length === 0 &&
                requiredFieldIssues.length === 0
        }
    };
}

export async function commitLocalMasterImport(workbookData, options = {}) {
    const prepared = await prepareLocalMasterImport(workbookData);
    if (!prepared.validation.canContinue) {
        throw new Error("Workbook belum sesuai kontrak Import Master KasirPro.");
    }

    const existingMode = options.mode === "skip" ? "skip" : "update";
    const working = normalizeMaster(prepared.current);
    const planToApply = existingMode === "update"
        ? buildBlankSafePlan(prepared.plan, working)
        : prepared.plan;

    const result = applyMasterImportPlan(planToApply, working, { existingMode });
    const nextMaster = sanitizeMaster(result.store || working);

    const previousVersion = Number(await readMasterVersion()) || 0;
    const nextVersion = previousVersion + 1;

    await installMasterSnapshot(nextMaster, {
        version: nextVersion,
        source: "excel-import-local",
        updatedAt: new Date().toISOString()
    });

    return {
        ...result,
        blankMerge: planToApply.blankMerge || { enabled: false, preservedBlankCells: 0 },
        masterVersion: nextVersion,
        master: await readMasterSnapshot()
    };
}
