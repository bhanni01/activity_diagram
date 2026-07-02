/* ============================================================
   effects.js — visual effects layer.
   Implements the window.FX hooks dispatched from app.js/export.js.
   Everything here is optional polish: the app works without it.
   ============================================================ */

"use strict";

(function initEffects() {
  const hasGsap = typeof window.gsap !== "undefined";
  window.FX = window.FX || {};
  const FX = window.FX;

  /* ---------------- GSAP: element & connection animations ---------------- */

  /* Animate only children (shape/text) with scale so we never fight the
     group's translate() attribute that app.js manages during drags. */
  function shapeParts(node) {
    return node.querySelectorAll(".el-shape, text");
  }

  FX.elementAdded = function (node, el) {
    if (!hasGsap) return;
    gsap.from(node, { opacity: 0, duration: 0.35, ease: "power2.out" });
    gsap.from(shapeParts(node), {
      scale: 0.2,
      transformOrigin: "center center",
      duration: 0.45,
      ease: "back.out(1.8)",
    });
  };

  FX.elementRemoved = function (node, done) {
    if (!hasGsap) {
      done();
      return;
    }
    gsap.to(shapeParts(node), {
      scale: 0.2,
      transformOrigin: "center center",
      duration: 0.22,
      ease: "power2.in",
    });
    gsap.to(node, { opacity: 0, duration: 0.25, ease: "power2.in", onComplete: done });
  };

  FX.elementSelected = function (node) {
    if (!hasGsap || !node) return;
    gsap.fromTo(
      shapeParts(node),
      { scale: 1 },
      {
        scale: 1.09,
        transformOrigin: "center center",
        duration: 0.14,
        yoyo: true,
        repeat: 1,
        ease: "power1.inOut",
      }
    );
  };

  /* Smoothly tween an element to its auto-layout position. */
  FX.elementMoved = function (node, el, target) {
    if (!hasGsap || !node) return;
    const proxy = { x: el.x, y: el.y };
    gsap.to(proxy, {
      x: target.x,
      y: target.y,
      duration: 0.6,
      ease: "power2.inOut",
      onUpdate() {
        el.x = proxy.x;
        el.y = proxy.y;
        updateElementPosition(el);
      },
    });
  };

  /* Draw-in animation for new connections. */
  FX.connectionAdded = function (path) {
    if (!hasGsap || !path || typeof path.getTotalLength !== "function") return;
    const length = path.getTotalLength();
    if (!isFinite(length) || length <= 0) return;
    const marker = path.getAttribute("marker-end");
    path.removeAttribute("marker-end");
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    gsap.to(path, {
      strokeDashoffset: 0,
      duration: Math.min(0.7, 0.25 + length / 900),
      ease: "power2.out",
      onComplete() {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
        if (marker) path.setAttribute("marker-end", marker);
      },
    });
  };

  FX.modalOpened = function (root) {
    if (!hasGsap) return;
    const modal = root.querySelector(".modal");
    if (modal) {
      gsap.from(modal, { y: 26, opacity: 0, scale: 0.96, duration: 0.35, ease: "power3.out" });
    }
  };

  /* ---------------- GSAP: page entrance & button ripples ---------------- */

  FX.appReady = function () {
    if (!hasGsap) return;
    gsap.from(".site-header", { y: -22, opacity: 0, duration: 0.6, ease: "power3.out" });
    gsap.from(".panel", { y: 18, opacity: 0, duration: 0.55, stagger: 0.12, ease: "power3.out", delay: 0.15 });
    gsap.from(".canvas-wrap", { opacity: 0, duration: 0.7, delay: 0.25 });
  };

  document.addEventListener("click", (evt) => {
    if (!hasGsap) return;
    const btn = evt.target.closest(".btn");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${evt.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${evt.clientY - rect.top - size / 2}px`;
    btn.appendChild(ripple);
    gsap.to(ripple, {
      scale: 1,
      opacity: 0,
      duration: 0.55,
      ease: "power2.out",
      onComplete: () => ripple.remove(),
    });
  });
})();
