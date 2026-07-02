/* ============================================================
   diagrams.js — element type definitions, SVG shape building,
   connection geometry and auto-layout.
   ============================================================ */

"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Registry of the five supported element types. */
const ElementTypes = {
  start: {
    name: "Start",
    w: 60,
    h: 60,
    fill: "url(#grad-start)",
    stroke: "#00ff88",
    defaultLabel: "Start",
    textFill: "#04120b",
  },
  end: {
    name: "End",
    w: 60,
    h: 60,
    fill: "url(#grad-end)",
    stroke: "#ff006e",
    defaultLabel: "End",
    textFill: "#ffffff",
  },
  activity: {
    name: "Activity",
    w: 150,
    h: 60,
    fill: "url(#grad-activity)",
    stroke: "#00d9ff",
    defaultLabel: "New Activity",
    textFill: "#e0e0e0",
  },
  decision: {
    name: "Decision",
    w: 150,
    h: 84,
    fill: "url(#grad-decision)",
    stroke: "#a855f7",
    defaultLabel: "Decision?",
    textFill: "#e0e0e0",
  },
  merge: {
    name: "Merge",
    w: 120,
    h: 70,
    fill: "url(#grad-merge)",
    stroke: "#00d9ff",
    defaultLabel: "Merge",
    textFill: "#e0e0e0",
  },
};

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
  }
  return node;
}

/** Build the type-specific shape node, centered on the group origin. */
function buildShape(el) {
  const def = ElementTypes[el.type];
  const w = el.w;
  const h = el.h;
  let shape;
  switch (el.type) {
    case "start":
      shape = svgEl("circle", { r: w / 2 });
      break;
    case "end": {
      shape = svgEl("g");
      shape.appendChild(svgEl("circle", { r: w / 2, fill: "none", stroke: def.stroke, "stroke-width": 2 }));
      const inner = svgEl("circle", { r: w / 2 - 6 });
      inner.setAttribute("fill", def.fill);
      shape.appendChild(inner);
      break;
    }
    case "activity":
      shape = svgEl("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 14, ry: 14 });
      break;
    case "decision":
    case "merge":
      shape = svgEl("polygon", {
        points: `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`,
      });
      break;
    default:
      throw new Error(`Unknown element type: ${el.type}`);
  }
  if (shape.tagName !== "g") {
    shape.setAttribute("fill", def.fill);
    shape.setAttribute("stroke", def.stroke);
    shape.setAttribute("stroke-width", "2");
  }
  shape.classList.add("el-shape");
  return shape;
}

/** Wrap a label into lines that fit the element width. */
function wrapLabel(label, maxChars) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines.slice(0, 3) : [""];
}

/** Build the <text> node with wrapped tspans, centered vertically. */
function buildLabelText(el) {
  const def = ElementTypes[el.type];
  const maxChars = Math.max(6, Math.floor(el.w / 8.5));
  const lines = wrapLabel(el.label, maxChars);
  const lineHeight = 15;
  const text = svgEl("text", {
    "text-anchor": "middle",
    "font-size": "13",
    "font-weight": "600",
    fill: def.textFill,
  });
  const startY = -((lines.length - 1) * lineHeight) / 2 + 4;
  lines.forEach((ln, i) => {
    const tspan = svgEl("tspan", { x: 0, y: startY + i * lineHeight });
    tspan.textContent = ln;
    text.appendChild(tspan);
  });
  return text;
}

/** Positions of the four connection ports (relative to element center). */
function portOffsets(el) {
  return [
    { dir: "n", dx: 0, dy: -el.h / 2 },
    { dir: "s", dx: 0, dy: el.h / 2 },
    { dir: "e", dx: el.w / 2, dy: 0 },
    { dir: "w", dx: -el.w / 2, dy: 0 },
  ];
}

/**
 * Point on the boundary of `el` along the ray from its center toward (tx, ty).
 * Exact for circles, analytic for rectangles and diamonds.
 */
