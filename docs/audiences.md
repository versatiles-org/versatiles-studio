# Target Audiences

Five groups, in the order they matter for [Release 1](scope-release-1.md). The IDs `P1`–`P5` are
stable and are referenced from the [Feature Catalogue](features.md) and from issues.

## P1 · Data journalists & NGOs

- **Who** — small teams, often one person, on deadline. Comfortable with spreadsheets, maybe a bit
  of JavaScript. No GIS training, no patience for a toolchain.
- **Brings** — a CSV, a GeoJSON, a shapefile from a statistics office. Strong opinions about how the
  result should look.
- **Needs** — import without a toolchain (E1, E2), table join for a choropleth (E6), colour and
  typography control (D1, D3), the newsroom's own house typeface (D9), accessibility checking (D6),
  embed snippet (F5), static image export for print (F6).
- **Why Studio** — Mapbox Studio costs money and binds the result to one vendor; QGIS is a week of
  learning for a one-off map. Studio is free, local, and the output belongs to them.
- **Risk** — unforgiving about polish. A rough edge a developer shrugs off will stop a journalist
  entirely.

## P2 · Public administration & open-data offices

- **Who** — geodata departments in municipalities, state agencies, statistical offices. Often have
  GIS skills, rarely have permission to install a Node toolchain or push data to a cloud service.
- **Brings** — shapefiles, GeoPackages, GeoTIFFs, OSM extracts. A mandate to publish. A procurement
  process that hates subscriptions.
- **Needs** — GDAL-backed import (E3), DEM and raster processing (E4), export plus upload (F2, F3),
  the mandated corporate-design typeface (D9), and reproducibility, which G1 answers directly: a
  project is a directory of real `.vpl` files that `versatiles` runs unchanged on their own server.
- **Why Studio** — local, no account, no telemetry, open source, auditable. That combination is rare
  and is the entire pitch for this group.
- **Risk** — long sales cycle, and they need documentation and stability more than features. One
  known unmet need: **GeoPackage is unsupported in release 1** ([Q20](decisions.md)), so a group that
  brings GeoPackages has to convert them first.

## P3 · Tile operators & self-hosters

- **Who** — the existing VersaTiles community: people who already run `versatiles serve`, maintain a
  tile server, or build their own data sets.
- **Brings** — large containers, real problems, and the willingness to file good bug reports.
- **Needs** — the analysis cluster: size breakdown (B2), spec validation (B3), coverage gaps (B4),
  container diff (B5), compression comparison (B6). Plus the pipeline editor (cluster C) as an
  authoring tool for pipelines that later run in production.
- **Why Studio** — nothing else gives them this instrumentation. `probe` answers some of it on the
  command line; Studio makes the answers visual and clickable.
- **Strategically** — smallest group, but the fastest to serve, since most of the machinery exists,
  and the one that produces feedback, contributions and word of mouth. Also the early audience for
  the `v0.x` releases ([Q8](decisions.md)).

## P4 · Web developers

- **Who** — building a site that needs a map. Want to be finished with the map part.
- **Brings** — a design spec, a hosting setup, no interest in tiles as such.
- **Needs** — open a source, cut out a region (F2), restyle to brand colours (D1, D2), export tiles
  plus style plus a working snippet (F5), leave.
- **Why Studio** — faster than assembling the pipeline by hand, and the result is self-hostable.
- **Implication** — for this group Studio is a tool, not a home. Every artefact must be exportable
  and nothing may only exist inside Studio.

## P5 · Cartographers & designers

- **Who** — people for whom the style _is_ the work.
- **Needs** — deep style editing: layer tree, expressions with live preview (D3), fonts and sprites
  (D4), glyph generation from arbitrary typefaces (D9), light/dark derivation (D5), legend generation
  (D7), colour-blindness simulation (D6).
- **Why Studio** — editing a MapLibre style by hand is miserable, and the hosted alternatives do not
  support self-hosted tiles well.
- **Risk** — the highest quality bar of all. Half a style editor may be worse than none.
