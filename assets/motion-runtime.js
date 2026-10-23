/*!
 * motion-craft runtime 1.0.0
 * Deterministic, seekable motion for self-contained HTML compositions.
 * Every frame is a pure function of time: the same t always renders the same pixels, so the
 * preview, the frame-by-frame checks and the video export all see exactly the same thing.
 * No dependencies, no network. Works inline in a single HTML file.
 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const IMPLICIT = Symbol('implicit');

  // ------------------------------------------------------------------ utils
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const round = (v, d = 4) => { const f = 10 ** d; return Math.round(v * f) / f; };
  const mapRange = (v, a, b, c, d, clampIt = true) => {
    let p = (v - a) / (b - a);
    if (clampIt) p = clamp(p, 0, 1);
    return c + (d - c) * p;
  };

  // --------------------------------------------------- randomness and noise
  // Seeded and deterministic: the same seed gives the same sequence on every run and in every renderer.
  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash1(i, seed) {
    let x = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  // 1D gradient noise in [-1, 1]: smooth, continuous, a pure function of x (safe to call per frame).
  function noise(x, seed = 0) {
    const i = Math.floor(x);
    const f = x - i;
    const g0 = hash1(i, seed) * 2 - 1;
    const g1 = hash1(i + 1, seed) * 2 - 1;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    return lerp(g0 * f, g1 * (f - 1), u) * 2;
  }
  // After Effects' wiggle(), but deterministic: amplitude around 0, `freq` wiggles per second.
  function wiggle(t, opts = {}) {
    const { freq = 1, amp = 1, seed = 0, octaves = 1 } = opts;
    let sum = 0;
    let norm = 0;
    let a = 1;
    let f = freq;
    for (let k = 0; k < octaves; k += 1) {
      sum += a * noise(t * f, seed + k * 101);
      norm += a;
      a *= 0.5;
      f *= 2;
    }
    return amp * (sum / norm);
  }

  // ----------------------------------------------------------------- easing
  const EASE_IN = {
    linear: (p) => p,
    sine: (p) => 1 - Math.cos((p * Math.PI) / 2),
    quad: (p) => p * p,
    cubic: (p) => p * p * p,
    quart: (p) => p * p * p * p,
    quint: (p) => p * p * p * p * p,
    expo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
    circ: (p) => 1 - Math.sqrt(Math.max(0, 1 - p * p)),
  };
  const ALIASES = { power0: 'linear', power1: 'quad', power2: 'cubic', power3: 'quart', power4: 'quint', none: 'linear' };
  const easeOut = (f) => (p) => 1 - f(1 - p);
  const easeInOut = (f) => (p) => (p < 0.5 ? f(2 * p) / 2 : 1 - f(2 - 2 * p) / 2);
  const DIRS = { in: (f) => f, out: easeOut, inout: easeInOut };

  function elasticOut(amp = 1, period = 0.3) {
    const a = Math.max(1, amp);
    const tau = Math.PI * 2;
    const s = (period / tau) * Math.asin(1 / a);
    return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : a * Math.pow(2, -10 * p) * Math.sin(((p - s) * tau) / period) + 1);
  }
  function bounceOut(p) {
    const n = 7.5625;
    const d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) { const q = p - 1.5 / d; return n * q * q + 0.75; }
    if (p < 2.5 / d) { const q = p - 2.25 / d; return n * q * q + 0.9375; }
    const q = p - 2.625 / d;
    return n * q * q + 0.984375;
  }
  // Each family returns its "in" curve; DIRS derive out and inOut from it.
  const FAMILIES = {
    ...Object.fromEntries(Object.entries(EASE_IN).map(([k, f]) => [k, () => f])),
    back: (s) => { const k = isNum(s) ? s : 1.70158; return (p) => p * p * ((k + 1) * p - k); },
    elastic: (a, per) => { const o = elasticOut(isNum(a) ? a : 1, isNum(per) ? per : 0.3); return (p) => 1 - o(1 - p); },
    bounce: () => (p) => 1 - bounceOut(1 - p),
  };

  // CSS cubic-bezier(), solved like the browser does (Newton, then bisection).
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    const solve = (x) => {
      let t = x;
      for (let i = 0; i < 8; i += 1) {
        const err = sx(t) - x;
        if (Math.abs(err) < 1e-7) return t;
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 50; i += 1) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-7) break;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    };
    return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)));
  }

  // CSS steps(): jump-end (default), jump-start, jump-none, jump-both.
  function steps(n, pos = 'end') {
    const k = Math.max(1, n | 0);
    const mode = String(pos).replace('jump-', '');
    return (p) => {
      if (p <= 0) return mode === 'start' || mode === 'both' ? (mode === 'both' ? 1 / (k + 1) : 1 / k) : 0;
      if (p >= 1) return 1;
      if (mode === 'start') return Math.min(1, Math.ceil(p * k) / k);
      if (mode === 'none') return k > 1 ? Math.min(1, Math.floor(p * k) / (k - 1)) : 0;
      if (mode === 'both') return (Math.floor(p * k) + 1) / (k + 1);
      return Math.floor(p * k) / k;
    };
  }

  // A damped spring used as an easing curve. bounce 0 = critically damped (no overshoot), towards 1 = springier.
  // The curve is normalised so that it settles (within 0.05% of the distance) exactly at the end of the tween:
  // the tween's duration is the time to rest; the visual arrival happens around half of it.
  const SPRING_EPS = 0.0005;
  function springEase(bounce = 0.2) {
    const b = clamp(isNum(bounce) ? bounce : 0.2, 0, 0.95);
    const zeta = 1 - b;
    let x;
    let settle;
    if (zeta >= 0.9999) {
      x = (t) => 1 - (1 + t) * Math.exp(-t);
      let lo = 0;
      let hi = 60;
      for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if ((1 + mid) * Math.exp(-mid) > SPRING_EPS) lo = mid; else hi = mid;
      }
      settle = hi;
    } else {
      const wd = Math.sqrt(1 - zeta * zeta);
      x = (t) => 1 - Math.exp(-zeta * t) * (Math.cos(wd * t) + (zeta / wd) * Math.sin(wd * t));
      settle = Math.log(1 / (SPRING_EPS * wd)) / zeta;
    }
    return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : x(p * settle));
  }
  // Physical parameters -> { duration (s, time to rest), ease } to spread into a tween.
  function physicalSpring({ stiffness = 170, damping = 26, mass = 1 } = {}) {
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const z = clamp(zeta, 0.05, 1);
    let settle;
    if (z >= 0.9999) {
      let lo = 0;
      let hi = 60;
      for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if ((1 + mid) * Math.exp(-mid) > SPRING_EPS) lo = mid; else hi = mid;
      }
      settle = hi;
    } else {
      settle = Math.log(1 / (SPRING_EPS * Math.sqrt(1 - z * z))) / z;
    }
    return { duration: round(settle / w0, 3), ease: `spring(${round(1 - z, 3)})` };
  }

  const CSS_KEYWORDS = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const easeCache = new Map();
  // Accepts: functions; tokens registered on the composition (enter, exit, move...); 'linear'; CSS keywords;
  // cubic-bezier(); steps(); spring(bounce); 'out.expo' / 'expo.out' / 'power3.inOut' / 'back.out(1.7)' /
  // 'elastic.out(1, 0.3)'.
  function parseEase(spec, tokens = {}, warn = null, depth = 0) {
    if (typeof spec === 'function') return spec;
    if (spec == null || spec === '') return null;
    const s = String(spec).trim();
    if (tokens && tokens[s] != null && depth < 6) return parseEase(tokens[s], tokens, warn, depth + 1);
    if (easeCache.has(s)) return easeCache.get(s);
    const lower = s.toLowerCase();
    let f = null;
    let m;
    if (lower === 'linear' || lower === 'none') f = EASE_IN.linear;
    else if (CSS_KEYWORDS[lower]) f = cubicBezier(...CSS_KEYWORDS[lower]);
    else if ((m = lower.match(/^cubic-bezier\(([^)]*)\)$/))) {
      const n = m[1].split(',').map((v) => parseFloat(v));
      if (n.length === 4 && n.every(Number.isFinite)) f = cubicBezier(n[0], n[1], n[2], n[3]);
    } else if ((m = lower.match(/^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/))) f = steps(+m[1], m[2] || 'end');
    else if ((m = lower.match(/^spring(?:\(\s*([^)]*)\))?$/))) f = springEase(m[1] ? parseFloat(m[1]) : 0.2);
    else if ((m = s.match(/^([a-zA-Z0-9]+)(?:\.([a-zA-Z]+))?(?:\(([^)]*)\))?$/))) {
      const a = m[1];
      const b = m[2] || '';
      const args = m[3] ? m[3].split(',').map((x) => parseFloat(x)) : [];
      const isDir = (x) => /^(in|out|inout)$/i.test(x);
      let dir = null;
      let fam = null;
      if (b && isDir(a)) { dir = a; fam = b; } else if (b && isDir(b)) { fam = a; dir = b; } else if (!b && isDir(a)) { dir = a; fam = 'cubic'; } else if (!b) { fam = a; dir = 'out'; }
      if (fam) fam = ALIASES[fam.toLowerCase()] || fam.toLowerCase();
      if (fam && FAMILIES[fam] && dir) f = DIRS[dir.toLowerCase()](FAMILIES[fam](...args));
    }
    if (!f) {
      if (warn) warn(`curva sconosciuta "${s}": uso out.cubic`);
      f = easeOut(EASE_IN.cubic);
    }
    easeCache.set(s, f);
    return f;
  }
  // Any curve as a CSS linear() easing, for authors who animate with CSS @keyframes.
  function toLinear(ease, samples = 40, tokens = {}) {
    const f = parseEase(ease, tokens) || EASE_IN.linear;
    const pts = [];
    for (let i = 0; i <= samples; i += 1) pts.push(round(f(i / samples), 4));
    return `linear(${pts.join(', ')})`;
  }

  // ------------------------------------------------------ values and interpolation
  const NUM_RE = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)\s*$/i;
  const NUM_G = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const COLOR_START = /^(#[0-9a-f]{3,8}$|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|color-mix\()/i;
  const COLOR_PROPS = new Set(['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor',
    'borderLeftColor', 'outlineColor', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor', 'caretColor',
    'textDecorationColor', 'columnRuleColor', 'accentColor']);
  const TRANSFORM_PROPS = { x: 'px', y: 'px', z: 'px', xPercent: '%', yPercent: '%', rotate: 'deg', rotation: 'deg', rotateZ: 'deg',
    rotateX: 'deg', rotateY: 'deg', skewX: 'deg', skewY: 'deg', scale: '', scaleX: '', scaleY: '', transformPerspective: 'px' };
  const TRANSFORM_BASE = { scale: 1, scaleX: 1, scaleY: 1 };
  const FILTER_PROPS = { blur: 'px', brightness: '', contrast: '', saturate: '', grayscale: '', sepia: '', invert: '', hueRotate: 'deg' };
  const FILTER_BASE = { brightness: 1, contrast: 1, saturate: 1 };
  const FILTER_CSS = { hueRotate: 'hue-rotate' };
  const UNITLESS = new Set(['opacity', 'autoAlpha', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order',
    'fillOpacity', 'strokeOpacity', 'stopOpacity', 'floodOpacity', 'draw', 'strokeMiterlimit']);
  const OPTION_KEYS = new Set(['duration', 'ease', 'stagger', 'delay', 'repeat', 'yoyo', 'repeatDelay', 'times', 'perceptual', 'morphPoints']);
  const SCALE_PROPS = new Set(['scale', 'scaleX', 'scaleY']);

  function looksColor(v, prop) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (COLOR_START.test(s)) return true;
    if (COLOR_PROPS.has(prop) && (/^var\(/i.test(s) || /^[a-z]+$/i.test(s))) return true;
    if (/^[a-z]+$/i.test(s) && root.CSS && typeof root.CSS.supports === 'function') {
      try { return root.CSS.supports('color', s) && !['inherit', 'initial', 'unset', 'revert'].includes(s.toLowerCase()); } catch (e) { return false; }
    }
    return false;
  }
  function parseNum(v) {
    if (isNum(v)) return { n: v, u: '' };
    if (v && typeof v === 'object' && isNum(v.n)) return v;
    if (typeof v !== 'string') return null;
    const m = v.match(NUM_RE);
    return m ? { n: parseFloat(m[1]), u: m[2] || '' } : null;
  }
  function normalizeSpaces(s) {
    return String(s).trim().replace(/\s+/g, ' ').replace(/\s*([(),/])\s*/g, '$1');
  }
  function parseComplex(v) {
    const s = String(v);
    const nums = [];
    const parts = [];
    let last = 0;
    s.replace(NUM_G, (m, idx) => {
      parts.push(s.slice(last, idx));
      nums.push(parseFloat(m));
      last = idx + m.length;
      return m;
    });
    parts.push(s.slice(last));
    return { nums, parts };
  }
  const toSpec = (v) => (v && typeof v === 'object' && 'n' in v ? (v.u ? `${round(v.n, 4)}${v.u}` : round(v.n, 4)) : v);

  // Returns fn(easedProgress, rawProgress) -> value ({n,u} for numbers, string otherwise).
  function makeInterp(prop, a, b, opts, warn) {
    if (looksColor(a, prop) || looksColor(b, prop)) {
      const A = String(a);
      const B = String(b);
      if (A === B) return () => A;
      return (e) => {
        const p = clamp(e, 0, 1);
        return p <= 0 ? A : p >= 1 ? B : `color-mix(in oklab, ${B} ${round(p * 100, 3)}%, ${A})`;
      };
    }
    const na = parseNum(a);
    const nb = parseNum(b);
    if (na && nb) {
      let unit = nb.u || na.u;
      if (na.u && nb.u && na.u !== nb.u) {
        if (na.n === 0) unit = nb.u;
        else if (nb.n === 0) unit = na.u;
        else {
          if (warn) warn(`${prop}: unità diverse (${toSpec(a)} → ${toSpec(b)}), salto senza interpolare`);
          return (e, raw) => (raw >= 1 ? nb : na);
        }
      }
      if (opts && opts.perceptual !== false && SCALE_PROPS.has(prop) && na.n > 0 && nb.n > 0 && na.n !== nb.n) {
        const r = nb.n / na.n;
        return (e) => ({ n: na.n * Math.pow(r, e), u: unit });
      }
      return (e) => ({ n: lerp(na.n, nb.n, e), u: unit });
    }
    if (typeof a === 'string' && typeof b === 'string') {
      const A = normalizeSpaces(a);
      const B = normalizeSpaces(b);
      const ca = parseComplex(A);
      const cb = parseComplex(B);
      if (ca.nums.length > 0 && ca.nums.length === cb.nums.length && ca.parts.join('\u0000') === cb.parts.join('\u0000')) {
        return (e) => {
          let out = ca.parts[0];
          for (let i = 0; i < ca.nums.length; i += 1) out += round(lerp(ca.nums[i], cb.nums[i], e), 4) + ca.parts[i + 1];
          return out;
        };
      }
    }
    if (a !== b && warn) warn(`${prop}: "${toSpec(a)}" → "${toSpec(b)}" non è interpolabile, cambia alla fine del tween`);
    return (e, raw) => (raw >= 1 ? b : a);
  }

  function fmt(prop, v) {
    if (v && typeof v === 'object' && 'n' in v) {
      const n = round(v.n, 4);
      let u = v.u;
      if (!u) {
        if (prop in TRANSFORM_PROPS) u = TRANSFORM_PROPS[prop];
        else if (prop in FILTER_PROPS) u = FILTER_PROPS[prop];
        else if (UNITLESS.has(prop) || prop.startsWith('--') || prop.startsWith('attr:')) u = '';
        else u = 'px';
      }
      return `${n}${u}`;
    }
    if (isNum(v)) return fmt(prop, { n: v, u: '' });
    return v == null ? '' : String(v);
  }
  const numOf = (v, d) => {
    if (v == null) return d;
    if (typeof v === 'object' && 'n' in v) return v.n;
    const p = parseFloat(v);
    return Number.isFinite(p) ? p : d;
  };

  // ------------------------------------------------------------ targets and stagger
  function toArray(targets, scope) {
    if (targets == null) return [];
    if (typeof targets === 'string') return Array.from((scope || document).querySelectorAll(targets));
    if (root.Element && targets instanceof root.Element) return [targets];
    if (typeof targets.length === 'number') return Array.from(targets).flatMap((t) => toArray(t, scope));
    return [targets];
  }

  function autoGrid(els) {
    const rows = [];
    for (const el of els) {
      const top = Math.round(el.getBoundingClientRect().top);
      let row = rows.find((r) => Math.abs(r.top - top) < 3);
      if (!row) { row = { top, n: 0 }; rows.push(row); }
      row.n += 1;
    }
    return [rows.length, Math.max(...rows.map((r) => r.n))];
  }

  // Start offsets (s) for each target. stagger: number | { each, amount, from, grid, axis, ease }.
  function staggerOffsets(n, st, rng, els, tokens, warn) {
    if (!st || n <= 1) return new Array(n).fill(0);
    const o = typeof st === 'number' ? { each: st } : { ...st };
    const from = o.from == null ? 'start' : o.from;
    let d;
    if (o.grid) {
      const [rows, cols] = o.grid === 'auto' ? autoGrid(els) : o.grid;
      const pos = (i) => [Math.floor(i / cols), i % cols];
      let origin = [0, 0];
      if (from === 'center') origin = [(rows - 1) / 2, (cols - 1) / 2];
      else if (from === 'end') origin = [rows - 1, cols - 1];
      else if (isNum(from)) origin = pos(from);
      d = Array.from({ length: n }, (_, i) => {
        const [r, c] = pos(i);
        if (from === 'edges') return Math.min(r, rows - 1 - r, c, cols - 1 - c);
        const dr = r - origin[0];
        const dc = c - origin[1];
        return o.axis === 'x' ? Math.abs(dc) : o.axis === 'y' ? Math.abs(dr) : Math.hypot(dr, dc);
      });
    } else if (from === 'random') {
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      d = new Array(n);
      order.forEach((idx, rank) => { d[idx] = rank; });
    } else if (from === 'edges') {
      d = Array.from({ length: n }, (_, i) => Math.min(i, n - 1 - i));
    } else {
      const origin = from === 'center' ? (n - 1) / 2 : from === 'end' ? n - 1 : isNum(from) ? from : 0;
      d = Array.from({ length: n }, (_, i) => Math.abs(i - origin));
    }
    const max = Math.max(...d) || 1;
    const e = o.ease ? parseEase(o.ease, tokens, warn) : (p) => p;
    if (o.amount != null) return d.map((v) => e(v / max) * o.amount);
    const each = o.each == null ? 0.05 : o.each;
    return d.map((v) => e(v / max) * max * each);
  }

  // ----------------------------------------------------------------- text split
  const segmenter = (() => {
    try { return new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch (e) { return null; }
  })();
  const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));

  function maskWrap(node, block) {
    const m = document.createElement('span');
    m.className = 'mc-mask';
    m.setAttribute('aria-hidden', 'true');
    // the padding/negative margin pair keeps ascenders and descenders out of the clip
    m.style.cssText = `display:${block ? 'block' : 'inline-block'};overflow:hidden;vertical-align:top;padding:0.14em 0.06em;margin:-0.14em -0.06em;`;
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
    return m;
  }

  // Splits text into words / chars / lines (spans). Run it inside build(): fonts are loaded there, so lines are right.
  // opts: 'chars' | 'words' | 'lines' | 'lines,words' | 'words,chars' | { type, mask: 'lines' | 'words' | 'chars' }
  function split(targets, opts, scope, warn) {
    const type = (typeof opts === 'string' ? opts : opts && opts.type) || 'words';
    const mask = typeof opts === 'object' && opts ? opts.mask : null;
    const wantChars = /chars/.test(type);
    const wantLines = /lines/.test(type);
    const res = { chars: [], words: [], lines: [], masks: [], elements: [] };
    for (const el of toArray(targets, scope)) {
      if (el.dataset.mcSplit) { if (warn) warn('testo già diviso: split() chiamato due volte sullo stesso elemento'); continue; }
      const label = el.textContent.trim().replace(/\s+/g, ' ');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
      el.dataset.mcSplit = type;
      const words = [];
      const chars = [];
      const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            const frag = document.createDocumentFragment();
            for (const part of child.textContent.split(/(\s+)/)) {
              if (!part) continue;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
              const w = document.createElement('span');
              w.className = 'mc-word';
              w.setAttribute('aria-hidden', 'true');
              w.style.display = 'inline-block';
              if (wantChars) {
                for (const g of graphemes(part)) {
                  const c = document.createElement('span');
                  c.className = 'mc-char';
                  c.style.display = 'inline-block';
                  c.textContent = g;
                  w.appendChild(c);
                  chars.push(c);
                }
              } else {
                w.textContent = part;
              }
              frag.appendChild(w);
              words.push(w);
            }
            node.replaceChild(frag, child);
          } else if (child.nodeType === 1 && child.tagName !== 'BR') {
            walk(child);
          }
        }
      };
      walk(el);
      let lines = [];
      if (wantLines && words.length) {
        const rows = [];
        let lastTop = null;
        for (const w of words) {
          const top = w.offsetTop;
          if (lastTop === null || Math.abs(top - lastTop) > 2) { rows.push([]); lastTop = top; }
          rows[rows.length - 1].push(w);
        }
        const chains = words.map((w) => {
          const anc = [];
          for (let p = w.parentNode; p && p !== el; p = p.parentNode) anc.push(p);
          return anc;
        });
        const index = new Map(words.map((w, i) => [w, i]));
        el.textContent = '';
        for (const row of rows) {
          const line = document.createElement('span');
          line.className = 'mc-line';
          line.setAttribute('aria-hidden', 'true');
          line.style.display = 'block';
          row.forEach((w, k) => {
            let node = w;
            for (const anc of chains[index.get(w)]) { const c = anc.cloneNode(false); c.appendChild(node); node = c; }
            if (k > 0) line.appendChild(document.createTextNode(' '));
            line.appendChild(node);
          });
          el.appendChild(line);
          lines.push(line);
        }
      }
      if (mask === 'lines') lines.forEach((l) => res.masks.push(maskWrap(l, true)));
      if (mask === 'words') words.forEach((w) => res.masks.push(maskWrap(w, false)));
      if (mask === 'chars') chars.forEach((c) => res.masks.push(maskWrap(c, false)));
      res.words.push(...words);
      res.chars.push(...chars);
      res.lines.push(...lines);
      res.elements.push(el);
      lines = [];
    }
    return res;
  }

  // ------------------------------------------------------------------- morph
  function pathTokens(d) {
    return String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  }
  // Subpaths that actually draw: a bare moveto ("M x y m dx dy a ...") does not count as one.
  function countSubpaths(tokens) {
    let count = 0;
    let drawing = false;
    for (const t of tokens) {
      if (t === 'M' || t === 'm') { drawing = false; continue; }
      if (/^[a-zA-Z]$/.test(t) && !drawing) { drawing = true; count += 1; }
    }
    return count;
  }
  function samplePath(d, n, host) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    host.appendChild(p);
    const len = p.getTotalLength();
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const q = p.getPointAtLength((len * i) / n);
      pts.push([q.x, q.y]);
    }
    p.remove();
    return pts;
  }
  function alignPoints(A, B) {
    const n = A.length;
    let best = { err: Infinity, arr: B, s: 0 };
    for (const cand of [B, B.slice().reverse()]) {
      for (let s = 0; s < n; s += 1) {
        let err = 0;
        for (let i = 0; i < n; i += 1) {
          const q = cand[(i + s) % n];
          err += (A[i][0] - q[0]) ** 2 + (A[i][1] - q[1]) ** 2;
          if (err >= best.err) break;
        }
        if (err < best.err) best = { err, arr: cand, s };
      }
    }
    return best.arr.map((_, i) => best.arr[(i + best.s) % n]);
  }
  // Same command structure: numbers interpolate exactly (curves preserved). Otherwise both shapes are resampled
  // into n points, aligned to minimise travel, and interpolated as polygons (single closed subpaths work best).
  function makeMorph(el, a, b, nPts, warn) {
    const ta = pathTokens(a);
    const tb = pathTokens(b);
    const letters = (t) => t.filter((x) => /[a-zA-Z]/.test(x)).join('');
    if (ta.length === tb.length && letters(ta) === letters(tb)) {
      const A = ta.join(' ');
      const B = tb.join(' ');
      return makeInterp('d', A, B, {}, warn);
    }
    const host = el.ownerSVGElement || el.closest('svg');
    if (!host) { if (warn) warn('morph: il path non è dentro un <svg>'); return (e, raw) => (raw >= 1 ? b : a); }
    if ((countSubpaths(ta) > 1 || countSubpaths(tb) > 1) && warn) {
      warn('morph tra forme con più sottopercorsi: il ricampionamento le tratta come una linea sola, verifica i fotogrammi');
    }
    const n = Math.max(16, nPts | 0);
    const P = samplePath(a, n, host);
    const Q = alignPoints(P, samplePath(b, n, host));
    const closed = /z\s*$/i.test(String(b).trim());
    return (e, raw) => {
      if (raw <= 0 && e === 0) return a;
      if (raw >= 1 && e === 1) return b;
      let s = '';
      for (let i = 0; i < n; i += 1) {
        const x = round(lerp(P[i][0], Q[i][0], e), 2);
        const y = round(lerp(P[i][1], Q[i][1], e), 2);
        s += (i === 0 ? 'M' : 'L') + x + ' ' + y;
      }
      return closed ? s + 'Z' : s;
    };
  }

  // ---------------------------------------------------------------- timeline
  class Timeline {
    constructor(comp, offset, parent) {
      this.comp = comp;
      this.offset = offset || 0;
      this.parent = parent || null;
      this.rootTl = parent ? parent.rootTl : this;
      this.end = 0;
      this.prevStart = 0;
      this.prevEnd = 0;
    }

    _pos(position) {
      if (position == null || position === '') return this.end;
      if (isNum(position)) return position;
      const s = String(position).trim();
      let m = s.match(/^([<>])\s*(?:([+-])?=?\s*(-?\d*\.?\d+))?$/);
      if (m) {
        const base = m[1] === '<' ? this.prevStart : this.prevEnd;
        const v = m[3] ? parseFloat(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
        return base + v;
      }
      m = s.match(/^([+-])=\s*(\d*\.?\d+)$/);
      if (m) return this.end + parseFloat(m[2]) * (m[1] === '-' ? -1 : 1);
      m = s.match(/^([^+\-<>=]+?)\s*(?:([+-])=?\s*(\d*\.?\d+))?$/);
      if (m) {
        const labels = this.comp._labels;
        if (labels.has(m[1])) {
          const v = m[3] ? parseFloat(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
          return labels.get(m[1]) - this.offset + v;
        }
      }
      this.comp.warn(`posizione "${s}" non riconosciuta: uso la fine della timeline`);
      return this.end;
    }

    _advance(start, end) {
      this.prevStart = start;
      this.prevEnd = end;
      if (end > this.end) this.end = end;
    }

    label(name, position) {
      const t = this._pos(position);
      this.comp._labels.set(name, this.offset + t);
      if (t > this.end) this.end = t;
      return this;
    }

    addLabel(name, position) { return this.label(name, position); }

    scene(name, position, fn) {
      const start = this._pos(position);
      const sub = new Timeline(this.comp, this.offset + start, this);
      this.comp._labels.set(name, this.offset + start);
      fn(sub);
      const dur = sub.end;
      this.comp._scenes.push({ name, start: this.offset + start, end: this.offset + start + dur });
      this._advance(start, start + dur);
      return this;
    }

    to(targets, vars, position) { return this._tween('to', targets, null, vars, position); }
    from(targets, vars, position) { return this._tween('from', targets, vars, null, position); }
    fromTo(targets, fromVars, toVars, position) { return this._tween('fromTo', targets, fromVars, toVars, position); }
    set(targets, vars, position) { return this._tween('to', targets, null, { ...vars, duration: 0 }, position); }

    // fn(p, info) is called on every rendered frame with the eased progress (0 before the start, 1 after the end):
    // it must set state from p alone, never accumulate.
    custom(fn, opts, position) {
      const o = opts || {};
      const comp = this.comp;
      const start = this._pos(position) + (o.delay || 0);
      const dur = isNum(o.duration) ? o.duration : comp.defaults.duration;
      comp._customs.push({ fn, start: this.offset + start, dur, ease: parseEase(o.ease || 'linear', comp.tokens, comp._warn), order: comp._order += 1 });
      this._advance(start, start + dur);
      return this;
    }

    // Animated number: { from, to, duration, ease, decimals, locale, prefix, suffix, format }.
    count(targets, opts, position) {
      const o = { from: 0, to: 100, decimals: 0, locale: undefined, prefix: '', suffix: '', ...opts };
      const els = this.comp._targets(targets);
      const nf = new Intl.NumberFormat(o.locale, { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
      const format = typeof o.format === 'function' ? o.format : (v) => o.prefix + nf.format(v) + o.suffix;
      return this.custom((p) => {
        const v = lerp(o.from, o.to, p);
        const factor = 10 ** o.decimals;
        const text = format(Math.round(v * factor) / factor);
        for (const el of els) if (el.textContent !== text) el.textContent = text;
      }, { duration: o.duration, ease: o.ease || 'out.expo', delay: o.delay }, position);
    }

    call() {
      this.comp.warn('call() non è supportato: non è riproducibile in un fotogramma. Usa custom(fn) che imposta lo stato da p');
      return this;
    }

    _tween(kind, targets, fromVars, toVars, position) {
      const comp = this.comp;
      const optsSrc = (kind === 'from' ? fromVars : toVars) || {};
      const opts = {};
      for (const k of OPTION_KEYS) if (optsSrc[k] !== undefined) opts[k] = optsSrc[k];
      const els = comp._targets(targets);
      const start = this._pos(position) + (opts.delay || 0);
      const dur = isNum(opts.duration) ? Math.max(0, opts.duration) : comp.defaults.duration;
      const easeSpec = opts.ease !== undefined ? opts.ease : comp.defaults.ease;
      const eases = (Array.isArray(easeSpec) ? easeSpec : [easeSpec]).map((e) => parseEase(e, comp.tokens, comp._warn));
      const order = comp._order += 1;
      const rng = mulberry32((comp.cfg.seed || 1) * 7919 + order);
      const offsets = staggerOffsets(els.length, opts.stagger, rng, els, comp.tokens, comp._warn);
      const repeat = opts.repeat == null ? 0 : opts.repeat < 0 ? -1 : Math.floor(opts.repeat);
      const repeatDelay = opts.repeatDelay || 0;
      const cycles = repeat < 0 ? 1 : repeat + 1;
      const groupDur = dur * cycles + repeatDelay * Math.max(0, cycles - 1);
      const props = new Set();
      for (const src of [fromVars, toVars]) if (src) for (const k of Object.keys(src)) if (!OPTION_KEYS.has(k)) props.add(k);
      els.forEach((el, i) => {
        for (const prop of props) {
          const pick = (src) => {
            if (!src || !(prop in src)) return undefined;
            const v = src[prop];
            return typeof v === 'function' ? v(i, el, els) : v;
          };
          let values;
          if (kind === 'fromTo') {
            const f = pick(fromVars);
            const t = pick(toVars);
            values = [f === undefined ? IMPLICIT : f, t === undefined ? IMPLICIT : t];
          } else {
            const v = pick(kind === 'from' ? fromVars : toVars);
            if (Array.isArray(v)) values = v.length === 1 ? (kind === 'from' ? [v[0], IMPLICIT] : [IMPLICIT, v[0]]) : v.slice();
            else values = kind === 'from' ? [v, IMPLICIT] : [IMPLICIT, v];
          }
          comp._addSegment({
            el, prop, values, times: opts.times || null, start: this.offset + start + offsets[i], dur,
            ease: eases, repeat, yoyo: !!opts.yoyo, repeatDelay, order, perceptual: opts.perceptual,
            morphPoints: opts.morphPoints || 128,
          });
        }
      });
      const maxOffset = offsets.length ? Math.max(...offsets) : 0;
      this._advance(start, start + maxOffset + groupDur);
      return this;
    }
  }

  // --------------------------------------------------------------- composition
  const SAFE_PRESETS = {
    broadcast: { action: [0.035, 0.035, 0.035, 0.035], title: [0.05, 0.05, 0.05, 0.05] }, // EBU R 95: top, right, bottom, left
    social: { action: [0.06, 0.06, 0.06, 0.06], title: [0.1, 0.12, 0.2, 0.06] },          // approximation of platform overlays
    none: { action: [0, 0, 0, 0], title: [0, 0, 0, 0] },
  };
  const DEFAULT_TOKENS = {
    enter: 'cubic-bezier(0.23, 1, 0.32, 1)',
    exit: 'cubic-bezier(0.55, 0, 1, 0.45)',
    move: 'cubic-bezier(0.77, 0, 0.175, 1)',
    emphasis: 'back.out(1.5)',
    settle: 'spring(0.3)',
    linear: 'linear',
  };

  class Composition {
    constructor(cfg) {
      this.cfg = {
        width: 1920, height: 1080, fps: 60, duration: null, background: null, poster: null, loop: false, safe: 'broadcast',
        controls: true, autoplay: true, seed: 1, posterize: 1, title: null, ...cfg,
      };
      this.defaults = { duration: 0.6, ease: 'enter', ...(this.cfg.defaults || {}) };
      this.tokens = { ...DEFAULT_TOKENS, ...(this.cfg.eases || {}) };
      this.width = this.cfg.width;
      this.height = this.cfg.height;
      this.fps = this.cfg.fps;
      this.duration = isNum(this.cfg.duration) ? this.cfg.duration : 0;
      this.warnings = [];
      this._warnSet = new Set();
      this._warn = (m) => this.warn(m);
      this._labels = new Map();
      this._scenes = [];
      this._segments = [];
      this._customs = [];
      this._frameFns = [];
      this._order = 0;
      this._tracks = [];
      this._recs = new Map();
      this._ready = false;
      this._error = null;
      this.time = 0;
      this.playing = false;
      this.speed = 1;
      this.looping = true;
      this.mode = this._detectMode();
      this.random = mulberry32(this.cfg.seed);
      Math.random = mulberry32(this.cfg.seed * 31 + 17); // unseeded randomness becomes reproducible
      this.stage = typeof this.cfg.stage === 'string' ? document.querySelector(this.cfg.stage)
        : this.cfg.stage || document.querySelector('[data-motion-stage], .mc-stage, #stage');
      if (!this.stage) throw new Error('motion: nessuno stage trovato (usa id="stage" o data-motion-stage)');
      this.tl = new Timeline(this, 0, null);
      this._setupStage();
      this._exposeContract();
    }

    _detectMode() {
      const q = new URLSearchParams(root.location ? root.location.search : '');
      if (root.__MOTION_EXPORT__ || q.has('export')) return 'export';
      if (this.cfg.controls === false || q.has('embed')) return 'embed';
      return 'preview';
    }

    warn(msg) {
      if (this._warnSet.has(msg)) return;
      this._warnSet.add(msg);
      this.warnings.push(msg);
      if (root.console) console.warn('[motion] ' + msg);
    }

    _targets(targets) {
      const all = toArray(targets, this.stage);
      const els = all.filter((e) => e && e.nodeType === 1);
      if (els.length < all.length) this.warn('alcuni target non sono elementi: hai passato il risultato di split() invece di .lines, .words o .chars?');
      if (!els.length) this.warn(`nessun elemento per ${typeof targets === 'string' ? `"${targets}"` : 'i target indicati'}: il tween non fa nulla`);
      return els;
    }

    // ---- lifecycle
    build(fn) {
      this._builder = fn;
      this._start();
      return this;
    }

    audio(fn) {
      this._audioBuilder = fn;
      if (!root.MotionAudio) this.warn('modulo audio non incluso: crea la composizione con `motion_tools.py init --audio` o `sync --audio`');
      return this;
    }

    onFrame(fn) { this._frameFns.push(fn); return this; }

    at(label, offset = 0) {
      if (!this._labels.has(label)) { this.warn(`etichetta "${label}" inesistente`); return offset; }
      return this._labels.get(label) + offset;
    }

    _start() {
      if (this._starting) return;
      this._starting = true;
      const go = () => this._prepare().catch((err) => this._fail(err));
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
      else Promise.resolve().then(go);
    }

    async _prepare() {
      this.stage.getBoundingClientRect(); // force layout so that font loads are requested
      const tasks = [];
      if (document.fonts) {
        document.fonts.forEach((f) => { if (f.status === 'unloaded') tasks.push(f.load().catch(() => {})); });
        tasks.push(document.fonts.ready);
      }
      for (const img of this.stage.querySelectorAll('img')) {
        if (!(img.complete && img.naturalWidth)) tasks.push(img.decode().catch(() => {}));
      }
      await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, 8000))]);
      const helpers = {
        tl: this.tl, comp: this,
        split: (t, o) => split(t, o, this.stage, this._warn),
        at: (l, o) => this.at(l, o),
        random: (seed) => mulberry32(seed == null ? this.cfg.seed : seed),
        noise, wiggle, lerp, clamp, mapRange, beats,
      };
      if (this._builder) await this._builder(helpers);
      this._compile();
      if (this._audioBuilder && root.MotionAudio) this._audio = root.MotionAudio.compile(this, this._audioBuilder);
      this._ready = true;
      const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t0 = this.mode !== 'export' && reduced ? this.posterTime : 0;
      this.render(t0);
      if (this.mode !== 'export') this._afterReady(reduced);
    }

    _fail(err) {
      this._error = String((err && err.message) || err);
      if (root.console) console.error('[motion] errore nella costruzione: ' + this._error);
    }

    get posterTime() {
      return isNum(this.cfg.poster) ? clamp(this.cfg.poster, 0, this.duration) : this.duration;
    }

    // ---- compile: segments -> tracks with resolved values and interpolators
    _addSegment(seg) { this._segments.push(seg); }

    _base(el, prop) {
      if (prop in TRANSFORM_PROPS) return TRANSFORM_BASE[prop] == null ? 0 : TRANSFORM_BASE[prop];
      if (prop in FILTER_PROPS) return FILTER_BASE[prop] == null ? 0 : FILTER_BASE[prop];
      if (prop === 'draw') return 1;
      if (prop === 'text') return el.textContent;
      if (prop === 'd') return el.getAttribute('d') || '';
      if (prop.startsWith('attr:')) { const v = el.getAttribute(prop.slice(5)); return v == null ? 0 : v; }
      const cs = getComputedStyle(el);
      if (prop === 'autoAlpha' || prop === 'opacity') return parseFloat(cs.opacity);
      if (prop.startsWith('--')) { const v = cs.getPropertyValue(prop).trim(); return v === '' ? 0 : v; }
      return cs.getPropertyValue(kebab(prop)).trim();
    }

    _resolveRef(el, prop, v) {
      if (prop === 'd' && typeof v === 'string' && /^[#.[]/.test(v.trim())) {
        const ref = this.stage.querySelector(v.trim()) || document.querySelector(v.trim());
        if (!ref) { this.warn(`morph: "${v}" non trovato`); return v; }
        return ref.getAttribute('d') || '';
      }
      return v;
    }

    _interp(el, prop, a, b, seg) {
      if (prop === 'd') return makeMorph(el, String(a), String(b), seg.morphPoints, this._warn);
      if (prop === 'text') {
        const A = String(a);
        const B = String(b);
        if (B.startsWith(A)) return (e) => B.slice(0, A.length + Math.round(clamp(e, 0, 1) * (B.length - A.length)));
        if (A.startsWith(B)) return (e) => A.slice(0, A.length - Math.round(clamp(e, 0, 1) * (A.length - B.length)));
        return (e, raw) => (raw >= 1 ? B : A);
      }
      return makeInterp(prop, a, b, { perceptual: seg.perceptual }, this._warn);
    }

    _compile() {
      const groups = new Map();
      for (const seg of this._segments) {
        let byProp = groups.get(seg.el);
        if (!byProp) { byProp = new Map(); groups.set(seg.el, byProp); }
        let list = byProp.get(seg.prop);
        if (!list) { list = []; byProp.set(seg.prop, list); }
        list.push(seg);
      }
      const end = { t: 0 };
      for (const [el, byProp] of groups) {
        this._prepareElement(el, byProp);
        for (const [prop, segs] of byProp) {
          segs.sort((a, b) => a.start - b.start || a.order - b.order);
          const track = { el, prop, segs };
          segs.forEach((seg, i) => {
            const implicit = () => (i === 0 ? this._base(el, prop) : toSpec(this._valueAt(track, seg.start, i)));
            seg.vals = seg.values.map((v) => this._resolveRef(el, prop, v === IMPLICIT ? implicit() : (v === undefined ? implicit() : v)));
            if (seg.vals.length < 2) seg.vals = [seg.vals[0], seg.vals[0]];
            seg.interps = [];
            for (let k = 0; k < seg.vals.length - 1; k += 1) seg.interps.push(this._interp(el, prop, seg.vals[k], seg.vals[k + 1], seg));
            const n = seg.interps.length;
            seg.times = Array.isArray(seg.times) && seg.times.length === n + 1 ? seg.times.slice() : Array.from({ length: n + 1 }, (_, k) => k / n);
            const cycles = seg.repeat < 0 ? Infinity : seg.repeat + 1;
            seg.total = seg.repeat < 0 ? Infinity : seg.dur * cycles + seg.repeatDelay * (cycles - 1);
            const segEnd = seg.repeat < 0 ? seg.start + seg.dur : seg.start + seg.total;
            if (segEnd > end.t) end.t = segEnd;
          });
          this._tracks.push(track);
        }
      }
      for (const c of this._customs) end.t = Math.max(end.t, c.start + c.dur);
      for (const s of this._scenes) end.t = Math.max(end.t, s.end);
      if (!isNum(this.cfg.duration)) {
        this.duration = round(end.t, 4);
        this.warn(`durata non indicata: uso la fine dell'ultimo tween (${this.duration} s). Meglio dichiararla in Motion.create`);
      } else if (end.t > this.duration + 1e-6) {
        this.warn(`la timeline finisce a ${round(end.t, 3)} s, oltre la durata dichiarata (${this.duration} s): la coda verrà tagliata`);
      }
      this._cssAnimations = this.stage.getAnimations ? this.stage.getAnimations({ subtree: true }) : [];
      for (const a of this._cssAnimations) {
        a.pause();
        if (typeof a.persist === 'function' && !(root.CSSAnimation && a instanceof root.CSSAnimation)) a.persist();
      }
      this._svgRoots = Array.from(this.stage.querySelectorAll('svg')).filter((s) => !s.parentElement.closest('svg') && s.querySelector('animate, animateTransform, animateMotion, set'));
      this._svgRoots.forEach((s) => s.pauseAnimations());
      if (this._cssAnimations.some((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity) && !this.cfg.loop) {
        this.warn('ci sono animazioni CSS infinite: per un loop senza giunture la loro durata deve dividere la durata della composizione');
      }
    }

    _prepareElement(el, byProp) {
      const cs = getComputedStyle(el);
      const rec = { el, tf: {}, fl: {}, css: new Map(), attrs: new Map(), last: new Map(), baseTransform: null, baseFilter: null,
        hasTransform: false, hasFilter: false, alphaHidden: false, drawHidden: false, usesVisibility: false };
      for (const prop of byProp.keys()) {
        if (prop in TRANSFORM_PROPS) rec.hasTransform = true;
        if (prop in FILTER_PROPS) rec.hasFilter = true;
        if (prop === 'autoAlpha' || prop === 'draw') rec.usesVisibility = true;
      }
      if (rec.hasTransform && cs.transform && cs.transform !== 'none') rec.baseTransform = cs.transform;
      if (rec.hasFilter && cs.filter && cs.filter !== 'none') rec.baseFilter = cs.filter;
      if (rec.hasTransform && el.getAnimations && el.getAnimations().some((a) => a.effect && a.effect.getKeyframes && a.effect.getKeyframes().some((k) => 'transform' in k))) {
        this.warn('un elemento ha sia un\'animazione CSS sul transform sia tween di trasformazione: vince il CSS. Usa un elemento contenitore');
      }
      const td = cs.transitionDuration.split(',').map((x) => parseFloat(x) || 0);
      if (td.some((x) => x > 0)) {
        el.style.transition = 'none';
        this.warn('transizioni CSS disattivate sugli elementi animati: ritarderebbero ogni fotogramma e renderebbero l\'export non deterministico');
      }
      if (byProp.has('draw') && !el.hasAttribute('pathLength')) el.setAttribute('pathLength', '1');
      this._recs.set(el, rec);
    }

    _valueAt(track, t, limit) {
      const segs = track.segs;
      const n = limit == null ? segs.length : limit;
      let idx = -1;
      for (let j = 0; j < n; j += 1) { if (segs[j].start <= t) idx = j; else break; }
      if (idx < 0) return segs[0].interps[0](0, 0);
      return sampleSeg(segs[idx], t - segs[idx].start);
    }

    // ---- rendering (a pure function of t)
    render(t) {
      if (!this._ready) return;
      let time = clamp(isNum(t) ? t : 0, 0, this.duration);
      const post = Math.max(1, this.cfg.posterize | 0);
      if (post > 1) time = Math.floor((time * this.fps) / post + 1e-9) * (post / this.fps);
      this.time = isNum(t) ? clamp(t, 0, this.duration) : 0;
      for (const track of this._tracks) {
        const v = this._valueAt(track, time);
        const rec = this._recs.get(track.el);
        const p = track.prop;
        if (p in TRANSFORM_PROPS) rec.tf[p === 'rotation' || p === 'rotateZ' ? 'rotate' : p] = v;
        else if (p in FILTER_PROPS) rec.fl[p] = v;
        else if (p === 'autoAlpha') { const o = numOf(v, 1); rec.css.set('opacity', String(round(o, 4))); rec.alphaHidden = o <= 0.001; }
        else if (p === 'draw') rec.draw = clamp(numOf(v, 1), 0, 1);
        else if (p === 'text') rec.text = String(v);
        else if (p === 'd') rec.attrs.set('d', String(v));
        else if (p.startsWith('attr:')) rec.attrs.set(p.slice(5), fmt(p, v));
        else rec.css.set(p.startsWith('--') ? p : kebab(p), fmt(p, v));
      }
      for (const rec of this._recs.values()) this._flush(rec);
      for (const c of this._customs) {
        const raw = c.dur > 0 ? clamp((time - c.start) / c.dur, 0, 1) : (time >= c.start ? 1 : 0);
        try { c.fn(c.ease(raw), { t: time, raw, comp: this }); } catch (err) { this.warn('custom(): ' + ((err && err.message) || err)); }
      }
      for (const a of this._cssAnimations) a.currentTime = time * 1000;
      for (const s of this._svgRoots) s.setCurrentTime(time);
      for (const fn of this._frameFns) { try { fn(time, this); } catch (err) { this.warn('onFrame(): ' + ((err && err.message) || err)); } }
      if (this._ui) this._ui.update(this.time);
    }

    _flush(rec) {
      const set = (key, val, apply) => {
        if (rec.last.get(key) === val) return;
        rec.last.set(key, val);
        apply(val);
      };
      const el = rec.el;
      if (rec.hasTransform) set('transform', transformString(rec.tf, rec.baseTransform), (v) => { el.style.transform = v; });
      if (rec.hasFilter) set('filter', filterString(rec.fl, rec.baseFilter), (v) => { el.style.filter = v; });
      for (const [k, v] of rec.css) set('css:' + k, v, (val) => { el.style.setProperty(k, val); });
      for (const [k, v] of rec.attrs) set('attr:' + k, v, (val) => { el.setAttribute(k, val); });
      if (rec.text !== undefined) set('text', rec.text, (v) => { el.textContent = v; });
      if (rec.draw !== undefined) {
        rec.drawHidden = rec.draw <= 0.0001;
        set('draw', rec.draw, (v) => { el.style.strokeDasharray = '1 1'; el.style.strokeDashoffset = String(round(1 - v, 5)); });
      }
      if (rec.usesVisibility) set('visibility', rec.alphaHidden || rec.drawHidden ? 'hidden' : '', (v) => { el.style.visibility = v; });
    }

    // ---- stage, playback and player
    _setupStage() {
      const st = this.stage;
      const { width: W, height: H } = this.cfg;
      st.style.width = W + 'px';
      st.style.height = H + 'px';
      st.style.overflow = 'hidden';
      if (getComputedStyle(st).position === 'static') st.style.position = 'relative';
      const bg = this.cfg.background;
      this.transparent = bg === 'transparent';
      if (bg && !this.transparent) st.style.background = bg;
      if (this.transparent) st.style.background = 'transparent';
      if (this.mode === 'export') {
        const de = document.documentElement;
        de.style.background = 'transparent';
        document.body.style.margin = '0';
        document.body.style.background = 'transparent';
        document.body.style.overflow = 'hidden';
        st.style.position = 'fixed';
        st.style.left = '0';
        st.style.top = '0';
        st.style.margin = '0';
        for (const child of Array.from(document.body.children)) {
          if (child !== st && !child.contains(st) && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') child.style.display = 'none';
        }
      } else {
        buildShell(this);
      }
    }

    _afterReady(reduced) {
      if (this._ui) this._ui.ready(reduced);
      const autoplay = this.cfg.autoplay !== false && !reduced;
      this.looping = this.mode === 'embed' ? this.cfg.loop !== false : true;
      if (autoplay) this.play();
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing) this.pause(); });
    }

    seek(t) { this.render(t); }

    play() {
      if (!this._ready || this.playing) return;
      if (this.time >= this.duration - 1e-6) this.time = 0;
      this.playing = true;
      this._last = performance.now();
      const loop = (now) => {
        if (!this.playing) return;
        const dt = Math.min(0.25, (now - this._last) / 1000);
        this._last = now;
        let t = this.time + dt * this.speed;
        if (t >= this.duration) {
          if (this.looping) { t %= this.duration; if (this._sound) this._sound.restart(t); } else { t = this.duration; this.render(t); this.pause(); return; }
        }
        this.render(t);
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
      if (this._sound) this._sound.start(this.time);
      if (this._ui) this._ui.state();
    }

    pause() {
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._sound) this._sound.stop();
      if (this._ui) this._ui.state();
    }

    toggle() { if (this.playing) this.pause(); else this.play(); }

    // ---- the contract read by motion_tools.py (frames, check, audio, export)
    _exposeContract() {
      const comp = this;
      root.__motion = {
        version: VERSION,
        get ready() { return comp._ready; },
        get error() { return comp._error; },
        get mode() { return comp.mode; },
        get width() { return comp.width; },
        get height() { return comp.height; },
        get fps() { return comp.fps; },
        get duration() { return comp.duration; },
        get loop() { return !!comp.cfg.loop; },
        get poster() { return comp.posterTime; },
        get safe() { return SAFE_PRESETS[comp.cfg.safe] ? comp.cfg.safe : 'broadcast'; },
        get safeAreas() { return SAFE_PRESETS[comp.cfg.safe] || SAFE_PRESETS.broadcast; },
        get transparent() { return comp.transparent; },
        get labels() { return Array.from(comp._labels, ([name, time]) => ({ name, time: round(time, 4) })).sort((a, b) => a.time - b.time); },
        get scenes() { return comp._scenes.map((s) => ({ ...s })); },
        get warnings() { return comp.warnings.slice(); },
        get stageElement() { return comp.stage; },
        get hasAudio() { return !!comp._audio; },
        get cues() { return comp._audio ? comp._audio.cues() : []; },
        seek(t) { comp.render(t); return comp.time; },
        renderAudio(opts) { return comp._audio ? comp._audio.renderOffline(opts || {}) : Promise.reject(new Error('nessun audio nella composizione')); },
        audioChunk(i) { return comp._audio ? comp._audio.chunk(i) : null; },
      };
    }
  }

  function sampleSeg(seg, local) {
    const n = seg.interps.length;
    if (seg.dur <= 0) return seg.interps[n - 1](1, 1);
    const cycle = seg.dur + seg.repeatDelay;
    let raw;
    let c;
    if (local >= seg.total) { c = seg.repeat < 0 ? 0 : seg.repeat; raw = 1; } else {
      c = Math.floor(local / cycle);
      raw = Math.min(1, (local - c * cycle) / seg.dur);
    }
    if (seg.yoyo && c % 2 === 1) raw = 1 - raw;
    const easeAt = (k) => seg.ease[Math.min(k, seg.ease.length - 1)] || EASE_IN.linear;
    if (n === 1) return seg.interps[0](easeAt(0)(raw), raw);
    const times = seg.times;
    let k = n - 1;
    for (let j = 0; j < n; j += 1) if (raw < times[j + 1]) { k = j; break; }
    const span = times[k + 1] - times[k];
    const lr = span > 0 ? clamp((raw - times[k]) / span, 0, 1) : 1;
    return seg.interps[k](easeAt(k)(lr), lr);
  }

  function transformString(tf, base) {
    let s = '';
    if (tf.transformPerspective !== undefined) s += `perspective(${fmt('transformPerspective', tf.transformPerspective)}) `;
    if (tf.xPercent !== undefined || tf.yPercent !== undefined) s += `translate(${fmt('xPercent', tf.xPercent == null ? 0 : tf.xPercent)}, ${fmt('yPercent', tf.yPercent == null ? 0 : tf.yPercent)}) `;
    if (tf.x !== undefined || tf.y !== undefined || tf.z !== undefined) s += `translate3d(${fmt('x', tf.x == null ? 0 : tf.x)}, ${fmt('y', tf.y == null ? 0 : tf.y)}, ${fmt('z', tf.z == null ? 0 : tf.z)}) `;
    if (tf.rotate !== undefined) s += `rotate(${fmt('rotate', tf.rotate)}) `;
    if (tf.rotateY !== undefined) s += `rotateY(${fmt('rotateY', tf.rotateY)}) `;
    if (tf.rotateX !== undefined) s += `rotateX(${fmt('rotateX', tf.rotateX)}) `;
    if (tf.skewX !== undefined || tf.skewY !== undefined) s += `skew(${fmt('skewX', tf.skewX == null ? 0 : tf.skewX)}, ${fmt('skewY', tf.skewY == null ? 0 : tf.skewY)}) `;
    if (tf.scale !== undefined || tf.scaleX !== undefined || tf.scaleY !== undefined) {
      const sc = numOf(tf.scale, 1);
      s += `scale(${round(numOf(tf.scaleX, 1) * sc, 5)}, ${round(numOf(tf.scaleY, 1) * sc, 5)})`;
    }
    s = s.trim();
    if (base) return s ? `${base} ${s}` : base;
    return s || 'none';
  }

  function filterString(fl, base) {
    const parts = [];
    for (const k of Object.keys(FILTER_PROPS)) if (fl[k] !== undefined) parts.push(`${FILTER_CSS[k] || k}(${fmt(k, fl[k])})`);
    const s = parts.join(' ');
    if (base) return s ? `${base} ${s}` : base;
    return s || 'none';
  }

  function beats(bpm, offset = 0) {
    const spb = 60 / bpm;
    return (n) => offset + n * spb;
  }

  // ------------------------------------------------------------------- player
  const fmtTime = (t) => {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  };

  function buildShell(comp) {
    const { width: W, height: H } = comp.cfg;
    const embed = comp.mode === 'embed';
    const css = document.createElement('style');
    css.id = 'mc-ui';
    css.textContent = `
      html,body{margin:0;height:100%;background:#0d0d10;}
      .mc-shell{position:fixed;inset:0;display:flex;flex-direction:column;font:13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e6e6ea;}
      .mc-viewport{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:hidden;}
      .mc-box{position:relative;}
      .mc-frame{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;}
      .mc-frame.mc-alpha{background:repeating-conic-gradient(#2a2a30 0 25%,#1d1d22 0 50%) 0 0/32px 32px;}
      .mc-guides{position:absolute;inset:0;pointer-events:none;display:none;}
      .mc-guides.on{display:block;}
      .mc-big{position:absolute;inset:0;margin:auto;width:max-content;height:max-content;padding:14px 20px;border:0;border-radius:999px;
        background:rgba(15,15,18,.82);color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;display:none;}
      .mc-big.on{display:block;}
      .mc-big:focus-visible,.mc-controls button:focus-visible,.mc-controls input:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px;}
      .mc-controls{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#141418;border-top:1px solid #23232a;}
      .mc-controls button{height:30px;min-width:30px;padding:0 9px;border:1px solid #2c2c34;border-radius:7px;background:#1c1c22;color:#e6e6ea;
        font:inherit;cursor:pointer;}
      .mc-controls button:hover{background:#25252d;}
      .mc-controls button[aria-pressed="true"]{background:#2b3550;border-color:#3d4f7a;}
      .mc-time,.mc-info{font-variant-numeric:tabular-nums;color:#a3a3ad;white-space:nowrap;}
      .mc-track{position:relative;flex:1;min-width:120px;}
      .mc-track input{width:100%;accent-color:#8ab4ff;margin:0;}
      .mc-marks{position:absolute;left:0;right:0;top:-9px;height:8px;pointer-events:none;}
      .mc-marks i{position:absolute;top:0;width:1px;height:8px;background:#6d6d78;}
      .mc-marks i::after{content:attr(data-n);position:absolute;left:3px;top:-3px;font:10px system-ui,sans-serif;color:#7d7d88;font-style:normal;white-space:nowrap;}
    `;
    document.head.appendChild(css);
    const shell = document.createElement('div');
    shell.className = 'mc-shell';
    shell.innerHTML = `
      <div class="mc-viewport"><div class="mc-box"><div class="mc-frame"></div>
        <button class="mc-big" type="button">▶ Riproduci</button></div></div>
      ${embed ? '' : `<div class="controls mc-controls" role="toolbar" aria-label="Controlli dell'animazione">
        <button type="button" data-action="play" aria-label="Riproduci o metti in pausa (spazio)">▶</button>
        <span class="mc-time" aria-live="off">0:00.00</span>
        <div class="mc-track"><div class="mc-marks"></div>
          <input class="scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Posizione nell'animazione (frecce: un fotogramma)"></div>
        <span class="mc-info"></span>
        <button type="button" data-action="loop" aria-pressed="true" aria-label="Ripeti (L)">⟲</button>
        <button type="button" data-action="speed" aria-label="Velocità">1×</button>
        <button type="button" data-action="guides" aria-pressed="false" aria-label="Aree sicure e terzi (G)">▦</button>
        <button type="button" data-action="sound" aria-pressed="false" aria-label="Suono (M)" hidden>🔇</button>
      </div>`}`;
    document.body.appendChild(shell);
    const q = (s) => shell.querySelector(s);
    const frame = q('.mc-frame');
    const box = q('.mc-box');
    const viewport = q('.mc-viewport');
    frame.appendChild(comp.stage);
    if (comp.cfg.background === 'transparent') frame.classList.add('mc-alpha');
    const guides = document.createElementNS(SVG_NS, 'svg');
    guides.setAttribute('class', 'mc-guides');
    guides.setAttribute('viewBox', `0 0 ${W} ${H}`);
    guides.setAttribute('aria-hidden', 'true');
    const safe = SAFE_PRESETS[comp.cfg.safe] || SAFE_PRESETS.broadcast;
    const rect = (m, dash, op) => `<rect x="${m[3] * W}" y="${m[0] * H}" width="${W * (1 - m[1] - m[3])}" height="${H * (1 - m[0] - m[2])}"
      fill="none" stroke="#8ab4ff" stroke-opacity="${op}" stroke-width="2" ${dash ? 'stroke-dasharray="12 10"' : ''}/>`;
    guides.innerHTML = `${rect(safe.action, true, 0.55)}${rect(safe.title, false, 0.8)}
      <path d="M${W / 3} 0V${H}M${(2 * W) / 3} 0V${H}M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
      <path d="M${W / 2 - 18} ${H / 2}h36M${W / 2} ${H / 2 - 18}v36" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`;
    frame.appendChild(guides);
    const fit = () => {
      const r = viewport.getBoundingClientRect();
      const s = Math.max(0.05, Math.min((r.width - 24) / W, (r.height - 24) / H));
      frame.style.transform = `scale(${s})`;
      box.style.width = `${W * s}px`;
      box.style.height = `${H * s}px`;
    };
    fit();
    new ResizeObserver(fit).observe(viewport);
    const big = q('.mc-big');
    big.addEventListener('click', () => { big.classList.remove('on'); comp.play(); });
    if (embed) box.addEventListener('click', (e) => { if (e.target !== big) comp.toggle(); });
    const ui = { update() {}, state() {}, ready() {} };
    comp._ui = ui;
    if (embed) {
      ui.ready = (reduced) => { if (reduced) big.classList.add('on'); };
      ui.state = () => { if (comp.playing) big.classList.remove('on'); };
      return;
    }
    const playBtn = q('[data-action=play]');
    const loopBtn = q('[data-action=loop]');
    const speedBtn = q('[data-action=speed]');
    const guidesBtn = q('[data-action=guides]');
    const soundBtn = q('[data-action=sound]');
    const scrub = q('.scrub');
    const time = q('.mc-time');
    const info = q('.mc-info');
    const marks = q('.mc-marks');
    let lastTxt = '';
    ui.update = (t) => {
      const ms = Math.round(t * 1000);
      if (document.activeElement !== scrub || comp.playing) scrub.value = String(ms);
      const txt = `${fmtTime(t)} · f ${Math.round(t * comp.fps)}`;
      if (txt !== lastTxt) { time.textContent = txt; lastTxt = txt; }
    };
    ui.state = () => {
      playBtn.textContent = comp.playing ? '❚❚' : '▶';
      loopBtn.setAttribute('aria-pressed', String(comp.looping));
      if (comp.playing) big.classList.remove('on');
    };
    ui.ready = (reduced) => {
      scrub.max = String(Math.round(comp.duration * 1000));
      scrub.step = String(1000 / comp.fps);
      info.textContent = `${fmtTime(comp.duration)} · ${comp.fps} fps · ${W}×${H}`;
      marks.innerHTML = Array.from(comp._labels, ([n, t]) => `<i style="left:${(100 * t) / comp.duration}%" data-n="${n.replace(/[<>&"]/g, '')}"></i>`).join('');
      if (comp._audio) {
        soundBtn.hidden = false;
        comp._sound = comp._audio.player();
      }
      if (reduced) big.classList.add('on');
      ui.update(comp.time); // the first frame was drawn before the slider knew the duration: sync it now
      ui.state();
    };
    const step = (dt) => { comp.pause(); comp.render(clamp(comp.time + dt, 0, comp.duration)); };
    scrub.addEventListener('input', () => { comp.pause(); comp.render(parseFloat(scrub.value) / 1000); });
    playBtn.addEventListener('click', () => comp.toggle());
    loopBtn.addEventListener('click', () => { comp.looping = !comp.looping; ui.state(); });
    const speeds = [1, 0.5, 0.25];
    speedBtn.addEventListener('click', () => {
      comp.speed = speeds[(speeds.indexOf(comp.speed) + 1) % speeds.length];
      speedBtn.textContent = `${comp.speed}×`;
      if (comp._sound) comp._sound.setSpeed(comp.speed, comp.time, comp.playing);
    });
    guidesBtn.addEventListener('click', () => {
      const on = !guides.classList.contains('on');
      guides.classList.toggle('on', on);
      guidesBtn.setAttribute('aria-pressed', String(on));
    });
    soundBtn.addEventListener('click', () => {
      if (!comp._sound) return;
      const on = comp._sound.toggle(comp.time, comp.playing);
      soundBtn.textContent = on ? '🔊' : '🔇';
      soundBtn.setAttribute('aria-pressed', String(on));
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target !== scrub) return;
      const f = 1 / comp.fps;
      if (e.code === 'Space') { e.preventDefault(); comp.toggle(); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 1 : f); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -1 : -f); } else if (e.key === 'Home') { e.preventDefault(); step(-comp.duration); } else if (e.key === 'End') { e.preventDefault(); step(comp.duration); } else if (e.key === 'l' || e.key === 'L') loopBtn.click();
      else if (e.key === 'g' || e.key === 'G') guidesBtn.click();
      else if (e.key === 'm' || e.key === 'M') { if (!soundBtn.hidden) soundBtn.click(); }
    });
  }

  // --------------------------------------------------------------- public API
  const Motion = {
    version: VERSION,
    create: (cfg) => new Composition(cfg || {}),
    ease: (spec, tokens) => parseEase(spec, tokens || DEFAULT_TOKENS),
    tokens: { ...DEFAULT_TOKENS },
    cubicBezier,
    spring: (bounce) => springEase(bounce),
    physicalSpring,
    toLinear,
    random: (seed) => mulberry32(seed == null ? 1 : seed),
    noise,
    wiggle,
    beats,
    lerp,
    clamp,
    mapRange,
    safeAreas: SAFE_PRESETS,
    // internals exposed for the test suite (scripts/test_runtime.mjs)
    _internals: { countSubpaths, parseEase, cubicBezier, springEase, steps, staggerOffsets, makeInterp, parseNum, parseComplex, transformString, filterString, fmt, sampleSeg, Timeline, mulberry32, pathTokens },
  };

  root.Motion = Motion;
  if (typeof module === 'object' && module.exports) module.exports = Motion;
})(typeof window !== 'undefined' ? window : globalThis);
