# Cronologia dei rami di questo fork

Questo documento traccia **in ordine cronologico** cosa cambia ogni ramo del fork `lr-24/firefly-iii-ai-categorize`
rispetto al precedente. Il progetto di partenza è il categorizzatore AI per Firefly III; le modifiche di questo fork
aggiungono la conferma manuale della categoria, la persistenza dei job e le correzioni descritte sotto.

Ultimo aggiornamento: 2026-10-10.

## Come sono nominati i rami

`NN-AAAA-MM-GG-descrizione`

- `NN` è il numero d'ordine (01, 02, …): ordinando l'elenco dei rami per nome si ottiene la successione cronologica.
- `AAAA-MM-GG` è la data dell'**ultimo commit** del ramo.
- `descrizione` è il nome originale del ramo (o una descrizione breve per i rami nuovi).

Per un ramo nuovo: usare il numero successivo all'ultimo in tabella e aggiornare questo documento nello stesso commit.

**`main` non è rinominato**: è la base del fork e il workflow `.github/workflows/main.yml` pubblica l'immagine Docker
solo per i push su `main` e per i tag `v*`; rinominarlo spegnerebbe quel workflow e cambierebbe il ramo predefinito.

## Tabella dei rami

| N. | Nome attuale | Nome precedente | Ultimo commit | Commit rispetto al precedente |
|---|---|---|---|---|
| 01 | `01-2024-08-13-lr-24-patch-1` | `lr-24-patch-1` | 2024-08-13 | 1 (staccato da `main` prima di 34 suoi commit) |
| 02 | `02-2024-08-14-patch-1` | `patch-1` | 2024-08-14 | 1 (idem) |
| – | `main` | `main` | 2024-08-15 | base del fork |
| 03 | `03-2024-08-15-user-input` | `user-input` | 2024-08-15 | 22 su `main` (11:46–15:11) |
| 04 | `04-2024-11-05-user-input-2` | `user-input-2` | 2024-11-05 | 115 su `main`, dalle 15:24 del 2024-08-15; **non contiene i commit di `03`** |
| 05 | `05-2025-02-09-user-input-3` | `user-input-3` | 2025-02-09 | 3 su `04` |
| 06 | `06-2025-02-10-user-input-4` | `user-input-4` | 2025-02-10 | 5 su `05` |
| 07 | `07-2025-10-08-user-input-5` | `user-input-5` | 2025-10-08 | 7 su `06` |
| 08 | `08-2026-10-10-do-not-change-applica-regole` | `fix-do-not-change-apply-rules` | 2026-10-10 | 2 su `07` (la correzione e questo documento) |
| 09 | `09-2026-10-10-job-senza-doppioni-e-falliti` | (nome nuovo) | 2026-10-10 | 3 su `08` |
| 10 | `10-2026-10-10-transazioni-eliminate-via-dai-lavori` | (nome nuovo) | 2026-10-10 | 1 su `09` |

Parentela (verificata con `git merge-base`): `01` e `02` sono modifiche isolate fatte dal sito di GitHub, staccate da
`main` prima di 34 suoi commit. `03` e `04` partono **entrambi da `main`** e non si contengono a vicenda: `04` è la linea
di lavoro che prosegue (iniziata il pomeriggio del 2024-08-15, dopo `03`). Da `04` in poi la storia è lineare: `05` contiene
`04`, `06` contiene `05`, e così via fino a `10`.

## Cosa cambia in ogni ramo

**01 – `lr-24-patch-1`** (2024-08-13). Una modifica a `src/OpenAiService.js` fatta dal sito di GitHub.

**02 – `patch-1`** (2024-08-14). Una modifica a `src/App.js` fatta dal sito di GitHub.

**`main`** (2024-08-15). Base del fork: il categorizzatore originale con il workflow di pubblicazione dell'immagine.

**03 – `user-input`** (2024-08-15). Prima versione dell'«input dell'utente»: quando l'AI non riesce a scegliere,
l'interfaccia mostra un modulo per scegliere la categoria a mano (evento `request-category-input`, invio a
`/category_input`). Il testo che si manda all'AI (`OpenAiService.js`) è riscritto. File: `src/App.js`,
`src/OpenAiService.js`, `public/index.html`.

**04 – `user-input-2`** (2024-11-05). Parte da `main` e non da `03`; rispetto al contenuto di `03` l'interfaccia diventa quella usata oggi: elenco delle categorie lette da
Firefly (`GET /categories`), menu a tendina con la categoria proposta dall'AI, pulsanti **Confirm** e
**Do not change**, aggiornamento in tempo reale dei job. In `FireflyService.js` compaiono la **categoria
provvisoria** (`setTempCategory`, salvata con `apply_rules: false`) e i tag `AI` / `Human`
(`FIREFLY_TAG_AI`, `FIREFLY_TAG_HUMAN`). File: `App.js`, `FireflyService.js`, `JobList.js`, `OpenAiService.js`,
`index.html`.

