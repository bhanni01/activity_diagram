/* ============================================================
   app.js — application state, rendering and canvas interaction.
   ============================================================ */

"use strict";

const state = {
  elements: [],
  connections: [],
  selectedId: null, // element or connection id
  currentTool: null, // element type being placed, or null
  idCounter: 1,
  drag: null, // { id, offsetX, offsetY, moved }
  connecting: null, // { fromId, tempPath }
};

const dom = {
  canvas: document.getElementById("canvas"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  layerConnections: document.getElementById("layer-connections"),
  layerElements: document.getElementById("layer-elements"),
  layerOverlay: document.getElementById("layer-overlay"),
  tooltip: document.getElementById("tooltip"),
  diagramName: document.getElementById("diagram-name"),
  propsEmpty: document.getElementById("props-empty"),
  propsEditor: document.getElementById("props-editor"),
  propLabel: document.getElementById("prop-label"),
  propType: document.getElementById("prop-type"),
  propIn: document.getElementById("prop-in"),
  propOut: document.getElementById("prop-out"),
  propDelete: document.getElementById("prop-delete"),
  toast: document.getElementById("toast"),
};

/* Dispatch to optional visual-effects hooks (defined in later layers). */
function fx(name, ...args) {
  const hooks = window.FX;
  if (hooks && typeof hooks[name] === "function") {
    try {
      hooks[name](...args);
    } catch (err) {
      console.warn(`FX hook "${name}" failed:`, err);
    }
  }
}

/* ---------------- Helpers ---------------- */

function nextId(prefix) {
  return `${prefix}-${state.idCounter++}`;
}

function getElement(id) {
  return state.elements.find((e) => e.id === id);
}

function connectionCounts(id) {
  let inbound = 0;
  let outbound = 0;
  for (const c of state.connections) {
    if (c.to === id) inbound++;
    if (c.from === id) outbound++;
  }
  return { inbound, outbound };
}

function canvasPoint(evt) {
  const rect = dom.canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

let toastTimer = null;
function showToast(message, isError) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", !!isError);
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

/* Simple rAF throttle for high-frequency pointer events. */
function rafThrottle(fn) {
  let pending = false;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...lastArgs);
    });
  };
}

/* ---------------- Mutations ---------------- */

function addElement(type, x, y, label) {
  const def = ElementTypes[type];
  const el = {
    id: nextId(type),
    type,
    label: label != null ? label : def.defaultLabel,
    x,
    y,
    w: def.w,
    h: def.h,
  };
  state.elements.push(el);
  const node = renderElement(el);
  fx("elementAdded", node, el);
  return el;
}

function removeElement(id) {
  state.elements = state.elements.filter((e) => e.id !== id);
  const removedConns = state.connections.filter((c) => c.from === id || c.to === id);
  state.connections = state.connections.filter((c) => c.from !== id && c.to !== id);
  for (const c of removedConns) {
    const node = connectionNode(c.id);
    if (node) node.remove();
  }
  const node = elementNode(id);
  if (node) {
    fx("elementRemoved", node, () => node.remove());
    if (!window.FX) node.remove();
  }
  if (state.selectedId === id) selectItem(null);
}

function validateConnection(fromId, toId) {
  if (fromId === toId) return "An element cannot connect to itself.";
  const from = getElement(fromId);
  const to = getElement(toId);
  if (!from || !to) return "Both endpoints must be diagram elements.";
  if (from.type === "end") return "End nodes cannot have outgoing connections.";
  if (to.type === "start") return "Start nodes cannot have incoming connections.";
  if (state.connections.some((c) => c.from === fromId && c.to === toId)) {
    return "These elements are already connected in this direction.";
  }
  return null;
}

function addConnection(fromId, toId) {
  const error = validateConnection(fromId, toId);
  if (error) {
    showToast(error, true);
    return null;
  }
  const conn = { id: nextId("conn"), from: fromId, to: toId };
  state.connections.push(conn);
  const node = renderConnection(conn);
  fx("connectionAdded", node.querySelector(".conn-path"));
  refreshProps();
  return conn;
}

