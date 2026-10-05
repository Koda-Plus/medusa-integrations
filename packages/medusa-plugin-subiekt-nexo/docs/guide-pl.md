# Przewodnik wdrożenia: połącz Medusę z Subiektem nexo PRO

Ten sam przewodnik jest w panelu Medusy: Subiekt nexo, przełącznik Przewodnik wdrożenia (`/app/subiekt?view=guide`). Tam każdy krok i każdy punkt listy kontrolnej pokazuje bieżący stan sklepu.

Subiekt nie ma API w sieci: jego interfejs programistyczny, Sfera, to biblioteka Windows działająca obok bazy Subiekta. Dlatego mały program, most, pracuje jako usługa Windows na komputerze, który widzi serwer SQL Subiekta, a Cloudflare Tunnel publikuje go przez HTTPS bez otwierania portu. Medusa podpisuje każde żądanie, most zakłada ZK każdego zamówienia, a Medusa odczytuje z powrotem WZ, fakturę albo paragon z numerem KSeF, stany i ceny. Nic nie jest zapisywane, dopóki na to nie pozwolisz.

**Czas:** 2 do 4 godzin konfiguracji, potem kilka dni zamówień testowych i planów, zanim włączysz zapisy.

**Potrzebujesz:**

- Subiekt nexo PRO (Sfera w zestawie)
- Komputer z Windows włączony cały czas, przy bazie
- nexo SDK w wersji Twojego Subiekta
- .NET 8 SDK
- Operator Subiekta dla mostu
- Domena w Cloudflare
- Most od Koda Plus
- Dostęp do medusa-config.ts i jego zmiennych środowiskowych

## Jak rozmawiają ze sobą części

Żądania do mostu wysyła tylko Medusa. Most może szturchnąć Medusę, gdy czekają nowe dokumenty; same dokumenty zawsze przychodzą w podpisanym żądaniu Medusy.

```
Medusa
   |  HTTPS, każde żądanie podpisane
   v
Cloudflare Tunnel
   |  cloudflared
   v
Most (usługa Windows)
   |  wewnątrz mostu
   v
Sfera (nexo SDK)
   |  SQL Server, logowanie Windows
   v
Subiekt nexo PRO
```

- **Medusa**: ta wtyczka: kolejka, plany, zapisy, panel. Hostowana gdziekolwiek, na przykład na Railway.
- **Cloudflare Tunnel**: publikuje most pod https://subiekt-bridge.twoj-sklep.pl bez otwartego portu. Odwrotne proxy z HTTPS też się nada.
- **Most (usługa Windows)**: KodaSubiektBridge na 127.0.0.1:5280, jedna sesja Sfery, własny kanał zdarzeń.
- **Sfera (nexo SDK)**: interfejs .NET od InsERT, w tej samej wersji co baza.
- **Subiekt nexo PRO**: dokumenty, kontrahenci, stany i ceny w bazie SQL Server.

## Od zera do produkcji

### 1. Przygotuj Subiekta nexo PRO

Most działa przez Sferę, którą InsERT nazywa „Sfera dla Subiekta nexo” i dołącza do Subiekta nexo PRO. Sfera nie ma własnej licencji do kupienia ani aktywacji: wystarczy aktywna licencja Subiekta nexo PRO. Zwykły Subiekt nexo nie ma Sfery i potrzebuje wersji PRO (od InsERT albo partnera); osobny dodatek Sfera PRO+ (sfera zdarzeniowa, menu sferyczne) nie jest potrzebny.

Załóż w Subiekcie operatora tylko dla mostu, na przykład `Integracja`, z uprawnieniami do zamówień od klientów, wydań zewnętrznych (WZ), dokumentów sprzedaży, towarów i kontrahentów. Zapisz jego hasło.

Wybierz magazyn dla nowych ZK (jego symbol, na przykład `MAG`) i nabywcę detalicznego: kontrahenta, do którego trafia każde ZK bez firmy. Zanotuj jego NIP. Dla cen zanotuj symbol poziomu cen do publikacji i upewnij się, że jego cennik bazowy jest zatwierdzony.