**05 – `user-input-3`** (2025-02-09). L'interfaccia mostra la data della transazione; il webhook ora richiede il
campo `date`.

**06 – `user-input-4`** (2025-02-10). Si usa `payment_date` se presente, altrimenti `date`.

**07 – `user-input-5`** (2025-10-08). **Ramo in uso sul server fino al 2026-10-10.** I job vengono salvati in
`jobs.json` e sopravvivono ai riavvii (se il file è montato come volume); i job conclusi si cancellano dopo 24 ore;
una `category_id` vuota (stringa) conta come «non impostata»; nuova regola per ripulire le descrizioni
(«PAGAMENTO POS … PRESSO»); il modello AI si legge da `OPENAI_MODEL`. File: `App.js`, `JobList.js`,
`OpenAiService.js`.

**08 – `do-not-change-applica-regole`** (2026-10-10). Corregge un difetto: con **Do not change** il categorizzatore
chiudeva il job senza avvisare Firefly. La categoria provvisoria dell'AI era salvata con `apply_rules: false`, quindi
le regole di Firefly che dipendono dalla categoria (per esempio quelle che aggiungono il tag della macro-categoria)
non giravano mai e la transazione restava senza quei tag. Ora **Do not change** su un job con una categoria dell'AI
rilegge da Firefly categoria e tag attuali e li risalva uguali con `apply_rules: true` (`FireflyService.applyRules`,
`App.js` → `setCategory`); le transazioni sparite o senza categoria vengono saltate. Il tag `AI` resta com'è.
Con **Confirm** non cambia nulla. File: `src/App.js`, `src/FireflyService.js`.

**09 – `job-senza-doppioni-e-falliti`** (2026-10-10). Sistema la coda dei lavori del categorizzatore.
(1) *Niente doppioni:* una transazione che ha già un lavoro non concluso (in coda, in corso, in attesa di revisione o
fallito) non ne riceve un secondo; lo script del venerdì che rilancia tutte le transazioni senza categoria prima ne
creava uno nuovo a ogni giro e la stessa transazione compariva più volte nell'interfaccia. (2) *I lavori falliti non
scadono più dopo 24 ore* (scadono solo quelli conclusi): un lavoro fallito aspetta una persona, che nell'interfaccia
può sceglierci la categoria o premere «Do not change». (3) *Nuovo tentativo automatico:* se arriva di nuovo il webhook
per una transazione il cui lavoro è fallito, lo stesso lavoro torna in coda con i dati nuovi. (4) *Ripresa dopo un
riavvio:* i lavori che erano in coda o in corso quando l'applicazione si è fermata tornano in coda (prima restavano
bloccati per sempre). La logica della coda è ora in un solo punto (`#enqueue`). File: `src/App.js`, `src/JobList.js`.

**10 – `transazioni-eliminate-via-dai-lavori`** (2026-10-10). Una transazione cancellata in Firefly sparisce anche dal
categorizzatore. (1) Ogni 30 minuti (e 1 minuto dopo l'avvio) i lavori non conclusi vengono confrontati con Firefly
(`GET /transactions/<id>`): se la transazione non esiste più (404) il lavoro viene tolto e l'interfaccia si aggiorna da
sola; se Firefly non risponde o dà un altro errore non si toglie nulla. (2) Se la transazione sparisce mentre si lavora
(404 nel salvataggio della categoria provvisoria, in **Confirm** o in **Do not change**) il lavoro viene tolto invece di
restare «fallito» o di dare un errore. Variabili facoltative: `RECONCILE_INTERVAL_MS` (30 minuti),
`RECONCILE_FIRST_DELAY_MS` (60 secondi). File: `src/App.js`, `src/JobList.js`, `src/FireflyService.js`
(`transactionExists`; `applyRules` ora restituisce `'gone'` se la transazione non esiste).

## Come tornare ai nomi precedenti

Con `gh` (login come proprietario del fork):

```bash
gh api -X POST repos/lr-24/firefly-iii-ai-categorize/branches/NOME-ATTUALE/rename -f new_name=NOME-PRECEDENTE
```

Per esempio `07-2025-10-08-user-input-5` → `user-input-5`. Chi ha costruito un'immagine da un indirizzo
`https://github.com/lr-24/firefly-iii-ai-categorize.git#NOME` deve aggiornare il `NOME` nel proprio `docker-compose.yml`
(sul server: `Firefly-AI-Categorize/docker-compose.yml`, riga `build:`).
