/* KasirPro AT-07 — Import Master Wizard v2 */
import { resetMasterSession } from "./master-import-session.js";

let panels = [];
let wizardRoot = null;
let panelObserver = null;

function ancestors(node) {
  const out = [];
  while (node && node !== document.body) { out.push(node); node = node.parentElement; }
  return out;
}

function deepestCommonAncestor(nodes) {
  if (!nodes.every(Boolean)) return null;
  const [first, ...rest] = nodes.map(ancestors);
  return first.find((candidate) => rest.every((list) => list.includes(candidate))) || null;
}

function directChildOf(root, node) {
  let current = node;
  while (current?.parentElement && current.parentElement !== root) current = current.parentElement;
  return current?.parentElement === root ? current : null;
}

function installStyle() {
  if (document.getElementById("kp-master-wizard-style")) return;
  const style = document.createElement("style");
  style.id = "kp-master-wizard-style";
  style.textContent = `
    .kp-master-wizard-panel{transition:opacity .2s ease,transform .2s ease}
    .kp-master-wizard-panel.kp-enter{opacity:0;transform:translateX(20px)}
    .kp-master-wizard-panel.kp-active{opacity:1;transform:translateX(0)}
  `;
  document.head.appendChild(style);
}

function resolvePanels() {
  const anchors = [
    document.getElementById("read-master-file"),
    document.getElementById("master-preview-body"),
    document.getElementById("continue-master-confirm"),
    document.getElementById("confirm-master-import")
  ];
  const root = deepestCommonAncestor(anchors);
  if (!root) return false;
  const resolved = anchors.map((anchor) => directChildOf(root, anchor));
  if (new Set(resolved).size !== 4 || resolved.some((node) => !node)) return false;
  wizardRoot = root;
  panels = resolved;
  panels.forEach((panel, index) => {
    panel.classList.add("kp-master-wizard-panel");
    panel.dataset.kpWizardStep = String(index + 1);
  });
  return true;
}

function isVisible(panel) {
  if (!panel || panel.hidden) return false;
  const style = getComputedStyle(panel);
  return style.display !== "none" && style.visibility !== "hidden";
}

function updateStepper(step) {
  if (!wizardRoot) return;
  const scope = wizardRoot.parentElement || document;
  scope.querySelectorAll("[class*='step']").forEach((item) => {
    const match = String(item.textContent || "").trim().match(/^([1-4])\b/);
    if (!match) return;
    const n = Number(match[1]);
    item.classList.toggle("active", n === step);
    item.classList.toggle("is-active", n === step);
    item.classList.toggle("completed", n < step);
    item.classList.toggle("is-complete", n < step);
  });
}

function animateCurrentPanel() {
  if (!panels.length) return;
  const index = panels.findIndex(isVisible);
  if (index < 0) return;
  panels.forEach((panel, i) => panel.classList.toggle("kp-active", i === index));
  const target = panels[index];
  if (target.dataset.kpAnimatedStep !== String(index + 1)) {
    target.dataset.kpAnimatedStep = String(index + 1);
    target.classList.add("kp-enter");
    requestAnimationFrame(() => requestAnimationFrame(() => target.classList.remove("kp-enter")));
  }
  updateStepper(index + 1);
}

export function goToMasterStep(step, options = {}) {
  if (!panels.length && !resolvePanels()) return false;
  const target = panels[step - 1];
  if (!target) return false;
  panels.forEach((panel, index) => {
    const active = index === step - 1;
    panel.hidden = !active;
    panel.style.display = active ? "" : "none";
    if (!active) delete panel.dataset.kpAnimatedStep;
  });
  animateCurrentPanel();
  if (options.scroll !== false) target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function clearPreviewUi() {
  ["master-preview-head","master-preview-body","master-warning-body","master-match-body"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = "";
  });
  ["summary-sheet-count","summary-row-count","summary-warning-count","preview-visible-count","warning-total-count","warning-empty-row-count","warning-partial-row-count","match-new-count","match-exact-count","match-review-count","match-duplicate-count","match-total-count"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = "0";
  });
  const result = document.getElementById("master-import-result");
  if (result) result.hidden = true;
  const consent = document.getElementById("kp-master-replace-consent");
  if (consent) consent.checked = false;
}

export function resetMasterWizard() {
  resetMasterSession();
  const remove = document.getElementById("remove-master-file");
  if (remove) {
    try { remove.click(); } catch {}
  }
  const input = document.getElementById("master-file-input");
  if (input) input.value = "";
  clearPreviewUi();
  setTimeout(() => goToMasterStep(1, { scroll: false }), 0);
}

function install() {
  installStyle();
  if (!resolvePanels()) return;
  animateCurrentPanel();

  panelObserver?.disconnect();
  panelObserver = new MutationObserver(animateCurrentPanel);
  panels.forEach((panel) => panelObserver.observe(panel, {
    attributes: true,
    attributeFilter: ["hidden", "class", "style"]
  }));

  window.addEventListener("kasirpro:master-import-go-step", (event) => goToMasterStep(Number(event.detail?.step) || 1));
  window.addEventListener("kasirpro:master-import-reset", resetMasterWizard);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();

window.KasirProMasterWizard = Object.freeze({ goToStep: goToMasterStep, reset: resetMasterWizard });
