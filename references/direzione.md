# Direzione

Le decisioni che rendono un motion graphic professionale invece che generico: idea, personalità, racconto, coreografia, tempi, tipografia, colore, composizione. Leggilo prima di costruire un pezzo nuovo o quando l'utente rifiuta un risultato.

## Indice

1. Dal brief all'idea
2. Personalità: sei preset di partenza
3. Racconto e storyboard a battute
4. Coreografia
5. Tempi e curve
6. Tipografia in movimento
7. Colore e superficie
8. Composizione e formati
9. Diagnosi dal feedback
10. Difetti tipici

## 1. Dal brief all'idea

- **Un'idea in una frase**, prima di animare ("i dati scorrono e si fermano sul numero che conta"). Senza idea il movimento è decorazione, e la decorazione è ciò che l'utente chiama "random".
- **Un motivo**: un gesto che ritorna (una linea che si disegna e diventa la base del testo, un taglio diagonale). La ripetizione costruisce identità.
- **Un momento-firma**: si ricorda una cosa sola; tutto il resto le cede spazio.
- **Un'anti-referenza**: cosa evitare ("niente estetica HUD", "niente rimbalzi").
- **Il brief vince sul gusto**: palette, caratteri e riferimenti dati dall'utente si seguono anche quando coincidono con un default che altrimenti eviteresti. Brand e design system, se esistono, sono la fonte dei token.

## 2. Personalità: sei preset di partenza

Le tabelle di durata per l'interfaccia (100–300 ms) non valgono qui: chi guarda non sta agendo, i fotogrammi sono grandi e leggere richiede tempo. Questi valori (in secondi) sono punti di partenza: tieni un preset per il 90% del pezzo e prendi in prestito da un altro solo per un momento preciso.

| Preset | Entrata | Curve enter / exit / move | Stagger | Sorpasso | Tratti |
|---|---|---|---|---|---|
| Editoriale | 0,8–1,1 | `cubic-bezier(0.16, 1, 0.3, 1)` / `(0.7, 0, 0.84, 0)` / `(0.65, 0, 0.35, 1)` | 0,08–0,12 per riga | 0 | maschere di riga, molto respiro, serif display |
| Prodotto / tech | 0,5–0,7 | `(0.23, 1, 0.32, 1)` / `(0.55, 0, 1, 0.45)` / `(0.77, 0, 0.175, 1)` | 0,04–0,07 | 0–3% | spinta sull'asse della corrente, griglia, dettagli mono |
| Giocoso | 0,4–0,6 | `back.out(1.6)` o `spring(0.45)` / `in.back(1.2)` / `spring(0.3)` | variato (random con seme) | 10–20% | squash & stretch sugli impatti, colori pieni |
| Premium / cinematico | 1,0–1,6 | `(0.4, 0, 0.2, 1)` / `(0.4, 0, 1, 1)` / `(0.45, 0, 0.55, 1)` | 0,12–0,2 | 0 | dissolvenze con blur 8→0, scala 0,98→1, tracking ampio |
| Energico / social | 0,25–0,45 | `out.expo` / `in.expo` / `(0.87, 0, 0.13, 1)` | 0,02–0,04 | 10–20% sugli accenti | tagli sul battito, testo cinetico, motion blur all'export |
| Istituzionale | 0,6–0,8 | `(0.2, 0, 0, 1)` / `(0.3, 0, 1, 1)` / `(0.2, 0, 0, 1)` | 0,06–0,08 uniforme | 0 | prevedibile e chiaro, nessun effetto gratuito |

Registra la scelta come token in `Motion.create({ eases: { enter, exit, move, emphasis, settle } })` e usa i nomi dei token nei tween: la personalità cambia in un punto solo.

## 3. Racconto e storyboard a battute

- **Struttura**: apertura (aggancio nei primi 1–2 s, soprattutto sui social) → sviluppo → payoff (il momento-firma) → risoluzione o invito. Proporzioni indicative: 20–30% preparazione, 30–40% azione, 30–40% risoluzione.
- **Una scena, un'idea.** Se una scena deve dire due cose, sono due scene.
- **Storyboard prima del codice**: una tabella con tempo, cosa si vede, cosa si legge, suono. Cambiarlo lì costa poco.
- **Budget di lettura**: un testo resta leggibile almeno max(5/6 s, caratteri/17), il limite dei sottotitoli per adulti della guida Netflix. Per i titoli in movimento è un minimo, non un obiettivo: dai di più ai messaggi chiave. Il `check` lo misura.
- **Durate tipiche**: sting o logo 3–5 s, bumper 6 s, post social 6–15 s, scena di un explainer 4–8 s.

