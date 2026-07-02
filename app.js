/* ============================================================
   app.js — application state, rendering, canvas interaction,
   editing UI (dialogs, inline edit, context menu, bulk import)
   and undo/redo history.
   ============================================================ */

"use strict";

const state = {
  elements: [],
  connections: [],
  selectedId: null, // element or connection id
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
  propDesc: document.getElementById("prop-desc"),
  propX: document.getElementById("prop-x"),
  propY: document.getElementById("prop-y"),
  propW: document.getElementById("prop-w"),
  propH: document.getElementById("prop-h"),
  propIn: document.getElementById("prop-in"),
  propOut: document.getElementById("prop-out"),
  propConnections: document.getElementById("prop-connections"),
  propDuplicate: document.getElementById("prop-duplicate"),
  propDelete: document.getElementById("prop-delete"),
  toast: document.getElementById("toast"),
  createModal: document.getElementById("create-modal"),
  createTitle: document.getElementById("create-modal-title"),
  createLabel: document.getElementById("create-label"),
  bulkModal: document.getElementById("bulk-modal"),
  bulkText: document.getElementById("bulk-text"),
  bulkConnect: document.getElementById("bulk-connect"),
  contextMenu: document.getElementById("context-menu"),
};

/* Dispatch to optional visual-effects hooks (defined in effects.js). */
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

/* ---------------- Undo / redo history ---------------- */

const history = { past: [], future: [], limit: 100 };
let lastHistoryKey = null;

function snapshotState() {
  return JSON.stringify({
    elements: state.elements,
    connections: state.connections,
    idCounter: state.idCounter,
  });
}

/**
 * Record the current state as an undo point, called BEFORE a mutation.
 * A `key` groups rapid repeats (e.g. keystrokes in the label field) into
 * a single undo step; discrete actions pass no key.
 */
function pushHistory(key) {
  if (key && key === lastHistoryKey) return;
  lastHistoryKey = key || null;
  history.past.push(snapshotState());
  if (history.past.length > history.limit) history.past.shift();
  history.future = [];
}

function restoreSnapshot(json) {
  cancelInlineEdit();
  closeContextMenu();
  const data = JSON.parse(json);
  state.elements = data.elements;
  state.connections = data.connections;
  state.idCounter = data.idCounter;
  if (
    state.selectedId &&
    !getElement(state.selectedId) &&
    !state.connections.some((c) => c.id === state.selectedId)
  ) {
    state.selectedId = null;
  }
  renderAll();
  refreshProps();
}

function undo() {
  if (!history.past.length) {
    showToast("Nothing to undo.", true);
    return;
  }
  history.future.push(snapshotState());
  restoreSnapshot(history.past.pop());
  lastHistoryKey = null;
  showToast("Undo");
}

function redo() {
  if (!history.future.length) {
    showToast("Nothing to redo.", true);
    return;
  }
  history.past.push(snapshotState());
  restoreSnapshot(history.future.pop());
  lastHistoryKey = null;
  showToast("Redo");
}

/* ---------------- Mutations ---------------- */

