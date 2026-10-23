# Fonti, scelte e limiti

Documento per chi mantiene la skill, non da caricare durante il lavoro. Tutto è riscritto in italiano: dalle fonti si riprendono idee, soglie e fatti tecnici, non testo. Motore, modulo audio e strumenti sono codice nuovo.

## Provenienza (fonti primarie lette il 03/10/2026)

| Fonte | Repo @ commit | Licenza | Cosa è stato preso |
|---|---|---|---|
| Remotion Agent Skills | remotion-dev/skills @ 0b5db9d (01/10/2026) | nessun file di licenza nel repo | il tempo come unica fonte dello stato, interpolazioni con estremi bloccati, molla come curva su un intervallo, scala percettiva (geometrica), posterizzazione, "preserva le modifiche dell'utente", anteprima prima del render, render solo su richiesta esplicita |
| HyperFrames | heygen-com/hyperframes @ 6149ec8 (03/10/2026) | Apache-2.0 | "seek, non play"; divieti di determinismo; stato finale costruito con il layout; niente transform CSS in conflitto con i tween; niente `<br>` nel testo; spazio per i picchi; check con persistenza (un solo campione = transitorio), eccezioni dichiarate sull'elemento, rifiuto di una timeline ferma; contrasto sul testo visibile; motion blur solo sui gesti che schioccano. Dalla motion-doctrine interna: legge del vettore, corrente, portatori, moto causale, quiete prima del culmine, tempi di uscita, budget di transizioni |
| GSAP AI Skills | greensock/gsap-skills @ aed9cfd (21/04/2026) | MIT | API della timeline (to, from, fromTo, parametro di posizione, etichette, stagger con from, grid e amount), alias delle trasformazioni in ordine fisso, autoAlpha, transform e opacity per le prestazioni, letture e scritture raggruppate |
| Skill di Emil Kowalski | emilkowalski/skills @ e8a175d (02/10/2026) | MIT | curve forti al posto delle predefinite (0.23, 1, 0.32, 1 e 0.77, 0, 0.175, 1), mai scale(0) per testo e pannelli, gerarchia dei rimedi (prima togliere), revisione Prima / Dopo / Perché, revisione al rallentatore, vocabolario degli effetti |
| motion-design-skill | LottieFiles/motion-design-skill @ f9a8a04 (18/05/2026) | MIT | archetipi di personalità e mescola 90/10, scala durata-distanza, uscite al 65–75%, budget di sorpasso, regola del terzo, coreografia (eroe, origine, contro-movimento, profondità per velocità), fasi della sequenza, diagnosi dei difetti |
| Motion AI Kit (/motion) | motiondivision/ai-kit @ d1c5c26 (25/09/2026) | MIT dichiarata nei package.json, nessun file LICENSE | molla parametrizzata da durata e bounce, campionamento delle curve in CSS `linear()` |
| splash-studio (skill dell'utente, ritirata) | — | — | storia in tre atti, momento-firma e leve di memorabilità, battuta unica, respiro, occhi e gesti, lettere e nome, figure di sfondo, montaggio, stati della splash, ricette delle voci sintetizzate, stanza e colla, obiettivi di mix, rendering audio offline, errori di metodo nella verifica |

Altre verifiche su fonti primarie (03/10/2026): WCAG 2.3.1 e definizioni di general flash e red flash (W3C, Understanding); EBU R 95 (aree sicure 3,5% e 5% per lato) e SMPTE ST 2046-1 (93% e 90%); EBU R 128 (−23 LUFS, −1 dBTP) e R 128 s2 (−18 LUFS provvisorio per lo streaming); guida Netflix ai sottotitoli (fino a 17 caratteri al secondo per gli adulti, durata minima 5/6 s). Ambiente di prova: Chromium 141 (color-mix, proprietà di trasformazione individuali e `linear()` supportati), ffmpeg 6.1 con libx264, libvpx-vp9, prores_ks e libopus, Python 3.12, Node 22.

## Divergenze tra le fonti e come sono state risolte

| Tema | Posizioni | Scelta |
|---|---|---|
| Motore | Remotion: React e numero di fotogramma. HyperFrames: GSAP in pausa. splash-studio: Web Animations con persist(). GSAP: timeline imperativa | Motore proprio a funzioni pure del tempo con API alla GSAP: niente dipendenze né licenze, niente trappole di Web Animations (persist, play che riavvolge, chiavi allo stesso istante), niente stato nascosto dei from() di GSAP |
| Animazioni CSS | Remotion: non si renderizzano, vanno riscritte | Sincronizzate al tempo con currentTime: il modo in cui Claude anima di solito resta valido |
| Durate | Emil e LottieFiles: UI sotto i 300 ms. HyperFrames: entrata entro circa 800 ms | Scala da motion graphic, 0,25–1,6 s secondo il preset: chi guarda non agisce. Le regole dell'interfaccia restano a frontend-craft |
| ease-in in uscita | Emil: mai ease-in sulla UI. LottieFiles e HyperFrames: uscite in accelerazione | In un pezzo non interattivo le uscite accelerano; nella UI vale Emil |
| Movimento d'ambiente | HyperFrames: vietato l'idle wobble. splash-studio: mai statico. LottieFiles: aggiungi ambiente | Niente riempitivi; ambiente lecito quando è il contenuto o il carattere, a bassa ampiezza; il check segnala le immagini ferme solo come info |
| Dissolvenza incrociata | HyperFrames: mai | Rara, solo premium o cinematico, breve, con un blur come ponte |
| Motion blur | Remotion: 180°, 8 campioni. HyperFrames: 720°, 16 campioni | 180° centrato (convenzione del cinema), campioni scelti all'export, media in luce lineare |
| Effetti sonori | Remotion: file remoti, compresi suoni meme | Sintetizzati in locale, deterministici |
| Opzioni di direzione | Emil: mai un menu di opzioni. splash-studio: 2–3 opzioni per la direzione | Opzioni solo per la direzione aperta; curve e durate si decidono e si motivano |
| Contrasto | HyperFrames: errore. WCAG: 4,5:1 e 3:1 | Misurato sullo sfondo reale dietro al testo; errore se insufficiente nella maggior parte degli istanti, avviso se in pochi |
| Loudness | piattaforme diverse, EBU diverso | tre preset dichiarati; di default solo guadagno lineare, limitatore su richiesta |

## Correzioni al report di partenza

- Le skill di Emil Kowalski sono a e8a175d (02/10/2026), non a d16ebe6.
- Motion AI Kit non ha un file LICENSE: la MIT è dichiarata solo nei package.json.
- HyperFrames contiene una skill chiamata `motion-graphics` e LottieFiles una cartella `motion-design`: per questo questa skill si chiama `motion-craft`.
- Gli effetti sonori delle skill di Remotion sono URL remoti su remotion.media, compresi suoni meme.
- L'ultimo commit di gsap-skills è del 21/04/2026.

## Escluso, e perché

- Lottie Creator MCP, LottieFiles MCP, Rive MCP: dipendono da applicazioni e servizi esterni.
- Catalogo e registry di HyperFrames, media-use, voci e immagini generate: servizi o asset esterni, fuori dal perimetro scelto dall'utente.
- Remotion Studio, Lambda e Player: richiedono un progetto React e, oltre le 3 persone, una licenza a pagamento.
- MotionScore e le funzioni di Motion+: a pagamento.
- Lo studio del marchio statico di splash-studio (costruzione geometrica, tavola di studio): non è motion.

## Non letto (limiti di questa sintesi)

La maggior parte dei file delle skill di HyperFrames (tecniche, catalogo delle transizioni, regole, blocchi del registry); le regole di Remotion oltre a SKILL.md, timing, sfx, motion-blur e transitions; RECIPES e STANDARDS di Emil; i pattern di LottieFiles oltre a quelli citati; i reference di Motion oltre a SKILL.md e css-spring.

## Come è stata verificata

- 11 test sul motore (`node --test scripts/test_runtime.mjs`) e 14 sugli strumenti (`python -m unittest discover -s scripts -p "test_*.py"`).
- Una composizione con difetti voluti: il check ha trovato lampeggi, stato non deterministico, font assente, testo tagliato dal bordo e dal contenitore, area sicura, testo piccolo, lettura troppo rapida, sovrapposizioni, contrasto, refuso nel selettore e finale a metà gesto.
- Un teaser di 9,5 s a tre scene con audio: il check ha trovato tempi di lettura insufficienti e un finale ancora in movimento, corretti; export MP4 con 570 fotogrammi su 570, colore BT.709, PSNR 40–43 dB rispetto alla cattura diretta, audio allineato a 0 ms; GIF, sequenza PNG, MOV ProRes 4444 e WebM VP9 con alfa reale; player provato in Chromium (riproduzione, pausa, fotogramma per fotogramma, guide, velocità, marcatori, reduced motion, embed).

## Limiti noti

- Il controllo dei lampeggi approssima WCAG 2.3.1 (finestre fisse, media di luminanza): per il broadcast serve uno strumento certificato.
- Il contrasto di testo a gradiente (`background-clip: text`) va giudicato a vista.
- Il morph ricampionato tratta le forme a più sottopercorsi come una linea sola.
- Export e check catturano un fotogramma alla volta: circa 0,13 s di sola cattura per fotogramma a 1080p nel container di prova, circa 2 minuti per 10 s a 60 fps. Il determinismo permetterebbe un render in parallelo, non implementato.
- Il tappeto musicale è essenziale: non sostituisce musica vera. Livelli e timbri delle voci non sono stati ascoltati da nessuno.
- Provato solo in Chromium e su Linux; Safari, Firefox, Windows e macOS non provati.

## Come aggiornare

Riclona i repo della tabella e confronta i file usati con i commit indicati: SKILL.md e remotion-markup/{SKILL,timing,sfx,motion-blur,transitions}.md di Remotion; hyperframes-core/{SKILL.md, references/determinism-rules.md}, hyperframes-cli/{SKILL.md, references/lint-validate-inspect.md}, hyperframes-animation/references/motion-blur.md e .claude/skills/motion-doctrine/SKILL.md di HyperFrames; gsap-core, gsap-timeline e gsap-performance; animate, review-animations e animation-vocabulary di Emil; director/motion-personality, reference/timing-easing-tables, reference/troubleshooting e director/choreography di LottieFiles; plugins/motion/skills/motion/{SKILL.md, css-spring/index.md} di Motion. Riverifica sulle fonti primarie ogni fatto versionato prima di cambiarlo. Dopo una modifica al motore: test, `sync` sulle composizioni esistenti, `check`.
