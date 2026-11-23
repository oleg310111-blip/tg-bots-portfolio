/**
 * Ambient full-screen GLSL backdrop shader for SQUZZER ATELIER (Clean-Slate v4).
 * Zero external dependencies: pure WebGL1/WebGL2 with GLSL ES 1.00.
 * Default preset: 'alabaster' (Variant 2 - Warm Alabaster & Architectural Bronze).
 */

function hexToRgb01(hex) {
  const clean = String(hex).replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return Object.freeze([
    Number(r.toFixed(4)),
    Number(g.toFixed(4)),
    Number(b.toFixed(4)),
  ]);
}

function freezePreset(preset) {
  return Object.freeze({
    baseColor: preset.baseColor,
    flowColorA: preset.flowColorA,
    flowColorB: preset.flowColorB,
    accentColor: preset.accentColor,
    secondaryColor: preset.secondaryColor,
    darkColor: preset.darkColor,
    grainStrength: preset.grainStrength,
    lightBalance: preset.lightBalance,
  });
}

export const SHADER_PRESETS = Object.freeze({
  alabaster: freezePreset({
    baseColor: hexToRgb01('#F2EFE9'),      // Warm Alabaster
    flowColorA: hexToRgb01('#E8E2D6'),     // Limestone Silk
    flowColorB: hexToRgb01('#9A7B4F'),     // Brushed Bronze
    accentColor: hexToRgb01('#B4532A'),    // Burnished Copper
    secondaryColor: hexToRgb01('#1B5E4A'), // Deep Forest Emerald
    darkColor: hexToRgb01('#141311'),      // Warm Obsidian Charcoal (focus acts)
    grainStrength: 0.022,
    lightBalance: 1.0,
  }),
  obsidian: freezePreset({
    baseColor: hexToRgb01('#04070F'),      // Obsidian Void
    flowColorA: hexToRgb01('#091122'),     // Deep Indigo Abyss
    flowColorB: hexToRgb01('#115E59'),     // Deep Teal Shadow
    accentColor: hexToRgb01('#E8C56E'),    // Warm Champagne Gold
    secondaryColor: hexToRgb01('#2DD4BF'), // Emerald Caustic
    darkColor: hexToRgb01('#04070F'),
    grainStrength: 0.026,
    lightBalance: 0.0,
  }),
  nocturne: freezePreset({
    baseColor: hexToRgb01('#07080D'),      // Midnight Basalt
    flowColorA: hexToRgb01('#101424'),     // Atmospheric Cobalt
    flowColorB: hexToRgb01('#2D4A8A'),     // Deep Cobalt Haze
    accentColor: hexToRgb01('#E09F5A'),    // Amber Filament
    secondaryColor: hexToRgb01('#1C6B66'), // Teal Rim
    darkColor: hexToRgb01('#07080D'),
    grainStrength: 0.026,
    lightBalance: 0.0,
  }),
});

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_scroll;
uniform float u_act_mix;
uniform vec3 u_color_base;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform vec3 u_color_accent;
uniform vec3 u_color_secondary;
uniform vec3 u_color_dark;
uniform vec3 u_accent_override;
uniform float u_accent_override_mix;
uniform float u_grain;
uniform float u_light_balance;
uniform float u_reduced_motion;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

// 2D Simplex noise for organic silk & caustic wave distortion
float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    value += amp * snoise(p);
    p = rot * p * 2.04 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return value;
}

// Interleaved gradient noise for banding-free dithering & fine mineral grain
float interleavedNoise(vec2 xy) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(xy, magic.xy)));
}

float actWeight(float act, float idx) {
  return max(0.0, 1.0 - abs(act - idx));
}

