# Verifica

Un agente non vede il movimento: vede fotogrammi. Il ciclo chiuso (rendere, guardare, misurare, correggere) è ciò che separa un primo tentativo mediocre da un risultato professionale. Leggi le trappole in fondo **prima** di costruire.

## Indice

1. Il ciclo
2. Guardare i fogli
3. Il check automatico
4. Passate limitate
5. Revisione di mestiere
6. Errori di metodo
7. Trappole tecniche
8. Il resoconto

## 1. Il ciclo

1. `frames comp.html` produce un foglio di contatto (istanti equidistanti, etichette, poster). Aggiungi `--onion A:B` per le pose sovrapposte di un movimento e `--strip A:B` per una transizione.
2. Guarda le immagini davvero, con lo strumento di visualizzazione.
3. `check comp.html` produce errori, avvisi e informazioni.
4. Correggi tutto in blocco e ricontrolla una volta.

## 2. Guardare i fogli

- **Foglio**: composizione di ogni istante, gerarchia, aree sicure, il poster è il momento migliore, l'ultimo fotogramma è pulito.
- **Onion skin**: la spaziatura tra le pose è la curva (pose fitte agli estremi vuol dire ease); le traiettorie disegnano archi o rette; gli elementi di un gruppo si sovrappongono o partono tutti insieme; la direzione rispetta la corrente.
- **Filmstrip**: il passaggio dura il giusto, il taglio cade a metà gesto, nessun fotogramma vuoto o doppio.
- Prima di correggere un difetto visto in miniatura, verificalo sull'immagine a piena risoluzione nella cartella dei fotogrammi.

## 3. Il check automatico

| Categoria | Cosa misura | Gravità |
|---|---|---|
| determinismo | lo stesso istante, raggiunto per strade diverse, dà gli stessi pixel | errore |
| font | carattere assente, non caricato, remoto, di sistema o generico | da errore a info |
| fotogramma, taglio | testo tagliato dal bordo o dal suo contenitore, se dura più di un campione | errore (transitorio: info) |
| area sicura | testo leggibile fuori dall'area dei titoli | avviso |
| dimensione | testo sotto la soglia pratica per il formato | avviso |
| sovrapposizione | testi leggibili che si coprono per più campioni | avviso |
| lettura | tempo leggibile inferiore a max(5/6 s, caratteri/17) | avviso |
| contrasto | sul vero sfondo dietro al testo (testo nascosto, fotogramma catturato) | errore se insufficiente nella maggior parte degli istanti; avviso se in pochi o solo su parte dello sfondo |
| lampeggi | più di 6 transizioni opposte in un secondo in una finestra di 1/36 del fotogramma (luminanza ≥ 10% con il lato scuro sotto 0,8; rosso saturo) | errore |
| movimento | timeline ferma; immagine ferma per almeno 2,5 s | errore / info |
| finale, loop | finale a metà gesto; giunzione del loop visibile | info / avviso |
| motore, console, risorse | avvisi del motore, errori di console, richieste fallite o remote | avviso / errore |

- Eccezioni volute, dichiarate sull'elemento: `data-allow="overlap safe contrast fast-text overflow frame"`.
- Il testo decorativo va marcato `aria-hidden="true"`: è escluso da lettura e contrasto.
- Il controllo dei lampeggi approssima WCAG 2.3.1 e non è una certificazione: per il broadcast serve uno strumento certificato.
- Un esito pulito con "unità di testo: 0" o con pochi campioni non vuol dire niente: leggi sempre la riga delle statistiche.

## 4. Passate limitate

Costruisci per intero; poi una sola passata di verifica raggruppata (fogli e check); correggi tutto in blocco; al massimo una seconda passata di conferma. Poi fermati e riporta ciò che resta aperto: l'auto-revisione infinita costa e non migliora il risultato.

## 5. Revisione di mestiere

Prima il giudizio (idea, gerarchia, ritmo), poi la checklist meccanica, così la checklist non condiziona il giudizio. Ogni rilievo va in una tabella Prima / Dopo / Perché. Ordine dei rimedi: togliere l'animazione → ridurla → sistemare curva e durata → gerarchia e tempi → origine e fisicità → profondità e movimento secondario → rifinitura (motion blur, grana, suono). Nel dubbio, la mossa più forte è spesso togliere.

## 6. Errori di metodo

- **Verificare la versione sbagliata**: dopo ogni modifica controlla che il file contenga il codice nuovo. Numeri identici a prima sono un indizio.
- **Patch troppo larghe**: cerca identificatori con confini di parola, non sottostringhe.
- **Metriche definite dopo averle lette**: decidi cosa misuri prima di guardare il risultato.
- **Fogli che distorcono**: il foglio mantiene le proporzioni; non giudicare cerchi e allineamenti da miniature deformate.
- **Sovrascrivere le modifiche dell'utente**: `init` non sovrascrive, `sync` tocca solo motore e audio; rileggi il file prima di modificarlo.
- **"Funziona" senza numeri**: riporta i valori che gli strumenti stampano.

## 7. Trappole tecniche

| Sintomo | Causa | Rimedio |
|---|---|---|
| Testo diverso nel video | carattere non incorporato | `fonts`, poi `check` |
| Fotogrammi diversi a ogni render | `Date.now`, casualità per fotogramma, accumuli, transizioni CSS, video | funzioni pure di t, `noise(t)` |
| Righe sbagliate | `split()` prima dei font | `split()` dentro `build()` |
| Frammenti di lettere a fine uscita | uscita sotto il 120% nelle maschere | ±120% o più |
| Colori spostati nel video | matrice YUV sbagliata | l'export usa BT.709 e lo verifica |
| Banding nei gradienti | 8 bit e compressione | grana, `--crf` più basso |
| Nessun suono in anteprima | nessun gesto, velocità diversa da 1× | clic su suono, velocità 1× |
| GIF pesante | troppi fotogrammi o colori | `--range`, `--gif-width`, `--fps` 15–20 |
| Export lento | molti fotogrammi, motion blur | `--range` per le prove, blur solo alla fine |
| Il check passa ma un testo non si vede mai | testo sempre trasparente o fuori scena | leggi le info "mai visibile" |

## 8. Il resoconto

```
Fatto: <cosa è cambiato, file principali>
Verificato: <con quale strumento, in quali condizioni, con quali numeri>
Dedotto o non verificato: <cosa, e perché> (l'ascolto, la fluidità a occhio nudo, browser diversi da Chromium)
Da decidere: <dipendenze, scelte di direzione>
```
