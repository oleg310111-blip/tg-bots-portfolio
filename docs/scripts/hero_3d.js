/**
 * Open architectural 3D sculpture for #hero using local Three.js (r128).
 * Variant 2 ("Warm Alabaster & Architectural Bronze" / SQUZZER ATELIER):
 * - No boxed portal and no heavy pedestal: floating smoky-quartz crystal with
 *   warm burnished copper/bronze core, 3 high-contrast metallic rings, and 40
 *   non-additive volumetric microparticles.
 * - Procedural PMREM studio lighting (no RoomEnvironment / EffectComposer).
 * - Scroll recession (setScrollProgress), IntersectionObserver rAF pause,
 *   DPR cap (<= 1.75 desktop, <= 1.5 mobile), prefers-reduced-motion static frame,
 *   passive window/canvas pointer tracking without scroll blocking, and
 *   webglcontextlost / webglcontextrestored recovery.
 */

export const HERO_3D_MODES = Object.freeze(['crystal', 'orbit', 'pulse']);

export const THEME_PALETTES = Object.freeze({
  alabaster: Object.freeze({
    bgReference: 0xf2efe9,
    stoneSilk: 0xe8e2d6,
    corePrimary: 0xb4532a,
    coreGlow: 0x9a7b4f,
    coreInnerRing: 0x9a7b4f,
    crystalOuter: 0x3b352f,
    crystalInner: 0x1e1c19,
    crystalEmissive: 0x5c301c,
    ringBronze: 0x9a7b4f,
    ringCopper: 0xb4532a,
    ringGraphite: 0x141311,
    ambientLight: 0xf2efe9,
    keyLight: 0xfffaf2,
    rimLight: 0xe8e2d6,
    warmLight: 0xb4532a,
    emeraldLight: 0x1b5e4a,
    particleColor: 0x3d352e,
    particleOpacity: 0.72,
    additiveParticles: false,
    exposure: 1.12,
  }),
  obsidian: Object.freeze({
    bgReference: 0x04070f,
    stoneSilk: 0x091122,
    corePrimary: 0xe8c56e,
    coreGlow: 0x2dd4bf,
    coreInnerRing: 0xe8c56e,
    crystalOuter: 0x0e1a32,
    crystalInner: 0x115e59,
    crystalEmissive: 0x115e59,
    ringBronze: 0xe8c56e,
    ringCopper: 0xcbd5e1,
    ringGraphite: 0x2dd4bf,
    ambientLight: 0xa7b2c9,
    keyLight: 0xf5f7fc,
    rimLight: 0x2dd4bf,
    warmLight: 0xe8c56e,
    emeraldLight: 0x115e59,
    particleColor: 0x5eead4,
    particleOpacity: 0.78,
    additiveParticles: true,
    exposure: 1.16,
  }),
  nocturne: Object.freeze({
    bgReference: 0x07080d,
    stoneSilk: 0x101424,
    corePrimary: 0xe09f5a,
    coreGlow: 0xf3efe6,
    coreInnerRing: 0xe09f5a,
    crystalOuter: 0x141a30,
    crystalInner: 0x1c6b66,
    crystalEmissive: 0x2d4a8a,
    ringBronze: 0xe09f5a,
    ringCopper: 0xf3efe6,
    ringGraphite: 0x2d4a8a,
    ambientLight: 0x9ca5bd,
    keyLight: 0xf7f8fc,
    rimLight: 0x2d4a8a,
    warmLight: 0xe09f5a,
    emeraldLight: 0x1c6b66,
    particleColor: 0xf3efe6,
    particleOpacity: 0.74,
    additiveParticles: true,
    exposure: 1.14,
  }),
});

const MODE_PRESETS = Object.freeze({
  crystal: Object.freeze({
    cameraZ: 5.2,
    cameraX: 0,
    cameraY: 0.06,
    ringSpeed: 1.0,
    ringScale: 1.0,
    particleSpread: 1.0,
    pulseAmp: 0.04,
    pulseFreq: 1.65,
  }),
  orbit: Object.freeze({
    cameraZ: 5.65,
    cameraX: 0.16,
    cameraY: 0.14,
    ringSpeed: 2.1,
    ringScale: 1.09,
    particleSpread: 1.22,
    pulseAmp: 0.032,
    pulseFreq: 1.4,
  }),
  pulse: Object.freeze({
    cameraZ: 4.75,
    cameraX: 0,
    cameraY: 0,
    ringSpeed: 0.78,
    ringScale: 0.95,
    particleSpread: 0.9,
    pulseAmp: 0.13,
    pulseFreq: 2.9,
  }),
});