## 4. Coreografia

- **Un punto focale alla volta.** Con tre o più elementi animati, al massimo un terzo in movimento insieme: l'elemento 1 si assesta mentre parte il 3.
- **L'eroe guida**: spostamento maggiore e curva più marcata; il resto è più sobrio in ogni dimensione.
- **Origine coerente**: gli elementi di un gruppo entrano dalla stessa direzione.
- **La corrente**: scegli una direzione dominante per i passaggi (per esempio verso sinistra) e usala sempre. Le altre direzioni sono riservate e significano qualcosa: verso l'alto una conclusione, uno zoom in avanti un approfondimento, uno zoom indietro un arrivo.
- **Legge del vettore ai tagli**: stesso asse, stesso verso, velocità simile, taglio a metà gesto su entrambi i lati (uscita in accelerazione, entrata in decelerazione). Per la scala la direzione è il segno della variazione: crescere è avanzare.
- **Moto causale**: ogni movimento è lanciato dal precedente (clic → schiacciamento → volo → impatto → rimbalzo) e la reazione parte nello stesso fotogramma della causa.
- **Sovrapposizione e trascinamento**: i figli seguono con 50–150 ms di ritardo; niente parte e arriva nello stesso istante di tutto il resto.
- **Contro-movimento leggero**: se l'eroe entra da destra, lo sfondo scorre del 20–30% nel verso opposto.
- **Quiete prima del culmine**: 0,3–0,75 s di fermo tra l'azione e il suo risultato.
- **Niente riempitivi**: oscillazioni che esistono solo perché la scena è finita prima del tempo leggono come "il video aspetta". Accorcia la scena o aggiungi racconto. Il movimento d'ambiente è legittimo quando è il contenuto (loop, sfondi) o il carattere (un marchio vivo), a bassa ampiezza e in periferia.
- **Uscite** circa al 65–75% della durata dell'entrata; elementi simili condividono curva e durata.
- **Budget di transizioni**: 2–3 tipi di passaggio per pezzo, ripetuti.

## 5. Tempi e curve

- **Durata e distanza**: più strada vuol dire più tempo, ma meno che in proporzione (50 px ×0,8; 100 px ×1; 300 px ×1,5; tutto lo schermo ×1,8–2).
- **Curve per direzione**: entrata ease-out forte; uscita ease-in (nessuno aspetta una risposta: accelerare via è giusto); movimento sullo schermo ease-in-out; loop sine; rotazioni continue e scorrimenti linear.
- Le curve CSS predefinite sono deboli: usa quelle dei token. **Mai linear su uno spostamento** nello spazio: sembra robotico.
- **Molle** per elementi "vivi", impatti e gesti: `spring(0)` assesta senza sorpasso, `spring(0.2–0.35)` dà un accenno. La durata del tween è il tempo fino al riposo: l'arrivo visivo cade a circa metà.
- **Sorpasso**: 0% premium e istituzionale, 3–10% prodotto, 10–20% giocoso e celebrazioni; oltre il 25% sembra rotto.
- **Archi**: curve diverse su x e y (x `out.quad`, y `in.quad`) disegnano una traiettoria curva. Il moto organico non va in linea retta.
- **Scala percettiva**: il motore interpola la scala in modo geometrico, così uno zoom 1→4 sembra a velocità costante.
- **Posterizzazione** (`posterize: 2`) per un effetto passo uno, solo se è la direzione scelta.
- **Rimbalzi ed elastici** solo nel preset giocoso; altrove sembrano economici.

## 6. Tipografia in movimento