function addElement(type, x, y, label, description) {
  const def = ElementTypes[type];
  const el = {
    id: nextId(type),
    type,
    label: label != null ? label : def.defaultLabel,
    description: description || "",
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

function removeElement(id, opts) {
  const options = opts || {};
  if (options.history !== false) pushHistory();
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
  else refreshProps();
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

function addConnection(fromId, toId, opts) {
  const options = opts || {};
  const error = validateConnection(fromId, toId);
  if (error) {
    if (!options.silent) showToast(error, true);
    return null;
  }
  if (options.history !== false) pushHistory();
  const conn = { id: nextId("conn"), from: fromId, to: toId };
  state.connections.push(conn);
  const node = renderConnection(conn);
  fx("connectionAdded", node.querySelector(".conn-path"));
  refreshProps();
  return conn;
}

function removeConnection(id, opts) {
  const options = opts || {};
  if (options.history !== false) pushHistory();
  state.connections = state.connections.filter((c) => c.id !== id);
  const node = connectionNode(id);
  if (node) node.remove();
  if (state.selectedId === id) selectItem(null);
  refreshProps();
}

function clearAll() {
  if (!state.elements.length && !state.connections.length) return;
  if (!window.confirm("Remove all elements and connections?")) return;
  pushHistory();
  state.elements = [];
  state.connections = [];
  selectItem(null);
  renderAll();
  showToast("Canvas cleared.");
}

function autoLayout(opts) {
  const options = opts || {};
  if (!state.elements.length) {
    showToast("Nothing to lay out yet.", true);
    return;
  }
  if (options.history !== false) pushHistory();
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
  if (!options.silent) showToast("Auto layout applied.");
}

function duplicateElement(id) {
  const el = getElement(id);
  if (!el) return null;
  pushHistory();
  const copy = addElement(el.type, el.x + 32, el.y + 32, el.label, el.description);
  copy.w = el.w;
  copy.h = el.h;
  renderElement(copy);
  selectItem(copy.id);
  return copy;
}

function setElementType(el, newType, opts) {
  const options = opts || {};
  if (!ElementTypes[newType] || newType === el.type) return;
  if (options.history !== false) pushHistory(options.historyKey);
  const wasDefaultLabel = el.label === ElementTypes[el.type].defaultLabel;
  el.type = newType;
  el.w = ElementTypes[newType].w;
  el.h = ElementTypes[newType].h;
  if (wasDefaultLabel) el.label = ElementTypes[newType].defaultLabel;
  renderElement(el);
  updateConnectionsFor(el.id);
  fx("elementSelected", elementNode(el.id));
  refreshProps();
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
  if (el.id === state.selectedId) updateCoordDisplay(el);
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
  lastHistoryKey = null; // selection boundaries end grouped-typing undo steps
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

function updateCoordDisplay(el) {
  dom.propX.value = Math.round(el.x);
  dom.propY.value = Math.round(el.y);
}

function refreshProps() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  dom.propsEmpty.hidden = !!el;
  dom.propsEditor.hidden = !el;
  if (!el) {
    if (state.selectedId) {
      dom.propsEmpty.textContent = "Connection selected — press Delete/Backspace to remove it.";
    } else {
      dom.propsEmpty.textContent = "Select an element to edit its properties.";
    }
    return;
  }
  if (document.activeElement !== dom.propLabel) dom.propLabel.value = el.label;
  if (document.activeElement !== dom.propDesc) dom.propDesc.value = el.description || "";
  dom.propType.value = el.type;
  updateCoordDisplay(el);
  if (document.activeElement !== dom.propW) dom.propW.value = el.w;
  if (document.activeElement !== dom.propH) dom.propH.value = el.h;
  const { inbound, outbound } = connectionCounts(el.id);
  dom.propIn.textContent = inbound;
  dom.propOut.textContent = outbound;
  renderConnectionList(el);
}

function renderConnectionList(el) {
  dom.propConnections.textContent = "";
  const related = state.connections.filter((c) => c.from === el.id || c.to === el.id);
  if (!related.length) {
    const empty = document.createElement("div");
    empty.className = "conn-list-empty";
    empty.textContent = "No connections yet.";
    dom.propConnections.appendChild(empty);
    return;
  }
  for (const conn of related) {
    const isOutgoing = conn.from === el.id;
    const other = getElement(isOutgoing ? conn.to : conn.from);
    if (!other) continue;
    const row = document.createElement("div");
    row.className = "conn-item";
    row.title = `Click to select "${other.label}"`;

    const arrow = document.createElement("span");
    arrow.className = "conn-arrow";
    arrow.textContent = isOutgoing ? "→" : "←";

    const label = document.createElement("span");
    label.className = "conn-label";
    label.textContent = other.label;

    const remove = document.createElement("button");
    remove.className = "conn-remove";
    remove.textContent = "×";
    remove.title = "Remove this connection";
    remove.addEventListener("click", (evt) => {
      evt.stopPropagation();
      removeConnection(conn.id);
    });

    row.append(arrow, label, remove);
    row.addEventListener("click", () => selectItem(other.id));
    dom.propConnections.appendChild(row);
  }
}

function applyLabelChange() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  if (!el) return;
  pushHistory(`label:${el.id}`);
  el.label = dom.propLabel.value.trim() || ElementTypes[el.type].defaultLabel;
  renderElement(el);
}

function applyDescriptionChange() {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  if (!el) return;
  pushHistory(`desc:${el.id}`);
  el.description = dom.propDesc.value;
}

function applySizeChange(dimension, input) {
  const el = state.selectedId ? getElement(state.selectedId) : null;
  if (!el) return;
  const value = Math.max(40, Math.min(dimension === "w" ? 400 : 300, Number(input.value) || 0));
  if (!value || value === el[dimension]) return;
  pushHistory(`size:${dimension}:${el.id}`);
  el[dimension] = value;
  if (el.type === "start" || el.type === "end") {
    el.w = el.h = value; // circles stay circular
    dom.propW.value = dom.propH.value = value;
  }
  renderElement(el);
  updateConnectionsFor(el.id);
}

/* ---------------- Element creation dialog ---------------- */

let pendingCreateType = null;

function openCreateModal(type) {
  pendingCreateType = type;
  dom.createTitle.textContent = `New ${ElementTypes[type].name}`;
  dom.createLabel.value = ElementTypes[type].defaultLabel;
  dom.createModal.hidden = false;
  fx("modalOpened", dom.createModal);
  dom.createLabel.focus();
  dom.createLabel.select();
}

function closeCreateModal() {
  dom.createModal.hidden = true;
  pendingCreateType = null;
}

/** A spot near the canvas center that doesn't sit on an existing element. */
function freePlacementPoint() {
  const rect = dom.canvas.getBoundingClientRect();
  let x = Math.max(120, rect.width / 2);
  let y = Math.max(100, rect.height / 2);
  const occupied = (px, py) =>
    state.elements.some((e) => Math.abs(e.x - px) < 60 && Math.abs(e.y - py) < 50);
  let tries = 0;
  while (occupied(x, y) && tries++ < 60) {
    x += 40;
    y += 34;
    if (x > rect.width - 90) x = 120;
    if (y > rect.height - 70) y = 90;
  }
  return { x, y };
}

function confirmCreate() {
  if (!pendingCreateType) return;
  const type = pendingCreateType;
  const label = dom.createLabel.value.trim() || ElementTypes[type].defaultLabel;
  closeCreateModal();
  pushHistory();
  const pos = freePlacementPoint();
  const el = addElement(type, pos.x, pos.y, label);
  selectItem(el.id);
}

/* ---------------- Inline label editing (double-click) ---------------- */

let inlineEdit = null; // { input, elementId }

function startInlineEdit(el) {
  cancelInlineEdit();
  hideTooltip();
  const input = document.createElement("input");
  input.className = "inline-edit";
  input.type = "text";
  input.maxLength = 80;
  input.value = el.label;
  const width = Math.max(el.w, 120);
  input.style.left = `${el.x - width / 2}px`;
  input.style.top = `${el.y - 16}px`;
  input.style.width = `${width}px`;
  dom.canvasWrap.appendChild(input);
  inlineEdit = { input, elementId: el.id };
  input.focus();
  input.select();
  input.addEventListener("keydown", (evt) => {
    evt.stopPropagation(); // keep Delete/undo shortcuts out of the global handler
    if (evt.key === "Enter") saveInlineEdit();
    else if (evt.key === "Escape") cancelInlineEdit();
  });
  input.addEventListener("blur", saveInlineEdit);
}

function saveInlineEdit() {
  if (!inlineEdit) return;
  const { input, elementId } = inlineEdit;
  inlineEdit = null;
  const el = getElement(elementId);
  if (el) {
    const value = input.value.trim() || ElementTypes[el.type].defaultLabel;
    if (value !== el.label) {
      pushHistory();
      el.label = value;
      renderElement(el);
      refreshProps();
    }
  }
  input.remove();
}

function cancelInlineEdit() {
  if (!inlineEdit) return;
  const { input } = inlineEdit;
  inlineEdit = null;
  input.remove();
}

/* ---------------- Context menu ---------------- */

let contextTargetId = null;

function openContextMenu(evt, elementId) {
  contextTargetId = elementId;
  selectItem(elementId);
  const menu = dom.contextMenu;
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const x = Math.min(evt.clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(evt.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
  // Flip the type submenu if it would run off the right edge.
  menu.classList.toggle("submenu-left", x + rect.width + 130 > window.innerWidth);
}

function closeContextMenu() {
  dom.contextMenu.hidden = true;
  contextTargetId = null;
}

function handleContextAction(action, type) {
  const el = contextTargetId ? getElement(contextTargetId) : null;
  closeContextMenu();
  if (!el) return;
  switch (action) {
    case "edit":
      startInlineEdit(el);
      break;
    case "duplicate":
      duplicateElement(el.id);
      break;
    case "type":
      setElementType(el, type);
      break;
    case "describe":
      selectItem(el.id);
      dom.propDesc.focus();
      break;
    case "delete":
      removeElement(el.id);
      break;
  }
}

/* ---------------- Bulk import ---------------- */

function openBulkModal() {
  dom.bulkModal.hidden = false;
  fx("modalOpened", dom.bulkModal);
  dom.bulkText.focus();
}

function closeBulkModal() {
  dom.bulkModal.hidden = true;
}

function parseBulkLine(line) {
  const typed = line.match(/^\s*(start|end|activity|decision|merge)\s*[:\-]\s*(.*)$/i);
  if (typed) {
    const type = typed[1].toLowerCase();
    return { type, label: typed[2].trim() || ElementTypes[type].defaultLabel };
  }
  const bare = line.trim().toLowerCase();
  if (ElementTypes[bare]) {
    return { type: bare, label: ElementTypes[bare].defaultLabel };
  }
  return { type: "activity", label: line.trim() };
}

function runBulkImport() {
  const lines = dom.bulkText.value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    showToast("Paste at least one element line first.", true);
    return;
  }
  pushHistory();
  const created = [];
  for (const line of lines) {
    const { type, label } = parseBulkLine(line);
    const pos = freePlacementPoint();
    created.push(addElement(type, pos.x, pos.y, label));
  }
  let connected = 0;
  if (dom.bulkConnect.checked) {
    for (let i = 0; i < created.length - 1; i++) {
      if (addConnection(created[i].id, created[i + 1].id, { history: false, silent: true })) {
        connected++;
      }
    }
  }
  autoLayout({ history: false, silent: true });
  closeBulkModal();
  dom.bulkText.value = "";
  selectItem(null);
  showToast(`Imported ${created.length} elements${connected ? `, ${connected} connections` : ""}.`);
}

/* ---------------- Canvas interaction ---------------- */

function onCanvasPointerDown(evt) {
  if (evt.button !== undefined && evt.button !== 0) return;
  closeContextMenu();
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

  const connGroup = target.closest ? target.closest(".connection") : null;
  selectItem(connGroup ? connGroup.dataset.id : null);
}

const onCanvasPointerMove = rafThrottle((evt) => {
  if (state.drag) {
    const el = getElement(state.drag.id);
    if (!el) return;
    if (!state.drag.moved) pushHistory(); // one undo step per drag
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

function onCanvasDoubleClick(evt) {
  const group = evt.target.closest ? evt.target.closest(".diagram-el") : null;
  if (!group) return;
  const el = getElement(group.dataset.id);
  if (!el) return;
  selectItem(el.id);
  startInlineEdit(el);
}

function onCanvasContextMenu(evt) {
  const group = evt.target.closest ? evt.target.closest(".diagram-el") : null;
  if (!group) {
    closeContextMenu();
    return;
  }
  evt.preventDefault();
  hideTooltip();
  openContextMenu(evt, group.dataset.id);
}

/* ---------------- Tooltip ---------------- */

function updateTooltip(evt) {
  const group = evt.target.closest ? evt.target.closest(".diagram-el") : null;
  if (!group || inlineEdit) {
    hideTooltip();
    return;
  }
  const el = getElement(group.dataset.id);
  if (!el) {
    hideTooltip();
    return;
  }
  const wrapRect = dom.canvasWrap.getBoundingClientRect();
  let text = `${el.label} — ${ElementTypes[el.type].name}`;
  if (el.description) {
    const desc = el.description.length > 90 ? `${el.description.slice(0, 90)}…` : el.description;
    text += `\n${desc}`;
  }
  dom.tooltip.textContent = text;
  dom.tooltip.hidden = false;
  dom.tooltip.style.left = `${evt.clientX - wrapRect.left + 14}px`;
  dom.tooltip.style.top = `${evt.clientY - wrapRect.top + 14}px`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

/* ---------------- Keyboard shortcuts ---------------- */

function isEditingText() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function onKeyDown(evt) {
  // Undo / redo (Ctrl/Cmd+Z, Ctrl+Y, Cmd+Shift+Z) — skip while typing so
  // native text-field undo keeps working.
  if ((evt.ctrlKey || evt.metaKey) && !isEditingText()) {
    const key = evt.key.toLowerCase();
    if (key === "z") {
      evt.preventDefault();
      if (evt.shiftKey) redo();
      else undo();
      return;
    }
    if (key === "y") {
      evt.preventDefault();
      redo();
      return;
    }
  }

  if (evt.key === "Escape") {
    if (!dom.contextMenu.hidden) {
      closeContextMenu();
      return;
    }
    if (inlineEdit) {
      cancelInlineEdit();
      return;
    }
    if (!dom.createModal.hidden) {
      closeCreateModal();
      return;
    }
    if (!dom.bulkModal.hidden) {
      closeBulkModal();
      return;
    }
    if (isEditingText()) {
      document.activeElement.blur();
      return;
    }
    if (state.selectedId) {
      selectItem(null);
      hideTooltip();
    }
    return;
  }

  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (isEditingText() || !state.selectedId) return;
    evt.preventDefault();
    if (getElement(state.selectedId)) removeElement(state.selectedId);
    else removeConnection(state.selectedId);
  }
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
    btn.addEventListener("click", () => openCreateModal(btn.dataset.tool));
  }
  document.getElementById("btn-clear").addEventListener("click", clearAll);
  document.getElementById("btn-layout").addEventListener("click", () => autoLayout());
  document.getElementById("btn-bulk").addEventListener("click", openBulkModal);
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);

  dom.canvas.addEventListener("pointerdown", onCanvasPointerDown);
  window.addEventListener("pointermove", onCanvasPointerMove);
  window.addEventListener("pointerup", onCanvasPointerUp);
  dom.canvas.addEventListener("dblclick", onCanvasDoubleClick);
  dom.canvas.addEventListener("contextmenu", onCanvasContextMenu);
  dom.canvasWrap.addEventListener("pointerleave", hideTooltip);

  // Properties form — every change applies to the canvas immediately.
  dom.propLabel.addEventListener("input", applyLabelChange);
  dom.propLabel.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") dom.propLabel.blur();
  });
  dom.propType.addEventListener("change", () => {
    const el = state.selectedId ? getElement(state.selectedId) : null;
    if (el) setElementType(el, dom.propType.value);
  });
  dom.propDesc.addEventListener("input", applyDescriptionChange);
  dom.propW.addEventListener("input", () => applySizeChange("w", dom.propW));
  dom.propH.addEventListener("input", () => applySizeChange("h", dom.propH));
  dom.propDuplicate.addEventListener("click", () => {
    if (state.selectedId) duplicateElement(state.selectedId);
  });
  dom.propDelete.addEventListener("click", () => {
    if (state.selectedId && getElement(state.selectedId)) removeElement(state.selectedId);
  });

  // Create-element dialog.
  document.getElementById("create-confirm").addEventListener("click", confirmCreate);
  document.getElementById("create-cancel").addEventListener("click", closeCreateModal);
  document.getElementById("create-close").addEventListener("click", closeCreateModal);
  dom.createLabel.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") confirmCreate();
  });
  dom.createModal.addEventListener("click", (evt) => {
    if (evt.target === dom.createModal) closeCreateModal();
  });

  // Bulk import dialog.
  document.getElementById("bulk-confirm").addEventListener("click", runBulkImport);
  document.getElementById("bulk-cancel").addEventListener("click", closeBulkModal);
  document.getElementById("bulk-close").addEventListener("click", closeBulkModal);
  dom.bulkText.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) runBulkImport();
  });
  dom.bulkModal.addEventListener("click", (evt) => {
    if (evt.target === dom.bulkModal) closeBulkModal();
  });

  // Context menu.
  dom.contextMenu.addEventListener("click", (evt) => {
    const item = evt.target.closest("[data-action]");
    if (item) handleContextAction(item.dataset.action, item.dataset.type);
  });
  document.addEventListener("pointerdown", (evt) => {
    if (!dom.contextMenu.hidden && !dom.contextMenu.contains(evt.target)) closeContextMenu();
  });

  window.addEventListener("keydown", onKeyDown);

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