function removeConnection(id) {
  state.connections = state.connections.filter((c) => c.id !== id);
  const node = connectionNode(id);
  if (node) node.remove();
  if (state.selectedId === id) selectItem(null);
  refreshProps();
}

function clearAll() {
  if (!state.elements.length && !state.connections.length) return;
  if (!window.confirm("Remove all elements and connections?")) return;
  state.elements = [];
  state.connections = [];
  selectItem(null);
  renderAll();
  showToast("Canvas cleared.");
}

function autoLayout() {
  if (!state.elements.length) {
    showToast("Nothing to lay out yet.", true);
    return;
  }
  const width = dom.canvas.getBoundingClientRect().width;
  const positions = computeAutoLayout(state.elements, state.connections, width);
  for (const el of state.elements) {
    const pos = positions[el.id];
    if (!pos) continue;
    fx("elementMoved", elementNode(el.id), el, pos);
    el.x = pos.x;
    el.y = pos.y;
  }
  if (!window.FX) renderAll();
  updateAllConnections();
  showToast("Auto layout applied.");
}

/* ---------------- Rendering ---------------- */

function elementNode(id) {
  return dom.layerElements.querySelector(`[data-id="${id}"]`);
}

function connectionNode(id) {
  return dom.layerConnections.querySelector(`[data-id="${id}"]`);
}

function renderElement(el) {
  let group = elementNode(el.id);
  if (group) group.remove();
  group = svgEl("g", { "data-id": el.id });
  group.classList.add("diagram-el");
  group.setAttribute("transform", `translate(${el.x}, ${el.y})`);
  group.appendChild(buildShape(el));
  group.appendChild(buildLabelText(el));
  for (const port of portOffsets(el)) {
    group.appendChild(
      svgEl("circle", { class: "port", r: 5, cx: port.dx, cy: port.dy, "data-port": port.dir })
    );
  }
  if (el.id === state.selectedId) group.classList.add("selected");
  dom.layerElements.appendChild(group);
  return group;
}

function renderConnection(conn) {
  let group = connectionNode(conn.id);
  if (group) group.remove();
  const from = getElement(conn.from);
  const to = getElement(conn.to);
  if (!from || !to) return null;
  const d = connectionPath(from, to);
  group = svgEl("g", { "data-id": conn.id });
  group.classList.add("connection");
  group.appendChild(svgEl("path", { class: "conn-hit", d }));
  group.appendChild(svgEl("path", { class: "conn-path", d, "marker-end": "url(#arrowhead)" }));
  if (conn.id === state.selectedId) group.classList.add("selected");
  dom.layerConnections.appendChild(group);
  return group;
}

function updateElementPosition(el) {
  const node = elementNode(el.id);
  if (node) node.setAttribute("transform", `translate(${el.x}, ${el.y})`);
  updateConnectionsFor(el.id);
}

function updateConnectionsFor(elementId) {
  for (const conn of state.connections) {
    if (conn.from !== elementId && conn.to !== elementId) continue;
    updateConnectionPath(conn);
  }
}

function updateConnectionPath(conn) {
  const node = connectionNode(conn.id);
  const from = getElement(conn.from);
  const to = getElement(conn.to);
  if (!node || !from || !to) return;
  const d = connectionPath(from, to);
  for (const path of node.querySelectorAll("path")) path.setAttribute("d", d);
}

function updateAllConnections() {
  for (const conn of state.connections) updateConnectionPath(conn);
}

function renderAll() {
  dom.layerElements.textContent = "";
  dom.layerConnections.textContent = "";
  for (const el of state.elements) renderElement(el);
  for (const conn of state.connections) renderConnection(conn);
}

/* ---------------- Selection & properties panel ---------------- */

function selectItem(id) {
  if (state.selectedId === id) {
    refreshProps();
    return;
  }
  const prev = state.selectedId;
  state.selectedId = id;
  if (prev) {
    const prevNode = elementNode(prev) || connectionNode(prev);
    if (prevNode) prevNode.classList.remove("selected");
  }
  if (id) {
    const node = elementNode(id) || connectionNode(id);
    if (node) {
      node.classList.add("selected");
      if (node.classList.contains("diagram-el")) fx("elementSelected", node);
    }
  }
  refreshProps();
}

