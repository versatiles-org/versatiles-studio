# Target Audiences

---

## P1 · Data journalists & NGOs

**Who.** Small teams, often a single person, on deadline. Comfortable with spreadsheets, maybe a
bit of JavaScript. No GIS training, no patience for a toolchain.

**Brings.** A CSV, a GeoJSON, a shapefile downloaded from a statistics office. Strong opinions
about how the result should look.

**Needs.** Import wizard (E1, E2), table join to make a choropleth (E6), colour and typography
control (D1, D3), the newsroom's own house typeface on the map (D9), accessibility checking (D6),
embed snippet (F5), and a static image export for print (F6).

**Why Studio.** Mapbox Studio costs money and binds the result to one vendor; QGIS is a week of
learning for a one-off map. Studio is free, local, and the output belongs to them.

**Risk.** This group is unforgiving about polish. A rough edge that a developer shrugs off will
stop a journalist entirely.

---

## P2 · Public administration & open-data offices

**Who.** Geodata departments in municipalities, state agencies, statistical offices. Often have
GIS skills, rarely have permission to install a Node toolchain or push data to a cloud service.

**Brings.** Shapefiles, GeoPackages, GeoTIFFs, OSM extracts. A mandate to publish. A procurement
process that hates subscriptions.

**Needs.** GDAL-backed import (E3), DEM and raster processing (E4), `planetiler` orchestration
(E5), export plus upload (F2, F3), the mandated corporate-design typeface (D9), and
reproducibility — the CLI command or CI snippet that lets them run the same thing on their own
server (C7).

**Why Studio.** Runs locally, no account, no telemetry, open source, auditable. That combination
is rare and is the entire pitch for this group.

**Risk.** Long sales cycle, and they need documentation and stability more than features.

---

## P3 · Tile operators & self-hosters

**Who.** The existing VersaTiles community. People who already run `versatiles serve`, maintain a
tile server, or build their own data sets.

**Brings.** Large containers, real problems, and the willingness to file good bug reports.

**Needs.** Everything in the analysis cluster: size breakdown (B2), spec validation (B3),
coverage gaps (B4), container diff (B5), compression comparison (B6). Plus the pipeline editor
(cluster C) as an authoring tool for pipelines that later run in production.

**Why Studio.** Nothing else gives them this instrumentation. `probe` already answers some of it
on the command line; Studio makes the answers visual and clickable.

**Strategically.** Smallest group, but the fastest to serve — most of the machinery exists — and
the one that produces feedback, contributions and word of mouth.

---

## P4 · Web developers

**Who.** Building a site that needs a map. Want to be finished with the map part.

**Brings.** A design spec, a hosting setup, no interest in tiles as such.

**Needs.** Open a source, cut out a region (F2), restyle to brand colours (D1, D2), export tiles
plus style plus a working snippet (F5), leave.

**Why Studio.** Faster than assembling the pipeline by hand, and the result is self-hostable.

**Implication.** For this group Studio is a tool, not a home. Every artefact must be exportable
and nothing may only exist inside Studio.

---

## P5 · Cartographers & designers

**Who.** People for whom the style _is_ the work.

**Needs.** Deep style editing: layer tree, expressions with live preview (D3), fonts and sprites
(D4), glyph generation from arbitrary typefaces (D9), light/dark derivation (D5), legend
generation (D7), colour-blindness simulation (D6).

**Why Studio.** Editing a MapLibre style by hand is miserable; the hosted alternatives do not
support self-hosted tiles well.

**Risk.** This group has the highest quality bar of all. Half a style editor may be worse than
none.