function anchorPoint(el, tx, ty) {
  const dx = tx - el.x;
  const dy = ty - el.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  if (el.type === "start" || el.type === "end") {
    const r = el.w / 2;
    return { x: el.x + ux * r, y: el.y + uy * r };
  }

  if (el.type === "decision" || el.type === "merge") {
    // Diamond: |x|/(w/2) + |y|/(h/2) = 1
    const t = 1 / (Math.abs(ux) / (el.w / 2) + Math.abs(uy) / (el.h / 2) || 1);
    return { x: el.x + ux * t, y: el.y + uy * t };
  }

  // Rectangle: clip the ray against the half-extents.
  const sx = Math.abs(ux) > 1e-6 ? (el.w / 2) / Math.abs(ux) : Infinity;
  const sy = Math.abs(uy) > 1e-6 ? (el.h / 2) / Math.abs(uy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: el.x + ux * s, y: el.y + uy * s };
}

/** SVG path `d` for a connection between two elements (gentle curve). */
function connectionPath(fromEl, toEl) {
  const from = anchorPoint(fromEl, toEl.x, toEl.y);
  const to = anchorPoint(toEl, fromEl.x, fromEl.y);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Mostly vertical flow — curve through vertical control points.
    const bend = Math.min(60, Math.abs(dy) / 2);
    const sign = dy >= 0 ? 1 : -1;
    return `M ${from.x},${from.y} C ${from.x},${from.y + sign * bend} ${to.x},${to.y - sign * bend} ${to.x},${to.y}`;
  }
  const bend = Math.min(60, Math.abs(dx) / 2);
  const sign = dx >= 0 ? 1 : -1;
  return `M ${from.x},${from.y} C ${from.x + sign * bend},${from.y} ${to.x - sign * bend},${to.y} ${to.x},${to.y}`;
}

/**
 * Auto layout: layer elements top-to-bottom by flow.
 * Start nodes (or elements with no incoming connections) form row 0;
 * every other element sits one row below its furthest predecessor.
 * Returns a map of id -> {x, y}.
 */
function computeAutoLayout(elements, connections, canvasWidth) {
  if (!elements.length) return {};

  const incoming = new Map(elements.map((e) => [e.id, 0]));
  const outgoing = new Map(elements.map((e) => [e.id, []]));
  for (const c of connections) {
    if (incoming.has(c.to)) incoming.set(c.to, incoming.get(c.to) + 1);
    if (outgoing.has(c.from)) outgoing.get(c.from).push(c.to);
  }

  let roots = elements.filter((e) => e.type === "start");
  if (!roots.length) roots = elements.filter((e) => incoming.get(e.id) === 0);
  if (!roots.length) roots = [elements[0]];

  // Longest-path layering with a cycle guard.
  const rank = new Map();
  const queue = roots.map((r) => ({ id: r.id, depth: 0 }));
  let hops = 0;
  const maxHops = elements.length * connections.length + elements.length + 16;
  while (queue.length && hops++ < maxHops) {
    const { id, depth } = queue.shift();
    if (rank.has(id) && rank.get(id) >= depth) continue;
    rank.set(id, depth);
    for (const next of outgoing.get(id) || []) {
      queue.push({ id: next, depth: depth + 1 });
    }
  }

  // Unreached elements (disconnected islands) go below everything else.
  let maxRank = 0;
  for (const r of rank.values()) maxRank = Math.max(maxRank, r);
  for (const e of elements) {
    if (!rank.has(e.id)) rank.set(e.id, maxRank + 1);
  }

  // End nodes sink to the bottom row.
  maxRank = 0;
  for (const r of rank.values()) maxRank = Math.max(maxRank, r);
  for (const e of elements) {
    if (e.type === "end") rank.set(e.id, maxRank);
  }

  // Group into rows and spread each row horizontally, centered.
  const rows = new Map();
  for (const e of elements) {
    const r = rank.get(e.id);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(e);
  }

  const positions = {};
  const rowGap = 150;
  const colGap = 200;
  const sortedRanks = [...rows.keys()].sort((a, b) => a - b);
  const centerX = Math.max(canvasWidth / 2, 200);
  sortedRanks.forEach((r, rowIndex) => {
    const row = rows.get(r);
    row.sort((a, b) => a.x - b.x); // keep current relative order
    const y = 90 + rowIndex * rowGap;
    row.forEach((e, i) => {
      positions[e.id] = { x: centerX + (i - (row.length - 1) / 2) * colGap, y };
    });
  });
  return positions;
}
