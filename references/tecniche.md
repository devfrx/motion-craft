# Tecniche

Ricette brevi con il motore. Adatta valori e curve alla personalità scelta (direzione.md).

## Indice

1. Rivelazioni di testo
2. Maschere e tendine
3. Linee e forme
4. Camera e profondità
5. Transizioni tra scene
6. Dati animati
7. Loop senza giunture
8. Generativo e particelle
9. Personaggi: occhi e gesti
10. Grana e banding
11. Motion blur
12. Ritmo e musica

## 1. Rivelazioni di testo

Righe con maschera, il default professionale:

```js
const t = split('.title', { type: 'lines', mask: 'lines' });
tl.from(t.lines, { y: '120%', duration: 0.9, stagger: 0.09 });
```

- Parole a cascata: `{ type: 'words' }` e `tl.from(t.words, { y: 30, opacity: 0, stagger: 0.04 })`.
- Lettere, solo per parole brevi e marchi: `{ type: 'chars', mask: 'chars' }` con `stagger: { each: 0.03, from: 'center' }`.
- Macchina da scrivere: `tl.fromTo('.code', { text: '' }, { text: 'npm run build', duration: 1.2, ease: 'linear' })`, più un cursore con `@keyframes`.
- Peso variabile: `font-variation-settings: 'wght' var(--wght)` nel CSS e `tl.to('.title', { '--wght': [300, 800] })` (serve un font variabile incorporato).
- Evidenziatore: una barra assoluta dietro la parola, `scaleX` da 0 con `transform-origin` a sinistra.
- Contatori: `tl.count('.n', { to: 1280, duration: 1.4, locale: 'it-IT', suffix: ' clienti' })`, con `tabular-nums`.

Decodifica (scramble) riproducibile: la tabella dei caratteri si calcola una volta sola, così ogni fotogramma dipende solo da p.

```js
const el = document.querySelector('.word');
const final = el.textContent;
const rng = random(7);
const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const table = Array.from({ length: 60 }, () => Array.from(final, () => glyphs[Math.floor(rng() * glyphs.length)]));
tl.custom((p) => {
  const k = Math.floor(p * final.length);
  el.textContent = final.slice(0, k) + table[Math.min(59, Math.floor(p * 60))].slice(k).join('');
}, { duration: 1 });
```

## 2. Maschere e tendine

- Tendina laterale: `clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']`.
- Iride: `clipPath: ['circle(0% at 50% 50%)', 'circle(75% at 50% 50%)']`.
- Diagonale: `clipPath: ['polygon(0 0, 0 0, 0 100%, 0 100%)', 'polygon(0 0, 120% 0, 100% 100%, -20% 100%)']`, con lo stesso numero di punti nei due estremi.
- Tapparelle: N strisce con stagger su `scaleY`.
- Maschera morbida: `mask-image` con un gradiente e `maskPosition` interpolata.

## 3. Linee e forme

- Disegno: `tl.from('path', { draw: 0, duration: 1, ease: 'move' })`.
- Morph: `tl.to('#forma', { d: '#bersaglio', duration: 0.8, ease: 'inOut.cubic' })`. Per curve perfette disegna le due forme con gli stessi comandi; altrimenti il motore ricampiona in punti.
- Forme che nascono: le forme grafiche possono crescere da un punto (`scale: [0, 1.08, 1]`); testo e pannelli no, partono da 0,95–0,98 con l'opacità.
- Squash & stretch: `scaleX` e `scaleY` opposti all'impatto, con il volume costante (scaleX × scaleY ≈ 1).

## 4. Camera e profondità

- Un contenitore `.camera` per tutta la scena, con una spinta lenta che si assesta alla fine: `tl.to('.camera', { scale: [1, 1.04], duration: D, ease: 'out.quad' }, 0)`.
- Parallasse: livelli con spostamenti 1×, 0,5× e 0,2× nello stesso tween.
- 2.5D: `perspective: 1400px` sul genitore, `rotateY` di ±8–15° sui pannelli.
- Fuoco: blur sui livelli lontani che si sposta (0→6 e 6→0).
- Whip pan: spostamento rapido (0,25–0,35 s, `out.expo`) più il motion blur all'export.

## 5. Transizioni tra scene