const DEFAULT_PALETTE = 'alabaster';
const PARTICLE_COUNT = 40;
const POINTER_DAMPING = 0.085;

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function clampRange(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createInactiveHandle() {
  return {
    setMode() {},
    setTheme() {},
    setScrollProgress() {},
    isActive: () => false,
    dispose() {},
  };
}

function showFallbackState(canvas, fallbackEl) {
  if (canvas) {
    canvas.hidden = true;
    if (typeof canvas.setAttribute === 'function') {
      canvas.setAttribute('hidden', '');
    }
  }
  if (fallbackEl) {
    fallbackEl.hidden = false;
    if (typeof fallbackEl.removeAttribute === 'function') {
      fallbackEl.removeAttribute('hidden');
    }
  }
}

function showCanvasState(canvas, fallbackEl) {
  if (canvas) {
    canvas.hidden = false;
    if (typeof canvas.removeAttribute === 'function') {
      canvas.removeAttribute('hidden');
    }
  }
  if (fallbackEl) {
    fallbackEl.hidden = true;
    if (typeof fallbackEl.setAttribute === 'function') {
      fallbackEl.setAttribute('hidden', '');
    }
  }
}

/**
 * Build procedural architectural studio IBL environment map via PMREMGenerator.
 * Combines warm daylight softboxes with dark obsidian negative-fill baffles so
 * smoky quartz and brushed bronze/copper/graphite rings show sharp high-contrast reflections.
 */
export function createStudioEnvironment(threeOrRenderer, maybeRenderer) {
  let THREE = null;
  let renderer = null;

  if (maybeRenderer !== undefined) {
    THREE = threeOrRenderer;
    renderer = maybeRenderer;
  } else if (threeOrRenderer && typeof threeOrRenderer.PMREMGenerator === 'function') {
    THREE = threeOrRenderer;
    renderer = null;
  } else {
    renderer = threeOrRenderer;
    THREE = globalThis.THREE || (typeof window !== 'undefined' ? window.THREE : null);
  }

  if (!THREE || !renderer || typeof THREE.PMREMGenerator !== 'function') {
    return { envMap: null, envTarget: null };
  }

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const tempGeometries = [];
  const tempMaterials = [];

  try {
    pmremGenerator.compileEquirectangularShader?.();

    const boxGeom = new THREE.BoxGeometry(22, 22, 22);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0x24201c,
      side: THREE.BackSide,
    });
    tempGeometries.push(boxGeom);
    tempMaterials.push(boxMat);
    envScene.add(new THREE.Mesh(boxGeom, boxMat));

    const panelSpecs = [
      // Overhead architectural daylight skylight
      {
        w: 11.0,
        h: 11.0,
        color: 0xfffaf2,
        pos: [0, 7.6, 0],
        rot: [Math.PI / 2, 0, 0],
      },
      // Left warm alabaster fill softbox
      {
        w: 8.5,
        h: 9.5,
        color: 0xf2efe9,
        pos: [-7.5, 0.8, 1.0],
        rot: [0, Math.PI / 2, 0],
      },
      // Right burnished copper-bronze warm bounce
      {
        w: 7.0,
        h: 9.0,
        color: 0xd98f60,
        pos: [7.5, 0.4, 0.6],
        rot: [0, -Math.PI / 2, 0],
      },
      // Dark obsidian negative-fill baffle for crisp glass & metal bevels
      {
        w: 6.5,
        h: 10.0,
        color: 0x141311,
        pos: [-3.8, -1.5, 6.4],
        rot: [0, 0.45, 0],
      },
      // Secondary dark architectural flag on opposite side
      {
        w: 5.5,
        h: 9.0,
        color: 0x141311,
        pos: [4.8, 2.2, -5.8],
        rot: [0, -0.62, 0],
      },
      // Rear brushed bronze rim strip
      {
        w: 10.0,
        h: 6.5,
        color: 0x9a7b4f,
        pos: [0, 1.2, -7.6],
        rot: [0, 0, 0],
      },
      // Floor limestone bounce
      {
        w: 10.0,
        h: 10.0,
        color: 0xe8e2d6,
        pos: [0, -7.6, 0],
        rot: [-Math.PI / 2, 0, 0],
      },
    ];

    for (const spec of panelSpecs) {
      const geom = new THREE.PlaneGeometry(spec.w, spec.h);
      const mat = new THREE.MeshBasicMaterial({
        color: spec.color,
        side: THREE.DoubleSide,
      });
      tempGeometries.push(geom);
      tempMaterials.push(mat);

      const panel = new THREE.Mesh(geom, mat);
      panel.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      panel.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
      envScene.add(panel);
    }

    const envTarget = pmremGenerator.fromScene(envScene, 0.04);
    return {
      envMap: envTarget ? envTarget.texture : null,
      envTarget: envTarget || null,
    };
  } finally {
    for (const geom of tempGeometries) {
      geom.dispose?.();
    }
    for (const mat of tempMaterials) {
      mat.dispose?.();
    }
    pmremGenerator.dispose?.();
  }
}

