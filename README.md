# Activity Diagram Creator

A self-project tool for designing UML activity diagrams in the browser — a static site with a drag-and-drop SVG canvas, neon dark theme, PDF export, and AI-prompt generation for handing workflows to coding agents.

**Live site:** https://bhanni01.github.io/activity_diagram/

## Features

- **Five element types** — Start (circle), End (double circle), Activity (rounded rectangle), Decision (diamond), Merge (diamond)
- **Named creation dialog** — click an element button, type its label, and it lands on a free spot on the canvas
- **Drag-and-drop canvas** — drag to move, drag between ports to connect with directional arrows, double-click to rename inline
- **Full properties form** — name, type, description, live coordinates, size controls, duplicate/delete, and a clickable list of connected elements
- **Bulk import** — paste `Type: Label` lines to create a whole workflow at once, auto-connected and auto-laid-out
- **Context menu** — right-click an element for Edit, Duplicate, Change Type, Add Description, Delete
- **Undo/redo** — Ctrl+Z / Ctrl+Y (Cmd+Shift+Z works too), up to 100 steps
- **Auto layout** — arranges the diagram top-to-bottom by flow (start at top, end at bottom, branches spread out)
- **PDF export** — titled, timestamped document with the rendered diagram (html2pdf.js)
- **AI prompt export** — structured specification of the workflow, ready to paste into a coding agent
- **Visual effects** — GSAP tweens (placement, selection, connection draw-in, ripples), optional tsParticles background, optional Three.js parallax backdrop, Lottie export animations
- **No build step** — plain HTML/CSS/vanilla JS; effects libraries are lazy-loaded from CDNs

## Quick Start

```bash
git clone git@github.com:bhanni01/activity_diagram.git
cd activity_diagram

# Serve locally (any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly also works for everything except PDF export (rasterization needs an http origin in some browsers).

## Usage Guide

1. **Add elements** — click a button in the left toolbar (e.g. *Activity*), type a label in the dialog, and press **Enter** or *Create*. The element appears on a free spot and is selected.
2. **Move elements** — drag any element to reposition it. Connections follow automatically.
3. **Rename inline** — double-click an element, type the new label, press **Enter** (Escape cancels).
4. **Connect elements** — hover an element to reveal its four ports (small dots on the edges). Drag from a port onto another element to create an arrow in that flow direction. Invalid connections (into a Start, out of an End, duplicates, self-loops) are rejected with a message.
5. **Edit properties** — click an element to select it. The right panel edits its name, type, description and size, shows live coordinates, lists connected elements (click to jump, × to disconnect), and has Duplicate/Delete buttons. Every change updates the canvas immediately.
6. **Right-click** — the context menu offers Edit Label, Duplicate, Change Type, Add Description, and Delete.
7. **Bulk import** — click *Bulk Import* and paste one element per line, e.g. `Activity: Validate Input` or `Decision: Is Valid?` (lines without a type become activities). Elements are created, optionally auto-connected in sequence, and auto-laid-out.
8. **Undo/redo** — **Ctrl+Z** undoes, **Ctrl+Y** or **Cmd+Shift+Z** redoes (also available as toolbar buttons). **Delete** removes the selection, **Escape** closes menus/dialogs or deselects.
9. **Auto layout** — click *Auto Layout* to arrange everything in rows from Start to End.
10. **Clear** — *Clear All* wipes the canvas (with confirmation, undoable).
11. **Toggle effects** — the Settings section enables the particle field and the 3D background; both are lazy-loaded only when switched on.

A sample workflow (Start → Validate Input → Process Data / Show Error → End) loads on startup so you can explore right away.

## PDF Export

*Export PDF* generates an A4 document containing:

- the diagram name (from the Settings input) as the title
- a generation timestamp and element/connection counts
- the diagram rendered as a high-resolution image on the dark theme background

The file is named `<Diagram_Name>-<YYYY-MM-DD>.pdf`. Exports are cached in memory, so re-exporting an unchanged diagram is instant.

## AI Prompt Export

*Export Prompt* opens a modal with a structured text specification:

- every element listed with its label, type and id
- every connection written as `"From" (type) --> "To" (type)` flow lines
- the semantics of each element type
- instructions telling an AI coding agent how to turn the workflow into code

Use *Copy to Clipboard* or *Download .txt*, then paste it into your favorite agent along with a target language/framework.

## Deployment

The repo ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs sanity checks and deploys the site to GitHub Pages on every push to `main`.

One-time setup: in the repository settings, set **Settings → Pages → Source** to **GitHub Actions**. After that:

```bash
git push origin main
```

The site publishes to https://bhanni01.github.io/activity_diagram/. (Alternatively, Pages can be pointed directly at the `main` branch root without the workflow.)

## Tech

Vanilla JavaScript + SVG. CDN libraries: [GSAP](https://gsap.com/) (tweens), [tsParticles](https://particles.js.org/) (particle field, lazy), [Three.js](https://threejs.org/) (3D backdrop, lazy), [lottie-web](https://github.com/airbnb/lottie-web) (export animations), [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) (PDF).

## License

MIT — do whatever you like, attribution appreciated.
