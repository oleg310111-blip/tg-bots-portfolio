/**
 * Scroll choreography, View Transitions, and Top-Layer animation helpers
 * for SQUZZER ATELIER (Clean-Slate v4).
 * Zero external dependencies and zero polyfills.
 */

export const ACT_IDS = Object.freeze([
  'hero',
  'showcase',
  'services',
  'cases',
  'calculator-order',
]);

const ACT_SECTION_SELECTORS = Object.freeze([
  ['hero'],
  ['showcase'],
  ['services'],
  ['cases'],
  ['calculator', 'order', 'calculator-order'],
]);

const REVEAL_SELECTOR = '[data-reveal], .reveal-item';
const OPTICAL_SURFACE_SELECTOR = '[data-optical-surface]';
const MAGNETIC_SELECTOR = '[data-magnetic]';
const MAGNETIC_MAX_PX = 4;
const EXIT_ANIMATION_TIMEOUT_MS = 2000;

const displayTransitionCache = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveDocument(documentObj) {
  if (documentObj) return documentObj;
  return typeof document !== 'undefined' ? document : null;
}

function resolveWindow(windowObj, doc) {
  if (windowObj) return windowObj;
  if (doc?.defaultView) return doc.defaultView;
  return typeof window !== 'undefined' ? window : null;
}

function getCssSupports(doc, win) {
  const cssApi =
    win?.CSS ??
    doc?.defaultView?.CSS ??
    (typeof globalThis !== 'undefined' && globalThis.CSS ? globalThis.CSS : null);
  return typeof cssApi?.supports === 'function' ? cssApi.supports.bind(cssApi) : null;
}

function matchesMedia(win, query) {
  if (!win || typeof win.matchMedia !== 'function') return false;
  try {
    return Boolean(win.matchMedia(query)?.matches);
  } catch {
    return false;
  }
}

function isReducedMotionPreferred(doc, win, explicitReducedMotion) {
  if (typeof explicitReducedMotion === 'boolean') {
    return explicitReducedMotion;
  }
  const targetWin = win ?? resolveWindow(null, doc);
  return matchesMedia(targetWin, '(prefers-reduced-motion: reduce)');
}

function applyFocus(focusTarget) {
  if (!focusTarget || typeof focusTarget.focus !== 'function') return;
  try {
    if (
      typeof focusTarget.getAttribute === 'function' &&
      typeof focusTarget.setAttribute === 'function' &&
      focusTarget.getAttribute('tabindex') === null &&
      typeof focusTarget.tabIndex === 'number' &&
      focusTarget.tabIndex < 0
    ) {
      focusTarget.setAttribute('tabindex', '-1');
    }
    focusTarget.focus({ preventScroll: true });
  } catch {
    try {
      focusTarget.focus();
    } catch {
      // Ignore focus errors on detached or non-focusable mock elements
    }
  }
}

function invokeCleanup(cleanupFn) {
  if (typeof cleanupFn === 'function') {
    cleanupFn();
  }
}

/**
 * Safely wraps a DOM update in document.startViewTransition() when available
 * and motion is not reduced, routing focus and running cleanup after finish.
 */
export function runViewTransition(updateDomFn, options = {}) {
  const {
    documentObj,
    focusTarget = null,
    cleanupFn = null,
    reducedMotion,
  } = options || {};

  const doc = resolveDocument(documentObj);
  const win = resolveWindow(null, doc);
  const reduced = isReducedMotionPreferred(doc, win, reducedMotion);

  if (reduced || !doc || typeof doc.startViewTransition !== 'function') {
    if (typeof updateDomFn === 'function') {
      updateDomFn();
    }
    applyFocus(focusTarget);
    invokeCleanup(cleanupFn);
    return Promise.resolve(null);
  }

  let transition;
  try {
    transition = doc.startViewTransition(() => {
      if (typeof updateDomFn === 'function') {
        updateDomFn();
      }
    });
  } catch {
    if (typeof updateDomFn === 'function') {
      updateDomFn();
    }
    applyFocus(focusTarget);
    invokeCleanup(cleanupFn);
    return Promise.resolve(null);
  }

  const finishedPromise =
    transition && transition.finished
      ? Promise.resolve(transition.finished)
      : Promise.resolve();

  return finishedPromise
    .catch(() => undefined)
    .finally(() => {
      applyFocus(focusTarget);
      invokeCleanup(cleanupFn);
    })
    .then(() => transition);
}