Serie dokumentów: ZK i WZ dostają numerację tego magazynu (na przykład `ZK 128/MAG/2026`), a każdy dokument używa domyślnej definicji swojego typu w Subiekcie, więc FS i PA zachowują numerację ustawioną przez księgowość. VAT pochodzi z kartotek towarów w Subiekcie: most ustawia na każdej pozycji cenę brutto zapłaconą przez klienta, a Subiekt wylicza netto i VAT według stawki towaru, więc trzymaj te stawki zgodne z ustawieniami podatków sklepu.

Zanotuj dokładną wersję Subiekta (pokazuje ją okno informacji o programie): nexo SDK musi mieć tę samą.

**Sprawdzenie:** Subiekt pokazuje wersję, operator się loguje, nabywca detaliczny istnieje.

### 2. Zainstaluj nexo SDK i .NET 8 na komputerze z Windows

Wybierz komputer z Windows, który pracuje cały czas i sięga do serwera SQL Subiekta, zwykle ten sam serwer, na którym działa Subiekt. Laptop, który usypia, wstrzymuje zamówienia na cały czas uśpienia (Medusa ponawia, ale nic nie płynie).

Zainstaluj .NET 8 SDK (dotnet.microsoft.com/download/dotnet/8.0) i nexo SDK w wersji Twojego Subiekta (InsERT udostępnia je na stronie Subiekta nexo PRO). Instaluje się w `C:\InsERT\nexoSDK\Bin\nexoSDK_<wersja>`. Inna wersja niż baza to najczęstsza awaria: Sfera odmawia połączenia i mówi, że baza jest w innej wersji.

