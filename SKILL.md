---
name: motion-craft
description: Motion graphic professionali generati come codice (HTML, CSS, SVG, JavaScript) su una timeline deterministica, con anteprima interattiva, verifica a ciclo chiuso e, solo su richiesta, audio sintetizzato ed export MP4, WebM, MOV con alfa, GIF o PNG. Copre direzione e storyboard, coreografia e tempi, testo cinetico, transizioni, morph, loop, dati animati, intro e sting del logo, splash animate, controlli di leggibilità, contrasto e lampeggi. Usa questa skill OGNI VOLTA che l'utente chiede un'animazione o un video animato, un motion graphic, un'intro, un logo animato, titoli o testo animati, un lower third, un explainer, un teaser o un promo, un post o reel animato, un loop, un grafico animato, un'animazione SVG, di dare movimento a una grafica, suoni per un'animazione o un export in MP4 o GIF — anche se non dice mai motion graphic. Non usarla per le microinterazioni della UI di un prodotto (frontend-craft) né per montare o generare video, foto, voci o musica reali.
---

# Motion Craft

Questa skill produce motion graphic professionali come codice — HTML, CSS, SVG e JavaScript su una timeline deterministica — e, solo su richiesta, li completa con audio sintetizzato e li esporta in video. È la sintesi verificata delle migliori skill di motion esistenti (Remotion, HyperFrames, GSAP, Emil Kowalski, LottieFiles, Motion) e del metodo di splash-studio: ne tiene il meglio, corregge ciò che le fonti primarie smentiscono e risolve i punti in cui si contraddicono. Provenienza e scelte sono in `FONTI.md`.

Il problema che risolve: il motion prodotto da un agente fallisce quasi sempre in uno di tre modi. **È generico**: curve predefinite, tutto che entra insieme, dissolvenze ovunque, nessuna idea. **È cieco**: generato senza guardarlo, perché un agente vede fotogrammi, non movimento. **È fragile e non misurato**: l'anteprima non coincide con il video, il testo non si legge, il carattere cambia da una macchina all'altra, un lampo supera le soglie di sicurezza, e nessuno se ne accorge. Ogni fase qui sotto chiude uno di questi buchi.

## Rapporto con le altre skill

- **frontend-craft** governa le animazioni dell'interfaccia di un prodotto (microinterazioni, transizioni tra stati della UI). Questa skill governa il motion come pezzo a sé: video, titoli, intro, loop, splash animate. Una splash che entra in un'app: l'animazione è di questa skill, il porting segue frontend-craft.
- **decision-principles** governa il modo di decidere; **dev-discipline** e **design-docs** valgono quando una composizione entra in un repository.
- Se l'utente sceglie una libreria (GSAP, Lottie, Three.js) e ne è installata la skill ufficiale, quella ha la precedenza sulla sua API; qui restano valide direzione, verifica e consegna.

Se questa skill e un'altra dicono cose diverse, esegui secondo la più specifica e segnala la divergenza all'utente.

## Principi, in ordine di precedenza

1. **Il brief e il progetto sono la fonte.** Brand, design system, palette e caratteri indicati dall'utente vincono sui default di questa skill.
2. **Un'idea, un motivo, un momento-firma.** Ogni movimento ha un perché raccontabile in una frase; il resto è decorazione, e la decorazione è ciò che l'utente chiama "random".
3. **Il tempo è l'unica fonte di verità.** Ogni fotogramma è una funzione pura di t: per questo anteprima, controlli e video coincidono, e la scena si scorre, si verifica e si esporta a qualsiasi fps.
4. **Leggibile prima che bello.** Tempo di lettura, contrasto, aree sicure, dimensioni, nessun lampeggio oltre le soglie.
5. **Guardato, non immaginato.** Nessuna consegna senza fotogrammi guardati e un check eseguito; nel resoconto si separano misurato, dedotto e non verificato.
6. **Media solo dal codice.** Niente servizi esterni che generano immagini, video, voci o musica; niente risorse remote nell'export. Il suono è sintetizzato, i caratteri sono incorporati.
7. **Prima l'anteprima, poi i file.** L'animazione si consegna come pagina interattiva; audio ed export solo quando l'utente li chiede.

## Il flusso

Le fasi sono in ordine, ma si itera: l'utente vede qualcosa a ogni passo. Mostra, non descrivere.

### 0. Brief

Ricava il più possibile dal contesto, poi chiedi solo ciò che manca, una domanda alla volta: cosa comunica e a chi; dove andrà (social verticale, sito, presentazione, montaggio); i testi; brand, palette e caratteri; durata; audio sì o no. Se l'utente non dice nulla: 1920×1080, 60 fps, durata dallo storyboard, nessun audio.

### 1. Direzione

Un'idea in una frase, un motivo, un momento-firma, un'anti-referenza; una personalità tradotta in token di curve e durate; palette per ruoli; uno o due caratteri. Quando la direzione è aperta proponi 2–3 direzioni davvero diverse, con una raccomandazione, e aspetta; per le scelte di dettaglio (una curva, una durata) decidi e motiva in una riga. → `references/direzione.md`

