# Wygląd stron wtyczek: zasady i przeróbka

Jeden wygląd wszystkich stron Koda Plus w panelu Medusy. Klocki są w kicie (`kit/admin/guide.tsx`, `kit/admin/blocks.tsx`, `kit/admin/kit.tsx`), w paczce jako `src/admin/lib/<ns>-guide.tsx`, `<ns>-blocks.tsx`, `<ns>-kit.tsx`. Kopii nie edytujemy: zmiana w `kit/`, potem `npm run kit:sync`.

Wzory do podglądania: **Kupony** (`packages/medusa-plugin-coupons`, lista z akcjami wiersza, kafelki), **Stripe** (`packages/medusa-plugin-stripe`, nagłówek, sekcje z hasłami, karta zamówienia), **Kredyt kupiecki** (`packages/medusa-plugin-trade-credit`, hasła reguły, ustawienia tylko do odczytu), **E-maile** (`packages/medusa-plugin-emails`).

## Zasady

- **Hasła zamiast zdań.** Opis strony, sekcji i pustego stanu to `KeyPoints`: 2 do 6 słów, ikona z `@medusajs/icons`, jeden rząd (przewija się w bok). Zdaniem zostają tylko: błąd, potwierdzenie, podpowiedź pod jednym polem formularza. Pełne zdanie może zostać jako `label` haseł (dymek i czytnik ekranu).
- **Kolor tylko, gdy coś znaczy.** Jedna paleta (`Tone`): zielony ok, pomarańczowy uwaga, czerwony błąd, niebieski informacja, szary neutralnie, fioletowy tylko wyróżnienie (premium, wiersz przykładowy), nigdy stan. Pomarańcz i czerwień tylko, gdy jest coś do zrobienia (`n > 0`).
- **Kolory z klas `ui-*`** (`text-ui-fg-subtle`, `bg-ui-tag-green-bg`...): działa motyw jasny i ciemny. Bez `#hex`, bez `bg-white`/`text-black` (wyjątki: znaki firm, np. Discord). Klasy pisane w całości, nigdy sklejane (`text-ui-tag-${x}-icon` nie wygeneruje się).
- **Akcje widoczne.** Żadnych menu „Więcej akcji”, „…”, `DropdownMenu` z akcjami. Nagłówek: przyciski obok głównego. Wiersz: ikony z `title` (`RowActions`).
- **Nagłówki jednakowe.** Kolorowa ikona modułu, tytuł, plakietki stanu, hasła, zakładki Panel / Przewodnik / Ustawienia z ikonami, akcje po prawej w szarym pasku. „Odśwież” zawsze pierwsza z akcji, „Otwórz w usłudze” jako główna albo ostatnia. Bez „by Koda Plus” (kit 1.3.0 już go nie rysuje; prop `by` można usunąć).
- **Filtry list** to przyciski ikona + nazwa + licznik (`FilterButton`), grupy rozdziela `FilterDivider`. Drugi klik w aktywny filtr go zdejmuje. Bez pigułek tekstowych, bez `Tabs` jako filtrów.
- **Wyszukiwarka** to `SearchInput` (`type="search"`: lupka i krzyżyk rysuje Medusa). Placeholder mówi, po czym szuka: „Numer zamówienia, e-mail, NIP”. Zapytanie do API po `useDebouncedValue`.
- **Puste stany:** ikona i hasło (`EmptyState`, w tabeli `EmptyTableRow`), nigdy pusta tabela ani akapit.
- **Ładowanie:** krótki odczyt `KitLoading` / `KitSkeletonRows`, ponowny odczyt `KitFetchingBar`, długi bieg z etapami `StagedLoader`. Nigdy „brak danych” przed przyjściem danych.
- **Sieroty (PL).** `pl.ts` kończy się `export default typeset(pl)`: twarda spacja po jednoliterowych słowach i krótkich spójnikach, liczba z jednostką razem. Tekst spoza słownika przez `nb()`.
- **Teksty nie brzmią jak AI.** Bez „z łatwością”, „kompleksowo”, „w jednym miejscu”, bez wyliczanek po przecinku w opisie. Konkret: co, skąd, kiedy. Bez półpauz, pauz i kropek środkowych.
- **Bez ozdobników.** Żadnych krótkich grubych kresek, belek akcentu, gradientów pod tytułem.
- **PL i EN zawsze razem.** Każdy klucz w `en.ts` i `pl.ts` (pl typowany przez en). Klocki kitu biorą teksty z propsów; własne słowa kitu (loader, „Szukaj”) są w kicie po polsku i angielsku.

