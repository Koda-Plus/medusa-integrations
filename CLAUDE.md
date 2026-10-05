# CLAUDE.md — medusa-integrations

Monorepo integracji Koda Plus dla Medusy v2 (`Koda-Plus/medusa-integrations`). Pięć paczek npm, każda publikowana i listowana na medusajs.com/integrations osobno:

| Paczka | Namespace | Moduł (klucz kontenera) | Kategoria w katalogu |
| --- | --- | --- | --- |
| `packages/medusa-plugin-olx` | `olx` | `olx` | Other |
| `packages/medusa-plugin-allegro` | `allegro` | `allegro` | Other |
| `packages/medusa-plugin-baselinker` | `baselinker` | `baselinker` | ERP |
| `packages/medusa-plugin-subiekt-nexo` | `subiekt` | `subiekt_nexo` | ERP |
| `packages/medusa-plugin-fakturownia` | `fakturownia` | `fakturownia` | Other |

Mostek Subiekta (.NET 8, Sfera) to OSOBNE, komercyjne repo `Koda-Plus/subiekt-nexo-bridge` (lokalnie `Desktop/koda/subiekt-nexo-bridge`). Kontrakt `packages/medusa-plugin-subiekt-nexo/contract/` jest źródłem prawdy, mostek trzyma jego kopię.

## Skąd to się wzięło

- OLX, Allegro, BaseLinker: uogólnione z integracji klienta OponyKola (Moto M5, `clients/oponykola/apps/backend`). Allegro i OLX tam tylko czytają; BaseLinker tam jest hubem (zamówienia do BL dokładnie raz, statusy i numery przesyłek z powrotem, stany z BL na planie).
- Fakturownia: uogólnione z produkcyjnej integracji Crème Bar (`Desktop/cremebar/cremebar/apps/backend/src/modules/fakturownia`), z poprawkami: stan we własnych tabelach zamiast `order.metadata`, unikalny wiersz na zamówienie i rodzaj dokumentu, atomowe przejęcie wiersza, wyszukiwanie po `?oid=` przed każdym wystawieniem, stawki VAT z linii podatkowych Medusy. Notatki o API (zweryfikowane w dokumentacji): `packages/medusa-plugin-fakturownia/docs/fakturownia-api-notes.md`.
- Subiekt nexo: uogólnione z produkcyjnego mostka Crème Bar (`Desktop/cremebar/NexoMedusaBridge`, v1.2.3), z odwróconą architekturą (Medusa ciągnie zdarzenia i stany, mostek nie ma klucza admina).
- Historia OLX i Subiekta przeniesiona przez `git subtree` (stare `koda-plus-demo/packages/medusa-plugin-olx` i repo `Koda-Plus/medusa-plugin-subiekt-nexo` są zastąpione tym monorepo).

## Konwencje (twarde, od nich zależy skrypt kopiowania)

- Pliki poza katalogami namespace mają przedrostek namespace: `jobs/<ns>-*`, `subscribers/<ns>-*`, `admin/widgets/<ns>-*`, `admin/lib/<ns>-*`. Katalogi: `modules/<ns>`, `workflows/<ns>`, `api/admin/<ns>`, `api/store/<ns>`, `api/hooks/<ns>`, `api/<ns>`, `admin/routes/<ns>`.
- i18n admina: `src/admin/i18n/{index,en,pl}.ts`, przestrzeń nazw = namespace, komponenty `useTranslation("<ns>")`. `pl.ts` typowany przez `en.ts`.
- Serwis modułu CIENKI: wygenerowany CRUD + opcje + maskowanie. Logika w `lib/*` i `workflows/*`, które wołają `svc.listX()` z zewnątrz. Własne metody serwisu wołające `this.listX()` wywalają się na demo (błąd `fork`, patrz `koda-plus-demo/CLAUDE.md`).
- Brak opcji nigdy nie wywraca startu. Tryb demo: dane z katalogu sklepu przez te same parsery, wiersze z flagą `demo`.
- Migracje pisane ręcznie z `create table if not exists`. `model.bigNumber` wymaga kolumny `raw_`, więc używamy `number`/`json`.
- README każdej paczki BEZ tabel i z opcjonalnymi obrazkami (medusajs.com spłaszcza tabele). Obrazki z `raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/<paczka>/docs/`.
- Copy: angielski w kodzie i README, polski w `pl.ts` z pełnymi znakami diakrytycznymi. Nigdzie myślnika półpauzy, pauzy ani kropki środkowej.

## Komendy

- `npm run check`: testy + typy we wszystkich paczkach. `npm run build`: `medusa plugin:build` w każdej.
- `npm run vendor`: kopia wszystkich wtyczek do `../koda-plus-demo/medusa-backend` (medusa.koda.plus). Potem w koda-plus-demo: commit + push na `main` = wdrożenie na Railway. Zmiana `package.json` backendu psuje cache Dockera, więc wtyczki NIE są tam zależnościami npm, tylko kodem aplikacji.
- Każda paczka: `npm install` (nie `npm ci`: skopiowany lockfile OLX bywał rozjechany), `npm test`, `npm run typecheck`, `npm run build`.

## Publikacja (czeka na decyzję Remika)

Repo na GitHubie i paczki na npm (scope `@koda-plus`) NIE są jeszcze publiczne. Deck dla zespołu Medusy (`clients/medusa/oferta`) ma przełącznik `PUBLISHED`, który pokazuje linki do npm i GitHuba dopiero po publikacji.
