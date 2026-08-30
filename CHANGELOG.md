# Changelog

What changed in each release. Written for someone deciding whether
to update, not for the next developer - the commit log is that.

## v0.3.0 - 2026-08-30

### Features

- add Control::Steps for per-zoom quality settings
- refine sampling logic to ensure comprehensive level coverage and establish minimum sample thresholds
- enhance export dialog to allow selection of container format and compression options
- add compression options for tile exports and estimates
- update export estimation to remove time prediction and improve accuracy of size reporting
- add detailed error handling for writable exports to improve user feedback on tile selection
- enhance job entry tracking with new anchor structure for accurate rate measurement
- replace hardcoded file fields with dynamic registry lookup for improved accuracy
- enhance tile probing to optimize raster source handling and improve performance
- implement tile serving with deadline management to prevent hanging requests
- add tile failure handling and deadline management for improved user feedback
- enhance field suggestions by integrating upstream node layer information
- update file dialog filtering logic to use per-argument accepts for improved path handling
- add file dialog filtering based on field extensions and refactor related components
- implement caching for reusable read nodes in VPL to optimize pipeline builds
- extend control mapping to include GeoDataPath and TileFilePath for path validation
- update versatiles packages to version 4.12.1 for compatibility
- update documentation to reflect upstream changes and adjust size budgets
- update versatiles packages to version 4.12 for compatibility
- add georeferencing tests for raster fixtures and handle spatial reference validation
- enhance error reporting and validation for VPL constructs and formats
- update color handling logic to reflect type changes in 4.11 and remove deprecated roles
- introduce new control type 'Char' and update related logic for character handling
- update versatiles packages to version 4.11 and refactor related code for compatibility
- add tests for tile size documentation consistency and control type validation
- add color detection logic in operations to ensure proper control handling for color fields
- add validation for color fields to ensure three-byte representation in registry
- enhance control handling in NodeArgument to ensure type safety and improve user feedback for unsupported controls
- enhance field suggestion logic to ensure accurate column mapping and improve registry access
- add exhaustive control handling in summarise function to ensure compile-time safety
- add root directory handling to path injection model
- implement new source opening functionality and update related tests
- enhance geospatial data handling by adding .aux.xml files and updating README
- add CodeQL model and pack configuration for path validation
- update documentation to include SourcesPane and clarify styling rules
- refactor layer handling by introducing declaredLayers function and removing layersIn
- add detach method to Waiter interface to manage signal cleanup in TileQueue
- add tests for PipelinePane to ensure document-specific draft handling and error reporting
- refactor preview handling to unify hairlines management and improve state clarity
- add documentation for the layer stack and update test for layer size
- enhance pane reconciliation and add utility for precise element selection in E2E tests
- update architecture and decisions documentation to clarify layer reordering and UI structure
- add end-to-end tests for source selection and layer management
- Implement layer reordering functionality
- implement filter reading and writing for layers
- enhance layer management with segment handling and visibility features
- add categories and tree structure for layer management with tests
- implement segment-based order handling and visibility management for sources
- introduce placeholderFor function to differentiate source URLs in exported styles
- implement preview caching to skip unnecessary rebuilds for unchanged pipelines
- enhance error reporting by including context in status bar and error messages
- refactor Picker to use shared popup logic and introduce Menu component
- add color control with swatch support and enhance color handling in operations
- implement choice control for fields with limited options and improve unset handling
- implement reanchoring of file references in VPL saving to ensure paths are correctly relative or absolute
- optimize remote document fetching by reducing request size and improving performance
- implement drawableLayers function to ensure derived styles reflect all declared layers
- enhance import handling for JSON formats and improve source parameter resolution
- enhance project pane visibility and messaging for empty states across components
- update bbox handling to ensure correct parsing and representation as four numbers
- implement bbox field for map interaction and enhance rectangle handling
- enhance report generation and redaction logic for improved privacy and clarity
- enhance style composition to retain all sources and improve layer source handling
- adjust z-index for dropdown and map controls to ensure proper layering
- reorganize map controls into a single stack and implement shared dropdown for background and views
- implement grid level control and requested zoom logic for TileGrid component
- implement busy markers for pending tiles in TileActivity component
- enhance inspector pane to display selected graph's output and inputs distinctly
- implement layer overrides for all vector sources in style rendering
- document tile swap behavior and its impact on style updates in architecture
- enhance addContainerToMap and tile-swap functionality to support tile swapping and source management
- implement tile swapping functionality to optimize style updates and prevent unnecessary rebuilds
- enhance style application handling to prevent blocking subsequent styles when no changes occur
- enhance tile request handling to support multiple concurrent requests and improve state management
- implement disabled operations tracking in graphs and projects, ensuring exports reflect current state
- enhance NodeChain and PipelinePane with visual indicators for node states and add e2e tests for switching operations
- refactor import handling by removing ImportCards and integrating Picker for graph creation
- add path control type and update related components for file handling
- add file picker functionality for path parameters and enhance NodeArgument tests
- improve UI and test descriptions for file handling and drop hints
- add "New empty project" option to launcher and update UI components
- implement window visibility control for end-to-end testing
- enhance end-to-end testing with detailed failure logging and evidence capture
- add end-to-end testing job to CI and update documentation
- add restored flag to manage camera state during refresh
- include rate and ETA in job progress events and update handling
- simplify landing screen controls and add tests for functionality
- enhance tile handling and error reporting for MapLibre integration
- update landing screen to launcher window and improve project handling
- refresh menu state on window focus to reflect project status
- update window management and launcher behavior for improved project handling
- implement launcher window and project opening functionality
- update layout handling to support per-project layouts and improve window management
- implement project-specific job handling and event reporting
- implement unmount_prefix to remove mounts by window prefix feat(docs): update Release 3 scope to reflect changes in mount handling feat(sources): adjust open_container to use project-specific mount names feat(vpl): modify graph handling to ensure unique mounts per window feat(state): enhance Project struct to manage mount prefixes for windows
- update README and decisions for Release 3 scope, add new documentation for project window functionality
- implement style application logic to avoid mid-load errors in MapLibre
- add functionality to show problem log in file manager
- replace AppBar with native menu items for fonts and updates, add UpdateDialog
- implement native menu for project actions and integrate with app state
- implement problem report saving and issue creation functionality
- implement Boundary component to isolate failures in Svelte application
- enhance diagnostics logging and reporting functionality
- implement diagnostics reporting and management
- add tests for addContainerToMap and removeContainerFromMap functions
- implement unwrap function and add tests for help popover functionality
- add tests for style pane functionality and gesture handling
- add comprehensive tests for document, export, graphs, jobs, layout, project, and updates state management
- add validation tests for MapLibre style acceptance and adjust style handling
- update StylePane to rename 'Relief' to 'Hillshade' and adjust tests accordingly
- add StylePane tests and Tauri stub for rendering in JSDOM
- refactor error handling in status management and add tests for message unwrapping
- add state management for graphs and exporting functionality
- integrate document state management for improved editor reactivity
- implement crop shape utilities and tests for rectangle, outside, boxBetween, and isRectangle functions
- add controls and slider functionality for style pane
- implement layout management for window state and pane handling
- enhance background handling in style composition and add related tests
- add clear functionality for recolor, raster, and hillshade fields in style pane
- implement pruning of style overrides for layers no longer present
- add hillshade support for elevation sources and enhance style management
- implement draw order management for style sources and enhance stack handling
- implement composeStyle function for stacking sources and managing draw order
- add raster adjustment functionality to style management
- implement styleFor function to enhance style derivation and reporting in the map
- implement tile schema handling and source kind selection in style management
- add Release 2 scope and style use cases documentation

