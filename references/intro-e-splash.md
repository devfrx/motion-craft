# Intro, sting e splash

Il marchio che prende vita e la schermata d'avvio che passa all'app. Raccoglie il metodo maturato in splash-studio, la skill che questa sostituisce.

## 1. Sting e intro del logo

- **Tre atti**: genesi (da dove nasce: un seme, una linea, una moltitudine; è il più sacrificabile, tienilo breve), trasformazione (diventa forma: il culmine visivo e sonoro), rivelazione (il marchio, il suo momento-firma, il nome).
- **Durate**: sting 3–5 s; intro completa di un'app 5–7 s; intro breve circa 2 s.
- **Il momento-firma**, leve in ordine di forza: un momento "vivo" con chi guarda (uno sguardo tenuto mezzo secondo), un suono nel silenzio, un'interazione durante l'attesa, un gesto riusato che torna nell'uscita e nell'app, una rarità sottile.
- **Una battuta per tutto** (per esempio 400 ms): i tempi sono multipli della battuta, così movimento e suono suonano insieme.
- **Respiro**: 200–400 ms di quiete prima e dopo il momento-firma e dopo il culmine.
- **Lettere e nome**: le lettere che escono da dietro il marchio escono come un pezzo unico per lato, ritagliate al proprio bordo e interamente nascoste in partenza; la riga sotto entra dal centro verso l'esterno mentre la spaziatura si stringe.
- **Figure di sfondo**: poche, composte (non casuali), ai bordi, tenui, lontane dai momenti chiave.
- **Montaggio**: la prima versione ha quasi sempre troppe battute. Accorcia la genesi, dai respiro al momento-firma.
- Il marchio arriva dall'utente come SVG approvato: questa skill lo anima, non lo progetta.

## 2. Splash di un'app (la parte animata)

- **Stati**: intro → attesa (un loop senza giunture finché l'app non è pronta) → uscita (il gesto-firma porta via la splash). Errore se il servizio non risponde, con "Riprova". Dal secondo avvio l'intro è breve; la memoria "già vista" è legata alla versione dell'app.
- **Reduced motion**: si mostra l'ultimo fotogramma e niente si muove da solo.
- **Suono**: solo con l'intro completa e dopo un gesto, o con il permesso esplicito della finestra dell'app; mai con l'intro quotidiana.
- **Agganci per l'app**: `ready()`, `unanswered()` e un evento a fine uscita. Il timeout lo decide il client del servizio, non la splash.
- **Accessibilità**: una regione `role="status"` ("avvio in corso", l'errore, "pronto"); il nome del prodotto in testo; i livelli decorativi `aria-hidden`.

## 3. Costruirla con questa skill

- Intro e attesa sono composizioni: l'attesa con `loop: true`, verificata con `frames` e `check` come ogni altro pezzo.
- Il porting nell'app (stati, agganci, memoria della versione, permessi della finestra) segue frontend-craft e le regole del progetto; la macchina a stati si documenta come chiede design-docs.
- Nell'app vera, l'outro più solido è la UI reale in stato di caricamento invece di uno scheletro separato: è una decisione di struttura da proporre al momento del porting.
