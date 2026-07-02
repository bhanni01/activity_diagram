/* ============================================================
   export.js — PDF export (html2pdf.js) and AI prompt generation.
   Uses `state`, `dom`, `showToast` and `fx` from app.js and the
   type registry from diagrams.js (all loaded on the same page).
   ============================================================ */

"use strict";

/* In-memory caches, keyed by a fingerprint of the diagram content. */
const exportCache = {
  key: null,
  prompt: null,
  pdfBlob: null,
  pdfName: null,
};

function diagramFingerprint() {
  return JSON.stringify({
    name: getDiagramName(),
    elements: state.elements.map((e) => [
      e.id, e.type, e.label, e.description || "", Math.round(e.x), Math.round(e.y), e.w, e.h,
    ]),
    connections: state.connections.map((c) => [c.from, c.to, c.label || ""]),
  });
}

function invalidateStaleCache() {
  const key = diagramFingerprint();
  if (exportCache.key !== key) {
    exportCache.key = key;
    exportCache.prompt = null;
    exportCache.pdfBlob = null;
    exportCache.pdfName = null;
  }
}

function getDiagramName() {
  return dom.diagramName.value.trim();
}

function requireExportPreconditions() {
  if (!getDiagramName()) {
    showToast("Please enter a diagram name before exporting.", true);
    dom.diagramName.focus();
    return false;
  }
  if (!state.elements.length) {
    showToast("The canvas is empty — add some elements first.", true);
    return false;
  }
  return true;
}

/* ---------------- SVG rasterization ---------------- */

function diagramBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of state.elements) {
    minX = Math.min(minX, el.x - el.w / 2);
    minY = Math.min(minY, el.y - el.h / 2);
    maxX = Math.max(maxX, el.x + el.w / 2);
    maxY = Math.max(maxY, el.y + el.h / 2);
  }
  const pad = 40;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Clone the live SVG, strip UI-only nodes and inline connection styles. */
function exportableSvg() {
  const bounds = diagramBounds();
  const clone = dom.canvas.cloneNode(true);
  clone.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  clone.setAttribute("width", bounds.w);
  clone.setAttribute("height", bounds.h);
  for (const node of clone.querySelectorAll(".port, .conn-hit, .temp-conn")) node.remove();
  for (const path of clone.querySelectorAll(".conn-path")) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#00d9ff");
    path.setAttribute("stroke-width", "2");
  }
  for (const g of clone.querySelectorAll(".selected")) g.classList.remove("selected");
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", bounds.x);
  bg.setAttribute("y", bounds.y);
  bg.setAttribute("width", bounds.w);
  bg.setAttribute("height", bounds.h);
  bg.setAttribute("fill", "#0a0e27");
  clone.insertBefore(bg, clone.firstChild);
  clone.querySelectorAll("text").forEach((t) => t.setAttribute("font-family", "Helvetica, Arial, sans-serif"));
  return { svg: clone, bounds };
}

function svgToPngDataUrl() {
  return new Promise((resolve, reject) => {
    const { svg, bounds } = exportableSvg();
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      try {
        const scale = 2; // crisp output in the PDF
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(bounds.w * scale);
        canvas.height = Math.ceil(bounds.h * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), bounds });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize the diagram SVG."));
    };
    img.src = url;
  });
}

/* ---------------- Export overlay ---------------- */

const overlay = {
  root: document.getElementById("export-overlay"),
  anim: document.getElementById("export-anim"),
  message: document.getElementById("export-message"),
};

function showExportOverlay(message) {
  overlay.message.textContent = message;
  overlay.root.hidden = false;
  if (!fxOverlayAnimation("loading")) {
    overlay.anim.innerHTML = '<div class="css-spinner"></div>';
  }
}

function exportOverlaySuccess(message) {
  overlay.message.textContent = message;
  if (!fxOverlayAnimation("success")) {
    overlay.anim.innerHTML = '<div style="font-size:56px;line-height:90px;text-align:center;color:#00ff88;">&#10003;</div>';
  }
  setTimeout(hideExportOverlay, 1300);
}

function hideExportOverlay() {
  overlay.root.hidden = true;
  fxOverlayAnimation("stop");
  overlay.anim.innerHTML = "";
}

/* Delegates to the Lottie layer when present; falls back to CSS. */
function fxOverlayAnimation(kind) {
  const hooks = window.FX;
  if (hooks && typeof hooks.overlayAnimation === "function") {
    try {
      return hooks.overlayAnimation(overlay.anim, kind) === true;
    } catch (err) {
      console.warn("Lottie overlay animation failed:", err);
    }
  }
  return false;
}

/* ---------------- PDF export ---------------- */