| Tipo | Quando | Come |
|---|---|---|
| Taglio a metà gesto | il default | uscita in accelerazione nella corrente, entrata in decelerazione dallo stesso lato |
| Push | cambio di argomento nella stessa storia | la scena va da x 0 a −W, la nuova arriva da +W |
| Tendina o maschera | rivelazione | `clipPath` sulla scena nuova |
| Zoom-through | approfondire | si scala un elemento finché riempie, la nuova scena è dentro |
| Match cut | continuità forte | la stessa forma in due scene, con stessa posizione e velocità |
| Morph | trasformazione | `d`, o forme misurate nel build |
| Dissolvenza | solo premium o cinematico, breve | con un blur di 4–8 px come ponte |

Al massimo 2–3 tipi per pezzo.

## 6. Dati animati

- Prima gli assi e la cornice, poi i dati, poi l'evidenza.
- Barre: `scaleY` con `transform-origin` in basso, stagger 0,05–0,08.
- Linee: `draw` sul tracciato; i punti con un pop a fine tratto.
- Il numero che conta: `count` e un accento di colore; il resto attenuato.
- Etichette leggibili per tutto il tempo necessario: il `check` misura la lettura.

## 7. Loop senza giunture

- `loop: true` in `Motion.create`.
- Moti periodici: `x = A · sin(2πt / D)` nell'`onFrame`, oppure tween con `repeat` la cui durata divide D.
- Keyframe con il primo e l'ultimo valore uguali.
- Animazioni CSS infinite: la loro durata deve dividere D.
- Il `check` confronta il primo e l'ultimo fotogramma.

## 8. Generativo e particelle

Calcola ogni particella da t, non integrando passo per passo:

```js
const rng = random(3);
const P = Array.from({ length: 140 }, () => ({ x: rng() * 1920, y: rng() * 1080, v: 20 + rng() * 60, ph: rng() * 6.28 }));
const ctx = document.querySelector('canvas').getContext('2d');
comp.onFrame((t) => {
  ctx.clearRect(0, 0, 1920, 1080);
  for (const p of P) {
    const y = (((p.y - p.v * t) % 1080) + 1080) % 1080;
    ctx.globalAlpha = 0.4 + 0.3 * Math.sin(p.ph + t * 2);
    ctx.fillRect(p.x + Motion.wiggle(t, { freq: 0.5, amp: 12, seed: Math.round(p.ph * 100) }), y, 3, 3);
  }
});
```

Distribuzioni non ripetitive: raggruppa e sfasa, sempre con un seme fisso.

## 9. Personaggi: occhi e gesti

- Occhi: saccadi di 90–110 ms con un 8% oltre il bersaglio; fissazioni di 150–300 ms; battito con chiusura in circa 70 ms e apertura in circa 125 ms; pupilla che si dilata del 4–8% nei momenti di attenzione; ruota l'occhio intero (circa il 45%) e lascia il resto alla pupilla.
- Gesti: traiettorie curve, veloci a metà e lente agli estremi, un anticipo prima di un movimento grande, un piccolo sorpasso; niente altro si muove durante il gesto principale.

## 10. Grana e banding

Grana leggera sopra tutto (2–4%), cambiata 12 volte al secondo perché non sfarfalli:

```html
<svg class="grain" aria-hidden="true" width="1920" height="1080" style="position:absolute;inset:0;pointer-events:none">
  <filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="1"/></filter>
  <rect width="100%" height="100%" filter="url(#g)" opacity=".035"/>
</svg>
```

```js
const turb = document.querySelector('.grain feTurbulence');
comp.onFrame((t) => turb.setAttribute('seed', String(1 + Math.floor(t * 12))));
```

Contro il banding dei gradienti scuri: grana, gradienti meno estesi, `--crf` più basso all'export.

## 11. Motion blur

Solo all'export (`--motion-blur 8–16`, otturatore a 180°): sotto-fotogrammi mediati in luce lineare. Usalo sui gesti che schioccano (impatti, whip pan, rotazioni veloci), uno-tre momenti per pezzo. Mai su testo da leggere; inutile su dissolvenze e derive lente. Moltiplica per N il tempo di export.

## 12. Ritmo e musica

Nel build, `const beat = beats(100)` e `tl.from('.x', { … }, beat(4))` fanno cadere gli accenti sui battiti. I tagli cadono sul battere, gli impatti sonori sul fotogramma del contatto.
