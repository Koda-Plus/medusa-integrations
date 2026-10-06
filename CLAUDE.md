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
- **Nazwa migracji (plik i klasa) musi być unikalna we WSZYSTKICH paczkach.** Medusa zapisuje wykonane migracje po samej nazwie we wspólnej tabeli `mikro_orm_migrations`, więc druga migracja o tej samej nazwie w innym module uchodzi za wykonaną i jej tabele nigdy nie powstają (06.10.2026: cztery paczki miały `Migration20261006090000`, na demo przeszła tylko OLX, BaseLinker padł na „relation baselinker_import does not exist”). Przed dodaniem migracji: `ls packages/*/src/modules/*/migrations/`.
- README każdej paczki BEZ tabel i z opcjonalnymi obrazkami (medusajs.com spłaszcza tabele). Obrazki z `raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/<paczka>/docs/`.
- Copy: angielski w kodzie i README, polski w `pl.ts` z pełnymi znakami diakrytycznymi. Nigdzie myślnika półpauzy, pauzy ani kropki środkowej.
- Polskie słowniki kończą się `export default typeset(pl)` (nasz skrypt bez sierotek, `nb()` w kicie), tekst spoza słowników (opisy i opinie referencji) idzie przez `nb()`.

## Strona w panelu (wspólny kit)

- `src/admin/lib/<ns>-guide.tsx` jest IDENTYCZNY w pięciu paczkach: zmieniasz w jednej, kopiujesz plik 1:1 do pozostałych i sprawdzasz `md5sum packages/*/src/admin/lib/*-guide.tsx`.
- Nagłówek każdej strony: tytuł z odznakami (tryb demo, zapisy), opis, pod nim odznaka „Działa w sklepach” i „Dodaj swój sklep” (formularz otwiera mail na `KODA_EMAIL` = hello@koda.plus). Po prawej Panel | Przewodnik, zębatka Ustawień i akcje, a pod nimi `HelpButtons`: „Kopiuj prompt” i „Pomoc na Discordzie” (`KODA_DISCORD`, oficjalny symbol z discord.com/branding, kolor Blurple). Napisy z bloku `community` w słownikach (te same klucze w pięciu paczkach, `communityLabels()`).
- Prompt składa `buildSetupPrompt()` w kicie (PL i EN, według języka panelu) z `usePromptSpec()` eksportowanego przez `<ns>-guide-view.tsx`: ta sama konfiguracja co w przewodniku plus przełącznik demo w wersji z medusa.koda.plus. Zmieniasz konfigurację w przewodniku, prompt idzie za nią. Prompt każe instalować paczkę z npm, więc u obcych zadziała dopiero po publikacji (do tego czasu kieruje do Koda Plus).

## Komendy

- `npm run check`: testy + typy we wszystkich paczkach. `npm run build`: `medusa plugin:build` w każdej. `npm run release`: publikacja na npm (patrz Publikacja).
- `npm run vendor`: kopia wszystkich wtyczek do `../koda-plus-demo/medusa-backend` (medusa.koda.plus). Potem w koda-plus-demo: commit + push na `main` = wdrożenie na Railway. Zmiana `package.json` backendu psuje cache Dockera, więc wtyczki NIE są tam zależnościami npm, tylko kodem aplikacji.
- Każda paczka: `npm install` (nie `npm ci`: skopiowany lockfile OLX bywał rozjechany), `npm test`, `npm run typecheck`, `npm run build`.

## Publikacja

- Repo `Koda-Plus/medusa-integrations` jest PUBLICZNE od 06.10.2026 (decyzja Remika, po audycie całej historii: bez sekretów, plików `.env`, danych klientów; wszystkie zrzuty w historii to dane demo). Wszystko, co tu trafia, jest od razu publiczne: żadnych tokenów, danych klientów ani zrzutów z prawdziwych sklepów.
- npm: `npm run release` publikuje pięć paczek po kolei (pomija wersje już opublikowane, więc można go ponowić). Wymaga `npm login` na koncie w organizacji npm `koda-plus`; konto i logowanie robi Remik, `npm publish` odpala testy i `medusa plugin:build` każdej paczki. Nowa wersja: podnieś `version` i CHANGELOG w paczce, potem `npm run release`.
- Katalog medusajs.com/integrations zbiera paczki z npm po słowach kluczowych `medusa-v2`, `medusa-plugin-integration` i kategorii (`medusa-plugin-other` dla OLX, Allegro, Fakturowni, `medusa-plugin-erp` dla BaseLinkera i Subiekta).
