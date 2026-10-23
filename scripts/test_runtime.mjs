// Test delle parti pure del motore: node --test scripts/test_runtime.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../assets/motion-runtime.js');
const I = M._internals;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('ogni curva parte da 0 e arriva a 1', () => {
  for (const s of ['linear', 'out.cubic', 'inOut.expo', 'back.out(1.7)', 'elastic.out(1, 0.3)', 'bounce.out', 'spring(0.3)',
    'spring(0)', 'steps(4)', 'cubic-bezier(0.23, 1, 0.32, 1)', 'ease-in-out', 'enter', 'exit', 'move', 'power3.inOut']) {
    const f = I.parseEase(s, M.tokens);
    close(f(0), 0, 1e-9);
    close(f(1), 1, 1e-9);
  }
});

test('nomi alla GSAP e alla CSS si equivalgono', () => {
  close(I.parseEase('out.expo')(0.3), I.parseEase('expo.out')(0.3));
  close(I.parseEase('power2.out')(0.4), I.parseEase('out.cubic')(0.4));
  close(I.parseEase('linear')(0.37), 0.37);
});

test('molla critica senza sorpasso, molla con bounce oltre il bersaglio', () => {
  const crit = I.parseEase('spring(0)');
  const bouncy = I.parseEase('spring(0.5)');
  let maxCrit = 0;
  let maxBouncy = 0;
  for (let i = 0; i <= 1000; i += 1) { maxCrit = Math.max(maxCrit, crit(i / 1000)); maxBouncy = Math.max(maxBouncy, bouncy(i / 1000)); }
  assert.ok(maxCrit <= 1 + 1e-9);
  assert.ok(maxBouncy > 1.1);
  const ps = M.physicalSpring({ stiffness: 170, damping: 26 });
  assert.ok(ps.duration > 0.3 && ps.duration < 2);
  assert.match(ps.ease, /^spring\(/);
});

test('curva sconosciuta: avviso e ripiego', () => {
  const warns = [];
  const f = I.parseEase('superbouncy', {}, (m) => warns.push(m));
  close(f(1), 1);
  assert.equal(warns.length, 1);
});

test('stagger: centro, quantità totale, casuale deterministico', () => {
  assert.deepEqual(I.staggerOffsets(5, { each: 0.1, from: 'center' }, M.random(1)).map((v) => +v.toFixed(3)), [0.2, 0.1, 0, 0.1, 0.2]);
  assert.deepEqual(I.staggerOffsets(4, { amount: 0.6 }, M.random(1)).map((v) => +v.toFixed(3)), [0, 0.2, 0.4, 0.6]);
  const a = I.staggerOffsets(6, { each: 0.1, from: 'random' }, M.random(9));
  const b = I.staggerOffsets(6, { each: 0.1, from: 'random' }, M.random(9));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [0, 0.1, 0.2, 0.30000000000000004, 0.4, 0.5].sort());
});

test('interpolazioni: unità, stringhe complesse, colori, scala percettiva', () => {
  assert.deepEqual(I.makeInterp('y', '120%', 0, {})(0.5, 0.5), { n: 60, u: '%' });
  assert.equal(I.makeInterp('clipPath', 'inset(0 100% 0 0)', 'inset(0 0% 0 0)', {})(0.25, 0.25), 'inset(0 75% 0 0)');
  assert.equal(I.makeInterp('color', '#000', '#fff', {})(0.5, 0.5), 'color-mix(in oklab, #fff 50%, #000)');
  assert.equal(I.makeInterp('color', '#000', '#fff', {})(1.3, 1), '#fff');
  close(I.makeInterp('scale', 1, 4, {})(0.5, 0.5).n, 2);
  close(I.makeInterp('scale', 1, 4, { perceptual: false })(0.5, 0.5).n, 2.5);
  const warns = [];
  assert.deepEqual(I.makeInterp('x', '10px', '2em', {}, (m) => warns.push(m))(0.5, 0.5), { n: 10, u: 'px' });
  assert.equal(warns.length, 1);
});

test('ordine delle trasformazioni e transform CSS conservato a sinistra', () => {
  const s = I.transformString({ x: { n: 10, u: '' }, rotate: { n: 12, u: '' }, scale: { n: 2, u: '' } }, 'matrix(1, 0, 0, 1, -50, -20)');
  assert.equal(s, 'matrix(1, 0, 0, 1, -50, -20) translate3d(10px, 0px, 0px) rotate(12deg) scale(2, 2)');
  assert.equal(I.transformString({}, null), 'none');
});

function fakeComp() {
  const c = { _labels: new Map(), _scenes: [], _customs: [], _order: 0, defaults: { duration: 1, ease: 'linear' }, tokens: M.tokens,
    cfg: { seed: 1 }, warns: [], segs: [] };
  c.warn = (m) => c.warns.push(m);
  c._warn = c.warn;
  c._addSegment = (s) => c.segs.push(s);
  c._targets = (t) => (Array.isArray(t) ? t : [t]);
  return c;
}

test('posizioni della timeline come in GSAP, scene e stagger', () => {
  const c = fakeComp();
  const tl = new I.Timeline(c, 0, null);
  const [A, B, C, D] = [{}, {}, {}, {}];
  tl.to(A, { x: 1, duration: 1 })
    .to(B, { x: 1, duration: 1 }, '<0.5')
    .to(C, { x: 1, duration: 1 }, '+=1')
    .label('L', 4)
    .to(D, { x: 1, duration: 0.5 }, 'L-=0.5');
  assert.deepEqual(c.segs.map((s) => s.start), [0, 0.5, 2.5, 3.5]);
  tl.scene('S', 5, (s) => { s.to(A, { y: 1, duration: 2 }).to(B, { y: 1, duration: 1 }, '<1'); });
  assert.equal(c._labels.get('S'), 5);
  assert.deepEqual(c.segs.slice(4).map((s) => s.start), [5, 6]);
  assert.equal(tl.end, 7);
  tl.to([A, B, C], { z: 1, duration: 1, stagger: 0.2 }, 10);
  assert.deepEqual(c.segs.slice(6).map((s) => +s.start.toFixed(3)), [10, 10.2, 10.4]);
  close(tl.prevEnd, 11.4);
  tl.to(A, { x: 2 }, 'inesistente');
  assert.ok(c.warns.some((w) => w.includes('inesistente')));
});

test('morph: una moveto relativa non è un secondo sottopercorso', () => {
  assert.equal(I.countSubpaths(I.pathTokens('M1500 500 m-80 0 a80 80 0 1 0 160 0 a80 80 0 1 0 -160 0Z')), 1);
  assert.equal(I.countSubpaths(I.pathTokens('M0 0 L10 0 Z M20 20 L30 30')), 2);
});

test('noise e wiggle: deterministici e limitati', () => {
  assert.equal(M.wiggle(1.234, { amp: 10, seed: 3 }), M.wiggle(1.234, { amp: 10, seed: 3 }));
  for (let x = -5; x < 5; x += 0.013) assert.ok(Math.abs(M.noise(x, 7)) <= 1 + 1e-9);
});

test('toLinear per le @keyframes CSS', () => {
  assert.match(M.toLinear('spring(0.4)', 8), /^linear\(0, .*, 1\)$/);
});