## Klocki

Nagłówek i hasła (`<ns>-guide.tsx`):

```tsx
<IntegrationHeader
  icon={<StripeIcon width={28} height={28} />}
  title={t("title")}
  badges={<ModeBadge color="green" label={t("mode.live")} />}
  description={t("subtitle")}
  points={[
    { icon: <Eye />, text: t("points.readOnly"), tone: "blue" },
    { icon: <CreditCard />, text: t("points.payments") },
    demo && { icon: <Beaker />, text: t("points.demo"), tone: "orange" },
  ]}
  help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
  view={nav.view}
  onView={(v) => nav.go(v)}
  labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
  primary={{ key: "open", label: t("actions.open"), icon: <ArrowUpRightOnBox />, onClick: open }}
  actions={[{ key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: q.isFetching, onClick: () => void q.refetch() }]}
/>
```

`KeyPoints` przyjmuje też `false`/`null` (warunek w miejscu) i `title` dla jednego hasła.

Sekcja, filtry, wyszukiwarka, tabela (`<ns>-blocks.tsx`):

```tsx
<Section
  id="stripe-payments"
  icon={<CreditCard />}
  title={t("payments.title")}
  points={[{ icon: <BarsArrowDown />, text: t("payments.points.newest") }, { icon: <CursorArrowRays />, text: t("payments.points.row") }]}
  actions={<SearchInput value={q} onChange={setQ} placeholder={t("payments.search")} />}
>
  <FilterBar>
    <FilterButton icon={<ListBullet />} label={t("filter.all")} count={c.all} active={f === "all"} onClick={() => setF("all")} />
    <FilterDivider />
    <FilterButton icon={<ExclamationCircle />} label={t("filter.failed")} count={c.failed} attention active={f === "failed"} onClick={() => toggle("failed")} />
  </FilterBar>
  <KitFetchingBar active={list.isFetching && !list.isLoading} />
  <Table>
    ...
    {rows.length === 0 && !list.isLoading ? <EmptyTableRow cols={6} icon={<CreditCard />} title={t("payments.empty")} /> : null}
    {rows.map((r) => (
      <Table.Row key={r.id} onClick={() => openRow(r)}>
        ...
        <Table.Cell><ToneBadge tone={toneOfStatus(r.status)}>{t(`status.${r.status}`)}</ToneBadge></Table.Cell>
        <Table.Cell className="text-right">
          <RowActions actions={[
            { key: "copy", label: t("actions.copy"), icon: <SquareTwoStack />, onClick: () => copy(r) },
            { key: "open", label: t("actions.openInStripe"), icon: <ArrowUpRightOnBox />, href: r.url, external: true },
            { key: "cancel", label: t("actions.cancel"), icon: <XCircle />, danger: true, hidden: !r.cancelable, onClick: () => cancel(r) },
          ]} />
        </Table.Cell>
      </Table.Row>
    ))}
  </Table>
</Section>
```

Kafelki (pod nagłówkiem w tym samym `Container` albo pod tytułem sekcji):

```tsx
<StatTiles columns={5}>
  <StatTile label={t("tiles.all")} value={n.all} active={f === "all"} onClick={() => setF("all")} />
  <StatTile label={t("tiles.failed")} value={n.failed} hint={t("tiles.failedHint")} tone={n.failed ? "red" : "grey"} active={f === "failed"} onClick={() => toggle("failed")} />
</StatTiles>
```

Strona szczegółu (jeden rekord): `SubpageHeader` z `back={{ href: "/app/<ns>", label: t("back") }}`, ikoną, tytułem, plakietkami, hasłami i akcjami.

Długi bieg (raport, import, synchronizacja): serwer trzyma stan `StageRun`, strona go odpytuje; bieg liczony na stronie składa `runFromSteps(...)`.