### Fixes

- standardize button label from "＋" to "+" for consistency across documentation and code
- update test to use a unique temporary file for unusual delimiter handling
- open a file dropped on the launcher
- update cpufeatures dependency from 0.3.0 to 0.3.1
- standardize border-radius values in LayerRow and StylePane components
- tell a superseded build from a graph that draws nothing
- improve range request handling and add loopback server for testing
- correct coordinate parsing order and update placeholder text for clarity
- ensure layer overrides are correctly applied for unstyled sources and prevent unnecessary entries in the recipe
- correct markdown links in architecture, decisions, ecosystem, history, and UI documents style: adjust spacing tokens for better layout differentiation in the pipeline pane feat: enhance NodeChain and PipelinePane components for improved visual hierarchy and functionality
- replace test command with coverage command for web tests
- update coverage include pattern to exclude scripts and svelte files
- update test command to remove coverage flag for web tests
- replace incorrect glyphs with the correct multiplication sign for delete actions
- update references from Pipeline to Sources pane in documentation and code

### Refactoring

- update sha2 dependency to 0.11 and adjust digest handling in asset manager
- Add workbench module and tests for document handling and state management
- consolidate window event handling into a dedicated module
- modularize map composition logic and add tests for style handling
- hold the preview's state as one record
- improve comments for clarity and consistency across multiple files
- update inspector pane to display inputs above results and improve fold functionality
- end-to-end tests and application structure
- implement status management and stack handling for map rendering
- style handling to support graph-specific appearances
- update documentation link definitions to support multiple files

