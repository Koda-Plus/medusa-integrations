# Changelog

## 0.1.0 (unreleased)

### Added

- The Ceneo module with its tables (`ceneo_feed`, `ceneo_offer`) and options: `feed` (token, product URL template, region, sales channel, offer id, `avail` values, out of stock handling, build interval), `reviews` (Zaufane Opinie account GUID, survey delay), `apiKey`, `timeoutMs`, `demo`. Missing or broken options never stop Medusa from starting.
- The Ceneo XML feed: built by the `ceneo-build-feed` job (every `feed.intervalMinutes` and after product changes) or the "Build now" button, served from the table at `GET /ceneo/feed/<token>.xml` with an ETag. Calculated gross prices of the region in PLN, availability and stock from the channel's locations, the product URL template, images, description, `EAN` and `Kod producenta`. Problems per variant on the offer rows; an offer with an error never reaches the file. Offer ids are never reused for another variant. An unchanged file adds no new build row; old builds are pruned.
- The workflow `buildCeneoFeedWorkflow` (export `./workflows`).
- The admin page under Extensions in English and Polish: offer counters, the feed card (address to paste into Panel Ceneo, what it still needs, the last build), the setup guide and the options in use.