```tsx
<StagedLoader run={run} stages={[
  { key: "orders", name: t("run.orders"), short: t("run.ordersShort"), icon: <ShoppingCart />, weight: 60 },
  { key: "docs", name: t("run.docs"), short: t("run.docsShort"), icon: <DocumentText />, weight: 40 },
]} columns={4} onRetry={restart} />
```

Spis propsów:

- `FilterButton { icon, label, count?, active, attention?, onClick, title?, disabled? }`, `FilterDivider`, `FilterBar { children }`
- `SearchInput { value, onChange(value), placeholder?, className?, autoFocus?, label? }`, `useDebouncedValue(value, ms = 300)`
- `ToneBadge { tone?, children, icon?, dot?, title?, size? }`, `toneOfStatus(status)`, typ `Tone`
- `Section { id?, icon?, title, badges?, points?, pointsLabel?, description?, actions?, children }`
- `SubpageHeader { icon?, title, badges?, points?, pointsLabel?, back?, actions?, children }`
- `StatTiles { columns?: 2..7 }`, `StatTile { label, value, hint?, tone?, icon?, active?, onClick?, title? }`
- `EmptyState { icon?, title?, points?, action?, compact? }`, `EmptyTableRow { cols, ...EmptyState }`
- `RowActions { actions: RowAction[] }`, `RowAction { key, label, icon, onClick?, href?, external?, disabled?, loading?, danger?, hidden? }`
- `StagedLoader { run, stages, doneTitle?, columns?: 3..6, onRetry? }`, `runFromSteps`, `formatDuration`

## Przeróbka wtyczki krok po kroku

1. `npm run kit:sync` (kit 1.3.0 lub nowszy w paczce).
2. **Nagłówek:** strona na `IntegrationHeader` (moduły bez niego: przenieść ręczny nagłówek). Usunąć `by={t("by")}`. Ikona modułu 28 px, kolorowa. Plakietki stanu przez `ModeBadge` (z dymkiem, gdy tryb demo albo brak ustawień).
3. **Hasła:** `subtitle` zostaje jako `description` (dymek), na ekranie `points` z `points.*` w `en.ts`/`pl.ts`: 3 do 6 haseł, ikony, kolor tylko znaczący.
4. **Zakładki:** `usePageNav` i widoki Panel / Przewodnik / Ustawienia (etykiety z ikonami rysuje kit). Ustawienia przez `SettingsView`, przewodnik przez `GuideSteps`, `GuideChecklist`, `GuideFaq`.
5. **Akcje:** wszystkie widoczne. `primary` jedna, reszta w `actions` (Odśwież pierwsza). Usunąć `DropdownMenu`/`EllipsisHorizontal` z akcjami, w wierszach `RowActions`.
6. **Filtry:** `FilterPills`, `Segment`, `Tabs` nad listą zamienić na `FilterBar` + `FilterButton` z licznikami (`attention` dla rzeczy do zrobienia), grupy przez `FilterDivider`. Filtr i wyszukiwanie czytane z `?filter=` i `?q=` (linki z liczników kontraktu).
7. **Wyszukiwarka:** `SearchInput`, bez własnej ikony lupy nad polem, placeholder mówi, po czym szuka.
8. **Plakietki:** stany przez `ToneBadge` (albo `toneOfStatus` + własna etykieta z i18n). Jedno znaczenie koloru w całej wtyczce, fiolet tylko wyróżnienie.
9. **Sekcje:** każda karta listy na `Section` (ikona, tytuł, hasła, akcje po prawej, bez `max-w-*` na opisie).
10. **Kafelki:** lokalne `StatTile`/`Tile` zastąpić klockiem kitu (`StatTiles` + `StatTile`). Klikalny kafelek = filtr listy niżej, z `active`.
11. **Puste stany:** `EmptyState` / `EmptyTableRow` z ikoną i hasłem zamiast `EmptyLine`/`EmptyRow` ze zdaniem.
12. **Ładowanie:** `KitLoading` przy pierwszym odczycie, `KitSkeletonRows` w tabeli, `KitFetchingBar` przy odświeżaniu, `StagedLoader` przy biegu dłuższym niż kilka sekund.
13. **Teksty PL/EN:** zdania w opisach zamienić na hasła, zostawić zdania tylko w błędach, potwierdzeniach i podpowiedziach pól. `pl.ts` przez `typeset`, tekst spoza słownika przez `nb()`. Bez półpauz.
14. **Karty na stronach zamówienia, produktu, klienta:** `WidgetFrame` + `hostable`, nagłówek karty: ikona modułu, tytuł, `ToneBadge` stanu; fakty jako krótkie wiersze, akcje widoczne (`RowActions` albo małe przyciski), pusty stan jednym hasłem, linki do strony wtyczki z `?q=`.
15. Sprawdzić w obu motywach (jasny, ciemny) i na wąskim ekranie; `npm test`, `npm run typecheck` w paczce, `npm run check` w repo.