/**
 * Probes whether discrete `display` transitions actually keep an element
 * rendered until the transition completes (working around Firefox bug 1882408).
 */
function canTransitionDisplay(doc) {
  if (!doc || !doc.body) return false;
  if (displayTransitionCache.has(doc)) {
    return displayTransitionCache.get(doc);
  }

  const win = resolveWindow(null, doc);
  const supports = getCssSupports(doc, win);
  if (!supports || !supports('transition-behavior', 'allow-discrete')) {
    displayTransitionCache.set(doc, false);
    return false;
  }

  if (
    typeof doc.createElement !== 'function' ||
    typeof doc.body.appendChild !== 'function' ||
    typeof win?.getComputedStyle !== 'function'
  ) {
    displayTransitionCache.set(doc, false);
    return false;
  }

  let supported = false;
  let probe = null;
  try {
    probe = doc.createElement('div');
    probe.style.cssText =
      'transition: display 1s allow-discrete !important; display: block;';
    doc.body.appendChild(probe);
    win.getComputedStyle(probe).display;
    probe.style.display = 'none';
    supported = win.getComputedStyle(probe).display === 'block';
  } catch {
    supported = false;
  } finally {
    probe?.remove?.();
  }

  displayTransitionCache.set(doc, supported);
  return supported;
}

function supportsTopLayerExit(doc) {
  const win = resolveWindow(null, doc);
  const supports = getCssSupports(doc, win);
  if (!supports) return false;
  try {
    if (!supports('overlay', 'auto')) return false;
  } catch {
    return false;
  }
  return canTransitionDisplay(doc);
}