### 2. Storyboard a battute

Prima del codice, una tabella con tempo, cosa si vede, cosa si legge (con il budget di lettura) e suono, più la direzione dominante dei passaggi e i 2–3 tipi di transizione. Per pezzi oltre i 10 secondi o a più scene, fallo approvare.

### 3. Costruzione

```bash
python scripts/motion_tools.py init comp.html --size 16:9 --duration 8      # 9:16, 1:1, 4:5, 4k o LxA; --audio se serve
python scripts/motion_tools.py fonts comp.html --google "Inter"             # o --file per un carattere locale
```

Sostituisci la scena di esempio: prima lo stato finale con il layout, poi la timeline dentro `build()` con `scene()`, `from()` e i token. Non riscrivere il motore. API e regole di determinismo: `references/motore.md`. Ricette (testo, maschere, morph, camera, transizioni, dati, loop, particelle, grana): `references/tecniche.md`. Intro del logo e splash d'app: `references/intro-e-splash.md`.
Senza shell: copia `assets/template.html` e incolla `assets/motion-runtime.js` tra i marcatori `MC-RUNTIME`.

### 4. Verifica

```bash
python scripts/motion_tools.py frames comp.html --onion 1.2:2.0 --strip 3.0:3.8
python scripts/motion_tools.py check comp.html
```

Guarda davvero il foglio, l'onion skin e la filmstrip; leggi errori e avvisi del check; correggi tutto in blocco; al massimo una seconda passata. → `references/verifica.md`

### 5. Consegna

La composizione è un HTML autonomo: in claude.ai pubblicala come artifact; in un progetto mettila dove il progetto tiene questi asset. Allega il foglio di contatto quando aiuta a decidere. Chiudi con il resoconto (`references/verifica.md` § 8).

### 6. Su richiesta: audio ed export

- **Audio**: `comp.audio(...)`, poi `motion_tools.py audio comp.html` (WAV, misure, spettrogramma con i cue). Non puoi ascoltarlo: consegna il WAV e chiedi un giudizio. → `references/audio.md`
- **Export**: `motion_tools.py export comp.html` in mp4, webm, mov, gif o png, con `--audio`, `--limiter`, `--scale`, `--range`, `--motion-blur`. → `references/export.md`

## Come lavorare con l'utente

- A ogni iterazione l'utente vede il risultato (pagina, fogli, video): le sue reazioni valgono più di qualsiasi descrizione.
- Quando rifiuta, capisci il perché prima di rifare: "random", "robotico", "lento", "economico", "troppe cose" sono diagnosi precise (tabella in `references/direzione.md` § 9). Tieni un elenco dei rifiuti e non riproporli.
- Per le direzioni, 2–3 opzioni con una raccomandazione; per i ritocchi procedi.
- Rispetta le modifiche dell'utente: rileggi il file prima di modificarlo. `init` non sovrascrive; `sync` aggiorna solo motore e audio.
- Quando l'utente chiede un'opinione, dalla davvero, con condizioni e rischi.

## Strumenti

`scripts/motion_tools.py` richiede Python 3.9+, Playwright con Chromium, Pillow, NumPy e fontTools; ffmpeg per audio ed export. Se mancano, chiedi prima di installarli: è una modifica all'ambiente. Ogni sottocomando ha `--help`. Test: `python -m unittest discover -s scripts -p "test_*.py"` e `node --test scripts/test_runtime.mjs`.

| Comando | Fa |
|---|---|
| `init` | nuova composizione con motore (e audio) incorporati |
| `sync` | aggiorna motore e audio in una composizione esistente |
| `fonts` | incorpora un carattere (google/fonts o file locale), sottoinsieme latino |
| `frames` | fotogrammi, foglio di contatto, onion skin, filmstrip |
| `check` | determinismo, font, testo tagliato o sovrapposto, aree sicure, contrasto, lettura, lampeggi, movimento, finale |
| `audio` | WAV, loudness, livelli per cue, spettrogramma |
| `export` | mp4, webm, mov, gif, png, verificati su codec, colore, fotogrammi e sincronia |

Gli strumenti stampano numeri: riportali, non riassumerli in "funziona".

## Checklist di consegna

- [ ] Idea in una frase; personalità registrata come token; storyboard rispettato.
- [ ] Carattere incorporato; nessuna risorsa remota.
- [ ] Fotogrammi guardati: foglio, onion skin sui movimenti chiave, filmstrip sui passaggi.
- [ ] `check` senza errori; avvisi risolti o motivati; eccezioni dichiarate con `data-allow`.
- [ ] Poster sul fotogramma più leggibile; finale assestato, oppure loop senza giunzione.
- [ ] Audio, se richiesto: WAV consegnato e misure riportate.
- [ ] Export, se richiesto: i numeri della verifica riportati.
- [ ] Resoconto con verificato, dedotto e non verificato.
