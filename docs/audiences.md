# Target Audiences

> Draft. Everything here is open for discussion.

Five groups, in the order they matter for [Release 1](history.md). The IDs `P1`-`P5` are
stable and are referenced from the [Feature Catalogue](features.md) and from issues.

---

## P1 · Data journalists & NGOs

**Who.** Small teams, often a single person, on deadline. Comfortable with spreadsheets, maybe a bit
of JavaScript. No GIS training, no patience for a toolchain.

**Brings.** A CSV, a GeoJSON, a shapefile from a statistics office. Strong opinions about how the
result should look.

**Risk.** Unforgiving about polish. A rough edge a developer shrugs off will stop a journalist
entirely.

## P2 · Public administration & open-data offices

**Who.** Geodata departments in municipalities, state agencies, statistical offices. Often have GIS
skills, rarely have permission to install a Node toolchain or push data to a cloud service.

**Brings.** Shapefiles, GeoPackages, GeoTIFFs, OSM extracts. A mandate to publish. A procurement
process that hates subscriptions.

## P3 · Tile operators & self-hosters

**Who.** The existing VersaTiles community - people who already run `versatiles serve`, maintain a
tile server, or build their own data sets.

**Brings.** Large containers, real problems, and the willingness to file good bug reports.

## P4 · Web developers

**Who.** Building a site that needs a map. Want to be finished with the map part.

**Brings.** A design spec, a hosting setup, no interest in tiles as such.

## P5 · Cartographers & designers

**Who.** People for whom the style _is_ the work.

**Needs.** Deep style editing: layer tree, expressions with live preview (D3), fonts and sprites
(D4), glyph generation from arbitrary typefaces (D9), light/dark derivation (D5), legend generation
(D7), colour-blindness simulation (D6).
