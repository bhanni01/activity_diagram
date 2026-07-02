# Activity Diagram Creator

A self-project tool for designing UML activity diagrams in the browser — a static site with a drag-and-drop SVG canvas, neon dark theme, PDF export, and AI-prompt generation for handing workflows to coding agents.

**Live site:** https://bhanni01.github.io/activity_diagram/

## Features

- **Five element types** — Start (circle), End (double circle), Activity (rounded rectangle), Decision (diamond), Merge (diamond)
- **Drag-and-drop canvas** — click to place, drag to move, drag between ports to connect with directional arrows
- **Properties panel** — rename elements, change their type, inspect in/out connection counts, delete
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

1. **Add elements** — click a button in the left toolbar (e.g. *Activity*), then click anywhere on the canvas to place it. Hold **Shift** while clicking to keep placing more of the same type.
2. **Move elements** — drag any element to reposition it. Connections follow automatically.
3. **Connect elements** — hover an element to reveal its four ports (small dots on the edges). Drag from a port onto another element to create an arrow in that flow direction. Invalid connections (into a Start, out of an End, duplicates, self-loops) are rejected with a message.
4. **Edit properties** — click an element to select it. The right panel lets you rename it, change its type, see incoming/outgoing connection counts, and delete it. Press **Delete/Backspace** to remove the selected element or connection.
5. **Auto layout** — click *Auto Layout* to arrange everything in rows from Start to End.
6. **Clear** — *Clear All* wipes the canvas (with confirmation).
7. **Toggle effects** — the Settings section enables the particle field and the 3D background; both are lazy-loaded only when switched on.

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
