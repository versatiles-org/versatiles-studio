# Changelog

What changed in each release. Written for someone deciding whether
to update, not for the next developer — the commit log is that.

## v0.2.0 — 2026-08-24

### Features

- add semantics module to define field meanings and roles
- add missing map-label token and ensure all tokens are defined in tests
- add AlphaRibbon component and integrate tauri-plugin-opener for external URL handling
- enhance FeaturePopup to restrict queries to Studio's tiles and improve positioning logic
- enhance CropOverlay to support draft rectangle visualization during dragging
- implement live cost estimation in ExportDialog and update related documentation
- AssetManager is now a AssetsDialog
- add bundle-local script for building installer locally
- implement commit functionality for filter edits in LayerTree
- the layer tree edits filters, which is where the expressions are
- build and release for Windows, x64 and arm64
- update README and add CONTRIBUTING guide for v0.1.0 release
- the tap generates the cask
- update Homebrew cask after publishing release assets
- publish once the manifest verifies

### Fixes

- update Tauri dependencies and improve caching strategy
- improve CropOverlay layer management and repaint logic
- repair CropOverlay
- the map stops jumping back when the pipeline changes
- add sqlite3 installation for Windows runners in CI and release workflows
- npm needs a shell on Windows, and a dead spawn must say so
- .mbtiles is not a vector tile
- put the install text on the page, and verify the manifest

### Refactoring

- improve role definitions and structure in semantics module
- map overlays and source layer handling
- update CropSection to be folded away by default and improve Pipeline pane button styling
- remove PipelineOutput component and integrate output details into ExportDialog
- remove redundant section label from PipelineOutput component
- update button styling and introduce primary button class for consistency across dialogs
- move views to the top left
- update UI layout for camera controls and views: Adjust positioning of named views and jump-to-coordinate box for improved usability. Ensure controls for viewing results are clearly separated, enhancing the overall interface experience.
- bookmarks to views: Rename bookmarks to views, moving functionality to the map interface. Update UI components and commands to reflect the change, ensuring application-wide view management. Remove old bookmark code and integrate new view handling in the inspector and map controls.
- remove unused source property from Bookmark and related components
- simplify Inspector component by removing unused props and elements
- replace URL.pathname with fileURLToPath for cross-platform compatibility
- the preview synchronisation gets its own module
- one archive writer, one modal shell

### Documentation

- expand ecosystem.md with detailed field semantics and roles for operations
- clean up milestone item formatting in scope release document
- update scope release document to reflect changes in Windows builds and code signing
- release notes for v0.1.0, written rather than generated

### Build

- Windows ships x86_64 only

### Chores

- update Rust version to 1.94 and versatiles dependencies to 4.10.0

### Other

- remove deployment functionality and related components

## v0.1.0 — 2026-08-22

The first release. VersaTiles Studio opens map tiles, edits the pipelines that produce them, designs
styles over them and writes new tile sets — without a terminal and without a full GIS. It works
offline from first launch: the fonts and sprites a map needs are in the installer.

### Open and explore

- Opens `.versatiles`, `.mbtiles`, `.pmtiles` and `.tar` containers, from disk or over HTTP.
- Every attribute of the feature under the cursor, the container's own metadata and TileJSON, a
  z/x/y grid, jump-to-coordinate, and bookmarks that outlive the window.
- The window comes back as you left it — viewport, panes, and what was open.

### Edit a pipeline, and watch it

- A VPL document as a chain of nodes or as text, both over one document, with one undo stack across
  every graph in the project.
- Each node carries its own parameters, generated from the operation's own metadata — so an
  operation added upstream appears here with no work.
- The map redraws as you type. Tiles still being produced are shown as such rather than as gaps.
- Mistakes are underlined where they are, using the same check `versatiles` itself runs.

### Import and convert

- GeoJSON and its line-delimited forms, shapefiles, CSV tables of points, and raster sources —
  GeoTIFF, COG, a VRT mosaic, or a scanned PNG or JPEG.
- A CSV import reads its own header and fills in what it can.
- Export to `.versatiles`, `.mbtiles` or `.pmtiles`, cropped by a rectangle drawn on the map and a
  zoom range, with an estimate of the size and time before the run starts.
- Long jobs report progress and can be cancelled.

### Design a style

- Six presets from `@versatiles/style`, plus one derived from whatever layers your tiles turn out to
  contain — useful before a style exists.
- Global recolouring, and a searchable tree of every layer to hide, recolour or restrict by zoom.
- Export as `style.json`, as `@versatiles/style` code, or as a bundle carrying its own fonts and
  sprites.
- Extra font families install on demand and are verified against a pinned checksum.

### Take it elsewhere

- A project is a directory of real files: `project.yaml` beside `.vpl` pipelines and a `style.json`,
  each usable without Studio.
- "Save a copy" carries the data your pipelines read and rewrites them to match, as a folder or one
  `.zip`, so the result opens on another machine.
- The `versatiles convert` command, a `serve` config, a Dockerfile and a GitHub Action that
  reproduce the same result on the command line.

### Not yet

- **macOS builds are not notarised**, so macOS refuses them on first launch; the install notes below
  say how to get past it. Windows is not built at all.
- Updates are checked when you ask, never on a timer, and a `.deb` install cannot update itself —
  the package manager owns it.
- The layer tree cannot edit a value that is an expression; it shows it and leaves it alone.

