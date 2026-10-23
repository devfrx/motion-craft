# Il motore

`assets/motion-runtime.js`, incorporato nella composizione da `motion_tools.py init` o `sync`. Ogni fotogramma è una funzione pura del tempo: per questo anteprima, controlli e video vedono la stessa cosa.

## Indice

1. Struttura della composizione
2. Motion.create
3. build() e gli aiuti
4. Timeline
5. Valori e proprietà animabili
6. Curve
7. Stagger
8. split()
9. Regole di determinismo
10. Integrazioni
11. Player e modalità
12. Il contratto per gli strumenti
13. Trappole

## 1. Struttura della composizione

```html
<style>/*MC-FONTS:BEGIN*/ … /*MC-FONTS:END*/  token per ruolo · stato finale costruito con il layout</style>
<main id="stage" data-motion-stage> … la scena … </main>
<script>/*MC-RUNTIME:BEGIN*/ … /*MC-RUNTIME:END*/</script>
<script>/*MC-AUDIO:BEGIN*/ … /*MC-AUDIO:END*/</script>   <!-- vuoto se non c'è audio -->
<script> const comp = Motion.create({ … }); comp.build(({ tl, split }) => { … }); </script>
```

- Lo stage è dimensionato in px della composizione: a scala 1, un px è un pixel del video. L'anteprima lo scala per stare nella finestra.
- Il CSS descrive lo stato finale; i tween partono da lì (`from()`) e ci tornano.
- Non mettere `transform` nel CSS degli elementi che animi con trasformazioni: per centrare usa il layout o un contenitore. Il motore conserva un transform statico a sinistra della propria catena, ma un'animazione CSS sullo stesso transform vince sempre.

## 2. Motion.create(config)

| Chiave | Predefinito | Note |
|---|---|---|
| `width`, `height` | 1920, 1080 | px della composizione |
| `fps` | 60 | dell'export; l'anteprima scorre in tempo reale |
| `duration` | — | dichiarala; se manca, fine dell'ultimo tween (con avviso) |
| `background` | — | colore o `var(--…)`; `'transparent'` per l'alfa |
| `poster` | la durata | il fotogramma più leggibile: reduced motion e anteprime |
| `loop` | false | il `check` verifica la giunzione |
| `safe` | `'broadcast'` | `'broadcast'` (EBU R 95), `'social'` (approssimato), `'none'` |
| `eases` | enter, exit, move, emphasis, settle, linear | i token della personalità |
| `defaults` | `{ duration: 0.6, ease: 'enter' }` | per i tween che non li indicano |
| `controls`, `autoplay` | true, true | `controls: false` = incorporata senza barra |
| `seed` | 1 | casualità riproducibile (`Math.random` diventa deterministico) |
| `posterize` | 1 | 2 = un fotogramma sì e uno no |
| `stage` | `#stage` | selettore o elemento |

Token predefiniti: enter `cubic-bezier(0.23, 1, 0.32, 1)`, exit `cubic-bezier(0.55, 0, 1, 0.45)`, move `cubic-bezier(0.77, 0, 0.175, 1)`, emphasis `back.out(1.5)`, settle `spring(0.3)`.

## 3. build() e gli aiuti

`comp.build(({ tl, split, at, random, noise, wiggle, beats, lerp, clamp, mapRange, comp }) => { … })` gira dopo il caricamento di font e immagini: misure e righe sono quelle vere.

Altri metodi: `comp.audio(fn)`, `comp.onFrame(fn)`, `comp.at(etichetta, scarto)`, `comp.seek(t)`, `comp.play()`, `comp.pause()`.
Fuori dalla composizione: `Motion.wiggle(t, { freq, amp, seed, octaves })`, `Motion.noise(x, seed)`, `Motion.random(seed)`, `Motion.beats(bpm, offset)`, `Motion.physicalSpring({ stiffness, damping, mass })`, `Motion.toLinear(curva)`.

## 4. Timeline

| Metodo | Uso |
|---|---|
| `to(target, vars, pos)` | verso i valori indicati |
| `from(target, vars, pos)` | dai valori indicati allo stato del CSS |
| `fromTo(target, da, a, pos)` | estremi espliciti |
| `set(target, vars, pos)` | cambio istantaneo |
| `scene(nome, pos, s => …)` | sotto-timeline con tempi locali, etichetta e marcatore nel player |
| `label(nome, pos)` | etichetta |
| `custom(fn, { duration, ease }, pos)` | `fn(p)` a ogni fotogramma con p da 0 a 1: imposta lo stato da p, non accumulare |
| `count(target, { from, to, duration, ease, decimals, locale, prefix, suffix }, pos)` | numero animato |

