# Changelog

## 0.1.0 (unreleased)

### Added

- The first release: the packaging ladder of every product (piece, box, pallet), the minimum order quantity and the order step, with the box EAN and the pallet SSCC prefix.
- One page in the admin with the catalog products, an editor per product and the SSCC label tool (the 18-digit SSCC with the GS1 check digit and the GS1-128 payload), in English and Polish.
- A store API that serves the ladder to the product page, and the koda.integration/1 contract with one line per product and the board counter of products without packaging.
- Demo mode with sample ladders, flagged `demo`.