function pdfFileName() {
  const safeName = getDiagramName().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "diagram";
  const date = new Date().toISOString().slice(0, 10);
  return `${safeName}-${date}.pdf`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportPdf() {
  if (!requireExportPreconditions()) return;
  invalidateStaleCache();

  if (exportCache.pdfBlob) {
    downloadBlob(exportCache.pdfBlob, exportCache.pdfName);
    showToast("PDF downloaded (from cache).");
    return;
  }

  showExportOverlay("Generating PDF…");
  try {
    const { dataUrl, bounds } = await svgToPngDataUrl();
    const name = getDiagramName();
    const timestamp = new Date().toLocaleString();

    const container = document.createElement("div");
    container.style.cssText =
      "width:760px;padding:28px;background:#0a0e27;color:#e0e0e0;font-family:Helvetica,Arial,sans-serif;";
    const maxW = 700;
    const imgW = Math.min(maxW, bounds.w);
    container.innerHTML = `
      <h1 style="margin:0;font-size:24px;color:#00ff88;">${escapeHtml(name)}</h1>
      <p style="margin:6px 0 2px;font-size:11px;color:#8a93b5;">UML Activity Diagram &mdash; generated ${escapeHtml(timestamp)}</p>
      <p style="margin:0 0 16px;font-size:11px;color:#8a93b5;">${state.elements.length} elements &middot; ${state.connections.length} connections</p>
      <img src="${dataUrl}" style="width:${imgW}px;border:1px solid #223;border-radius:6px;" />
    `;

    const filename = pdfFileName();
    const worker = html2pdf()
      .set({
        margin: 8,
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: "#0a0e27" },
        jsPDF: { unit: "mm", format: "a4", orientation: bounds.w > bounds.h * 1.2 ? "landscape" : "portrait" },
      })
      .from(container);

    const blob = await worker.outputPdf("blob");
    exportCache.pdfBlob = blob;
    exportCache.pdfName = filename;
    downloadBlob(blob, filename);
    exportOverlaySuccess("PDF exported!");
  } catch (err) {
    console.error("PDF export failed:", err);
    hideExportOverlay();
    showToast(`PDF export failed: ${err.message || err}`, true);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ---------------- Prompt export ---------------- */

function generatePrompt() {
  invalidateStaleCache();
  if (exportCache.prompt) return exportCache.prompt;

  const name = getDiagramName() || "Untitled Workflow";
  const byId = new Map(state.elements.map((e) => [e.id, e]));
  const lines = [];

  lines.push(`# Workflow Specification: ${name}`);
  lines.push("");
  lines.push(
    "The following is a UML activity diagram specification describing a workflow. " +
      "You are an AI coding agent: read the elements and flow below, then implement " +
      "this workflow as code (functions, branching logic and control flow) in the " +
      "language or framework requested by the user."
  );
  lines.push("");
  lines.push(`## Elements (${state.elements.length})`);
  lines.push("");
  state.elements.forEach((el, i) => {
    lines.push(`${i + 1}. [${ElementTypes[el.type].name}] "${el.label}" (id: ${el.id})`);
    if (el.description) {
      lines.push(`   Description: ${el.description.replace(/\s*\n\s*/g, " ")}`);
    }
  });
  lines.push("");
  lines.push(`## Flow (${state.connections.length} connections)`);
  lines.push("");
  if (!state.connections.length) {
    lines.push("(No connections defined yet.)");
  }
  for (const conn of state.connections) {
    const from = byId.get(conn.from);
    const to = byId.get(conn.to);
    if (!from || !to) continue;
    const arrow = conn.label ? `--[${conn.label}]-->` : "-->";
    lines.push(`- "${from.label}" (${from.type}) ${arrow} "${to.label}" (${to.type})`);
  }
  lines.push("");
  lines.push("## Semantics");
  lines.push("");
  lines.push("- start: entry point of the workflow; execution begins here.");
  lines.push("- end: terminal point; execution stops when reached.");
  lines.push("- activity: a concrete action or processing step to implement.");
  lines.push("- decision: a conditional branch; each outgoing connection is one possible outcome.");
  lines.push("- merge: converging branches rejoin into a single flow.");
  lines.push("- Arrow labels in [brackets] are branch conditions or outcomes (e.g. [Yes], [No]).");
  lines.push("");
  lines.push("## Instructions for the agent");
  lines.push("");
  lines.push("1. Model each activity as a well-named function or step.");
  lines.push("2. Implement each decision as explicit conditional logic covering every outgoing branch.");
  lines.push("3. Preserve the exact flow order defined by the connections above.");
  lines.push("4. Handle error paths and edge cases implied by the branch labels.");
  lines.push("5. Ask the user for clarification if a branch condition is ambiguous.");

  exportCache.prompt = lines.join("\n");
  return exportCache.prompt;
}

const promptModal = {
  root: document.getElementById("prompt-modal"),
  text: document.getElementById("prompt-text"),
};

function openPromptModal() {
  if (!requireExportPreconditions()) return;
  promptModal.text.value = generatePrompt();
  promptModal.root.hidden = false;
  fx("modalOpened", promptModal.root);
}

function closePromptModal() {
  promptModal.root.hidden = true;
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(promptModal.text.value);
    showToast("Prompt copied to clipboard.");
  } catch (err) {
    promptModal.text.select();
    document.execCommand("copy");
    showToast("Prompt copied to clipboard.");
  }
}

function downloadPrompt() {
  const safeName = (getDiagramName() || "diagram").replace(/[^\w-]+/g, "_");
  const blob = new Blob([promptModal.text.value], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${safeName}-prompt.txt`);
}

/* ---------------- Wiring ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-pdf").addEventListener("click", exportPdf);
  document.getElementById("btn-prompt").addEventListener("click", openPromptModal);
  document.getElementById("prompt-close").addEventListener("click", closePromptModal);
  document.getElementById("prompt-copy").addEventListener("click", copyPrompt);
  document.getElementById("prompt-download").addEventListener("click", downloadPrompt);
  promptModal.root.addEventListener("click", (evt) => {
    if (evt.target === promptModal.root) closePromptModal();
  });
  window.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape" && !promptModal.root.hidden) closePromptModal();
  });
});
