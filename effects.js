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

/* ============================================================
   Particle effects (tsParticles) and 3D background (Three.js).
   Both libraries are lazy-loaded only when their toggle is on.
   ============================================================ */

(function initBackgroundEffects() {
  const FX = window.FX;
  const hasGsap = typeof window.gsap !== "undefined";
  const loadedScripts = new Map();

  function loadScript(url) {
    if (!loadedScripts.has(url)) {
      loadedScripts.set(
        url,
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = url;
          script.onload = resolve;
          script.onerror = () => {
            loadedScripts.delete(url);
            reject(new Error(`Failed to load ${url}`));
          };
          document.head.appendChild(script);
        })
      );
    }
    return loadedScripts.get(url);
  }

  /* ---------------- Spark bursts on the canvas ---------------- */

  const typeColors = {
    start: "#00ff88",
    end: "#ff006e",
    activity: "#00d9ff",
    decision: "#a855f7",
    merge: "#00d9ff",
  };

  function sparkBurst(x, y, color, count, spread) {
    if (!hasGsap) return;
    const wrap = document.querySelector(".canvas-wrap");
    if (!wrap) return;
    for (let i = 0; i < count; i++) {
      const spark = document.createElement("div");
      spark.className = "spark";
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.background = color;
      spark.style.boxShadow = `0 0 8px ${color}`;
      wrap.appendChild(spark);
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.7;
      const dist = spread * (0.5 + Math.random() * 0.7);
      gsap.to(spark, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        opacity: 0,
        scale: 0.3,
        duration: 0.55 + Math.random() * 0.35,
        ease: "power2.out",
        onComplete: () => spark.remove(),
      });
    }
  }

  const baseElementAdded = FX.elementAdded;
  FX.elementAdded = function (node, el) {
    if (baseElementAdded) baseElementAdded(node, el);
    sparkBurst(el.x, el.y, typeColors[el.type] || "#00ff88", 12, 55);
  };

  const baseElementSelected = FX.elementSelected;
  FX.elementSelected = function (node) {
    if (baseElementSelected) baseElementSelected(node);
    if (!node) return;
    const id = node.dataset.id;
    const el = typeof getElement === "function" ? getElement(id) : null;
    if (el) sparkBurst(el.x, el.y, typeColors[el.type] || "#00ff88", 7, 40);
  };

  /* ---------------- tsParticles background field ---------------- */

  const TSPARTICLES_URL =
    "https://cdn.jsdelivr.net/npm/tsparticles-slim@2.12.0/tsparticles.slim.bundle.min.js";
  let particleContainer = null;

  async function enableParticles() {
    await loadScript(TSPARTICLES_URL);
    if (particleContainer) return;
    particleContainer = await window.tsParticles.load("particles-bg", {
      fpsLimit: 60,
      detectRetina: true,
      fullScreen: { enable: false },
      particles: {
        number: { value: 55, density: { enable: true, area: 900 } },
        color: { value: ["#00ff88", "#00d9ff", "#ff006e"] },
        links: { enable: true, color: "#00d9ff", distance: 140, opacity: 0.14 },
        move: { enable: true, speed: 0.6, outModes: { default: "out" } },
        opacity: { value: 0.35 },
        size: { value: { min: 1, max: 2.5 } },
      },
      interactivity: {
        detectsOn: "window",
        events: { onHover: { enable: true, mode: "grab" } },
        modes: { grab: { distance: 170, links: { opacity: 0.35 } } },
      },
    });
  }

  function disableParticles() {
    if (particleContainer) {
      particleContainer.destroy();
      particleContainer = null;
    }
  }

  /* ---------------- Three.js parallax background ---------------- */

  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js";
  const three = { renderer: null, scene: null, camera: null, meshes: [], raf: null, mouse: { x: 0, y: 0 } };

  function onThreeMouse(evt) {
    three.mouse.x = (evt.clientX / window.innerWidth) * 2 - 1;
    three.mouse.y = (evt.clientY / window.innerHeight) * 2 - 1;
  }

  function onThreeResize() {
    if (!three.renderer) return;
    three.camera.aspect = window.innerWidth / window.innerHeight;
    three.camera.updateProjectionMatrix();
    three.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async function enableThree() {
    await loadScript(THREE_URL);
    if (three.renderer) return;
    const THREE = window.THREE;
    three.scene = new THREE.Scene();
    three.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    three.camera.position.z = 14;
    three.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    three.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("three-bg").appendChild(three.renderer.domElement);

    const colors = [0x00ff88, 0x00d9ff, 0xff006e];
    for (let i = 0; i < 14; i++) {
      const geometry =
        i % 2 === 0 ? new THREE.BoxGeometry(1.6, 1.6, 1.6) : new THREE.IcosahedronGeometry(1.1, 0);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 16, -4 - Math.random() * 14);
      mesh.userData.spin = {
        x: (Math.random() - 0.5) * 0.008,
        y: (Math.random() - 0.5) * 0.008,
      };
      three.scene.add(mesh);
      three.meshes.push(mesh);
    }

    window.addEventListener("mousemove", onThreeMouse);
    window.addEventListener("resize", onThreeResize);

    (function animate() {
      three.raf = requestAnimationFrame(animate);
      for (const mesh of three.meshes) {
        mesh.rotation.x += mesh.userData.spin.x;
        mesh.rotation.y += mesh.userData.spin.y;
      }
      // Mouse parallax: ease the camera toward the pointer.
      three.camera.position.x += (three.mouse.x * 2 - three.camera.position.x) * 0.03;
      three.camera.position.y += (-three.mouse.y * 1.4 - three.camera.position.y) * 0.03;
      three.camera.lookAt(0, 0, -8);
      three.renderer.render(three.scene, three.camera);
    })();
  }

  function disableThree() {
    if (!three.renderer) return;
    cancelAnimationFrame(three.raf);
    window.removeEventListener("mousemove", onThreeMouse);
    window.removeEventListener("resize", onThreeResize);
    for (const mesh of three.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    three.meshes = [];
    three.renderer.dispose();
    three.renderer.domElement.remove();
    three.renderer = null;
    three.scene = null;
    three.camera = null;
  }

  /* ---------------- Toggle wiring ---------------- */

  function bindToggle(id, enable, disable, label) {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.addEventListener("change", async () => {
      if (toggle.checked) {
        try {
          await enable();
        } catch (err) {
          console.error(err);
          toggle.checked = false;
          if (typeof showToast === "function") showToast(`Could not load the ${label}.`, true);
        }
      } else {
        disable();
      }
    });
  }

  bindToggle("toggle-particles", enableParticles, disableParticles, "particle background");
  bindToggle("toggle-three", enableThree, disableThree, "3D background");
})();
