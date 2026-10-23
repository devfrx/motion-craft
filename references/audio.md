# Audio

Sound design sintetizzato (`assets/motion-audio.js`): nessun file, nessun servizio esterno. La stessa partitura suona nell'anteprima (dopo un gesto dell'utente) e si rende offline per l'export, quindi ciò che misuri è ciò che consegni.

## Indice

1. Quando
2. Il progetto sonoro
3. API
4. Voci
5. Sincronia
6. Mix e livelli
7. Loudness all'export
8. Verifica

## 1. Quando

Solo se l'utente lo chiede. Incorpora il modulo (`init --audio` o `sync --audio`), poi scrivi `comp.audio(...)`. Nell'anteprima il suono parte muto: si attiva con il pulsante (M), suona solo a velocità 1×, e il player non prova a suonare prima di un gesto (i browser lo rifiutano e riempiono la console di avvisi).

## 2. Il progetto sonoro

Ciò che separa un suono professionale da beep sparsi:

- **una tonalità**: tappeto e campane nella stessa chiave;
- **una stanza**: un riverbero sintetico comune (`room({ size, mix })`);
- **una colla**: compressore leggero su tutto il mix, tetto di sicurezza a −3 dB;
- **stereo legato alla scena**: ciò che attraversa lo schermo attraversa i canali (`from` e `to` del whoosh);
- **un arco** che segue la storia, con il suono-firma nel silenzio e non sopra un tappeto pieno;
- **rumore con seme fisso**: due rendering sono identici.

## 3. API

```js
comp.audio((a) => {
  const t = comp.at('rivelazione');
  a.room({ size: 2.2, mix: 1 }).master({ gain: 0 });
  a.bed({ bpm: 100, key: 'A', mode: 'minor', progression: ['i', 'VI', 'III', 'VII'], style: 'pulse', level: -20 });
  a.whoosh(t - 0.4, { dur: 0.6, from: 0.5, to: -0.5 });
  a.riser(t, { dur: 1.2 });   // finisce esattamente sull'istante indicato
  a.hit(t, { weight: 'heavy' });
  a.shimmer(t + 0.4);
});
```

I tempi sono in secondi della composizione: usa `comp.at('etichetta', scarto)` e `Motion.beats(bpm)` invece di numeri scritti a mano, così suono e immagine non possono separarsi quando cambi la timeline.

## 4. Voci

| Voce | Uso | Parametri e predefiniti |
|---|---|---|
| `whoosh(t)` | passaggi, oggetti che attraversano | `dur` 0.6, `level` −10, `from` −0.4, `to` 0.4, `bright` 0.5 |
| `hit(t)` | impatti, arrivi, il marchio che si posa | `weight` soft, medium o heavy; `level` −4; `tone` 1 |
| `tick(t)` | clic d'interfaccia, piccoli arrivi | `pitch` 2400, `level` −16 |
| `pop(t)` | forme che nascono | `pitch` 750, `level` −12 |
| `riser(t)` | tensione che si risolve in t | `dur` 1.5, `note` 'C4', `level` −12 |
| `swell(t)` | aria che cresce fino a t e si interrompe | `dur` 1.5, `from` 300, `to` 3000, `level` −14 |
| `sub(t)` | caduta grave, peso | `dur` 1.4, `from` 110, `to` 38, `level` −6 |
| `bell(t)` | nota-firma, risoluzione | `note` 'E5', `ratio` 1.41 (vetro), 2 (legno), 3.01 (luccichio), 1 (morbido); `dur` 1.6; `level` −14 |
| `shimmer(t)` | luccichio, apparizione | `notes`, `spread` 0.06, `level` −18 |
| `tone(t)` | segnali semplici | `note`, `dur`, `type`, `glide`, `level` −14 |
| `pad(t)` | tappeto armonico | `dur` 4, `chord`, `cutoff` [400, 2400], `level` −22 |
| `bed({...})` | tappeto musicale a tempo | `bpm` 100, `key`, `mode` major o minor, `progression` in numeri romani, `style` 'pulse' o 'ambient', `from`, `to`, `level` −16 |

Il `bed` è un tappeto essenziale sotto l'immagine, non un brano: per musica vera serve un file fornito dall'utente. Generare musica con servizi esterni è fuori da questa skill per scelta.

## 5. Sincronia

- Gli impatti cadono sul fotogramma del contatto.
- Il whoosh è più forte al 60% della sua durata: fallo partire prima, in modo che il picco cada sul momento più veloce dell'immagine.
- `riser` e `swell` si posizionano sull'istante in cui si risolvono.
- Lascia silenzio prima dei momenti grandi: 200–400 ms di respiro danno forza all'impatto.
- Le code non coprono il momento successivo: accorcia campane e pad.

## 6. Mix e livelli

- **Gerarchia**: il culmine (`hit`) è il punto più forte; firma e risoluzione vengono subito dopo; la tessitura (`tick`, `pop`, `shimmer`) si sente ma resta discreta.
- Il tappeto sta sotto il resto (da −18 a −24); se c'è una voce dell'utente scende ancora.
- Il grave ha una leggera saturazione: le sue armoniche sono ciò che si sente sugli altoparlanti dei telefoni.
- Il picco del rendering resta intorno a −3 dBFS (il tetto della catena); la loudness si fissa all'export.

## 7. Loudness all'export

`export --audio --loudness web | streaming | broadcast | none [--limiter]`

| Preset | Integrata | True peak | Fonte |
|---|---|---|---|
| web | −14 LUFS | −1,5 dBTP | pratica comune per le piattaforme web (Spotify usa −14 come predefinito; YouTube abbassa soltanto) |
| streaming | −18 LUFS | −1 dBTP | EBU R 128 s2, valore provvisorio per lo streaming |
| broadcast | −23 LUFS | −1 dBTP | EBU R 128 |

- **Senza `--limiter`** il guadagno è solo lineare: niente compressione, niente "pompaggio". Se il true peak lo impedisce, l'export resta sotto il target e lo dice. Un mix di soli effetti, con impatti forti e pause, di solito si ferma intorno a −20 LUFS.
- **Con `--limiter`** un limitatore comprime i picchi fino a raggiungere il target (il guadagno viene corretto finché la loudness misurata è entro 0,3 LU). Decidilo con l'utente: si guadagna volume, si perde punch.
- Le specifiche delle piattaforme cambiano: verificale sulle pagine ufficiali quando la consegna è per una piattaforma precisa.

## 8. Verifica

Non puoi ascoltare. `motion_tools.py audio comp.html` rende il WAV e misura picco, true peak, loudness integrata, LRA, campioni oltre 0 dBFS e livelli per ogni cue. Lo spettrogramma ha i cue segnati in azzurro e l'inviluppo sotto: guarda che ogni suono cada sul suo segno e che nessuna coda copra il momento dopo. All'export, l'audio dentro il file viene confrontato per correlazione con il WAV di riferimento (scarto atteso: 0 ms).
Consegna il WAV: il giudizio finale è dell'utente. Chiedigli quale momento non lo convince.