void main() {
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 uv = gl_FragCoord.xy / res;
  float aspect = res.x / res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 ptr = (u_pointer - 0.5) * vec2(aspect, 1.0);

  float t = (u_reduced_motion > 0.5) ? 14.0 : u_time;

  // Scroll parallax drift across the fluid plane
  vec2 flowPos = p * 1.35 + vec2(0.0, -u_scroll * 0.42);

  // Inertial pointer ripple gently bends nearby caustic waves
  vec2 toPtr = p - ptr;
  float ptrDist = length(toPtr);
  float ptrInfluence = exp(-ptrDist * ptrDist * 3.2);
  vec2 ptrSwirl = toPtr * (0.22 * ptrInfluence);
  float ptrRipple = sin(ptrDist * 9.0 - t * 1.4) * 0.5 + 0.5;
  float ptrSheen = ptrInfluence * (0.55 + 0.45 * ptrRipple);

  // Two-stage domain-warped FBM for silk & alabaster caustics
  vec2 q = vec2(
    fbm(flowPos + ptrSwirl + vec2(t * 0.045, -t * 0.03)),
    fbm(flowPos - ptrSwirl + vec2(5.2 - t * 0.035, 1.3 + t * 0.04))
  );
  vec2 r = vec2(
    fbm(flowPos + 1.55 * q + vec2(1.7 + t * 0.025, 9.2)),
    fbm(flowPos + 1.55 * q + vec2(8.3, 2.8 - t * 0.03))
  );

  float silkField = fbm(flowPos + 1.35 * r);
  float silkNorm = clamp(silkField * 0.55 + 0.5, 0.0, 1.0);

  float ridgeA = 1.0 - abs(snoise(flowPos * 1.65 + q * 1.35 + vec2(t * 0.05, -t * 0.04)));
  float ridgeB = 1.0 - abs(snoise(flowPos * 2.15 - r * 1.15 + vec2(-t * 0.04, t * 0.055)));
  float caustic = pow(clamp(ridgeA, 0.0, 1.0), 3.4) * 0.65
                + pow(clamp(ridgeB, 0.0, 1.0), 4.0) * 0.45;

  // 5-act weights (0: Hero, 1: Showcase, 2: Services, 3: Cases, 4: Calculator/Order)
  float actClamped = clamp(u_act_mix, 0.0, 4.0);
  float w0 = actWeight(actClamped, 0.0);
  float w1 = actWeight(actClamped, 1.0);
  float w2 = actWeight(actClamped, 2.0);
  float w3 = actWeight(actClamped, 3.0);
  float w4 = actWeight(actClamped, 4.0);

  // Active accent blends preset copper/gold with optional hover override
  vec3 activeAccent = mix(
    u_color_accent,
    u_accent_override,
    clamp(u_accent_override_mix, 0.0, 1.0)
  );

  // Light Alabaster base layer (#F2EFE9 <-> #E8E2D6)
  float stoneGrad = clamp(0.55 * silkNorm + 0.45 * (1.0 - uv.y * 0.65 + r.x * 0.2), 0.0, 1.0);
  vec3 lightCanvas = mix(u_color_a, u_color_base, stoneGrad);

  // Pearlescent highlight & warm bronze/copper caustic veins on alabaster
  vec3 pearlHighlight = mix(u_color_base, vec3(1.0, 0.992, 0.978), 0.52);
  vec3 bronzeVeins = mix(u_color_b, activeAccent, 0.35 + 0.35 * w3);

  lightCanvas = mix(lightCanvas, pearlHighlight, smoothstep(0.45, 0.95, silkNorm) * 0.42);
  lightCanvas = mix(lightCanvas, bronzeVeins, caustic * (0.14 + 0.08 * w3));
  lightCanvas = mix(lightCanvas, activeAccent, ptrSheen * (0.11 + 0.14 * u_accent_override_mix));

  // Subtle emerald mineral undertone during Services act (Act 2)
  float emeraldVeil = smoothstep(0.35, 0.85, q.x * 0.5 + 0.5) * w2 * 0.09;
  lightCanvas = mix(lightCanvas, u_color_secondary, emeraldVeil);

  // Keep the full-screen alabaster canvas luminous (#F2EFE9 / #E8E2D6) across all light sections
  // so dark editorial text (#141311 / #59544C) always maintains crisp >= 4.5:1 contrast.
  // Dark focus islands (#showcase, #order, footer) provide their own #141311 surfaces on top.
  vec3 warmSilkShift = mix(lightCanvas, u_color_base * 0.99, w1 * 0.18 + w4 * 0.14);
  vec3 alabasterComposed = mix(warmSilkShift, pearlHighlight, 0.16 * w0);

  // Dark-mode presets (obsidian / nocturne) modulation
  vec3 darkPresetComposed = mix(u_color_base, u_color_a, silkNorm * 0.85);
  vec3 darkPresetStream = mix(u_color_b, u_color_secondary, 0.45 * w1 + 0.55 * w2);
  darkPresetComposed = mix(darkPresetComposed, darkPresetStream, smoothstep(0.3, 0.85, q.x * 0.5 + 0.5) * 0.42);
  darkPresetComposed += activeAccent * (caustic * (0.24 + 0.12 * w4) + ptrSheen * (0.15 + 0.15 * u_accent_override_mix));
  darkPresetComposed += u_color_secondary * (caustic * 0.16 * (w0 + w1 + w2));

  vec3 color = mix(darkPresetComposed, alabasterComposed, clamp(u_light_balance, 0.0, 1.0));

  // Soft edge vignette that respects light/dark tone without muddying alabaster
  float edgeDist = length(p * vec2(0.82, 0.95));
  float vig = smoothstep(0.35, 1.15, edgeDist);
  float darkVigStrength = mix(0.32, 0.05, clamp(u_light_balance, 0.0, 1.0));
  color *= 1.0 - vig * darkVigStrength;

  // Sub-LSB triangular dithering + mineral paper grain to eliminate gradient banding
  float timeSeed = (u_reduced_motion > 0.5) ? 0.0 : fract(t * 7.13) * 19.37;
  float ignA = interleavedNoise(gl_FragCoord.xy + timeSeed);
  float ignB = interleavedNoise(gl_FragCoord.xy + vec2(37.0, 19.0) - timeSeed * 0.5);
  float triDither = (ignA + ignB - 1.0);

  color += triDither * (1.25 / 255.0);
  color += triDither * u_grain;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1, Math.max(0, num));
}