## Lista do przeróbki (stan 2026-10-22)

Najpierw moduły bez wspólnego nagłówka, potem najwięksi „odstający”. Żadna z 15 wtyczek poza wzorami nie ma jeszcze haseł (`points`) w nagłówku ani w sekcjach.

Priorytet 1, strona bez `IntegrationHeader` (ręczny nagłówek z „by Koda Plus / opis”, bez zakładek):
- **Lojalność** (`loyalty`): nagłówek, zakładki, `StatTile` i `EmptyLine` z `loyalty-ui` na klocki, wyszukiwarki bez `type="search"`, nagrody jako `ToneBadge`.
- **Opakowania** (`packaging`): to samo; lista produktów jako `Section` z `SearchInput` (7 pól `Input`, żadne nie jest wyszukiwarką kitu).
- **Biała lista VAT** (`whitelist`): nagłówek, `StateBadge` na `ToneBadge`, lista podmiotów jako `Section` + `RowActions`.
- **Zgodność** (`compliance`): nagłówek, własne zakładki sekcji na `FilterButton` albo widoki, `DsrStatusBadge`/`KindBadge` na paletę, wyszukiwarka.
- **Kit** (`kit`, newsletter): ręczny nagłówek z `t("by")`, brak zakładek i haseł.

Priorytet 2, duże strony z wieloma zdaniami i pigułkami:
- **InPost** (`inpost`): 34 użycia `DropdownMenu` (menu „…” w planie przesyłek, `inpost-plan.tsx`) na widoczne ikony; hasła; filtry.
- **BaseLinker** (`baselinker`): pigułki filtrów (10) na `FilterButton`, hasła, puste stany zdaniami.
- **Allegro** (`allegro`): hasła, `allegro-issues.tsx` (kafelki, puste stany), wyszukiwarki (4 z 6 pól), karta oferty produktu.
- **Fakturownia** (`fakturownia`): pigułki (5) na `FilterButton` z licznikami, kafelki jako filtry, hasła.
- **Subiekt nexo** (`subiekt`): pigułki (7), kafelki, hasła, bieg wysyłki do mostu jako `StagedLoader`.
- **Zadania** (`tasks`): tablica i lista, akcje kart widoczne, 6 pól bez `type="search"`, karty na zamówieniu, produkcie, kliencie.
- **Negocjacje** (`negotiations`): pigułki (3), szczegół negocjacji na `SubpageHeader`, karty klienta/produktu/zamówień.
- **OLX** (`olx`): hasła, `olx-panel.tsx` (kafelki, puste stany), karta ogłoszeń produktu.

Priorytet 3, małe strony z nagłówkiem kitu:
- **InPost Pay** (`inpostpay`) i **InPost Von Halsky** (`vonhalsky`): hasła, wyszukiwarka (dziś brak), kafelki z kitu, puste stany.

Wzory do dokończenia przy okazji:
- **Kupony:** `Segment` nad listą na `FilterButton` z licznikami; wyszukiwarka na `SearchInput`.
- **Stripe, E-maile:** `FilterPills` na `FilterButton`; `EmptyRow` na `EmptyTableRow`.
- **Kredyt kupiecki:** `StatTile` i `EmptyLine` z `credit-ui` na klocki kitu.

Wszystkie: usunąć `by={t("by")}` z nagłówka (kit go już nie pokazuje), zostawić klucz `by` tylko tam, gdzie składa nazwę w zgłoszeniu sklepu (`communityLabels`).