**Posizioni**, come in GSAP: numero assoluto; niente = fine della timeline; `'+=0.5'` o `'-=0.2'` rispetto alla fine; `'<'` inizio del precedente; `'>'` fine del precedente; `'<0.3'`, `'>-0.2'`; `'etichetta'`, `'etichetta+=0.4'`. Dentro `scene()` i tempi sono locali.

**Opzioni** nei vars: `duration`, `ease` (anche un array, una curva per segmento di keyframe), `stagger`, `delay`, `repeat` (−1 = fino alla fine), `yoyo`, `repeatDelay`, `times` (per i keyframe), `perceptual` (false = scala lineare), `morphPoints`.

**Valori**: `x: 100` (verso), `x: [0, 100]` (da–a), `scale: [0, 1.12, 1]` (keyframe equidistanti, oppure `times: [0, .7, 1]`), funzioni `(i, el, els) => valore` (una per elemento). Un tween successivo sulla stessa proprietà parte dal valore che la traccia ha in quell'istante; se due tween si sovrappongono vince quello iniziato dopo.

## 5. Valori e proprietà animabili

| Famiglia | Proprietà | Note |
|---|---|---|
| Trasformazioni | `x`, `y`, `z` (px o %), `xPercent`, `yPercent`, `rotate`, `rotateX`, `rotateY`, `skewX`, `skewY`, `scale`, `scaleX`, `scaleY`, `transformPerspective` | catena fissa: translate → rotate → skew → scale |
| Opacità | `opacity`, `autoAlpha` | `autoAlpha` aggiunge `visibility: hidden` a 0 |
| Filtri | `blur` (px), `brightness`, `contrast`, `saturate`, `grayscale`, `sepia`, `invert`, `hueRotate` | |
| Colori | `color`, `backgroundColor`, `fill`, `stroke`, `borderColor`… | interpolati con `color-mix` in oklab; `var()` ammesso |
| CSS | qualsiasi proprietà in camelCase | numeri senza unità = px, tranne quelle adimensionali |
| Stringhe complesse | `clipPath`, `boxShadow`, `backgroundPosition`, `fontVariationSettings`… | stessa struttura, numeri interpolati |
| Variabili CSS | `'--wght': [300, 800]` | |
| Attributi | `'attr:r'`, `'attr:viewBox'` | SVG e DOM |
| `draw` | 0–1 | tracciati SVG (usa `pathLength = 1`) |
| `d` | stringa o `'#idDelPath'` | morph |
| `text` | stringa | macchina da scrivere se una è prefisso dell'altra |

## 6. Curve

