# Export

Solo quando l'utente lo chiede in modo esplicito ("esporta", "fammi l'MP4", "una GIF"), di solito dopo aver approvato l'anteprima: rendere costa tempo, e l'anteprima interattiva è il luogo dove si decide.

## Indice

1. Formati
2. Comandi
3. Risoluzione e fps
4. Colore
5. Trasparenza
6. Motion blur
7. Cosa verifica l'export
8. Tempi
9. Piattaforme

## 1. Formati

| Formato | Uso | Dettagli |
|---|---|---|
| `mp4` (predefinito) | social, web, presentazioni | H.264 4:2:0, crf 18, tune animation, faststart, colore BT.709 taggato; audio AAC 192 kb/s |
| `webm` | web, anche con alfa per le sovrapposizioni | VP9 (alfa se lo sfondo è trasparente); audio Opus |
| `mov` | montaggio (Premiere, Resolve, Final Cut) | ProRes 422 HQ; ProRes 4444 con alfa se lo sfondo è trasparente; audio PCM 24 bit |
| `gif` | anteprime leggere, README | palette in due passate, larghezza ≤ 960 px, ≤ 25 fps, loop infinito; niente audio |
| `png` | sequenza per altri programmi | un file per fotogramma, con alfa se trasparente |

## 2. Comandi

```bash
python scripts/motion_tools.py export comp.html                           # MP4 alla risoluzione e agli fps della composizione
python scripts/motion_tools.py export comp.html --audio                   # con il suono, loudness web, solo guadagno lineare
python scripts/motion_tools.py export comp.html --audio --limiter         # raggiunge il target comprimendo i picchi
python scripts/motion_tools.py export comp.html --format mov              # ProRes (4444 con alfa se lo sfondo è trasparente)
python scripts/motion_tools.py export comp.html --format gif --range 2:5 --gif-width 720
python scripts/motion_tools.py export comp.html --scale 2                 # 3840×2160 da una composizione 1920×1080
python scripts/motion_tools.py export comp.html --motion-blur 12          # motion blur vero, otturatore a 180°
python scripts/motion_tools.py export comp.html --fps 30                  # il tempo è continuo: qualsiasi fps
```

Per le prove usa `--range` su un tratto breve; il pezzo intero solo alla fine.

## 3. Risoluzione e fps

- A scala 1 un px della composizione è un pixel del video. `--scale 2` raddoppia tutto: testo e vettori restano nitidi, le immagini raster servono al doppio della risoluzione.
- 24 fps per un taglio cinematografico, 30 per social e web, 60 per prodotto e interfacce fluide. La composizione è a tempo continuo, quindi esportare a un fps diverso da quello di lavoro è lecito; con `posterize` il passo resta legato all'fps della composizione.
- MP4 e WebM in 4:2:0 vogliono lati pari: lo strumento si ferma e lo dice.

## 4. Colore

Le catture sono sRGB. La conversione verso YUV usa la matrice BT.709 e il file è taggato BT.709: senza, molti lettori applicano la BT.601 e i colori si spostano, soprattutto rossi e verdi. Lo strumento confronta due fotogrammi del file con la cattura diretta (PSNR, scarto medio, deriva media per canale) e segnala uno scarto alto. Contro il banding: grana leggera nella composizione e `--crf` più basso (14–16).

## 5. Trasparenza

`background: 'transparent'` in `Motion.create` → `mov` (ProRes 4444) o `webm` (VP9 con alfa). MP4 e GIF non hanno alfa: lo sfondo diventa nero e lo strumento avvisa. Per decodificare l'alfa di un WebM con ffmpeg serve il decoder `libvpx-vp9` (`-c:v libvpx-vp9` prima di `-i`); ffprobe lo mostra come yuv420p perché l'alfa viaggia a parte.

## 6. Motion blur

`--motion-blur N` cattura N sotto-fotogrammi dentro l'intervallo dell'otturatore (`--shutter`, 180° predefinito, centrato sul fotogramma) e li media in luce lineare. Non si vede nell'anteprima e moltiplica per N il tempo di export. Quando usarlo: tecniche.md § 11.

## 7. Cosa verifica l'export

- Codec, dimensioni, fps, numero di fotogrammi rispetto all'atteso, tag di colore, durata e peso.
- Confronto di due fotogrammi del file con la cattura diretta (MP4 e WebM senza alfa né motion blur).
- Con l'audio: loudness prima e dopo, guadagno applicato e modalità (lineare o limitatore); allineamento dell'audio nel file rispetto al WAV di riferimento, per correlazione.

Riporta i numeri, non "funziona".

## 8. Tempi

La cattura avviene un fotogramma alla volta: circa 0,13–0,2 s per fotogramma a 1080p su una macchina modesta, quindi un paio di minuti per 10 s a 60 fps. Il motion blur moltiplica per i suoi campioni. Avvisa l'utente prima di export lunghi.

## 9. Piattaforme

Durate massime, fps consigliati, aree coperte dall'interfaccia e loudness cambiano spesso: verificali sulle pagine ufficiali quando la consegna è per una piattaforma precisa, invece di affidarti alla memoria.