function clampRange(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function parseRgbOverride(input) {
  if (input == null) return null;

  if (typeof input === 'string') {
    const clean = input.trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
    ];
  }

  if (Array.isArray(input) && input.length >= 3) {
    const raw = [Number(input[0]), Number(input[1]), Number(input[2])];
    if (!raw.every(Number.isFinite)) return null;
    const scale = raw.some((v) => v > 1) ? 255 : 1;
    return raw.map((v) => clamp01(v / scale));
  }

  return null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpVec3(out, target, t) {
  out[0] = lerp(out[0], target[0], t);
  out[1] = lerp(out[1], target[1], t);
  out[2] = lerp(out[2], target[2], t);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (ok === false) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return { program: null, vs: null, fs: null };
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program: null, vs: null, fs: null };
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (linked === false) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program: null, vs: null, fs: null };
  }

  return { program, vs, fs };
}

function setFallbackFlag(target, enabled) {
  if (!target) return;
  if (enabled && typeof target.setAttribute === 'function') {
    target.setAttribute('data-backdrop-fallback', 'true');
  } else if (!enabled && typeof target.removeAttribute === 'function') {
    target.removeAttribute('data-backdrop-fallback');
  }
}

export function initAmbientShader({
  canvas,
  fallbackTarget,
  windowObj,
  documentObj,
  preset = 'alabaster',
} = {}) {
  const win = windowObj !== undefined
    ? windowObj
    : (typeof window !== 'undefined' ? window : null);
  const doc = documentObj !== undefined
    ? documentObj
    : (typeof document !== 'undefined' ? document : null);
  const resolvedFallbackTarget = fallbackTarget || canvas || doc?.documentElement || null;

  const initialPresetName = Object.prototype.hasOwnProperty.call(SHADER_PRESETS, preset)
    ? preset
    : 'alabaster';

  const state = {
    presetName: initialPresetName,
    active: false,
    disposed: false,
    contextLost: false,
    reducedMotion: false,
    rafId: 0,
    elapsedTime: 0,
    lastTimestamp: 0,

    targetScroll: 0,
    currentScroll: 0,
    targetAct: 0,
    currentAct: 0,
    targetPointer: [0.5, 0.5],
    currentPointer: [0.5, 0.5],

    targetColorBase: [...SHADER_PRESETS[initialPresetName].baseColor],
    currentColorBase: [...SHADER_PRESETS[initialPresetName].baseColor],
    targetColorA: [...SHADER_PRESETS[initialPresetName].flowColorA],
    currentColorA: [...SHADER_PRESETS[initialPresetName].flowColorA],
    targetColorB: [...SHADER_PRESETS[initialPresetName].flowColorB],
    currentColorB: [...SHADER_PRESETS[initialPresetName].flowColorB],
    targetColorAccent: [...SHADER_PRESETS[initialPresetName].accentColor],
    currentColorAccent: [...SHADER_PRESETS[initialPresetName].accentColor],
    targetColorSecondary: [...SHADER_PRESETS[initialPresetName].secondaryColor],
    currentColorSecondary: [...SHADER_PRESETS[initialPresetName].secondaryColor],
    targetColorDark: [...SHADER_PRESETS[initialPresetName].darkColor],
    currentColorDark: [...SHADER_PRESETS[initialPresetName].darkColor],
    targetGrain: SHADER_PRESETS[initialPresetName].grainStrength,
    currentGrain: SHADER_PRESETS[initialPresetName].grainStrength,
    targetLightBalance: SHADER_PRESETS[initialPresetName].lightBalance,
    currentLightBalance: SHADER_PRESETS[initialPresetName].lightBalance,

    targetOverrideColor: [...SHADER_PRESETS[initialPresetName].accentColor],
    currentOverrideColor: [...SHADER_PRESETS[initialPresetName].accentColor],
    targetOverrideMix: 0,
    currentOverrideMix: 0,

    width: 1,
    height: 1,
  };

  let gl = null;
  let glResources = null;
  let motionQuery = null;

  const cancelScheduledFrame = () => {
    if (!state.rafId) return;
    if (win && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(state.rafId);
    } else if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.rafId);
    }
    state.rafId = 0;
  };

  const requestNextFrame = (cb) => {
    if (win && typeof win.requestAnimationFrame === 'function') {
      return win.requestAnimationFrame(cb);
    }
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(cb);
    }
    return 0;
  };

  const snapCurrentState = () => {
    state.currentScroll = state.targetScroll;
    state.currentAct = state.targetAct;
    state.currentPointer[0] = state.targetPointer[0];
    state.currentPointer[1] = state.targetPointer[1];
    state.currentColorBase = [...state.targetColorBase];
    state.currentColorA = [...state.targetColorA];
    state.currentColorB = [...state.targetColorB];
    state.currentColorAccent = [...state.targetColorAccent];
    state.currentColorSecondary = [...state.targetColorSecondary];
    state.currentColorDark = [...state.targetColorDark];
    state.currentGrain = state.targetGrain;
    state.currentLightBalance = state.targetLightBalance;
    state.currentOverrideColor = [...state.targetOverrideColor];
    state.currentOverrideMix = state.targetOverrideMix;
  };

  const updateCanvasSize = () => {
    if (!canvas || !gl) return;
    const cssWidth = Math.max(1, Number(canvas.clientWidth) || Number(win?.innerWidth) || 1280);
    const cssHeight = Math.max(1, Number(canvas.clientHeight) || Number(win?.innerHeight) || 720);
    const viewportWidth = Number(win?.innerWidth) || cssWidth;
    const isMobile = viewportWidth < 768;
    const rawDpr = Number(win?.devicePixelRatio) || 1;
    const dpr = Math.min(rawDpr, isMobile ? 1.5 : 1.75);
    const mobileScale = isMobile ? 0.75 : 1.0;

    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr * mobileScale));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr * mobileScale));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    state.width = pixelWidth;
    state.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
  };

  const initGlPipeline = () => {
    if (!canvas || typeof canvas.getContext !== 'function') return false;

    const contextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    };

    let ctx = null;
    try {
      ctx = canvas.getContext('webgl2', contextAttributes)
        || canvas.getContext('webgl', contextAttributes)
        || canvas.getContext('experimental-webgl', contextAttributes);
    } catch (_err) {
      ctx = null;
    }

    if (!ctx) return false;
    gl = ctx;

    const { program, vs, fs } = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) {
      gl = null;
      return false;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      gl = null;
      return false;
    }

    const quadVertices = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.useProgram(program);
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    const uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      pointer: gl.getUniformLocation(program, 'u_pointer'),
      scroll: gl.getUniformLocation(program, 'u_scroll'),
      actMix: gl.getUniformLocation(program, 'u_act_mix'),
      colorBase: gl.getUniformLocation(program, 'u_color_base'),
      colorA: gl.getUniformLocation(program, 'u_color_a'),
      colorB: gl.getUniformLocation(program, 'u_color_b'),
      colorAccent: gl.getUniformLocation(program, 'u_color_accent'),
      colorSecondary: gl.getUniformLocation(program, 'u_color_secondary'),
      colorDark: gl.getUniformLocation(program, 'u_color_dark'),
      accentOverride: gl.getUniformLocation(program, 'u_accent_override'),
      accentOverrideMix: gl.getUniformLocation(program, 'u_accent_override_mix'),
      grain: gl.getUniformLocation(program, 'u_grain'),
      lightBalance: gl.getUniformLocation(program, 'u_light_balance'),
      reducedMotion: gl.getUniformLocation(program, 'u_reduced_motion'),
    };

    glResources = { program, vs, fs, buffer, uniforms };
    updateCanvasSize();
    return true;
  };

  const cleanupGlPipeline = (loseContextOnDispose) => {
    if (!gl) return;
    if (glResources) {
      try {
        if (glResources.buffer) gl.deleteBuffer(glResources.buffer);
        if (glResources.program) gl.deleteProgram(glResources.program);
        if (glResources.vs) gl.deleteShader(glResources.vs);
        if (glResources.fs) gl.deleteShader(glResources.fs);
      } catch (_err) {
        // Ignore cleanup errors on already lost contexts
      }
      glResources = null;
    }

    if (loseContextOnDispose && !state.contextLost && typeof gl.getExtension === 'function') {
      try {
        const ext = gl.getExtension('WEBGL_lose_context');
        ext?.loseContext?.();
      } catch (_err) {
        // Safe no-op if extension is unavailable
      }
    }
    gl = null;
  };

  const drawFrame = () => {
    if (!state.active || state.disposed || state.contextLost || !gl || !glResources) return;
    const { program, uniforms } = glResources;
    gl.useProgram(program);

    if (uniforms.time != null) gl.uniform1f(uniforms.time, state.elapsedTime);
    if (uniforms.resolution != null) gl.uniform2f(uniforms.resolution, state.width, state.height);
    if (uniforms.pointer != null) {
      gl.uniform2f(uniforms.pointer, state.currentPointer[0], state.currentPointer[1]);
    }
    if (uniforms.scroll != null) gl.uniform1f(uniforms.scroll, state.currentScroll);
    if (uniforms.actMix != null) gl.uniform1f(uniforms.actMix, state.currentAct);

    if (uniforms.colorBase != null) {
      gl.uniform3f(uniforms.colorBase, state.currentColorBase[0], state.currentColorBase[1], state.currentColorBase[2]);
    }
    if (uniforms.colorA != null) {
      gl.uniform3f(uniforms.colorA, state.currentColorA[0], state.currentColorA[1], state.currentColorA[2]);
    }
    if (uniforms.colorB != null) {
      gl.uniform3f(uniforms.colorB, state.currentColorB[0], state.currentColorB[1], state.currentColorB[2]);
    }
    if (uniforms.colorAccent != null) {
      gl.uniform3f(uniforms.colorAccent, state.currentColorAccent[0], state.currentColorAccent[1], state.currentColorAccent[2]);
    }
    if (uniforms.colorSecondary != null) {
      gl.uniform3f(uniforms.colorSecondary, state.currentColorSecondary[0], state.currentColorSecondary[1], state.currentColorSecondary[2]);
    }
    if (uniforms.colorDark != null) {
      gl.uniform3f(uniforms.colorDark, state.currentColorDark[0], state.currentColorDark[1], state.currentColorDark[2]);
    }
    if (uniforms.accentOverride != null) {
      gl.uniform3f(uniforms.accentOverride, state.currentOverrideColor[0], state.currentOverrideColor[1], state.currentOverrideColor[2]);
    }
    if (uniforms.accentOverrideMix != null) {
      gl.uniform1f(uniforms.accentOverrideMix, state.currentOverrideMix);
    }
    if (uniforms.grain != null) gl.uniform1f(uniforms.grain, state.currentGrain);
    if (uniforms.lightBalance != null) gl.uniform1f(uniforms.lightBalance, state.currentLightBalance);
    if (uniforms.reducedMotion != null) {
      gl.uniform1f(uniforms.reducedMotion, state.reducedMotion ? 1.0 : 0.0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const tick = (timestamp) => {
    state.rafId = 0;
    if (!state.active || state.disposed || state.contextLost || state.reducedMotion || doc?.hidden) {
      return;
    }

    const now = Number.isFinite(timestamp) ? timestamp : 0;
    const rawDelta = state.lastTimestamp > 0 ? (now - state.lastTimestamp) / 1000 : 1 / 60;
    const dt = Math.min(Math.max(rawDelta, 0), 0.05);
    state.lastTimestamp = now;
    state.elapsedTime += dt;

    // Exponential frame-rate independent smoothing
    const fastLerp = 1 - Math.exp(-8.5 * dt);
    const gentleLerp = 1 - Math.exp(-5.0 * dt);

    state.currentScroll = lerp(state.currentScroll, state.targetScroll, fastLerp);
    state.currentAct = lerp(state.currentAct, state.targetAct, gentleLerp);
    state.currentPointer[0] = lerp(state.currentPointer[0], state.targetPointer[0], fastLerp);
    state.currentPointer[1] = lerp(state.currentPointer[1], state.targetPointer[1], fastLerp);

    lerpVec3(state.currentColorBase, state.targetColorBase, gentleLerp);
    lerpVec3(state.currentColorA, state.targetColorA, gentleLerp);
    lerpVec3(state.currentColorB, state.targetColorB, gentleLerp);
    lerpVec3(state.currentColorAccent, state.targetColorAccent, gentleLerp);
    lerpVec3(state.currentColorSecondary, state.targetColorSecondary, gentleLerp);
    lerpVec3(state.currentColorDark, state.targetColorDark, gentleLerp);
    state.currentGrain = lerp(state.currentGrain, state.targetGrain, gentleLerp);
    state.currentLightBalance = lerp(state.currentLightBalance, state.targetLightBalance, gentleLerp);

    lerpVec3(state.currentOverrideColor, state.targetOverrideColor, fastLerp);
    state.currentOverrideMix = lerp(state.currentOverrideMix, state.targetOverrideMix, fastLerp);

    drawFrame();

    if (!state.disposed && state.active && !state.reducedMotion && !doc?.hidden && !state.contextLost) {
      state.rafId = requestNextFrame(tick);
    }
  };

  const startLoopIfAllowed = () => {
    if (state.disposed || !state.active || state.contextLost || state.reducedMotion || doc?.hidden) {
      return;
    }
    if (!state.rafId) {
      state.lastTimestamp = 0;
      state.rafId = requestNextFrame(tick);
    }
  };

  const renderStaticIfReduced = () => {
    if (!state.active || state.disposed || state.contextLost || !state.reducedMotion) return;
    snapCurrentState();
    drawFrame();
  };

  const onPointerMove = (event) => {
    if (!win || state.disposed) return;
    const w = Math.max(1, Number(win.innerWidth) || 1);
    const h = Math.max(1, Number(win.innerHeight) || 1);
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    state.targetPointer[0] = clamp01(x / w);
    state.targetPointer[1] = clamp01(1 - y / h);
  };

  const onResize = () => {
    if (state.disposed || !state.active || state.contextLost) return;
    updateCanvasSize();
    if (state.reducedMotion) {
      drawFrame();
    }
  };

  const onVisibilityChange = () => {
    if (state.disposed) return;
    if (doc?.hidden) {
      cancelScheduledFrame();
    } else if (state.active && !state.contextLost) {
      if (state.reducedMotion) {
        drawFrame();
      } else {
        startLoopIfAllowed();
      }
    }
  };

  const onMotionPreferenceChange = (event) => {
    if (state.disposed) return;
    state.reducedMotion = Boolean(event?.matches);
    if (state.reducedMotion) {
      cancelScheduledFrame();
      renderStaticIfReduced();
    } else if (state.active && !state.contextLost && !doc?.hidden) {
      startLoopIfAllowed();
    }
  };

  const onContextLost = (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    state.contextLost = true;
    state.active = false;
    cancelScheduledFrame();
    setFallbackFlag(resolvedFallbackTarget, true);
  };

  const onContextRestored = () => {
    if (state.disposed) return;
    state.contextLost = false;
    const ok = initGlPipeline();
    if (!ok) {
      state.active = false;
      setFallbackFlag(resolvedFallbackTarget, true);
      return;
    }
    state.active = true;
    setFallbackFlag(resolvedFallbackTarget, false);
    if (state.reducedMotion) {
      renderStaticIfReduced();
    } else if (!doc?.hidden) {
      startLoopIfAllowed();
    }
  };

  // Evaluate initial reduced-motion preference
  if (win && typeof win.matchMedia === 'function') {
    try {
      motionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
      state.reducedMotion = Boolean(motionQuery?.matches);
    } catch (_err) {
      motionQuery = null;
    }
  }

  // Initialize WebGL pipeline or trigger graceful fallback
  const initialized = initGlPipeline();
  if (!initialized) {
    state.active = false;
    setFallbackFlag(resolvedFallbackTarget, true);
  } else {
    state.active = true;
    setFallbackFlag(resolvedFallbackTarget, false);

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pointermove', onPointerMove, { passive: true });
      win.addEventListener('resize', onResize, { passive: true });
    }
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('webglcontextlost', onContextLost, false);
      canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    }
    if (motionQuery) {
      if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionPreferenceChange);
      } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(onMotionPreferenceChange);
      }
    }

    if (state.reducedMotion) {
      renderStaticIfReduced();
    } else if (!doc?.hidden) {
      // Draw initial frame synchronously so the canvas is never blank on frame 0
      snapCurrentState();
      drawFrame();
      startLoopIfAllowed();
    }
  }

  return {
    setScrollProgress(progress01) {
      if (state.disposed) return;
      state.targetScroll = clamp01(progress01);
    },

    setAct(actIndex) {
      if (state.disposed) return;
      state.targetAct = clampRange(actIndex, 0, 4);
      if (state.reducedMotion) {
        renderStaticIfReduced();
      }
    },

    setAccentOverride(rgbArrayOrNull) {
      if (state.disposed) return;
      const parsed = parseRgbOverride(rgbArrayOrNull);
      if (parsed) {
        state.targetOverrideColor = parsed;
        state.targetOverrideMix = 1;
      } else {
        state.targetOverrideMix = 0;
      }
    },

    setPreset(name) {
      if (state.disposed) return;
      if (!Object.prototype.hasOwnProperty.call(SHADER_PRESETS, name)) return;
      const next = SHADER_PRESETS[name];
      state.presetName = name;
      state.targetColorBase = [...next.baseColor];
      state.targetColorA = [...next.flowColorA];
      state.targetColorB = [...next.flowColorB];
      state.targetColorAccent = [...next.accentColor];
      state.targetColorSecondary = [...next.secondaryColor];
      state.targetColorDark = [...next.darkColor];
      state.targetGrain = next.grainStrength;
      state.targetLightBalance = next.lightBalance;
      if (state.reducedMotion) {
        renderStaticIfReduced();
      }
    },

    isActive() {
      return Boolean(state.active && !state.disposed && !state.contextLost);
    },

    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      state.active = false;
      cancelScheduledFrame();

      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('resize', onResize);
      }
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (canvas && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('webglcontextlost', onContextLost, false);
        canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
      }
      if (motionQuery) {
        if (typeof motionQuery.removeEventListener === 'function') {
          motionQuery.removeEventListener('change', onMotionPreferenceChange);
        } else if (typeof motionQuery.removeListener === 'function') {
          motionQuery.removeListener(onMotionPreferenceChange);
        }
      }

      cleanupGlPipeline(true);
    },
  };
}
