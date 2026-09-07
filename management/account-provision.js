import { initializeDatabase, readStore, writeStore } from "../modules/database/database-store.js";
import { provisionFirebaseUser, signOutKasirPro, waitForFirebaseUser } from "../modules/database/auth.js";

const form = document.getElementById("provision-form");
const notice = document.getElementById("provision-notice");
const submit = document.getElementById("provision-submit");
const nameInput = document.getElementById("cashier-name");
const usernameInput = document.getElementById("cashier-username");
const passwordInput = document.getElementById("cashier-password");
const confirmInput = document.getElementById("cashier-password-confirm");
const statusInput = document.getElementById("cashier-status");

function show(message, type = "") {
    notice.textContent = message;
    notice.className = `provision-notice ${type}`.trim();
}

function cleanUsername(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function updateGmailAliasNotice() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
        if (node.nodeValue.includes("Email internal dibuat otomatis: username@kasirpro-v2.app")) {
            node.nodeValue = "Email login dibuat otomatis sebagai alias Gmail Admin.";
            return;
        }
    }
}

async function start() {
    try {
        await initializeDatabase();
        const user = await waitForFirebaseUser();
        const session = JSON.parse(sessionStorage.getItem("kasirpro_session") || "null");
        if (!user || session?.role !== "admin") throw new Error("Hanya Administrator aktif yang dapat membuat akun kasir.");
        form.hidden = false;
        updateGmailAliasNotice();
        show("Sesi Administrator terverifikasi. Password tidak akan disimpan.");
    } catch (error) {
        show(error?.message || "Sesi tidak valid. Silakan login sebagai Admin.", "error");
        setTimeout(() => { window.location.href = "../index.html"; }, 2200);
    }
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = cleanUsername(usernameInput.value);
    const name = nameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !/^[a-z0-9._-]+$/.test(username)) return show("Username hanya boleh berisi huruf kecil, angka, titik, garis bawah, atau tanda minus.", "error");
    if (password.length < 8) return show("Password minimal 8 karakter.", "error");
    if (password !== confirmInput.value) return show("Konfirmasi password tidak sama.", "error");
    if (username === "admin") return show("Username admin dikelola khusus dan tidak dapat dibuat dari halaman ini.", "error");

    submit.disabled = true;
    show("Membuat akun di Firebase Authentication…");
    try {
        const result = await provisionFirebaseUser({ username, name, role: "cashier", status: statusInput.value, password });
        if (result.status === "existing") throw new Error(`Username ${username} sudah digunakan atau sudah memiliki akun Authentication.`);
        if (result.status !== "created") throw new Error(result.reason || "Akun gagal dibuat.");

        const store = readStore("kasirpro_master_store_v1", { produk: [], supplier: [], kategori: [], pengguna: [], pengaturan_toko: [] });
        const users = Array.isArray(store.pengguna) ? store.pengguna.filter((item) => String(item.Username || "").toLowerCase() !== username) : [];
        users.push({ "ID Pengguna": result.uid, "Nama": name || username, "Role": "Kasir", "Username": username, "Status": statusInput.value, "Email": result.authEmail, "Kredensial": "Firebase Authentication" });
        await writeStore("kasirpro_master_store_v1", { ...store, pengguna: users });
        show(`Akun ${username} berhasil dibuat. Password tidak disimpan di Firestore.`, "success");
        form.reset();
    } catch (error) {
        show(error?.message || "Akun gagal dibuat.", "error");
    } finally {
        passwordInput.value = "";
        confirmInput.value = "";
        submit.disabled = false;
    }
});

start();