function refreshProps() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  dom.propsEmpty.hidden = !!el;
  dom.propsEditor.hidden = !el;
  if (!el) {
    if (state.selectedId && !el) {
      // A connection is selected — show a hint instead of the editor.
      dom.propsEmpty.hidden = false;
      dom.propsEmpty.textContent = "Connection selected — press Delete/Backspace to remove it.";
    } else {
      dom.propsEmpty.textContent = "Select an element to edit its properties.";
    }
    return;
  }
  if (document.activeElement !== dom.propLabel) dom.propLabel.value = el.label;
  dom.propType.value = el.type;
  const { inbound, outbound } = connectionCounts(el.id);
  dom.propIn.textContent = inbound;
  dom.propOut.textContent = outbound;
}

function applyLabelChange() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  if (!el) return;
  el.label = dom.propLabel.value.trim() || ElementTypes[el.type].defaultLabel;
  renderElement(el);
}

function applyTypeChange() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  if (!el) return;
  const newType = dom.propType.value;
  if (!ElementTypes[newType] || newType === el.type) return;
  const wasDefaultLabel = el.label === ElementTypes[el.type].defaultLabel;
  el.type = newType;
  el.w = ElementTypes[newType].w;
  el.h = ElementTypes[newType].h;
  if (wasDefaultLabel) el.label = ElementTypes[newType].defaultLabel;
  renderElement(el);
  updateConnectionsFor(el.id);
  fx("elementSelected", elementNode(el.id));
}

/* ---------------- Toolbar ---------------- */

function setTool(tool) {
  state.currentTool = state.currentTool === tool ? null : tool;
  for (const btn of document.querySelectorAll(".tool-btn")) {
    btn.classList.toggle("active", btn.dataset.tool === state.currentTool);
  }
  dom.canvasWrap.classList.toggle("placing", !!state.currentTool);
}

/* ---------------- Canvas interaction ---------------- */

function onCanvasPointerDown(evt) {
  if (evt.button !== undefined && evt.button !== 0) return;
  const target = evt.target;

  // Start a connection drag from a port.
  const port = target.closest ? target.closest(".port") : null;
  if (port) {
    const group = port.closest(".diagram-el");
    if (group) {
      evt.preventDefault();
      const tempPath = svgEl("path", { class: "temp-conn", d: "" });
      dom.layerOverlay.appendChild(tempPath);
      state.connecting = { fromId: group.dataset.id, tempPath };
      return;
    }
  }

  // Start dragging an element.
  const group = target.closest ? target.closest(".diagram-el") : null;
  if (group) {
    evt.preventDefault();
    const el = getElement(group.dataset.id);
    if (!el) return;
    const pt = canvasPoint(evt);
    state.drag = { id: el.id, offsetX: pt.x - el.x, offsetY: pt.y - el.y, moved: false };
    return;
  }

  // Empty canvas: place an element or clear selection.
  if (state.currentTool) {
    const pt = canvasPoint(evt);
    const el = addElement(state.currentTool, pt.x, pt.y);
    selectItem(el.id);
    if (!evt.shiftKey) setTool(null); // hold Shift to keep placing
    return;
  }

  const connGroup = target.closest ? target.closest(".connection") : null;
  selectItem(connGroup ? connGroup.dataset.id : null);
}

const onCanvasPointerMove = rafThrottle((evt) => {
  if (state.drag) {
    const el = getElement(state.drag.id);
    if (!el) return;
    const pt = canvasPoint(evt);
    el.x = pt.x - state.drag.offsetX;
    el.y = pt.y - state.drag.offsetY;
    state.drag.moved = true;
    updateElementPosition(el);
    hideTooltip();
    return;
  }

  if (state.connecting) {
    const from = getElement(state.connecting.fromId);
    if (!from) return;
    const pt = canvasPoint(evt);
    const start = anchorPoint(from, pt.x, pt.y);
    state.connecting.tempPath.setAttribute("d", `M ${start.x},${start.y} L ${pt.x},${pt.y}`);
    updateDropTarget(evt);
    return;
  }

  updateTooltip(evt);
});

function elementGroupAtPoint(evt) {
  const hit = document.elementFromPoint(evt.clientX, evt.clientY);
  return hit && hit.closest ? hit.closest(".diagram-el") : null;
}