- Al massimo due famiglie; meglio il contrasto di peso che quello tra famiglie. Incorpora sempre il carattere (`motion_tools.py fonts`).
- Titoli grandi: tracking da −0,02 a −0,045 em. Maiuscoletto e etichette: da +0,15 a +0,35 em.
- **Dimensioni minime** (regola pratica; il `check` avvisa): in 16:9 a 1080 righe almeno circa 24 px; in verticale 1080×1920 almeno circa 38 px per il testo da leggere.
- Rivela per righe o per parole. Le lettere solo per parole brevi e marchi: dividere in lettere perde la crenatura tra le coppie.
- Una tecnica di rivelazione per pezzo, ripetuta.
- Niente `<br>` nel testo corrente: le righe le decide la larghezza (`text-wrap: balance` per i titoli).
- Numeri: `font-variant-numeric: tabular-nums` e locale esplicita (`count(..., { locale: 'it-IT' })`).
- Testo sopra immagini o sfondi animati: il `check` misura il contrasto sullo sfondo reale.

## 7. Colore e superficie

- Palette per ruoli: sfondo, superficie, testo, testo attenuato, un accento (un secondo solo se ha un ruolo).
- Evita #000 e #fff puri: un nero caldo o freddo e un bianco sporco reggono meglio la compressione e l'occhio.
- Contrasto: 4,5:1 per il testo normale, 3:1 per quello grande (≥ 24 px, o ≥ 18,7 px in grassetto).
- I colori sono interpolati in oklab (con `color-mix`): niente toni fangosi a metà transizione. Contro il banding dell'H.264 aggiungi grana leggera (tecniche.md § 10).
- Trasparenza come consegna: `background: 'transparent'` → MOV ProRes 4444 o WebM con alfa.

## 8. Composizione e formati

- **Aree sicure**: titoli dentro l'area grafica (EBU R 95: 5% per lato; azione 3,5%). Per il verticale social il preset `social` approssima le zone coperte dall'interfaccia delle app: verifica le specifiche correnti della piattaforma quando contano.
- **Griglia**: margini laterali 120–170 px a 1920; terzi; spazio negativo generoso; un solo elemento dominante per inquadratura.
- **Profondità con la velocità**: primo piano 1×, piano medio 0,5×, fondo 0,2× dello spostamento.
- **Progetta per il formato, non ritagliare**: 16:9 (1920×1080), 9:16 (1080×1920), 1:1, 4:5. Più formati: una composizione per formato con gli stessi token.

## 9. Diagnosi dal feedback

| L'utente dice | Causa probabile | Correzione |
|---|---|---|
| "Random", "senza senso" | manca l'idea o il motivo | riparti dalla frase e dal gesto ricorrente |
| "Robotico" | linear, tempi uniformi, tutto sincrono, linee rette | curve dei token, stagger, sfasamenti di 50–150 ms, archi |
| "Lento" | durate oltre il budget, pause senza scopo, troppa preparazione | entrate più corte, scene sovrapposte, genesi tagliata |
| "Frenetico", "troppo veloce" | testo che non si legge, niente pause | budget di lettura, quiete prima del culmine |
| "Economico", "piatto" | solo dissolvenze, nessun movimento secondario, curve deboli, nessuna profondità | maschere, trascinamento, parallasse, curve forti |
| "Statico" | nessuna vita tra entrata e uscita | camera con intenzione, rivelazioni scaglionate (non oscillazioni) |
| "Troppe cose" | più eroi insieme | un eroe per momento, regola del terzo, montaggio |
| "Distrae" | ambiente troppo ampio o veloce | 10–20% di ampiezza, più lento, in periferia |
| "Lo fa in un momento a caso" | movimento senza causa o fuori ritmo | causa visibile, battuta, sincronia con il suono |
| "Scatta", "salta" | stato non deterministico, uscita non oltre la maschera | `check` (determinismo), uscite ≥ 120% nelle maschere |

Correggi la causa, non il sintomo, e tieni un elenco dei rifiuti per non riproporli.

## 10. Difetti tipici (cercali prima di consegnare)

- tutto entra insieme; durate uguali per tutto; curve predefinite o linear;
- solo dissolvenze; testo o pannelli che nascono da `scale(0)`;
- nessuna pausa per leggere, oppure pause morte riempite di oscillazioni;
- direzioni che fanno ping-pong tra una scena e l'altra; più di tre tipi di transizione;
- dissolvenza incrociata come passaggio standard (non ha un vettore);
- rimbalzi ovunque; sorpassi incoerenti tra elementi simili;
- testo sopra sfondi movimentati senza controllo del contrasto;
- motion blur su testo da leggere;
- finale tagliato a metà gesto.
