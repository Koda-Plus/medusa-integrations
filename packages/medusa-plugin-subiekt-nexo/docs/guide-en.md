# Setup guide: connect Medusa to Subiekt nexo PRO

The same guide lives in the Medusa admin: Subiekt nexo, switch Setup guide (`/app/subiekt?view=guide`). There every step and every checklist item shows the live state of your store.

Subiekt has no web API: its programming interface, Sfera, is a Windows library next to the Subiekt database. So a small program, the bridge, runs as a Windows service on a machine that sees the Subiekt SQL Server, and a Cloudflare Tunnel publishes it over HTTPS without opening a port. Medusa signs every request, the bridge creates the ZK of each order, Medusa reads back the WZ, the invoice or receipt with its KSeF number, stock and prices. Nothing is written until you allow it.

**Time:** 2 to 4 hours of setup, then a few days of test orders and plans before you arm the writers.

**You need:**

- Subiekt nexo PRO (Sfera is included)
- Windows machine on all the time, next to the database
- nexo SDK of your Subiekt version
- .NET 8 SDK
- A Subiekt operator for the bridge
- A domain in Cloudflare
- The bridge from Koda Plus
- Access to medusa-config.ts and its environment

## How the parts talk

Only Medusa starts requests to the bridge. The bridge may nudge Medusa when new documents wait; the documents themselves always come through Medusa's own signed request.

```
Medusa
   |  HTTPS, every request signed
   v
Cloudflare Tunnel
   |  cloudflared
   v
Bridge (Windows service)
   |  inside the bridge
   v
Sfera (nexo SDK)
   |  SQL Server, Windows login
   v
Subiekt nexo PRO
```

- **Medusa**: this plugin: queue, plans, writers, admin. Hosted anywhere, for example Railway.
- **Cloudflare Tunnel**: publishes the bridge at https://subiekt-bridge.your-shop.pl without an open port. A reverse proxy with HTTPS works too.
- **Bridge (Windows service)**: KodaSubiektBridge on 127.0.0.1:5280, one Sfera session, its own event feed.
- **Sfera (nexo SDK)**: InsERT's .NET interface, the same version as the database.
- **Subiekt nexo PRO**: documents, contractors, stock and prices in its SQL Server database.

## From zero to production

### 1. Prepare Subiekt nexo PRO

The bridge works through Sfera, which InsERT calls "Sfera dla Subiekta nexo" and includes in Subiekt nexo PRO. Sfera has no licence of its own to buy or activate: an active Subiekt nexo PRO licence is enough. Plain Subiekt nexo has no Sfera and needs the PRO version (from InsERT or its partner); the separate Sfera PRO+ add-on (event sphere, spherical menu) is not needed.

In Subiekt create an operator only for the bridge, for example `Integracja`, with rights to customer orders, external issues (WZ), sales documents, products and contractors. Write down its password.

Decide the warehouse for new ZK (its symbol, for example `MAG`) and the retail buyer: the contractor every ZK without a company goes to. Note its NIP. For prices, note the symbol of the price level to publish and make sure its base price list is approved.

Document series: ZK and WZ get the numbering of that warehouse (for example `ZK 128/MAG/2026`), and every document uses the default definition of its type in Subiekt, so FS and PA keep the numbering your accountant set. VAT comes from the product cards in Subiekt: the bridge sets the gross price the customer paid on each line and Subiekt computes net and VAT with the product's rate, so keep those rates in line with the store's tax settings.

Note the exact version of Subiekt (its About window shows it): the nexo SDK must have the same one.

**Check:** Subiekt shows the version, the operator can log in, the retail buyer exists.

### 2. Install the nexo SDK and .NET 8 on the Windows machine

Pick a Windows machine that runs all the time and reaches the Subiekt SQL Server, usually the server Subiekt itself runs on. A laptop that sleeps loses orders for as long as it sleeps (Medusa retries, but nothing moves).

Install the .NET 8 SDK and the nexo SDK of your Subiekt version (InsERT publishes it on the Subiekt nexo PRO page). It installs to `C:\InsERT\nexoSDK\Bin\nexoSDK_<version>`. A different version than the database is the most common failure: Sfera refuses to connect and says the database is in another version.