[Subiekt nexo PRO w InsERT (pobranie nexo SDK)](https://www.insert.com.pl/programy_dla_firm/sprzedaz/subiekt_nexo_pro/opis.html)

**Sprawdzenie:** Folder C:\InsERT\nexoSDK\Bin zawiera folder nexoSDK_&lt;wersja&gt; w tej samej wersji co Subiekt.

### 3. Zainstaluj most jako usługę Windows

Skopiuj most od Koda Plus na ten komputer, na przykład do `C:\Koda\subiekt-nexo-bridge`. Otwórz w tym folderze PowerShell jako administrator i uruchom `deploy\install-service.ps1` z `-ServiceUser`, czyli kontem Windows, na którym ma działać usługa (nie LocalSystem: SQL Server przyjmuje logowanie Windows tego konta). Pierwsze uruchomienie publikuje most do `C:\KodaSubiektBridge`, zakłada tam `appsettings.Local.json` ze wzoru i kończy pracę: uzupełnij każdą wartość zaczynającą się od `WSTAW-`.

Klucze, wszystkie w sekcji `Bridge`: `Mode` sfera; `Secret` wspólny sekret (pierwsza linia poniżej go generuje); `Subiekt:Server` instancja SQL Server, na przykład `SERWER\INSERTNEXO`; `Subiekt:Database` baza firmy; `Subiekt:Operator` i `Subiekt:OperatorPassword`; `Subiekt:Warehouse` dla nowych ZK; `Subiekt:StockWarehouses`, z których stany idą do Medusy; `Subiekt:BuyerNip` nabywca detaliczny; `Subiekt:BuyerMode` fixed albo customer, żeby użyć NIP nabywcy; `Subiekt:CreateContractors`; `Products:PriceLevels`; `Documents:Fs` i `Documents:Pa`; `Medusa:WebhookUrl` (opcjonalnie).

Uruchom to samo polecenie jeszcze raz. Publikuje most na najnowszym zainstalowanym nexo SDK, uruchamia `--check` (konfiguracja, potem logowanie do Sfery tylko do odczytu, z magazynem, nabywcą detalicznym i poziomami cen), pyta o hasło konta usługi, zakłada usługę KodaSubiektBridge z restartem po awarii, uruchamia ją i odpytuje /healthz.

Aktualizacje: `deploy\upgrade-service.ps1` (kopia zapasowa, publikacja, sprawdzenie, start; z -Rollback sam przywraca kopię, gdy sprawdzenie zawiedzie). Usunięcie: `deploy\uninstall-service.ps1`, który zostawia konfigurację, kanał zdarzeń i logi.

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") })
.\deploy\install-service.ps1 -ServiceUser "SERWER\integracja"
C:\KodaSubiektBridge\Koda.SubiektBridge.exe --check
```

[Pobierz .NET 8](https://dotnet.microsoft.com/download/dotnet/8.0)

**Sprawdzenie:** --check kończy się słowem Ready, skrypt komunikatem /healthz = ok, a http://127.0.0.1:5280/ na tym komputerze pokazuje stronę stanu.

### 4. Opublikuj most przez Cloudflare Tunnel

W panelu Cloudflare otwórz Networking, Tunnels i wybierz Create a tunnel. Nadaj nazwę (na przykład `subiekt-bridge`), wybierz Windows i uruchom pokazane polecenie instalacji w terminalu administratora na komputerze z mostem. cloudflared działa potem jako usługa Windows.

W tunelu otwórz Routes, Add route, Published application. Subdomain `subiekt-bridge`, Twoja domena, Service URL `http://127.0.0.1:5280`. Ścieżkę zostaw pustą: Cloudflare przekazuje ją bez zmian, a podpisy ją obejmują. Domena musi już być dodana jako witryna na Twoim koncie Cloudflare.

Most nasłuchuje tylko na 127.0.0.1, więc zapora Windows nie potrzebuje reguły przychodzącej. Komputer potrzebuje wychodzącego HTTPS dla cloudflared i dostępu do bazy Subiekta w SQL Server.

```bash
curl https://subiekt-bridge.twoj-sklep.pl/healthz
```

[Cloudflare: tworzenie tunelu](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)

**Sprawdzenie:** https://subiekt-bridge.twoj-sklep.pl/healthz odpowiada ok, a każdy adres /v1 bez podpisu odpowiada invalid_signature.

### 5. Zamknij adres przez Cloudflare Access

Podpisy już chronią każde wywołanie /v1. Access dokłada drugi zamek, zanim żądanie dotrze do komputera. W Cloudflare Zero Trust utwórz token usługi (Access controls, Service credentials, Service Tokens) i skopiuj Client ID oraz Client Secret: sekret jest pokazywany tylko raz.

Dodaj aplikację Access typu self-hosted dla subiekt-bridge.twoj-sklep.pl z polityką o akcji Service Auth, która obejmuje ten token. Potem ustaw w Medusie cfAccessClientId i cfAccessClientSecret. Token wygasa po wybranym przy tworzeniu czasie: odnów go wcześniej.

[Cloudflare: tokeny usług](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)

**Sprawdzenie:** Sprawdź połączenie nadal pokazuje Połączone, a przeglądarkę bez tokenu zatrzymuje Cloudflare Access.

### 6. Skonfiguruj wtyczkę w Medusie

Dodaj wtyczkę do medusa-config.ts z adresem mostu i tym samym sekretem, potem uruchom `npx medusa db:migrate` i zrestartuj Medusę. Zacznij od próby na sucho dla stanów i wszystkich zapisów wyłączonych: pierwsze dni tylko planują.

Przy kilku lokalizacjach magazynowych ustaw stockLocationId na tę, która odpowiada magazynowi Subiekta. salesDocument decyduje o fakturze albo paragonie (none, fs, pa, auto), a salesDocumentAfter o tym, kiedy (wz albo zk). nipSources mówi, gdzie Twój checkout trzyma NIP nabywcy.

```ts
{
  resolve: "@koda-plus/medusa-plugin-subiekt-nexo",
  options: {
    bridgeUrl: process.env.SUBIEKT_BRIDGE_URL,
    secret: process.env.SUBIEKT_SECRET,
    cfAccessClientId: process.env.SUBIEKT_CF_ACCESS_CLIENT_ID,
    cfAccessClientSecret: process.env.SUBIEKT_CF_ACCESS_CLIENT_SECRET,
    stockLocationId: process.env.SUBIEKT_STOCK_LOCATION_ID,
    stockDryRun: true,
    salesDocument: "none",
    salesDocumentAfter: "wz",
    nipSources: ["metadata.nip", "billing_address.company"],
    priceWriter: false,
    createMissingProducts: false,
    createContractors: false,
  },
},

npx medusa db:migrate
```

**Sprawdzenie:** Ta strona pokazuje adres mostu zamiast Brak konfiguracji.

### 7. Sprawdź połączenie, podpisy i zegary

Kliknij Sprawdź połączenie. Sekcja Most pokazuje wersje, nexo SDK i bazę, licencję, co most obsługuje, czas odpowiedzi i różnicę zegarów.

Podpisy zawodzą, gdy sekret jest różny albo gdy zegary różnią się o ponad 5 minut. Trzymaj czas Windows zsynchronizowany (Ustawienia, Czas i język, Synchronizuj teraz, albo `w32tm /resync` jako administrator).

```powershell
w32tm /resync
```

**Sprawdzenie:** Połączone, podpisy przyjęte, różnica zegarów poniżej minuty.

### 8. Odczytaj stany i zaplanuj ceny

Kliknij Synchronizuj stany. Przy stockDryRun przebieg tylko zapisuje plan: co by się zmieniło, warianty bez dopasowania, towary tylko w Subiekcie, konflikty. Popraw kody tam, gdzie się różnią (EAN w Subiekcie w Miary, Kod kreskowy, albo SKU względem symbolu towaru), aż lista będzie krótka i spodziewana.

Kliknij Pobierz produkty. Plan pokazuje zmiany cen z i na, produkty do założenia i konflikty. Na razie nic się nie zmienia.

**Sprawdzenie:** Przebieg stanów bez błędów i przeczytany plan produktów.

### 9. Zamówienie testowe: ZK, WZ, faktura

Złóż zamówienie testowe płatne przy odbiorze. W kilka sekund Subiekt ma jego ZK, a to zamówienie pokazuje numer. Wystaw w Subiekcie WZ z tego ZK (WZ musi powstać z ZK: Subiekt przenosi wtedy znacznik zamówienia); w ciągu kilku minut WZ pojawi się przy zamówieniu.

Przy ustawionym salesDocument i włączonym zapisie dokumentów potem powstaje faktura albo paragon. Anuluj drugie zamówienie testowe przed WZ, żeby zobaczyć anulowanie: Sfera nie ustawi statusu Unieważnione, więc ZK dostaje widoczny znacznik, a resztę robi człowiek w Subiekcie.

**Sprawdzenie:** Zamówienie testowe pokazuje swoje ZK i WZ.

### 10. Faktury, paragony i kontrahenci

salesDocument auto wystawia FS, gdy zamówienie niesie poprawny NIP, a w pozostałych przypadkach PA. Most realizuje WZ, jeśli istnieje (towar już wyjechał), a w przeciwnym razie ZK, raz na zamówienie. Numery KSeF przychodzą, gdy Subiekt wyśle e-fakturę; pojawiają się przy zamówieniu. Paragony fiskalizuje Subiekt, nigdy most.

Dla firm ustaw w moście BuyerMode customer: ZK trafia do kontrahenta z tym NIP. Żeby zakładać brakujących kontrahentów, ustaw CreateContractors w moście, createContractors w Medusie i włącz zapis kontrahentów. Niepoprawny NIP (suma kontrolna) kieruje zamówienie do nabywcy detalicznego z ostrzeżeniem w kolejce.

```ts
salesDocument: "auto",
salesDocumentAfter: "wz",
createContractors: true,
```

**Sprawdzenie:** Sekcja Przełączniki zapisu: dokumenty włączone, a zamówienie testowe pokazuje swoją FS albo PA.

### 11. Ceny i nowe produkty

Ustaw priceWriter albo createMissingProducts w medusa-config.ts, przeczytaj plan, potem włącz zapis tutaj. Każdy przebieg nanosi najwyżej maxPriceChangesPerRun cen i maxProductsPerRun produktów, tuż przed zapisem czyta każdą pozycję ponownie, pomija to, co ktoś w międzyczasie zmienił w Medusie, i wysyła do kwarantanny pozycję, która zawiodła trzy przebiegi z rzędu. Nowe produkty powstają jako szkice: dodaj zdjęcia i kanał sprzedaży, potem opublikuj.

```ts
priceWriter: true,
maxPriceChangesPerRun: 200,
createMissingProducts: true,
maxProductsPerRun: 20,
```

**Sprawdzenie:** Sekcja Przełączniki zapisu: zapis cen włączony przez człowieka, wiersze planu Naniesione.

### 12. Start produkcyjny

Wyłącz stockDryRun, gdy plan stanów jest poprawny. Włączaj każdy potrzebny zapis świadomie, jeden po drugim. Ustaw w moście Medusa:WebhookUrl na https://twoja-medusa/hooks/subiekt, żeby WZ przychodziły w kilka sekund. Zasubskrybuj subiekt.task_failed, żeby alarmować zespół, i trzymaj kolejkę na zerze w Wymagają uwagi.

**Sprawdzenie:** Każda pozycja listy kontrolnej poniżej jest odhaczona.

## Lista kontrolna przed startem

W panelu znaczniki stawia bieżący stan sklepu.

- [ ] Most odpowiada przez tunel. Sekcja Most: Połączone.
- [ ] Podpisy przyjęte. Ten sam sekret w Medusie i w moście.
- [ ] Różnica zegarów poniżej minuty. Powyżej 5 minut podpisy przestają działać.
- [ ] Most mówi kontraktem 1.1. Most 0.2.0 lub nowszy: produkty, dokumenty, kontrahenci.
- [ ] Subiekt się loguje, a licencja to przyjmuje. Sekcja Most: licencja nexo.
- [ ] Pierwszy odczyt stanów bez błędów. Sekcja Stany.
- [ ] Próba na sucho dla stanów wyłączona po przeglądzie. stockDryRun: false.
- [ ] Pierwsze ZK założone. Zamówienie testowe.
- [ ] WZ wróciło z magazynu. Wystawione z ZK w Subiekcie.
- [ ] Każdy dozwolony zapis rozstrzygnięty przez człowieka. Sekcja Przełączniki zapisu: włączony albo świadomie wyłączony.
- [ ] Nic w kolejce nie wymaga uwagi. Kolejka: Wymagają uwagi jest puste.
- [ ] Webhook z mostu przyjęty (opcjonalnie). Bridge:Medusa:WebhookUrl.

## Gdy coś nie działa

### Subiekt nie odpowiada: baza jest w innej wersji niż SDK

Sfera łączy się tylko z bazą dokładnie w swojej wersji. Po aktualizacji Subiekta baza idzie naprzód i most zbudowany na starym SDK nie może się zalogować. Sekcja Połączenie pokazuje wtedy „The nexo database has a different version than the SDK the bridge was built with” z wersją SDK i komunikatem samej Sfery; most odpowiada subiekt_unavailable, a Medusa ponawia, więc żadne zamówienie nie ginie.

Zainstaluj nexo SDK w nowej wersji, potem uruchom deploy\upgrade-service.ps1: przebuduje most na najnowszym zainstalowanym SDK. Żeby wskazać konkretne, podaj -NexoSdkBin z jego folderem Bin.

### Usługa KodaSubiektBridge się nie uruchamia

Zajrzyj do Podglądu zdarzeń (Dzienniki systemu Windows, Aplikacja) i do C:\KodaSubiektBridge\logs. Zwykłe przyczyny: zmieniło się hasło konta usługi (Usługi, KodaSubiektBridge, Logowanie: wpisz nowe), appsettings.Local.json nie jest poprawnym JSON (--check czyta te same pliki i wskazuje miejsce) albo inny program zajął port 5280 (ustaw Urls w appsettings.Local.json i Service URL tunelu).

Po aktualizacji Subiekta usługa zwykle startuje, ale Subiekt nie odpowiada: to zmiana wersji z poprzedniej odpowiedzi.

### Licencja nexo odmawia pracy

Wykorzystana wersja próbna albo wygasła licencja zatrzymuje Sferę komunikatem „Limit czasu pracy”. Aktywuj ważną licencję Subiekta nexo PRO na tym komputerze. Upewnij się, że licencja ma stanowisko dla komputera z mostem; Twój partner InsERT potwierdzi, jak liczy logowanie przez Sferę.

### Po kilku dniach pracy każde wywołanie zawodzi

Sfera uruchamia dyspozytor WPF na każdym wątku, który jej używa, a usługa Windows ma małą stertę pulpitu. Mosty, które wołały Sferę z przypadkowych wątków, wyczerpywały ją po około sześciu dniach. Ten most wykonuje każde wywołanie Sfery na jednym, stałym wątku, więc tego nie robi; jeśli to widzisz, sprawdź, czy usługa uruchamia ten most, i zrestartuj ją.

### Subiekt jest zajęty dłużej niż 5 minut

Sfera nie jest bezpieczna dla równoległych sesji, więc most wykonuje jedną operację naraz. Bardzo długa operacja (ogromny odczyt stanów, prace serwisowe w Subiekcie) każe innym czekać; odpowiedź busy Medusa ponawia później.

### invalid_signature albo stale_timestamp

invalid_signature: sekret w Medusie i w moście jest różny. stale_timestamp: zegary różnią się o ponad 5 minut. Sekcja Most pokazuje różnicę. Żeby zmienić sekret bez przerwy, na czas zmiany wpisz stary w previousSecret (Medusa) i PreviousSecret (most).

### WZ wystawione w Subiekcie nie pojawia się w Medusie

Wystawiaj WZ z ZK: Subiekt przenosi wtedy uwagi ZK ze znacznikiem zamówienia [medusa:order_...] na WZ, a po tym znaczniku most znajduje zamówienie. WZ wpisane ręcznie znacznika nie ma. Most szuka nowych WZ co 2 minuty, a Medusa czyta kanał co 2 minuty; przy pierwszym uruchomieniu obserwator zaczyna od najnowszego WZ i nie ogłasza starszych.

### Czy zamówienie może dostać dwa ZK albo dwie faktury?

Nie. Most wpisuje znacznik zamówienia do każdego dokumentu i szuka go przed założeniem nowego, pod blokadą zamówienia i drugi raz pod blokadą Sfery. Medusa trzyma jedno zadanie na zamówienie i przejmuje je atomowo. Niejasna odpowiedź (przekroczony czas) zmienia status na Niejasna odpowiedź, a kolejna próba najpierw pyta most.

### Dokończ ręcznie w Subiekcie po anulowaniu

Sfera nie ustawi statusu ZK Unieważnione. Most oznacza ZK na początku uwag oraz flagą własną, jeśli ją masz; status ustawia człowiek. Gdy istnieje już WZ albo dokument sprzedaży, anulowanie jest odrzucane (document_locked): potraktuj je jako zwrot albo korektę w Subiekcie.

### Pozycje bez towaru w Subiekcie (unmatched_lines)

Most dopasowuje każdą pozycję najpierw po EAN, potem po SKU względem symbolu towaru, i nie zapisuje nic, gdy choć jedna pozycja nie ma towaru. Popraw EAN w Subiekcie (Miary, Kod kreskowy) albo SKU, potem Wyślij ponownie. Usługi i karty podarunkowe bez kodów można pominąć opcją omitLinesWithoutCode.

### --check przechodzi, ale usługa nie loguje się do SQL Server

--check działa na Twoim koncie, usługa na własnym koncie Windows. Daj temu kontu dostęp do bazy nexo albo uruchom --check jako to konto.

### Kontrahenci się nie zakładają

Muszą się zgadzać cztery przełączniki: Bridge:Subiekt:BuyerMode customer, Bridge:Subiekt:CreateContractors true, createContractors w medusa-config.ts i zapis kontrahentów włączony tutaj. Niepoprawny NIP nigdy nie zakłada kontrahenta; kolejka pokazuje ostrzeżenie.

### Wariantu brakuje w planie cen

Ceny dopasowują się po EAN, potem po SKU równym symbolowi, bez obcinania końcówek SKU, więc hurtowy wariant -WH zachowuje swoją cenę. Towar bez ceny w poziomie, poziom w innej walucie albo zdublowany EAN nigdy nie dają zmiany.

### Komputer z mostem był wyłączony przez weekend

Nic nie ginie: każde wywołanie jest najpierw zadaniem i jest ponawiane przez około dwa i pół dnia. Zadania, które nadal zawodzą, czekają potem w Wymagają uwagi z przyciskiem Wyślij ponownie.