function updateDropTarget(evt) {
  const group = elementGroupAtPoint(evt);
  for (const g of dom.layerElements.querySelectorAll(".drop-target")) {
    if (g !== group) g.classList.remove("drop-target");
  }
  if (group && group.dataset.id !== state.connecting.fromId) {
    group.classList.add("drop-target");
  }
}

function onCanvasPointerUp(evt) {
  if (state.connecting) {
    const { fromId, tempPath } = state.connecting;
    tempPath.remove();
    const group = elementGroupAtPoint(evt);
    for (const g of dom.layerElements.querySelectorAll(".drop-target")) {
      g.classList.remove("drop-target");
    }
    if (group) addConnection(fromId, group.dataset.id);
    state.connecting = null;
    return;
  }

  if (state.drag) {
    if (!state.drag.moved) selectItem(state.drag.id);
    state.drag = null;
  }
}

/* ---------------- Tooltip ---------------- */

function updateTooltip(evt) {
  const group = evt.target.closest ? evt.target.closest(".diagram-el") : null;
  if (!group) {
    hideTooltip();
    return;
  }
  const el = getElement(group.dataset.id);
  if (!el) {
    hideTooltip();
    return;
  }
  const wrapRect = dom.canvasWrap.getBoundingClientRect();
  dom.tooltip.textContent = `${el.label} — ${ElementTypes[el.type].name}`;
  dom.tooltip.hidden = false;
  dom.tooltip.style.left = `${evt.clientX - wrapRect.left + 14}px`;
  dom.tooltip.style.top = `${evt.clientY - wrapRect.top + 14}px`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

/* ---------------- Sample diagram ---------------- */

function loadSampleDiagram() {
  const start = addElement("start", 0, 0, "Start");
  const validate = addElement("decision", 0, 0, "Validate Input");
  const process = addElement("activity", 0, 0, "Process Data");
  const error = addElement("activity", 0, 0, "Show Error");
  const end = addElement("end", 0, 0, "End");
  state.connections.push(
    { id: nextId("conn"), from: start.id, to: validate.id },
    { id: nextId("conn"), from: validate.id, to: process.id },
    { id: nextId("conn"), from: validate.id, to: error.id },
    { id: nextId("conn"), from: process.id, to: end.id },
    { id: nextId("conn"), from: error.id, to: end.id }
  );
  const width = dom.canvas.getBoundingClientRect().width || 800;
  const positions = computeAutoLayout(state.elements, state.connections, width);
  for (const el of state.elements) {
    const pos = positions[el.id];
    if (pos) {
      el.x = pos.x;
      el.y = pos.y;
    }
  }
  renderAll();
}

/* ---------------- Init ---------------- */

function init() {
  for (const btn of document.querySelectorAll(".tool-btn")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  }
  document.getElementById("btn-clear").addEventListener("click", clearAll);
  document.getElementById("btn-layout").addEventListener("click", autoLayout);

  dom.canvas.addEventListener("pointerdown", onCanvasPointerDown);
  window.addEventListener("pointermove", onCanvasPointerMove);
  window.addEventListener("pointerup", onCanvasPointerUp);
  dom.canvasWrap.addEventListener("pointerleave", hideTooltip);

  dom.propLabel.addEventListener("input", applyLabelChange);
  dom.propType.addEventListener("change", applyTypeChange);
  dom.propDelete.addEventListener("click", () => {
    if (state.selectedId && getElement(state.selectedId)) removeElement(state.selectedId);
  });

  window.addEventListener("keydown", (evt) => {
    if (evt.key !== "Delete" && evt.key !== "Backspace") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!state.selectedId) return;
    evt.preventDefault();
    if (getElement(state.selectedId)) removeElement(state.selectedId);
    else removeConnection(state.selectedId);
  });

  window.addEventListener(
    "resize",
    (() => {
      let timer = null;
      return () => {
        clearTimeout(timer);
        timer = setTimeout(updateAllConnections, 150);
      };
    })()
  );

  loadSampleDiagram();
  fx("appReady");
}

document.addEventListener("DOMContentLoaded", init);