[Subiekt nexo PRO at InsERT (nexo SDK download)](https://www.insert.com.pl/programy_dla_firm/sprzedaz/subiekt_nexo_pro/opis.html)

**Check:** The folder C:\InsERT\nexoSDK\Bin has a nexoSDK_&lt;version&gt; folder with the same version as Subiekt.

### 3. Install the bridge as a Windows service

Copy the bridge from Koda Plus to the machine, for example `C:\Koda\subiekt-nexo-bridge`. Open PowerShell as administrator in that folder and run `deploy\install-service.ps1` with `-ServiceUser`, the Windows account the service will run as (not LocalSystem: SQL Server accepts the Windows login of that account). The first run publishes the bridge to `C:\KodaSubiektBridge`, creates `appsettings.Local.json` there from a template and stops: fill in every value that starts with `WSTAW-`.

The keys, all under `Bridge`: `Mode` sfera; `Secret` the shared secret (the first line below generates one); `Subiekt:Server` the SQL Server instance, for example `SERWER\INSERTNEXO`; `Subiekt:Database` the company database; `Subiekt:Operator` and `Subiekt:OperatorPassword`; `Subiekt:Warehouse` for new ZK; `Subiekt:StockWarehouses` whose stock goes to Medusa; `Subiekt:BuyerNip` the retail buyer; `Subiekt:BuyerMode` fixed, or customer to use the buyer's NIP; `Subiekt:CreateContractors`; `Products:PriceLevels`; `Documents:Fs` and `Documents:Pa`; `Medusa:WebhookUrl` (optional).

Run the same command again. It publishes the bridge against the newest nexo SDK installed, runs `--check` (the configuration, then a read-only Sfera login with the warehouse, the retail buyer and the price levels), asks for the password of the service account, creates the KodaSubiektBridge service with a restart on failure, starts it and calls /healthz.

Upgrades: `deploy\upgrade-service.ps1` (backup, publish, check, start; with -Rollback it restores the backup by itself when the check fails). Removal: `deploy\uninstall-service.ps1`, which keeps the configuration, the event feed and the logs.

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") })
.\deploy\install-service.ps1 -ServiceUser "SERWER\integracja"
C:\KodaSubiektBridge\Koda.SubiektBridge.exe --check
```

[.NET 8 download](https://dotnet.microsoft.com/download/dotnet/8.0)

**Check:** --check ends with Ready, the script with /healthz = ok, and http://127.0.0.1:5280/ on that machine shows the status page.

### 4. Publish the bridge through Cloudflare Tunnel

In the Cloudflare dashboard open Networking, Tunnels, and choose Create a tunnel. Name it (for example `subiekt-bridge`), choose Windows, and run the install command it shows in an administrator terminal on the bridge machine. cloudflared then runs as a Windows service.

On the tunnel open Routes, Add route, Published application. Subdomain `subiekt-bridge`, your domain, Service URL `http://127.0.0.1:5280`. Leave the path empty: Cloudflare passes it on unchanged, and the signatures cover it. The domain must already be a website in your Cloudflare account.

The bridge listens on 127.0.0.1 only, so the Windows firewall needs no inbound rule. The machine needs outbound HTTPS for cloudflared and SQL Server access to the Subiekt database.

```bash
curl https://subiekt-bridge.your-shop.pl/healthz
```

[Cloudflare: create a tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)

**Check:** https://subiekt-bridge.your-shop.pl/healthz answers ok, while any /v1 address answers invalid_signature without a signature.

### 5. Lock the address with Cloudflare Access

Signatures already protect every /v1 call. Access adds a second lock before a request reaches the machine. In Cloudflare Zero Trust create a service token (Access controls, Service credentials, Service Tokens) and copy the Client ID and Client Secret: the secret is shown only once.

Add a self-hosted Access application for subiekt-bridge.your-shop.pl with a policy whose action is Service Auth and which includes that token. Then set cfAccessClientId and cfAccessClientSecret in Medusa. A token expires after the duration you chose: renew it before then.

[Cloudflare: service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)

**Check:** Check connection still says Connected, while a browser without the token is stopped by Cloudflare Access.

### 6. Configure the plugin in Medusa

Add the plugin to medusa-config.ts with the bridge address and the same secret, then run `npx medusa db:migrate` and restart Medusa. Start with a dry run of stock and every writer off: the first days only plan.

With several stock locations set stockLocationId to the one that mirrors the Subiekt warehouse. salesDocument decides the invoice or receipt (none, fs, pa, auto) and salesDocumentAfter when (wz or zk). nipSources says where your checkout keeps the buyer's NIP.

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

**Check:** This page shows the bridge host instead of Not configured.

### 7. Check the connection, signatures and clocks

Click Check connection. The Bridge section shows the versions, the nexo SDK and database, the licence, what the bridge can do, the round trip and the clock skew.

Signatures fail when the secret differs or when the clocks differ by more than 5 minutes. Keep Windows time synchronized (Settings, Time and language, Sync now, or `w32tm /resync` as administrator).

```powershell
w32tm /resync
```

**Check:** Connected, signatures accepted, clock skew under a minute.

### 8. Read stock and plan prices

Click Sync stock. With stockDryRun the run only records the plan: what would change, variants without a match, products only in Subiekt, conflicts. Fix codes where they differ (EAN in Subiekt under Miary, Kod kreskowy, or the SKU against the product symbol) until the list is short and expected.

Click Read products. The plan lists price changes from and to, products to create and conflicts. Nothing changes yet.

**Check:** A stock run without errors, and a product plan you have read.

### 9. Test order: ZK, WZ, invoice

Place a test order paid on delivery. Within seconds Subiekt has its ZK and this order shows the number. Issue the WZ from that ZK in Subiekt (the WZ must come from the ZK: Subiekt copies the order tag with it); within a few minutes the WZ shows on the order.

With salesDocument set and the documents writer armed, the invoice or receipt follows. Cancel a second test order before its WZ to see the cancel: Sfera cannot set the status Unieważnione, so the ZK gets a visible mark and a person finishes it in Subiekt.

**Check:** The test order shows its ZK and WZ.

### 10. Invoices, receipts and contractors

salesDocument auto issues an FS when the order carries a valid NIP and a PA otherwise. The bridge realizes the WZ when there is one (the goods left already) and the ZK otherwise, once per order. KSeF numbers arrive when Subiekt sent the e-invoice; they appear on the order. Receipts are fiscalized in Subiekt, never by the bridge.

For company buyers set the bridge to BuyerMode customer: the ZK goes to the contractor with that NIP. To create missing contractors, set CreateContractors in the bridge, createContractors in Medusa and arm the contractors writer. An invalid NIP (checksum) sends the order to the retail buyer with a warning in the queue.

```ts
salesDocument: "auto",
salesDocumentAfter: "wz",
createContractors: true,
```

**Check:** Writers section: documents armed, and the test order shows its FS or PA.

### 11. Prices and new products

Set priceWriter or createMissingProducts in medusa-config.ts, read the plan, then arm the writer here. Each run applies at most maxPriceChangesPerRun prices and maxProductsPerRun products, reads every item again right before it writes, skips what changed in Medusa meanwhile and quarantines an item that failed three runs in a row. New products are drafts: add images and a sales channel, then publish.

```ts
priceWriter: true,
maxPriceChangesPerRun: 200,
createMissingProducts: true,
maxProductsPerRun: 20,
```

**Check:** Writers section: the price writer armed by a person, the plan rows Applied.

### 12. Go live

Switch stockDryRun off once the stock plan is right. Arm every writer you want deliberately, one at a time. Set Medusa:WebhookUrl in the bridge to https://your-medusa/hooks/subiekt so WZ arrive within seconds. Subscribe to subiekt.task_failed to alert your team, and keep the queue at zero Need attention.

**Check:** Every item of the go-live checklist below is ticked.

## Go-live checklist

In the admin the ticks come from the live status of your store.

- [ ] The bridge answers through the tunnel. Bridge section: Connected.
- [ ] Signatures accepted. Same secret in Medusa and the bridge.
- [ ] Clock skew under a minute. Signatures fail beyond 5 minutes.
- [ ] The bridge speaks contract 1.1. Bridge 0.2.0 or newer: products, documents, contractors.
- [ ] Subiekt logs in and the licence accepts it. Bridge section: nexo licence.
- [ ] First stock read without errors. Stock section.
- [ ] Stock dry run switched off after review. stockDryRun: false.
- [ ] First ZK created. A test order.
- [ ] A WZ came back from the warehouse. Issued from the ZK in Subiekt.
- [ ] Every allowed writer decided by a person. Writers section: armed or switched off on purpose.
- [ ] Nothing needs attention in the queue. Queue: Need attention is empty.
- [ ] Webhook from the bridge accepted (optional). Bridge:Medusa:WebhookUrl.

## When something goes wrong

### Subiekt not answering: the database is in another version than the SDK

Sfera connects only to a database of exactly its own version. After a Subiekt update the database moves on and the bridge built against the old SDK cannot log in. The Connection section then says "The nexo database has a different version than the SDK the bridge was built with", with the SDK version and Sfera's own message; the bridge answers subiekt_unavailable and Medusa keeps retrying, no order is lost.

Install the nexo SDK of the new version, then run deploy\upgrade-service.ps1: it rebuilds the bridge against the newest SDK installed. To pin one, pass -NexoSdkBin with its Bin folder.

### The KodaSubiektBridge service does not start

Look in Event Viewer (Windows Logs, Application) and in C:\KodaSubiektBridge\logs. The usual causes: the password of the service account changed (Services, KodaSubiektBridge, Log On: type the new one), appsettings.Local.json is not valid JSON (--check reads the same files and says where), or another program took port 5280 (set Urls in appsettings.Local.json and the Service URL of the tunnel).

After a Subiekt update the service usually starts but Subiekt does not answer: that is the version change from the previous answer.

### The nexo licence refuses work

A used up trial or an expired licence stops Sfera with "Limit czasu pracy". Activate a valid Subiekt nexo PRO licence on that machine. Make sure the licence has a workstation for the bridge machine; your InsERT partner can confirm how it counts the Sfera login.

### Every call fails after days of uptime

Sfera starts a WPF dispatcher on every thread that uses it, and a Windows service has a small desktop heap. Bridges that called Sfera from random threads ran out of it after about six days. This bridge runs every Sfera call on one dedicated thread, so it does not; if you see it, check that the service runs this bridge, then restart it.

### Subiekt is busy for over 5 minutes

Sfera is not safe for parallel sessions, so the bridge runs one operation at a time. A very long operation (a huge stock read, Subiekt doing maintenance) makes the others wait; the answer busy is retried by Medusa later.

### invalid_signature or stale_timestamp

invalid_signature: the secret differs between Medusa and the bridge. stale_timestamp: the clocks differ by more than 5 minutes. The Bridge section shows the skew. To change the secret without downtime, put the old one in previousSecret (Medusa) and PreviousSecret (bridge) for the switch.

### A WZ issued in Subiekt does not appear in Medusa

Issue the WZ from the ZK: Subiekt copies the ZK notes, with the order tag [medusa:order_...], to the WZ, and that tag is how the bridge finds the order. A WZ typed by hand has no tag. The bridge looks for new WZ every 2 minutes and Medusa reads the feed every 2 minutes; on its very first run the watcher starts after the newest WZ and announces none of the older ones.

### Can an order get two ZK or two invoices?

No. The bridge writes the order tag into every document and looks for it before it creates one, under the order lock and again under the Sfera lock. Medusa keeps one task per order and claims it atomically. An unclear answer (a timeout) becomes Answer unclear, and the next attempt asks the bridge first.

### Finish by hand in Subiekt after a cancel

Sfera cannot set the ZK status Unieważnione. The bridge marks the ZK at the top of its notes and with a custom flag when you have one; a person sets the status. Once a WZ or a sales document exists, the cancel is refused (document_locked): handle it as a return or a correction in Subiekt.

### Lines without a product in Subiekt (unmatched_lines)

The bridge matches every line by EAN first, then the SKU against the product symbol, and writes nothing when one line has no product. Fix the EAN in Subiekt (Miary, Kod kreskowy) or the SKU, then Send again. Services and gift cards without codes can be left off with omitLinesWithoutCode.

### --check passes but the service cannot log in to SQL Server

--check runs as you, the service as its own Windows account. Give that account access to the nexo database, or run --check as that account.

### Contractors are not created

Four switches must agree: Bridge:Subiekt:BuyerMode customer, Bridge:Subiekt:CreateContractors true, createContractors in medusa-config.ts, and the contractors writer armed here. An invalid NIP never creates one; the queue shows the warning.

### A variant is missing from the price plan

Prices match by EAN, then by the SKU equal to the symbol, without stripping SKU suffixes, so a wholesale -WH variant keeps its price. A product without a price in the level, a level in another currency, or a duplicated EAN never produce a change.

### The bridge machine was off over the weekend

Nothing is lost: every call is a task first and is retried for about two and a half days. Tasks still failing after that wait under Need attention with a Send again button.