function createParticleTexture(THREE, doc) {
  if (!doc || typeof doc.createElement !== 'function' || typeof THREE.CanvasTexture !== 'function') {
    return null;
  }
  const offscreen = doc.createElement('canvas');
  if (!offscreen || typeof offscreen.getContext !== 'function') {
    return null;
  }
  offscreen.width = 64;
  offscreen.height = 64;
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    return null;
  }

  // Off-center specular radial sphere so particles read as volumetric beads rather than flat glow
  const gradient = ctx.createRadialGradient(24, 22, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.28, 'rgba(242, 239, 233, 0.92)');
  gradient.addColorStop(0.68, 'rgba(180, 170, 158, 0.55)');
  gradient.addColorStop(1, 'rgba(140, 130, 120, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(offscreen);
  texture.needsUpdate = true;
  return texture;
}

function getStageDimensions(canvas, portalEl, sectionEl, root, win) {
  const host = canvas?.parentElement || portalEl || sectionEl || root || canvas;
  const rect = host?.getBoundingClientRect?.();
  const width = Math.max(
    1,
    Math.round(rect?.width || canvas?.clientWidth || canvas?.width || win?.innerWidth || 640)
  );
  const height = Math.max(
    1,
    Math.round(rect?.height || canvas?.clientHeight || canvas?.height || 480)
  );
  return { width, height };
}

function computeDpr(win, stageWidth) {
  const viewportWidth = win?.innerWidth || stageWidth || 1024;
  const maxDpr = viewportWidth < 768 ? 1.5 : 1.75;
  return Math.min(win?.devicePixelRatio || 1, maxDpr);
}

/**
 * Mount the open architectural 3D sculpture on #hero-3d-canvas with safe fallback handling.
 */