function performNativeTopLayerClose(element) {
  if (!element) return false;

  const isDialogElement =
    typeof element.close === 'function' &&
    (element.tagName === 'DIALOG' ||
      typeof element.open === 'boolean' ||
      typeof element.hidePopover !== 'function');

  if (isDialogElement) {
    if (element.open === false) {
      return false;
    }
    try {
      element.close();
      return true;
    } catch {
      return false;
    }
  }

  if (typeof element.hidePopover === 'function') {
    try {
      element.hidePopover();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function waitForAnimations(animations) {
  let timeoutId = null;
  const settledPromise = Promise.allSettled(
    animations.map((anim) => (anim && anim.finished ? anim.finished : Promise.resolve()))
  );
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, EXIT_ANIMATION_TIMEOUT_MS);
  });

  return Promise.race([settledPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Safely closes a `<dialog>` or `[popover]` element, applying the `data-closing`
 * exit-animation fallback on browsers without discrete `display` + `overlay` support.
 */
export async function closeTopLayer(dialogOrPopover, options = {}) {
  if (!dialogOrPopover) return false;

  const { documentObj, reducedMotion } = options || {};
  const doc = resolveDocument(documentObj ?? dialogOrPopover.ownerDocument);
  const win = resolveWindow(null, doc);
  const reduced = isReducedMotionPreferred(doc, win, reducedMotion);

  if (reduced || supportsTopLayerExit(doc)) {
    dialogOrPopover.removeAttribute?.('data-closing');
    return performNativeTopLayerClose(dialogOrPopover);
  }

  if (dialogOrPopover.getAttribute?.('data-closing') === 'true') {
    return false;
  }

  dialogOrPopover.setAttribute?.('data-closing', 'true');

  const animations =
    typeof dialogOrPopover.getAnimations === 'function'
      ? dialogOrPopover.getAnimations({ subtree: true })
      : [];

  if (Array.isArray(animations) && animations.length > 0) {
    await waitForAnimations(animations);
    const stillClosing =
      typeof dialogOrPopover.hasAttribute === 'function'
        ? dialogOrPopover.hasAttribute('data-closing')
        : dialogOrPopover.getAttribute?.('data-closing') === 'true';
    if (!stillClosing) {
      return false;
    }
  }

  dialogOrPopover.removeAttribute?.('data-closing');
  return performNativeTopLayerClose(dialogOrPopover);
}

/**
 * Enables backdrop click light-dismiss for `<dialog>` when native `closedBy`
 * is unsupported. Returns a cleanup function that removes the listener.
 */
export function enableDialogLightDismissFallback(dialogEl, options = {}) {
  if (!dialogEl || typeof dialogEl.addEventListener !== 'function') {
    return () => {};
  }

  const hasNativeClosedBy =
    'closedBy' in dialogEl ||
    (typeof HTMLDialogElement !== 'undefined' &&
      'closedBy' in HTMLDialogElement.prototype);

  if (hasNativeClosedBy) {
    return () => {};
  }

  const { documentObj, reducedMotion } = options || {};

  const onBackdropClick = (event) => {
    if (!event || event.target !== dialogEl) return;
    if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) {
      return;
    }

    if (typeof dialogEl.getBoundingClientRect === 'function') {
      const rect = dialogEl.getBoundingClientRect();
      if (
        rect &&
        typeof rect.width === 'number' &&
        typeof rect.height === 'number' &&
        rect.width > 0 &&
        rect.height > 0 &&
        typeof event.clientX === 'number' &&
        typeof event.clientY === 'number'
      ) {
        const isInsideDialogBox =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isInsideDialogBox) return;
      }
    }

    closeTopLayer(dialogEl, {
      documentObj: documentObj ?? dialogEl.ownerDocument,
      reducedMotion,
    });
  };

  dialogEl.addEventListener('click', onBackdropClick);

  return () => {
    dialogEl.removeEventListener?.('click', onBackdropClick);
  };
}

function resetMagneticElement(el) {
  if (!el || !el.style) return;
  if ('translate' in el.style) {
    el.style.translate = '';
  }
  el.style.removeProperty?.('--mag-x');
  el.style.removeProperty?.('--mag-y');
}

function scheduleFrame(win, callback) {
  if (typeof win?.requestAnimationFrame === 'function') {
    return {
      type: 'raf',
      id: win.requestAnimationFrame(callback),
    };
  }
  return {
    type: 'timeout',
    id: setTimeout(callback, 16),
  };
}

function cancelScheduledFrame(win, handle) {
  if (!handle) return;
  if (handle.type === 'raf' && typeof win?.cancelAnimationFrame === 'function') {
    win.cancelAnimationFrame(handle.id);
  } else if (handle.type === 'timeout') {
    clearTimeout(handle.id);
  }
}

/**
 * Initializes scroll progress, active act detection, IntersectionObserver
 * reveal fallback, and fine-pointer optical surface / magnetic micro-shift.
 */
export function initScrollChoreography({
  documentObj,
  windowObj,
  onScrollChange,
  onActChange,
} = {}) {
  const doc = resolveDocument(documentObj);
  const win = resolveWindow(windowObj, doc);

  if (!doc || !win) {
    return {
      dispose() {},
      refresh() {},
    };
  }

  let disposed = false;
  let scrollFrameHandle = null;
  let pointerFrameHandle = null;
  let revealObserver = null;
  let currentAct = null;
  let lastProgress01 = -1;
  let lastHeroProgress01 = -1;
  let pendingPointer = null;
  let activeMagneticEl = null;

  const supportsViewTimeline = (() => {
    const supports = getCssSupports(doc, win);
    if (!supports) return false;
    try {
      return Boolean(
        supports('(animation-timeline: view()) and (animation-range: entry)')
      );
    } catch {
      return false;
    }
  })();

  const reducedMotionMql =
    typeof win.matchMedia === 'function'
      ? (() => {
          try {
            return win.matchMedia('(prefers-reduced-motion: reduce)');
          } catch {
            return null;
          }
        })()
      : null;

  const finePointerMql =
    typeof win.matchMedia === 'function'
      ? (() => {
          try {
            return win.matchMedia('(hover: hover) and (pointer: fine)');
          } catch {
            return null;
          }
        })()
      : null;

  function isReducedMotion() {
    return Boolean(reducedMotionMql?.matches);
  }

  function hasFinePointer() {
    return Boolean(finePointerMql?.matches);
  }

  function resolveActElements(idList) {
    const elements = [];
    for (const id of idList) {
      const el =
        typeof doc.getElementById === 'function'
          ? doc.getElementById(id)
          : doc.querySelector?.(`#${id}`);
      if (el) {
        elements.push(el);
      }
    }
    return elements;
  }

  function computeScrollMetrics() {
    const docEl = doc.documentElement;
    const scrollTop = Math.max(
      0,
      win.scrollY ?? win.pageYOffset ?? docEl?.scrollTop ?? 0
    );
    const docHeight = docEl?.scrollHeight ?? doc.body?.scrollHeight ?? 0;
    const viewportHeight = Math.max(
      1,
      win.innerHeight || docEl?.clientHeight || 1
    );
    const maxScroll = Math.max(0, docHeight - viewportHeight);
    const progress01 = maxScroll > 0 ? clamp(scrollTop / maxScroll, 0, 1) : 0;

    const heroEl = resolveActElements(ACT_SECTION_SELECTORS[0])[0] ?? null;
    let heroProgress01 = clamp(scrollTop / viewportHeight, 0, 1);
    if (heroEl) {
      const heroRect =
        typeof heroEl.getBoundingClientRect === 'function'
          ? heroEl.getBoundingClientRect()
          : null;
      const heroHeight = Math.max(
        1,
        heroRect?.height || heroEl.offsetHeight || viewportHeight
      );
      if (heroRect && typeof heroRect.top === 'number' && heroRect.height > 0) {
        heroProgress01 = clamp(-heroRect.top / heroHeight, 0, 1);
      } else {
        heroProgress01 = clamp(scrollTop / heroHeight, 0, 1);
      }
    }

    return {
      scrollTop,
      docHeight,
      viewportHeight,
      maxScroll,
      progress01,
      heroProgress01,
    };
  }

  function detectActiveAct(metrics) {
    const presentActs = [];
    for (let i = 0; i < ACT_SECTION_SELECTORS.length; i += 1) {
      const els = resolveActElements(ACT_SECTION_SELECTORS[i]);
      if (els.length > 0) {
        presentActs.push({ index: i, els });
      }
    }

    if (presentActs.length === 0) {
      return 0;
    }

    if (metrics.scrollTop <= 4) {
      return presentActs[0].index;
    }

    if (
      metrics.maxScroll > 0 &&
      metrics.scrollTop + metrics.viewportHeight >= metrics.docHeight - 4
    ) {
      return presentActs[presentActs.length - 1].index;
    }

    const focalY = metrics.viewportHeight * 0.38;
    let matchedIndex = presentActs[0].index;
    let hasMeasuredRect = false;

    for (const act of presentActs) {
      let minTop = Infinity;
      let hasRect = false;
      for (const el of act.els) {
        if (typeof el.getBoundingClientRect === 'function') {
          const rect = el.getBoundingClientRect();
          if (rect && typeof rect.top === 'number' && (rect.height > 0 || rect.top !== 0)) {
            hasRect = true;
            hasMeasuredRect = true;
            if (rect.top < minTop) {
              minTop = rect.top;
            }
          }
        }
      }
      if (hasRect && minTop <= focalY) {
        matchedIndex = act.index;
      }
    }

    return hasMeasuredRect ? matchedIndex : presentActs[0].index;
  }

  function updateScrollState() {
    if (disposed) return;

    const metrics = computeScrollMetrics();
    const docEl = doc.documentElement;
    if (docEl?.style?.setProperty) {
      docEl.style.setProperty('--scroll-progress', metrics.progress01.toFixed(4));
    }

    const roundedProgress = Math.round(metrics.progress01 * 10000) / 10000;
    const roundedHero = Math.round(metrics.heroProgress01 * 10000) / 10000;
    if (
      roundedProgress !== lastProgress01 ||
      roundedHero !== lastHeroProgress01
    ) {
      lastProgress01 = roundedProgress;
      lastHeroProgress01 = roundedHero;
      if (typeof onScrollChange === 'function') {
        onScrollChange(metrics.progress01, metrics.heroProgress01);
      }
    }

    const nextAct = detectActiveAct(metrics);
    if (nextAct !== currentAct) {
      currentAct = nextAct;
      if (docEl) {
        if (docEl.dataset) {
          docEl.dataset.activeAct = String(nextAct);
        } else if (typeof docEl.setAttribute === 'function') {
          docEl.setAttribute('data-active-act', String(nextAct));
        }
      }
      if (typeof onActChange === 'function') {
        onActChange(nextAct);
      }
    }
  }

  function scheduleScrollUpdate() {
    if (disposed || scrollFrameHandle !== null) return;
    scrollFrameHandle = scheduleFrame(win, () => {
      scrollFrameHandle = null;
      updateScrollState();
    });
  }

  function syncRevealObservers() {
    if (disposed) return;
    if (typeof doc.querySelectorAll !== 'function') return;

    const targets = Array.from(doc.querySelectorAll(REVEAL_SELECTOR));
    if (targets.length === 0) return;

    const reduced = isReducedMotion();
    if (reduced) {
      if (revealObserver) {
        revealObserver.disconnect();
        revealObserver = null;
      }
      for (const el of targets) {
        el.setAttribute?.('data-revealed', 'true');
      }
      return;
    }

    if (supportsViewTimeline) {
      if (revealObserver) {
        revealObserver.disconnect();
        revealObserver = null;
      }
      return;
    }

    if (typeof win.IntersectionObserver !== 'function') {
      for (const el of targets) {
        el.setAttribute?.('data-revealed', 'true');
      }
      return;
    }

    if (!revealObserver) {
      revealObserver = new win.IntersectionObserver(
        (entries) => {
          if (disposed) return;
          for (const entry of entries) {
            if (entry.isIntersecting || entry.intersectionRatio > 0) {
              entry.target?.setAttribute?.('data-revealed', 'true');
              revealObserver?.unobserve?.(entry.target);
            }
          }
        },
        {
          threshold: 0.12,
          rootMargin: '0px 0px -6% 0px',
        }
      );
    }

    for (const el of targets) {
      if (el.getAttribute?.('data-revealed') !== 'true') {
        revealObserver.observe?.(el);
      }
    }
  }

  function applyPointerEffects() {
    pointerFrameHandle = null;
    if (disposed || !pendingPointer) return;

    const { clientX, clientY, target } = pendingPointer;
    pendingPointer = null;

    if (isReducedMotion() || !hasFinePointer()) {
      if (activeMagneticEl) {
        resetMagneticElement(activeMagneticEl);
        activeMagneticEl = null;
      }
      return;
    }

    const surfaceEl = target?.closest?.(OPTICAL_SURFACE_SELECTOR) ?? null;
    const magneticEl = target?.closest?.(MAGNETIC_SELECTOR) ?? null;

    // Batch all layout reads before style writes to avoid layout thrashing.
    const surfaceRect =
      surfaceEl && typeof surfaceEl.getBoundingClientRect === 'function'
        ? surfaceEl.getBoundingClientRect()
        : null;
    const magneticRect =
      magneticEl && typeof magneticEl.getBoundingClientRect === 'function'
        ? magneticEl.getBoundingClientRect()
        : null;

    if (surfaceEl && surfaceRect && surfaceRect.width > 0 && surfaceRect.height > 0) {
      const mx = clamp(
        ((clientX - surfaceRect.left) / surfaceRect.width) * 100,
        0,
        100
      );
      const my = clamp(
        ((clientY - surfaceRect.top) / surfaceRect.height) * 100,
        0,
        100
      );
      surfaceEl.style?.setProperty?.('--mx', `${mx.toFixed(2)}%`);
      surfaceEl.style?.setProperty?.('--my', `${my.toFixed(2)}%`);
    }

    if (activeMagneticEl && activeMagneticEl !== magneticEl) {
      resetMagneticElement(activeMagneticEl);
      activeMagneticEl = null;
    }

    if (
      magneticEl &&
      magneticRect &&
      magneticRect.width > 0 &&
      magneticRect.height > 0
    ) {
      const halfW = magneticRect.width / 2;
      const halfH = magneticRect.height / 2;
      const nx = clamp((clientX - (magneticRect.left + halfW)) / halfW, -1, 1);
      const ny = clamp((clientY - (magneticRect.top + halfH)) / halfH, -1, 1);
      let tx = nx * MAGNETIC_MAX_PX;
      let ty = ny * MAGNETIC_MAX_PX;
      const magLen = Math.hypot(tx, ty);
      if (magLen > MAGNETIC_MAX_PX && magLen > 0) {
        const scale = MAGNETIC_MAX_PX / magLen;
        tx *= scale;
        ty *= scale;
      }

      if (magneticEl.style) {
        if ('translate' in magneticEl.style) {
          magneticEl.style.translate = `${tx.toFixed(2)}px ${ty.toFixed(2)}px`;
        }
        magneticEl.style.setProperty?.('--mag-x', `${tx.toFixed(2)}px`);
        magneticEl.style.setProperty?.('--mag-y', `${ty.toFixed(2)}px`);
      }
      activeMagneticEl = magneticEl;
    }
  }

  const onPointerMove = (event) => {
    if (disposed || isReducedMotion() || !hasFinePointer()) return;
    if (
      !event ||
      typeof event.clientX !== 'number' ||
      typeof event.clientY !== 'number'
    ) {
      return;
    }
    pendingPointer = {
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target ?? null,
    };
    if (pointerFrameHandle === null) {
      pointerFrameHandle = scheduleFrame(win, applyPointerEffects);
    }
  };

  const onPointerLeave = () => {
    pendingPointer = null;
    if (pointerFrameHandle !== null) {
      cancelScheduledFrame(win, pointerFrameHandle);
      pointerFrameHandle = null;
    }
    if (activeMagneticEl) {
      resetMagneticElement(activeMagneticEl);
      activeMagneticEl = null;
    }
  };

  const onReducedMotionChange = () => {
    if (disposed) return;
    if (isReducedMotion()) {
      onPointerLeave();
    }
    syncRevealObservers();
  };

  win.addEventListener?.('scroll', scheduleScrollUpdate, { passive: true });
  win.addEventListener?.('resize', scheduleScrollUpdate, { passive: true });
  doc.addEventListener?.('pointermove', onPointerMove, { passive: true });
  doc.addEventListener?.('pointerleave', onPointerLeave, { passive: true });
  win.addEventListener?.('blur', onPointerLeave);
  reducedMotionMql?.addEventListener?.('change', onReducedMotionChange);

  syncRevealObservers();
  updateScrollState();

  return {
    refresh() {
      if (disposed) return;
      syncRevealObservers();
      updateScrollState();
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      cancelScheduledFrame(win, scrollFrameHandle);
      scrollFrameHandle = null;
      cancelScheduledFrame(win, pointerFrameHandle);
      pointerFrameHandle = null;
      pendingPointer = null;

      if (activeMagneticEl) {
        resetMagneticElement(activeMagneticEl);
        activeMagneticEl = null;
      }

      if (revealObserver) {
        revealObserver.disconnect?.();
        revealObserver = null;
      }

      win.removeEventListener?.('scroll', scheduleScrollUpdate);
      win.removeEventListener?.('resize', scheduleScrollUpdate);
      doc.removeEventListener?.('pointermove', onPointerMove);
      doc.removeEventListener?.('pointerleave', onPointerLeave);
      win.removeEventListener?.('blur', onPointerLeave);
      reducedMotionMql?.removeEventListener?.('change', onReducedMotionChange);
    },
  };
}