`linear`; `ease`, `ease-in`, `ease-out`, `ease-in-out`; `cubic-bezier(…)`; `steps(n[, start | end | none | both])`; famiglie `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `back`, `elastic`, `bounce` con direzione `in`, `out`, `inOut` in entrambi gli ordini (`out.expo`, `expo.out`, `power3.inOut`, `back.out(1.7)`, `elastic.out(1, 0.3)`); `spring(bounce)` con bounce da 0 a 0,95; i token.
Una curva sconosciuta produce un avviso e ripiega su `out.cubic`. `Motion.physicalSpring(...)` restituisce `{ duration, ease }` da spargere nel tween; `Motion.toLinear(curva)` restituisce una funzione CSS `linear()` per usare molle e curve nelle `@keyframes`.

## 7. Stagger

`stagger: 0.05` oppure `{ each | amount, from: 'start' | 'center' | 'end' | 'edges' | 'random' | indice, grid: [righe, colonne] | 'auto', axis: 'x' | 'y', ease }`. `random` è deterministico.

## 8. split()

`split(target, 'words' | 'chars' | 'lines' | 'lines,words' | 'words,chars')` oppure `split(target, { type, mask: 'lines' | 'words' | 'chars' })` restituisce `{ lines, words, chars, masks, elements }`.

- Solo dentro `build()`, quando i font sono caricati.
- Conserva gli elementi in linea annidati (`em`, `strong`, `span` con classe).
- Il testo intero resta in `aria-label`; i pezzi sono `aria-hidden`.
- Con le maschere, entrate e uscite di almeno ±120%: la maschera ha un margine per non tagliare ascendenti e discendenti.
- Passa a `tl` gli array (`title.lines`), non l'oggetto.

## 9. Regole di determinismo

- Niente `Date.now()` o `performance.now()` nello stato visivo.
- `Math.random` è reso deterministico all'avvio; per valori che cambiano a ogni fotogramma usa `noise(t)` o `wiggle(t)`, non `random()`.
- `custom()` e `onFrame()` impostano lo stato da t o da p: mai accumulare (`x += …`).
- Le animazioni CSS `@keyframes` e SMIL sono sincronizzate al tempo: partono tutte a t = 0, quindi usa `animation-delay`. Le transizioni CSS sugli elementi animati vengono disattivate dal motore, con un avviso.
- Niente `<video>` (non si sincronizza fotogramma per fotogramma), niente risorse remote, niente stato di hover o di scroll.
- `call()` non esiste: usa `custom()`.

Il `check` verifica il determinismo raggiungendo lo stesso istante per strade diverse.

## 10. Integrazioni

- **CSS `@keyframes` e SVG SMIL**: funzionano così come sono, sincronizzati.
- **Canvas**: `comp.onFrame((t) => draw(t))`, con `draw` funzione pura del tempo.
- **Three.js**: renderer con `preserveDrawingBuffer: true`; nell'`onFrame` posiziona camera e oggetti da t e chiama `renderer.render()`.
- **GSAP**: una timeline in pausa e `comp.onFrame((t) => gtl.seek(t))`, con `gsap.ticker.lagSmoothing(0)`. La licenza è gratuita anche per uso commerciale, ma vieta strumenti visuali no-code concorrenti di Webflow.
- **Lottie**: lottie-web con i dati JSON incorporati e `anim.goToAndStop(t * 1000, false)` nell'`onFrame`.

Ognuna è una dipendenza: proponila all'utente, non aggiungerla di nascosto. Per l'export offline va incorporata nel file; nelle pagine pubblicate di claude.ai gli script esterni si caricano solo dai CDN ammessi.

## 11. Player e modalità

Barra dell'anteprima: ▶/❚❚ (spazio), tempo e fotogramma, slider con i marcatori delle scene, ⟲ ripeti (L), velocità 1×, 0,5×, 0,25×, ▦ aree sicure e terzi (G), suono (M; solo se c'è audio, parte muto). Frecce: un fotogramma; Maiusc + frecce: un secondo; Home e Fine.
Con `prefers-reduced-motion` parte ferma sul poster, con il pulsante "Riproduci".
`?embed` o `controls: false`: incorporata senza barra (clic per pausa). `?export` o `window.__MOTION_EXPORT__ = true`: la modalità degli strumenti (niente player, il tempo lo decide chi chiama).

## 12. Il contratto per gli strumenti

`window.__motion`: `ready`, `error`, `version`, `width`, `height`, `fps`, `duration`, `loop`, `poster`, `safe`, `safeAreas`, `transparent`, `labels`, `scenes`, `warnings`, `hasAudio`, `cues`, `stageElement`, `seek(t)`, `renderAudio(opts)`, `audioChunk(i)`. Lo usano `frames`, `check`, `audio` ed `export`.

## 13. Trappole

| Sintomo | Causa | Rimedio |
|---|---|---|
| Il tween non fa niente | selettore sbagliato (il motore avvisa) | correggi il selettore |
| Frammenti di lettere a fine uscita | uscita sotto il 120% in una maschera | ±120% o più |
| Un elemento non si muove | transform su un elemento inline | `display: inline-block` o `block` |
| Un elemento va a scatti in anteprima | transizione CSS sulla stessa proprietà | il motore la disattiva; toglila dal CSS |
| Il transform del CSS non si vede | animazione CSS sul transform dello stesso elemento | usa un contenitore |
| Elementi pulsanti tagliati | spazio calcolato sulla posa a riposo | lascia spazio per il picco |
| Righe sbagliate | `split()` prima del caricamento dei font | chiamalo dentro `build()` |
| Morph aggrovigliato | forme con più sottopercorsi | forme con gli stessi comandi, o a un solo sottopercorso |
| `draw` rompe un tratteggio | `draw` usa `pathLength = 1` e `stroke-dasharray` | non combinarlo con un tratteggio |
| Testo diverso nel video | carattere non incorporato | `fonts`, poi `check` |
