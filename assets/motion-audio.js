/*!
 * motion-craft audio 1.0.0
 * Sound design synthesised with Web Audio and tied to the composition's timeline: no files, no network.
 * The same score plays live in the preview (only after a user gesture) and renders offline for the export,
 * so what you check is what you ship. Every noise source is seeded: two renders are identical.
 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const dbToGain = (db) => Math.pow(10, db / 20);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round = (v, d = 4) => { const f = 10 ** d; return Math.round(v * f) / f; };

  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ pitch
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freq(note) {
    if (typeof note === 'number') return note;
    const m = String(note).trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
    if (!m) return 440;
    const midi = (parseInt(m[3], 10) + 1) * 12 + SEMI[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
  // Diatonic triad on a degree of the key: the scale decides the quality (I, ii, iii, IV, V, vi, vii°).
  function chordOf(key, mode, numeral, octave) {
    const k = String(key || 'C');
    const rootSemi = SEMI[k[0].toUpperCase()] + (k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0);
    const sc = SCALES[mode] || SCALES.major;
    const deg = ROMAN[String(numeral).toLowerCase().replace(/[^iv]/g, '')] || 0;
    return [0, 2, 4].map((step) => {
      const idx = deg + step;
      const semi = rootSemi + sc[idx % 7] + 12 * Math.floor(idx / 7);
      return 440 * Math.pow(2, ((octave + 1) * 12 + semi - 69) / 12);
    });
  }

  // --------------------------------------------------------------- sources
  function noiseBuffer(ctx, seconds, seed, color) {
    const n = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = mulberry32(seed);
    if (color === 'pink') {
      let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
      for (let i = 0; i < n; i += 1) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      for (let i = 0; i < n; i += 1) d[i] = r() * 2 - 1;
    }
    return buf;
  }

  // A synthetic room: decaying noise that darkens as it fades, different in the two channels.
  function impulse(ctx, seconds, seed) {
    const n = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const d = buf.getChannelData(c);
      const r = mulberry32(seed * 13 + c * 7 + 1);
      let lp = 0;
      for (let i = 0; i < n; i += 1) {
        const x = i / n;
        lp += (0.85 - 0.77 * x) * ((r() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - x, 2.2);
      }
    }
    return buf;
  }

  function shaper(ctx, amount) {
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(amount);
    for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(amount * x) / norm; }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  // An envelope that starts at silence: attack to `peak`, then exponential decay to silence at `end`.
  function env(param, w, attack, peak, end) {
    param.setValueAtTime(0.0001, w);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), w + Math.max(0.001, attack));
    param.exponentialRampToValueAtTime(0.0001, Math.max(w + attack + 0.002, end));
  }

  function fmBell(io, dest, w, f, ratio, dur, peak, index) {
    const { ctx } = io;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * index, w);
    mg.gain.exponentialRampToValueAtTime(f * 0.01 + 0.01, w + dur * 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    env(g.gain, w, 0.003, peak, w + dur);
    car.connect(g);
    g.connect(dest);
    car.start(w); mod.start(w);
    car.stop(w + dur + 0.05); mod.stop(w + dur + 0.05);
  }

  // ---------------------------------------------------------------- voices
  // Each voice: defaults, len(p) = seconds it sounds, play(io, w, p, seed, skipBefore).
  const VOICES = {
    whoosh: {
      defaults: { dur: 0.6, level: -10, from: -0.4, to: 0.4, bright: 0.5 },
      len: (p) => p.dur + 0.1,
      play(io, w, p, seed) {
        const { ctx } = io;
        const s = io.strip(p.level, p.from, 0.25);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, p.dur + 0.1, seed, 'pink');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.8 + p.bright;
        const f0 = 220 + 280 * p.bright;
        const f1 = 1500 + 4000 * p.bright;
        const peak = w + p.dur * 0.6; // loudest where the picture moves fastest
        bp.frequency.setValueAtTime(f0, w);
        bp.frequency.exponentialRampToValueAtTime(f1, peak);
        bp.frequency.exponentialRampToValueAtTime(f0 * 1.5, w + p.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, w);
        g.gain.exponentialRampToValueAtTime(4, peak);
        g.gain.exponentialRampToValueAtTime(0.0001, w + p.dur);
        s.pan.pan.setValueAtTime(clamp(p.from, -1, 1), w);
        s.pan.pan.linearRampToValueAtTime(clamp(p.to, -1, 1), w + p.dur);
        src.connect(bp); bp.connect(g); g.connect(s.input);
        src.start(w); src.stop(w + p.dur + 0.1);
      },
    },
    hit: {
      defaults: { weight: 'medium', level: -4, pan: 0, tone: 1 },
      len: () => 1,
      play(io, w, p, seed) {
        const { ctx } = io;
        const k = { soft: 0.7, medium: 1, heavy: 1.35 }[p.weight] || 1;
        const s = io.strip(p.level, p.pan, 0.2);
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, 0.06, seed, 'white');
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2200 * p.tone;
        const gn = ctx.createGain();
        env(gn.gain, w, 0.002, 0.45 * k, w + 0.02);
        n.connect(hp); hp.connect(gn); gn.connect(s.input);
        n.start(w); n.stop(w + 0.06);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(200 * p.tone, w);
        o.frequency.exponentialRampToValueAtTime(70 * p.tone, w + 0.09);
        const go = ctx.createGain();
        env(go.gain, w, 0.003, 0.7, w + 0.1 + 0.05 * k);
        o.connect(go); go.connect(s.input);
        o.start(w); o.stop(w + 0.25 + 0.05 * k);
        // the sub gets a little saturation: its harmonics are what survives on phone speakers
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(62, w);
        sub.frequency.exponentialRampToValueAtTime(40, w + 0.25 * k);
        const sat = shaper(ctx, 2.2);
        const gs = ctx.createGain();
        env(gs.gain, w, 0.006, 0.8 * k, w + 0.15 + 0.3 * k);
        sub.connect(sat); sat.connect(gs); gs.connect(s.input);
        sub.start(w); sub.stop(w + 0.55 + 0.3 * k);
      },
    },
    tick: {
      defaults: { level: -16, pitch: 2400, pan: 0 },
      len: () => 0.08,
      play(io, w, p) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.08);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(p.pitch, w);
        o.frequency.exponentialRampToValueAtTime(p.pitch * 0.6, w + 0.03);
        const g = ctx.createGain();
        env(g.gain, w, 0.001, 1, w + 0.035);
        o.connect(g); g.connect(s.input);
        o.start(w); o.stop(w + 0.06);
      },
    },
    pop: {
      defaults: { level: -12, pitch: 750, pan: 0 },
      len: () => 0.2,
      play(io, w, p) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.12);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(p.pitch * 1.4, w);
        o.frequency.exponentialRampToValueAtTime(p.pitch * 0.38, w + 0.07);
        const g = ctx.createGain();
        env(g.gain, w, 0.002, 1, w + 0.11);
        o.connect(g); g.connect(s.input);
        o.start(w); o.stop(w + 0.15);
      },
    },
    riser: { // placed on the moment it resolves into: it starts `dur` earlier and stops dead on the moment
      defaults: { dur: 1.5, level: -12, note: 'C4', pan: 0 },
      len: (p) => p.dur + 0.02,
      play(io, w, p, seed) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.3);
        const end = w + p.dur;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, p.dur + 0.05, seed, 'pink');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(300, w);
        bp.frequency.exponentialRampToValueAtTime(6000, end);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, w);
        g.gain.exponentialRampToValueAtTime(3, end - 0.01);
        g.gain.linearRampToValueAtTime(0.0001, end + 0.005);
        src.connect(bp); bp.connect(g); g.connect(s.input);
        src.start(w); src.stop(end + 0.02);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(freq(p.note), w);
        o.frequency.exponentialRampToValueAtTime(freq(p.note) * 2, end);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(600, w);
        lp.frequency.exponentialRampToValueAtTime(4000, end);
        const go = ctx.createGain();
        go.gain.setValueAtTime(0.0001, w);
        go.gain.exponentialRampToValueAtTime(0.25, end - 0.01);
        go.gain.linearRampToValueAtTime(0.0001, end + 0.005);
        o.connect(lp); lp.connect(go); go.connect(s.input);
        o.start(w); o.stop(end + 0.02);
      },
    },
    sub: {
      defaults: { dur: 1.4, level: -6, from: 110, to: 38, pan: 0 },
      len: (p) => p.dur + 0.05,
      play(io, w, p) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.1);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(p.from, w);
        o.frequency.exponentialRampToValueAtTime(p.to, w + p.dur * 0.5);
        const sat = shaper(ctx, 1.8);
        const g = ctx.createGain();
        env(g.gain, w, 0.005, 1, w + p.dur);
        o.connect(sat); sat.connect(g); g.connect(s.input);
        o.start(w); o.stop(w + p.dur + 0.05);
      },
    },
    bell: {
      defaults: { note: 'E5', ratio: 1.41, dur: 1.6, level: -14, pan: 0, index: 2.5 },
      len: (p) => p.dur + 0.1,
      play(io, w, p) {
        const s = io.strip(p.level, p.pan, 0.35);
        fmBell(io, s.input, w, freq(p.note), p.ratio, p.dur, 0.6, p.index);
      },
    },
    shimmer: {
      defaults: { notes: ['E6', 'B6', 'E7', 'G#7'], spread: 0.06, level: -18, pan: 0.25 },
      len: (p) => p.notes.length * p.spread + 1,
      play(io, w, p) {
        p.notes.forEach((note, i) => {
          const s = io.strip(p.level, i % 2 ? p.pan : -p.pan, 0.45);
          fmBell(io, s.input, w + i * p.spread, freq(note), 3.01, 0.9, 0.5, 1.2);
        });
      },
    },
    tone: {
      defaults: { note: 'A4', dur: 0.4, type: 'sine', glide: null, level: -14, pan: 0 },
      len: (p) => p.dur + 0.05,
      play(io, w, p) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.2);
        const o = ctx.createOscillator();
        o.type = p.type;
        o.frequency.setValueAtTime(freq(p.note), w);
        if (p.glide) o.frequency.exponentialRampToValueAtTime(freq(p.glide), w + p.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, w);
        g.gain.exponentialRampToValueAtTime(0.8, w + 0.005);
        g.gain.setValueAtTime(0.8, w + p.dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, w + p.dur);
        o.connect(g); g.connect(s.input);
        o.start(w); o.stop(w + p.dur + 0.05);
      },
    },
    swell: { // like the riser: placed on the moment it leads into; grows to 94% of its length, then cuts
      defaults: { dur: 1.5, level: -14, from: 300, to: 3000, pan: 0 },
      len: (p) => p.dur + 0.02,
      play(io, w, p, seed) {
        const { ctx } = io;
        const s = io.strip(p.level, p.pan, 0.35);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, p.dur + 0.05, seed, 'pink');
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(p.from, w);
        lp.frequency.exponentialRampToValueAtTime(p.to, w + p.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, w);
        g.gain.exponentialRampToValueAtTime(2, w + p.dur * 0.94);
        g.gain.linearRampToValueAtTime(0.0001, w + p.dur);
        src.connect(lp); lp.connect(g); g.connect(s.input);
        src.start(w); src.stop(w + p.dur + 0.02);
      },
    },
    pad: {
      defaults: { dur: 4, chord: ['C3', 'G3', 'E4'], level: -22, cutoff: [400, 2400], detune: 7, pan: 0 },
      len: (p) => p.dur + 0.3,
      play(io, w, p) {
        const s = io.strip(p.level, p.pan, 0.3);
        padVoice(io, s.input, w, p.dur, p.chord.map(freq), p.cutoff, p.detune, 0.25);
      },
    },
    bed: {
      defaults: { bpm: 100, key: 'C', mode: 'major', progression: ['I', 'V', 'vi', 'IV'], from: 0, to: null, style: 'pulse', level: -16, beatsPerBar: 4 },
      len: (p) => Math.max(0, p.to - p.from) + 0.6,
      play(io, w0, p, seed, skipBefore) { bedVoice(io, w0, p, seed, skipBefore); },
    },
  };

  function padVoice(io, dest, w, dur, freqs, cutoff, detune, peak) {
    const { ctx } = io;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(cutoff[0], w);
    lp.frequency.exponentialRampToValueAtTime(cutoff[1], w + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, w);
    g.gain.exponentialRampToValueAtTime(peak, w + Math.min(1.2, dur * 0.3));
    g.gain.setValueAtTime(peak, w + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, w + dur + 0.25);
    lp.connect(g);
    g.connect(dest);
    const scale = 1 / Math.max(1, freqs.length * 2);
    for (const f of freqs) {
      for (const det of [-detune, detune]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = scale;
        o.connect(og);
        og.connect(lp);
        o.start(w);
        o.stop(w + dur + 0.3);
      }
    }
  }

  // A minimal music bed on a tempo grid: chords per bar, plus a pulse (kick, hats, plucks, ducking) or an ambient
  // texture. Meant as a bed under the picture, not as a track: real music is outside this skill.
  function bedVoice(io, w0, p, seed, skipBefore) {
    const { ctx } = io;
    const spb = 60 / p.bpm;
    const total = Math.max(0, p.to - p.from);
    const nBeats = Math.floor(total / spb + 1e-6);
    const bus = io.strip(p.level, 0, 0.25);
    const padBus = ctx.createGain();
    padBus.gain.value = 1;
    padBus.connect(bus.input);
    const rng = mulberry32(seed);
    for (let b = 0; b < nBeats; b += 1) {
      const t = w0 + b * spb;
      const inBar = b % p.beatsPerBar;
      const barIdx = Math.floor(b / p.beatsPerBar);
      const chord = chordOf(p.key, p.mode, p.progression[barIdx % p.progression.length], 3);
      if (inBar === 0) {
        const barDur = Math.min(p.beatsPerBar * spb, total - b * spb);
        if (t + barDur > skipBefore) padVoice(io, padBus, t, barDur, [chord[0] / 2, ...chord, chord[0] * 2], [500, 1800], 6, 0.5);
      }
      if (t < skipBefore - 0.02) continue;
      if (p.style === 'pulse') {
        const k = ctx.createOscillator();
        k.type = 'sine';
        k.frequency.setValueAtTime(150, t);
        k.frequency.exponentialRampToValueAtTime(45, t + 0.1);
        const kg = ctx.createGain();
        env(kg.gain, t, 0.002, inBar === 0 ? 1 : 0.8, t + 0.16);
        k.connect(kg); kg.connect(bus.input);
        k.start(t); k.stop(t + 0.2);
        padBus.gain.setValueAtTime(1, t);
        padBus.gain.linearRampToValueAtTime(0.55, t + 0.012);
        padBus.gain.linearRampToValueAtTime(1, t + Math.min(0.3, spb * 0.8));
        const h = ctx.createBufferSource();
        h.buffer = noiseBuffer(ctx, 0.04, seed + b * 3 + 1, 'white');
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        const hg = ctx.createGain();
        env(hg.gain, t + spb / 2, 0.001, 0.12 + rng() * 0.04, t + spb / 2 + 0.03);
        h.connect(hp); hp.connect(hg); hg.connect(bus.input);
        h.start(t + spb / 2); h.stop(t + spb / 2 + 0.04);
        const arp = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2];
        for (let e = 0; e < 2; e += 1) fmBell(io, bus.input, t + (e * spb) / 2, arp[(b * 2 + e) % 4], 2, 0.22, 0.16, 1.2);
      } else if (inBar === 0 && barIdx % 2 === 0) {
        fmBell(io, bus.input, t, chord[2] * 4, 1.41, 2.4, 0.2, 1.5);
      }
    }
  }

  // ---------------------------------------------------------- mixing chain
  function makeIO(ctx, dest, settings) {
    const bus = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = settings.room.mix;
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulse(ctx, settings.room.size, settings.seed);
    send.connect(conv);
    conv.connect(bus);
    const glue = ctx.createDynamicsCompressor(); // a light glue on the whole mix
    glue.threshold.value = -20; glue.knee.value = 6; glue.ratio.value = 3; glue.attack.value = 0.004; glue.release.value = 0.24;
    const makeup = ctx.createGain();
    makeup.gain.value = dbToGain(settings.master.gain);
    const limit = ctx.createDynamicsCompressor(); // a safety ceiling; loudness is set at export, linearly
    limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    if (settings.master.glue !== false) { bus.connect(glue); glue.connect(makeup); } else bus.connect(makeup);
    makeup.connect(limit);
    limit.connect(dest);
    return {
      ctx,
      strip(levelDb, pan = 0, sendAmt = 0.2) {
        const g = ctx.createGain();
        g.gain.value = dbToGain(levelDb);
        const pn = ctx.createStereoPanner();
        pn.pan.value = clamp(pan, -1, 1);
        g.connect(pn);
        pn.connect(bus);
        if (sendAmt > 0) { const s = ctx.createGain(); s.gain.value = sendAmt; pn.connect(s); s.connect(send); }
        return { input: g, pan: pn };
      },
    };
  }

  // ----------------------------------------------------------------- score
  class Score {
    constructor(comp) {
      this.comp = comp;
      this.cues = [];
      this.settings = { room: { size: 2.2, mix: 1 }, master: { gain: 0, glue: true }, seed: (comp.cfg && comp.cfg.seed) || 1 };
    }
    room(o) { Object.assign(this.settings.room, o); return this; }
    master(o) { Object.assign(this.settings.master, o); return this; }
    seed(n) { this.settings.seed = n; return this; }
    at(label, offset = 0) { return this.comp.at(label, offset); }
    beats(bpm, offset = 0) { const spb = 60 / bpm; return (n) => offset + n * spb; }
    _cue(type, t, o) {
      const p = { ...VOICES[type].defaults, ...(o || {}) };
      let time = Number(t);
      if (type === 'riser' || type === 'swell') time -= p.dur;
      if (type === 'bed') {
        if (p.to == null) p.to = this.comp.duration;
        time = p.from;
      }
      this.cues.push({ type, time, anchor: Number(t), p, i: this.cues.length });
      return this;
    }
    whoosh(t, o) { return this._cue('whoosh', t, o); }
    hit(t, o) { return this._cue('hit', t, o); }
    tick(t, o) { return this._cue('tick', t, o); }
    pop(t, o) { return this._cue('pop', t, o); }
    riser(t, o) { return this._cue('riser', t, o); }
    sub(t, o) { return this._cue('sub', t, o); }
    bell(t, o) { return this._cue('bell', t, o); }
    shimmer(t, o) { return this._cue('shimmer', t, o); }
    tone(t, o) { return this._cue('tone', t, o); }
    swell(t, o) { return this._cue('swell', t, o); }
    pad(t, o) { return this._cue('pad', t, o); }
    bed(o) { return this._cue('bed', (o && o.from) || 0, o); }
  }

  function schedule(io, score, from, ctxStart) {
    for (const c of score.cues) {
      const voice = VOICES[c.type];
      if (!Number.isFinite(c.time)) continue;
      if (c.time + voice.len(c.p) <= from) continue;
      const w = ctxStart + (c.time - from);
      voice.play(io, Math.max(0, w), c.p, score.settings.seed * 1000 + c.i + 1, ctxStart);
    }
  }

  function wavFloat32(chans, sr) {
    const n = chans[0].length;
    const nc = chans.length;
    const dataBytes = n * nc * 4;
    const buf = new ArrayBuffer(58 + dataBytes);
    const v = new DataView(buf);
    let o = 0;
    const str = (s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o++, s.charCodeAt(i)); };
    str('RIFF'); v.setUint32(o, 50 + dataBytes, true); o += 4; str('WAVE');
    str('fmt '); v.setUint32(o, 18, true); o += 4; v.setUint16(o, 3, true); o += 2; v.setUint16(o, nc, true); o += 2;
    v.setUint32(o, sr, true); o += 4; v.setUint32(o, sr * nc * 4, true); o += 4; v.setUint16(o, nc * 4, true); o += 2;
    v.setUint16(o, 32, true); o += 2; v.setUint16(o, 0, true); o += 2;
    str('fact'); v.setUint32(o, 4, true); o += 4; v.setUint32(o, n, true); o += 4;
    str('data'); v.setUint32(o, dataBytes, true); o += 4;
    for (let i = 0; i < n; i += 1) for (let c = 0; c < nc; c += 1) { v.setFloat32(o, chans[c][i], true); o += 4; }
    return new Uint8Array(buf);
  }

  // Chunks are multiples of 3 bytes, so each one is valid base64 on its own.
  function base64Chunks(bytes, size) {
    const out = [];
    for (let i = 0; i < bytes.length; i += size) {
      const part = bytes.subarray(i, Math.min(bytes.length, i + size));
      let bin = '';
      for (let j = 0; j < part.length; j += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
      out.push(btoa(bin));
    }
    return out;
  }

  async function renderOffline(comp, score, opts) {
    const sr = opts.sampleRate || 48000;
    const from = opts.from || 0;
    const to = opts.to == null ? comp.duration : opts.to;
    const len = Math.max(1, Math.round((to - from) * sr));
    const ctx = new OfflineAudioContext(2, len, sr);
    const io = makeIO(ctx, ctx.destination, score.settings);
    schedule(io, score, from, 0);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const fade = (n, atEnd) => { for (let i = 0; i < n; i += 1) { const g = i / n; const k = atEnd ? len - 1 - i : i; L[k] *= g; R[k] *= g; } };
    fade(Math.min(len, Math.round(0.03 * sr)), true); // no click where the video ends
    if (from > 0) fade(Math.min(len, Math.round(0.005 * sr)), false);
    let peak = 0;
    for (let i = 0; i < len; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    score._b64 = base64Chunks(wavFloat32([L, R], sr), 3 * 1024 * 1024);
    return { sampleRate: sr, channels: 2, frames: len, chunks: score._b64.length, peak: round(peak, 6) };
  }

  function makePlayer(comp, score) {
    let ctx = null;
    let enabled = false;
    let speed = 1;
    let token = 0;
    const api = {
      start() {
        if (!enabled || speed !== 1 || ctx) return;
        const ua = root.navigator && root.navigator.userActivation;
        if (ua && !ua.hasBeenActive) return; // browsers refuse sound before a gesture: do not even try
        const my = (token += 1);
        const c = new AudioContext({ latencyHint: 'interactive' });
        ctx = c;
        c.resume().then(() => {
          if (my !== token || ctx !== c || !comp.playing) return;
          schedule(makeIO(c, c.destination, score.settings), score, comp.time, c.currentTime + 0.03);
        });
      },
      stop() {
        token += 1;
        if (ctx) { const c = ctx; ctx = null; c.close().catch(() => {}); }
      },
      restart(t) { api.stop(); api.start(t); },
      toggle(t, playing) {
        enabled = !enabled;
        if (enabled && playing) api.start(t); else api.stop();
        return enabled;
      },
      setSpeed(s, t, playing) {
        speed = s;
        if (s !== 1) api.stop(); else if (playing && enabled) api.start(t);
      },
    };
    return api;
  }

  function compile(comp, builder) {
    const score = new Score(comp);
    builder(score);
    for (const c of score.cues) {
      if (!Number.isFinite(c.time)) comp.warn(`audio: "${c.type}" ha un tempo non valido`);
      else if (c.time > comp.duration) comp.warn(`audio: "${c.type}" a ${round(c.time, 3)} s cade dopo la fine`);
      else if (c.time < 0) comp.warn(`audio: "${c.type}" comincerebbe prima di 0 s: viene tagliato`);
    }
    return {
      cues: () => score.cues.map((c) => ({ type: c.type, time: round(c.time, 4), anchor: round(c.anchor, 4), end: round(c.time + VOICES[c.type].len(c.p), 4) })),
      renderOffline: (opts) => renderOffline(comp, score, opts || {}),
      chunk: (i) => (score._b64 ? score._b64[i] || null : null),
      player: () => makePlayer(comp, score),
    };
  }

  root.MotionAudio = { version: VERSION, compile, freq, chordOf, voices: Object.keys(VOICES) };
})(typeof window !== 'undefined' ? window : globalThis);