### Documentation

- remove unnecessary brackets in comments for clarity across multiple files
- update comments for clarity and consistency in VPL and IPC modules
- update release history and documentation references for accuracy
- enhance architecture and components documentation for clarity and detail
- clarify comments in utility class description for better understanding
- Add tests for decision log chapter order and decision filing
- Refactor documentation for clarity and accuracy
- Reduce word budget for decisions documentation from 8250 to 5000 to better align with current content expectations.
- Refactor documentation links and references to use the consolidated history document
- fix hyphen
- Refine documentation across multiple files

### Tests

- update test to use from_debug for consistent tile retrieval and ensure filter effectiveness
- adjust button order in UpdateDialog for consistency with other dialogs
- enhance end-to-end testing setup with binary validation
- add geospatial data files for testing
- enhance component organization tests to validate pane naming and inventory documentation
- add end-to-end testing support with WebDriverIO

### Chores

- update versatiles package versions to 4.12.2 in Cargo files
- update package.json to add @puppeteer/browsers override
- update dependencies and package versions

### Other

- style: enhance accessibility by updating button titles and aria-labels in LandingScreen and StepsDialog
- style: update save dialog title to include ellipsis for consistency with other dialog titles
- style: update labels in Inspector component to sentence case for improved readability
- style: add truncation to file paths in CopyDialog and Picker components for improved readability
- style: update typography for section labels in MapControls and Inspector; adjust letter-spacing in DiagnosticsPanel
- Refactor VPL semantics and validation logic
- Refactor UI structure and functionality for graph management
- Refactor graph and preview handling to improve node visibility and state management
- Refactor project management to support one project per window

## v0.2.0 - 2026-08-24

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

## v0.1.0 - 2026-08-22

The first release. VersaTiles Studio opens map tiles, edits the pipelines that produce them, designs
styles over them and writes new tile sets - without a terminal and without a full GIS. It works
offline from first launch: the fonts and sprites a map needs are in the installer.

### Open and explore

- Opens `.versatiles`, `.mbtiles`, `.pmtiles` and `.tar` containers, from disk or over HTTP.
- Every attribute of the feature under the cursor, the container's own metadata and TileJSON, a
  z/x/y grid, jump-to-coordinate, and bookmarks that outlive the window.
- The window comes back as you left it - viewport, panes, and what was open.

### Edit a pipeline, and watch it

- A VPL document as a chain of nodes or as text, both over one document, with one undo stack across
  every graph in the project.
- Each node carries its own parameters, generated from the operation's own metadata - so an
  operation added upstream appears here with no work.
- The map redraws as you type. Tiles still being produced are shown as such rather than as gaps.
- Mistakes are underlined where they are, using the same check `versatiles` itself runs.

### Import and convert

- GeoJSON and its line-delimited forms, shapefiles, CSV tables of points, and raster sources -
  GeoTIFF, COG, a VRT mosaic, or a scanned PNG or JPEG.
- A CSV import reads its own header and fills in what it can.
- Export to `.versatiles`, `.mbtiles` or `.pmtiles`, cropped by a rectangle drawn on the map and a
  zoom range, with an estimate of the size and time before the run starts.
- Long jobs report progress and can be cancelled.

### Design a style

- Six presets from `@versatiles/style`, plus one derived from whatever layers your tiles turn out to
  contain - useful before a style exists.
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
- Updates are checked when you ask, never on a timer, and a `.deb` install cannot update itself -
  the package manager owns it.
- The layer tree cannot edit a value that is an expression; it shows it and leaves it alone.