export function initHero3D({
  canvas,
  fallbackEl,
  portalEl,
  sectionEl,
  root,
  windowObj,
  documentObj,
  paletteName,
  prefersReducedMotionFn,
} = {}) {
  const win = windowObj !== undefined ? windowObj : typeof window !== 'undefined' ? window : null;
  const doc =
    documentObj !== undefined ? documentObj : typeof document !== 'undefined' ? document : null;
  const THREE = globalThis.THREE || win?.THREE || null;

  if (!THREE || !canvas) {
    showFallbackState(canvas, fallbackEl);
    return createInactiveHandle();
  }

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    showFallbackState(canvas, fallbackEl);
    return createInactiveHandle();
  }

  const glContext = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
  if (!glContext) {
    renderer.dispose?.();
    showFallbackState(canvas, fallbackEl);
    return createInactiveHandle();
  }

  showCanvasState(canvas, fallbackEl);

  if (canvas.style) {
    canvas.style.touchAction = 'pan-y';
  }

  let motionQuery = null;
  let reducedMotionMatch = false;
  if (win && typeof win.matchMedia === 'function') {
    try {
      motionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotionMatch = Boolean(motionQuery?.matches);
    } catch {
      motionQuery = null;
    }
  }

  const isReducedMotion = () => {
    if (typeof prefersReducedMotionFn === 'function') {
      return Boolean(prefersReducedMotionFn());
    }
    return reducedMotionMatch;
  };

  const resolvePaletteName = (requested) => {
    if (requested && Object.hasOwn(THEME_PALETTES, requested)) {
      return requested;
    }
    const docTheme = doc?.documentElement?.dataset?.theme;
    if (docTheme && Object.hasOwn(THEME_PALETTES, docTheme)) {
      return docTheme;
    }
    return DEFAULT_PALETTE;
  };

  let currentTheme = resolvePaletteName(paletteName);
  let currentMode = 'crystal';
  let palette = THEME_PALETTES[currentTheme];

  const { width: initW, height: initH } = getStageDimensions(
    canvas,
    portalEl,
    sectionEl,
    root,
    win
  );
  renderer.setPixelRatio(computeDpr(win, initW));
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  if (THREE.ACESFilmicToneMapping !== undefined) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  renderer.toneMappingExposure = palette.exposure;
  renderer.setSize(initW, initH, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 100);
  camera.position.set(0, MODE_PRESETS.crystal.cameraY, MODE_PRESETS.crystal.cameraZ);
  camera.lookAt(0, 0, 0);

  let envTarget = null;
  const setupStudioEnv = () => {
    try {
      const env = createStudioEnvironment(THREE, renderer);
      if (env.envMap) {
        scene.environment = env.envMap;
        envTarget = env.envTarget;
      }
    } catch {
      envTarget = null;
    }
  };
  setupStudioEnv();

  const disposableGeometries = [];
  const disposableMaterials = [];
  const trackGeom = (geom) => {
    disposableGeometries.push(geom);
    return geom;
  };
  const trackMat = (mat) => {
    disposableMaterials.push(mat);
    return mat;
  };

  // Architectural Studio Lighting
  const ambientLight = new THREE.AmbientLight(palette.ambientLight, 0.75);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(palette.keyLight, 2.35);
  keyLight.position.set(3.8, 5.6, 4.4);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(palette.rimLight, 1.55);
  rimLight.position.set(-4.6, 2.2, -2.8);
  scene.add(rimLight);

  const warmLight = new THREE.DirectionalLight(palette.warmLight, 1.35);
  warmLight.position.set(4.0, -1.6, 2.5);
  scene.add(warmLight);

  const emeraldCounterLight = new THREE.DirectionalLight(palette.emeraldLight, 0.45);
  emeraldCounterLight.position.set(-3.2, -2.4, -3.5);
  scene.add(emeraldCounterLight);

  // Open floating sculptural assembly (zero frame, zero pedestal)
  const scenePivot = new THREE.Group();
  scene.add(scenePivot);

  const sculptureGroup = new THREE.Group();
  sculptureGroup.position.set(0, 0.04, 0);
  scenePivot.add(sculptureGroup);

  // 1. Warm Burnished Copper & Brushed Bronze Core
  const coreGroup = new THREE.Group();
  sculptureGroup.add(coreGroup);

  const coreHeartGeo = trackGeom(new THREE.SphereGeometry(0.19, 24, 24));
  const coreHeartMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.coreGlow,
      emissive: palette.corePrimary,
      emissiveIntensity: 1.15,
      metalness: 0.86,
      roughness: 0.18,
      envMapIntensity: 1.5,
    })
  );
  const coreHeart = new THREE.Mesh(coreHeartGeo, coreHeartMat);
  coreGroup.add(coreHeart);

  const coreFacetedGeo = trackGeom(new THREE.OctahedronGeometry(0.44, 0));
  const coreFacetedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.corePrimary,
      emissive: palette.corePrimary,
      emissiveIntensity: 0.35,
      metalness: 0.88,
      roughness: 0.16,
      flatShading: true,
      transparent: true,
      opacity: 0.94,
      envMapIntensity: 1.55,
    })
  );
  const coreFaceted = new THREE.Mesh(coreFacetedGeo, coreFacetedMat);
  coreFaceted.scale.set(0.84, 1.46, 0.84);
  coreGroup.add(coreFaceted);

  const coreCollarGeo = trackGeom(new THREE.TorusGeometry(0.54, 0.014, 16, 64));
  const coreCollarMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.coreInnerRing,
      emissive: palette.coreGlow,
      emissiveIntensity: 0.28,
      metalness: 0.92,
      roughness: 0.14,
      envMapIntensity: 1.6,
    })
  );
  const coreCollar = new THREE.Mesh(coreCollarGeo, coreCollarMat);
  coreCollar.rotation.x = Math.PI / 2;
  coreGroup.add(coreCollar);

  const corePointLight = new THREE.PointLight(palette.corePrimary, 2.2, 6.5, 1.6);
  coreGroup.add(corePointLight);

  // 2. Central Faceted Smoky-Quartz Crystal (two-layer physical glass)
  const crystalGroup = new THREE.Group();
  sculptureGroup.add(crystalGroup);

  const crystalGeo = trackGeom(new THREE.IcosahedronGeometry(1.06, 0));
  const crystalInnerMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: palette.crystalInner,
      emissive: palette.crystalEmissive,
      emissiveIntensity: 0.12,
      roughness: 0.12,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      flatShading: true,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      side: THREE.BackSide,
      envMapIntensity: 1.45,
    })
  );
  const crystalInner = new THREE.Mesh(crystalGeo, crystalInnerMat);
  crystalInner.scale.set(0.86, 1.28, 0.86);
  crystalInner.renderOrder = 1;
  crystalGroup.add(crystalInner);

  const crystalOuterMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: palette.crystalOuter,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      flatShading: true,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      side: THREE.FrontSide,
      envMapIntensity: 1.95,
    })
  );
  const crystalOuter = new THREE.Mesh(crystalGeo, crystalOuterMat);
  crystalOuter.scale.set(0.86, 1.28, 0.86);
  crystalOuter.renderOrder = 2;
  crystalGroup.add(crystalOuter);

  // 3. Three Thin Architectural Orbital Rings (Bronze, Burnished Copper, Dark Anodized Graphite)
  const ringsGroup = new THREE.Group();
  sculptureGroup.add(ringsGroup);

  const ringMatBronze = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.ringBronze,
      metalness: 0.92,
      roughness: 0.14,
      envMapIntensity: 1.75,
    })
  );
  const ringMatCopper = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.ringCopper,
      metalness: 0.92,
      roughness: 0.14,
      envMapIntensity: 1.75,
    })
  );
  const ringMatGraphite = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.ringGraphite,
      metalness: 0.92,
      roughness: 0.14,
      envMapIntensity: 1.65,
    })
  );

  const ringBronzeGeo = trackGeom(new THREE.TorusGeometry(1.32, 0.02, 24, 96));
  const ringCopperGeo = trackGeom(new THREE.TorusGeometry(1.48, 0.017, 24, 96));
  const ringGraphiteGeo = trackGeom(new THREE.TorusGeometry(1.16, 0.015, 24, 96));

  const ringBronze = new THREE.Mesh(ringBronzeGeo, ringMatBronze);
  ringBronze.rotation.set(0.62, 0.24, 0.32);

  const ringCopper = new THREE.Mesh(ringCopperGeo, ringMatCopper);
  ringCopper.rotation.set(-0.54, 0.48, -0.42);

  const ringGraphite = new THREE.Mesh(ringGraphiteGeo, ringMatGraphite);
  ringGraphite.rotation.set(1.16, -0.34, 0.22);

  ringsGroup.add(ringBronze, ringCopper, ringGraphite);

  // 4. 40 Volumetric Metallic/Smoky Microparticles (NormalBlending on light alabaster)
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleBase = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const t = i / PARTICLE_COUNT;
    const angle = i * 2.399963229728653;
    const radius = 1.46 + (((i * 37) % 100) / 100) * 1.18;
    const y = -1.18 + t * 2.42;
    const phase = i * 0.47;
    particleBase.push({ angle, radius, y, phase });
    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }

  const particleGeo = trackGeom(new THREE.BufferGeometry());
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

  const particleTexture = createParticleTexture(THREE, doc);
  const particleMat = trackMat(
    new THREE.PointsMaterial({
      color: palette.particleColor,
      size: 0.11,
      map: particleTexture,
      transparent: true,
      opacity: palette.particleOpacity,
      depthWrite: false,
      blending:
        palette.additiveParticles && THREE.AdditiveBlending !== undefined
          ? THREE.AdditiveBlending
          : THREE.NormalBlending !== undefined
            ? THREE.NormalBlending
            : 1,
    })
  );
  const particles = new THREE.Points(particleGeo, particleMat);
  scenePivot.add(particles);

  // Animation, scroll, and pointer state
  let active = true;
  let disposed = false;
  let contextLost = false;
  let inViewport = true;
  let rafId = 0;
  let lastFrameMs = 0;
  let simTime = 0;

  let currentCamZ = MODE_PRESETS.crystal.cameraZ;
  let currentCamX = MODE_PRESETS.crystal.cameraX;
  let currentCamY = MODE_PRESETS.crystal.cameraY;
  let currentRingScale = MODE_PRESETS.crystal.ringScale;
  let currentParticleSpread = MODE_PRESETS.crystal.particleSpread;

  let targetScroll = 0;
  let currentScroll = 0;

  let pointerParallaxX = 0;
  let pointerParallaxY = 0;
  let currentParallaxX = 0;
  let currentParallaxY = 0;

  let isDragging = false;
  let dragAxisLocked = null;
  let activePointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let targetRotX = 0;
  let targetRotY = 0.28;
  let currentRotX = 0;
  let currentRotY = 0.28;
  let velRotX = 0;
  let velRotY = 0;

  const renderFrame = () => {
    if (!active || disposed || contextLost) return;
    renderer.render(scene, camera);
  };

  const applySceneTransforms = (dt) => {
    const preset = MODE_PRESETS[currentMode] || MODE_PRESETS.crystal;
    const reduced = isReducedMotion();
    const lerpFactor = reduced ? 1 : Math.min(1, dt * 4.5);

    currentCamZ += (preset.cameraZ - currentCamZ) * lerpFactor;
    currentCamX += (preset.cameraX - currentCamX) * lerpFactor;
    currentCamY += (preset.cameraY - currentCamY) * lerpFactor;
    currentRingScale += (preset.ringScale - currentRingScale) * lerpFactor;
    currentParticleSpread += (preset.particleSpread - currentParticleSpread) * lerpFactor;
    currentScroll += (targetScroll - currentScroll) * lerpFactor;

    currentParallaxX += (pointerParallaxX - currentParallaxX) * (reduced ? 1 : 0.08);
    currentParallaxY += (pointerParallaxY - currentParallaxY) * (reduced ? 1 : 0.08);

    camera.position.set(
      currentCamX + currentParallaxX * 0.24,
      currentCamY - currentParallaxY * 0.14,
      currentCamZ
    );
    camera.lookAt(0, currentScroll * 0.1, 0);

    if (!isDragging) {
      targetRotY += velRotY;
      targetRotX += velRotX;
      velRotX *= 0.92;
      velRotY *= 0.92;
      if (!reduced) {
        targetRotX += (0 - targetRotX) * 0.035;
      }
    }

    targetRotX = clampRange(targetRotX, -0.56, 0.56);
    const rotDamp = reduced ? 1 : POINTER_DAMPING * 1.4;
    currentRotX += (targetRotX - currentRotX) * rotDamp;
    currentRotY += (targetRotY - currentRotY) * rotDamp;

    // Scroll recession: slide sculpture deeper into z-space, scale gently down, and turn smoothly
    const p = currentScroll;
    const sculptureScale = 1 - p * 0.28;
    sculptureGroup.scale.setScalar(sculptureScale);
    sculptureGroup.position.set(
      p * 0.28,
      0.04 + p * 0.42 + (reduced ? 0 : Math.sin(simTime * 1.25) * 0.045),
      -p * 2.55
    );

    const autoSpin = reduced ? 0 : simTime * 0.3;
    sculptureGroup.rotation.x = currentRotX + currentParallaxY * 0.14 + p * 0.16;
    sculptureGroup.rotation.y = currentRotY + autoSpin + currentParallaxX * 0.22 + p * 0.85;

    const pulse = reduced ? 1 : 1 + Math.sin(simTime * preset.pulseFreq) * preset.pulseAmp;
    coreGroup.scale.setScalar(pulse);
    coreGroup.rotation.y = reduced ? 0.36 : -simTime * 0.68;
    coreCollar.rotation.z = reduced ? 0.24 : simTime * 0.82;
    corePointLight.intensity = 2.1 * pulse * (1 - p * 0.35);

    ringsGroup.scale.setScalar(currentRingScale);
    const speed = preset.ringSpeed;
    ringBronze.rotation.y = 0.24 + simTime * 0.48 * speed;
    ringBronze.rotation.x = 0.62 + Math.sin(simTime * 0.68 * speed) * 0.14;
    ringCopper.rotation.z = -0.42 - simTime * 0.42 * speed;
    ringCopper.rotation.y = 0.48 + Math.cos(simTime * 0.58 * speed) * 0.12;
    ringGraphite.rotation.x = 1.16 + simTime * 0.62 * speed;

    particles.position.set(0, p * 0.24, -p * 1.9);
    particles.scale.setScalar(1 - p * 0.18);

    const posAttr = particleGeo.getAttribute('position');
    if (posAttr && posAttr.array) {
      const arr = posAttr.array;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const base = particleBase[i];
        const orbitA = base.angle + simTime * (0.12 + (i % 5) * 0.022) * speed;
        const r = base.radius * currentParticleSpread;
        arr[i * 3] = Math.cos(orbitA) * r;
        arr[i * 3 + 1] = base.y + Math.sin(simTime * 0.85 + base.phase) * 0.11;
        arr[i * 3 + 2] = Math.sin(orbitA) * r;
      }
      posAttr.needsUpdate = true;
    }
  };

  const stopLoop = () => {
    if (rafId && win?.cancelAnimationFrame) {
      win.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const tick = (nowMs) => {
    rafId = 0;
    if (!active || disposed || contextLost || !inViewport || doc?.hidden || isReducedMotion()) {
      return;
    }
    if (!lastFrameMs) {
      lastFrameMs = nowMs;
    }
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    simTime += dt;

    applySceneTransforms(dt);
    renderFrame();

    if (win?.requestAnimationFrame) {
      rafId = win.requestAnimationFrame(tick);
    }
  };

  const startLoop = () => {
    if (!active || disposed || contextLost || !inViewport || doc?.hidden || isReducedMotion()) {
      return;
    }
    if (!rafId && win?.requestAnimationFrame) {
      lastFrameMs = 0;
      rafId = win.requestAnimationFrame(tick);
    }
  };

  // Passive window cursor parallax (never blocks mobile vertical scroll)
  const onWindowPointerMove = (event) => {
    if (!active || disposed || contextLost || !inViewport) return;
    if (event.pointerType === 'touch') return;
    const vw = Math.max(1, win?.innerWidth || initW);
    const vh = Math.max(1, win?.innerHeight || initH);
    const nx = ((event.clientX ?? vw * 0.5) / vw) * 2 - 1;
    const ny = ((event.clientY ?? vh * 0.5) / vh) * 2 - 1;
    pointerParallaxX = clampRange(nx, -1, 1);
    pointerParallaxY = clampRange(ny, -1, 1);
  };

  // Soft pointer drag on scene (passive, touch-action: pan-y, yields to vertical touch swipes)
  const onPointerDown = (event) => {
    if (!active || disposed || contextLost) return;
    if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') {
      return;
    }
    isDragging = true;
    dragAxisLocked = event.pointerType === 'touch' ? null : 'free';
    activePointerId = event.pointerId ?? null;
    dragStartX = event.clientX || 0;
    dragStartY = event.clientY || 0;
    lastPointerX = dragStartX;
    lastPointerY = dragStartY;
    velRotX = 0;
    velRotY = 0;
  };

  const onPointerMove = (event) => {
    if (!isDragging || !active || disposed || contextLost) return;
    if (
      activePointerId !== null &&
      event.pointerId !== undefined &&
      event.pointerId !== activePointerId
    ) {
      return;
    }
    const x = event.clientX || 0;
    const y = event.clientY || 0;

    if (dragAxisLocked === null) {
      const totalDx = Math.abs(x - dragStartX);
      const totalDy = Math.abs(y - dragStartY);
      if (totalDx + totalDy < 6) {
        return;
      }
      if (totalDy > totalDx * 1.1) {
        // Yield immediately to native vertical scroll on touch devices
        isDragging = false;
        activePointerId = null;
        return;
      }
      dragAxisLocked = 'horizontal';
    }

    const dx = x - lastPointerX;
    const dy = y - lastPointerY;
    lastPointerX = x;
    lastPointerY = y;

    const deltaY = dx * 0.008;
    const deltaX = dragAxisLocked === 'horizontal' ? 0 : dy * 0.0055;
    targetRotY += deltaY;
    targetRotX = clampRange(targetRotX + deltaX, -0.56, 0.56);
    velRotY = deltaY * 0.42;
    velRotX = deltaX * 0.42;

    if (isReducedMotion()) {
      applySceneTransforms(0.016);
      renderFrame();
    }
  };

  const endDrag = (event) => {
    if (!isDragging) return;
    if (
      activePointerId !== null &&
      event?.pointerId !== undefined &&
      event.pointerId !== activePointerId
    ) {
      return;
    }
    isDragging = false;
    dragAxisLocked = null;
    activePointerId = null;
  };

  win?.addEventListener?.('pointermove', onWindowPointerMove, { passive: true });
  canvas.addEventListener?.('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener?.('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener?.('pointerup', endDrag, { passive: true });
  canvas.addEventListener?.('pointercancel', endDrag, { passive: true });

  const onContextLost = (event) => {
    event?.preventDefault?.();
    contextLost = true;
    active = false;
    stopLoop();
    showFallbackState(canvas, fallbackEl);
  };

  const onContextRestored = () => {
    if (disposed) return;
    contextLost = false;
    active = true;
    showCanvasState(canvas, fallbackEl);
    if (!scene.environment) {
      setupStudioEnv();
    }
    applySceneTransforms(0.016);
    renderFrame();
    startLoop();
  };

  canvas.addEventListener?.('webglcontextlost', onContextLost, false);
  canvas.addEventListener?.('webglcontextrestored', onContextRestored, false);

  const handleResize = () => {
    if (!active || disposed || contextLost) return;
    const { width, height } = getStageDimensions(canvas, portalEl, sectionEl, root, win);
    renderer.setPixelRatio(computeDpr(win, width));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (isReducedMotion() || !rafId) {
      renderFrame();
    }
  };

  let resizeObserver = null;
  const ResizeObs = win?.ResizeObserver || globalThis.ResizeObserver;
  if (typeof ResizeObs === 'function') {
    resizeObserver = new ResizeObs(() => handleResize());
    resizeObserver.observe(canvas.parentElement || portalEl || sectionEl || root || canvas);
  } else {
    win?.addEventListener?.('resize', handleResize, { passive: true });
  }

  let intersectionObserver = null;
  const IntersectionObs = win?.IntersectionObserver || globalThis.IntersectionObserver;
  const observedTarget = sectionEl || portalEl || root || canvas;
  if (typeof IntersectionObs === 'function' && observedTarget) {
    intersectionObserver = new IntersectionObs(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        inViewport = Boolean(entry.isIntersecting || entry.intersectionRatio > 0);
        if (inViewport) {
          startLoop();
        } else {
          stopLoop();
        }
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(observedTarget);
  }

  const onVisibilityChange = () => {
    if (disposed || contextLost) return;
    if (doc?.hidden) {
      stopLoop();
    } else if (active && inViewport) {
      if (isReducedMotion()) {
        renderFrame();
      } else {
        startLoop();
      }
    }
  };
  doc?.addEventListener?.('visibilitychange', onVisibilityChange);

  const onMotionPreferenceChange = (event) => {
    if (disposed) return;
    reducedMotionMatch = Boolean(event?.matches);
    if (isReducedMotion()) {
      stopLoop();
      applySceneTransforms(1);
      renderFrame();
    } else if (active && !contextLost && inViewport && !doc?.hidden) {
      startLoop();
    }
  };
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', onMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === 'function') {
      motionQuery.addListener(onMotionPreferenceChange);
    }
  }

  const setMode = (nextMode) => {
    if (!active || disposed || contextLost) return;
    currentMode = HERO_3D_MODES.includes(nextMode) ? nextMode : 'crystal';
    if (isReducedMotion() || !inViewport) {
      applySceneTransforms(1);
      renderFrame();
    }
  };

  const setTheme = (nextTheme) => {
    if (!active || disposed || contextLost) return;
    currentTheme = Object.hasOwn(THEME_PALETTES, nextTheme) ? nextTheme : DEFAULT_PALETTE;
    palette = THEME_PALETTES[currentTheme];

    renderer.toneMappingExposure = palette.exposure;

    ambientLight.color.setHex(palette.ambientLight);
    keyLight.color.setHex(palette.keyLight);
    rimLight.color.setHex(palette.rimLight);
    warmLight.color.setHex(palette.warmLight);
    emeraldCounterLight.color.setHex(palette.emeraldLight);

    coreHeartMat.color.setHex(palette.coreGlow);
    coreHeartMat.emissive.setHex(palette.corePrimary);
    coreFacetedMat.color.setHex(palette.corePrimary);
    coreFacetedMat.emissive.setHex(palette.corePrimary);
    coreCollarMat.color.setHex(palette.coreInnerRing);
    coreCollarMat.emissive.setHex(palette.coreGlow);
    corePointLight.color.setHex(palette.corePrimary);

    crystalInnerMat.color.setHex(palette.crystalInner);
    crystalInnerMat.emissive.setHex(palette.crystalEmissive);
    crystalOuterMat.color.setHex(palette.crystalOuter);

    ringMatBronze.color.setHex(palette.ringBronze);
    ringMatCopper.color.setHex(palette.ringCopper);
    ringMatGraphite.color.setHex(palette.ringGraphite);

    particleMat.color.setHex(palette.particleColor);
    particleMat.opacity = palette.particleOpacity;
    particleMat.blending =
      palette.additiveParticles && THREE.AdditiveBlending !== undefined
        ? THREE.AdditiveBlending
        : THREE.NormalBlending !== undefined
          ? THREE.NormalBlending
          : 1;
    particleMat.needsUpdate = true;

    if (isReducedMotion() || !inViewport) {
      renderFrame();
    }
  };

  const setScrollProgress = (heroProgress01) => {
    if (disposed) return;
    targetScroll = clamp01(heroProgress01);
    if (isReducedMotion() || !inViewport) {
      applySceneTransforms(1);
      renderFrame();
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    active = false;
    stopLoop();

    intersectionObserver?.disconnect?.();
    resizeObserver?.disconnect?.();
    if (!resizeObserver) {
      win?.removeEventListener?.('resize', handleResize);
    }
    win?.removeEventListener?.('pointermove', onWindowPointerMove);
    doc?.removeEventListener?.('visibilitychange', onVisibilityChange);

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') {
        motionQuery.removeEventListener('change', onMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === 'function') {
        motionQuery.removeListener(onMotionPreferenceChange);
      }
    }

    canvas.removeEventListener?.('pointerdown', onPointerDown);
    canvas.removeEventListener?.('pointermove', onPointerMove);
    canvas.removeEventListener?.('pointerup', endDrag);
    canvas.removeEventListener?.('pointercancel', endDrag);
    canvas.removeEventListener?.('webglcontextlost', onContextLost, false);
    canvas.removeEventListener?.('webglcontextrestored', onContextRestored, false);

    if (typeof scene.traverse === 'function') {
      scene.traverse((obj) => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          if (mat.map && typeof mat.map.dispose === 'function') {
            mat.map.dispose();
          }
          if (typeof mat.dispose === 'function') {
            mat.dispose();
          }
        }
      });
    }

    for (const geom of disposableGeometries) {
      geom?.dispose?.();
    }
    for (const mat of disposableMaterials) {
      mat?.dispose?.();
    }

    particleTexture?.dispose?.();
    envTarget?.dispose?.();
    scene.environment = null;
    renderer.dispose?.();
  };

  // Initial pose and render (renders 1 static noble frame even under prefers-reduced-motion)
  applySceneTransforms(0.016);
  renderFrame();
  startLoop();

  return {
    setMode,
    setTheme,
    setScrollProgress,
    isActive: () => Boolean(active && !disposed && !contextLost),
    dispose,
  };
}
