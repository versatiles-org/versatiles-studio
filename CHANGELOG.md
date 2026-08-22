# Changelog

What changed in each release. Written for someone deciding whether
to update, not for the next developer — the commit log is that.

## v0.1.0 — 2026-08-22

### Features

- implement path validation to prevent directory traversal vulnerabilities
- add signing check for updater secrets to prevent versioning issues
- one command to cut a release
- release workflow, Homebrew cask and auto-update (S5.6–S5.8)
- a style bundle, and fix the URLs the plain export carried
- crop by rectangle, in the pane rather than the dialog
- a project you can send somebody
- show the commands that reproduce this project elsewhere
- the commands that reproduce a project elsewhere (S5.5)
- projects save and open (S5.1)
- a project is a directory with a manifest (S5.1 core)
- the mode bar, and fonts you can install (S4.1)
- installing and removing font families (S4.1 back end)
- the asset manager's core (S4.1)
- a style leaves Studio as JSON or as code (S4.6)
- a layer tree over the rendered style (S4.5, partial)
- a style derived from the layers the tiles have (S4.4)
- the map draws the style recipe (S4.3)
- update map styling and token definitions for improved clarity and consistency
- enhance field suggestions to support multiple nodes in a pipeline
- refactor node selection logic and enhance pipeline preview functionality
- update text color in TileActivity for improved visibility across themes
- update color tokens and styles for improved UI consistency across components
- update TileActivity layer roles and styles for improved clarity and visibility
- add TileActivity component and enhance tile rendering indicators
- the bar says whether tiles are queued or rendering
- update milestone tasks in release scope document for clarity and completeness
- add styling for drop elements in NodeCard component to improve UI consistency
- integrate help component to manage popover positioning in Picker
- enhance Picker component with examination and tooltip features for improved item selection
- implement Picker component for enhanced filtering and grouping of items
- enhance server configuration with custom watch options to optimize file handling
- implement fitting logic for transforms and integrate into preview and UI components
- update upstream asks in ecosystem and scope release documents
- the core owns the style, as the recipe it is made from
- an export says what it will cost before you commit to it
- add script to prune unused build directories
- add script to upgrade Rust and NPM dependencies
- the status bar shows a job's speed and how long is left
- export a graph from a modal, with zoom and numeric bounds
- export a graph to a container, as a queued job
- an export can be narrowed by bounding box and zoom range
- a graph is named after the file it came from
- a graph can be deleted
- node help shows the operation's summary
- enhance NodeCard to display required parameters and manage their values
- add help popover component and integrate with NodeCard for parameter documentation
- the graph list and the node-as-form (S2.13)
- a project holds several named graphs (S2.12)
- implement structural edits for VPL pipeline, adding and removing operations
- add export module for writing pipeline output to container files
- enhance JobHandle with a cloneable Reporter for progress reporting
- link GDAL statically and enable the raster import path
- a CSV import reads its header and fills in what it can
- the import form learns the data it is configuring
- one import catalogue, and cards in both places
- job runner with two lanes, and a cancellable preview
- generate the IPC types with tauri-specta
- open .versatiles, .mbtiles, .pmtiles and .vpl from the OS (S0.1)
- add background map, reset view, and gather the map controls
- save the pipeline as a .vpl from the Pipeline section
- open .vpl files as the window's pipeline (C9, S2.9)
- add undo history
- remove unused probe module and update architecture documentation for tile URL caching
- implement live preview of selected node in pipeline, enhancing map interactivity
- update styling documentation and tests to enforce font size rules on body element
- implement dynamic parameter setting for VPL nodes
- add PipelineGraph component for visualizing VPL as a vertical tree and implement node selection synchronization
- enhance pane resizing experience by preventing text selection during drag
- implement draggable pane resizer for left and right panes, enhancing layout flexibility
- add validation module for VPL with diagnostic reporting
- implement VPL editor with syntax highlighting and token management
- enhance container handling by adding SourceType support and improving mount logic
- replace CommandStrip with StatusBar for improved status reporting and remove command functionality
- refactor styling to improve consistency and introduce shared classes for common elements
- update styling to use font-size and font-family tokens for consistency and improve native control theming
- implement dark theme support with responsive styling and map color adjustments
- update window title to reflect current container name
- Implement VPL parsing and structured editing with UI integration
- Implement left-pane layout management with collapsible sections and VPL integration
- Implement VPL Document Model with Differential Testing
- update documentation to reflect UI changes and decision Q22 regarding map surface and mode separation
- refactor state management to use a unified data directory for recents and bookmarks
- add safety checks for repository and asset validation in asset fetching
- add ignore rule for glib dependency in Dependabot configuration to prevent failed updates
- enhance JsonTree component with foldable details and summary for better JSON visualization
- update MapLibre worker path and configuration for Vite compatibility
- add allowScripts configuration for esbuild and fsevents
- update README with building prerequisites, run instructions, and asset management details
- implement bookmarks functionality with storage and management
- update architecture and decisions documentation to clarify recent sources and bookmarks storage
- add tile inspection functionality and integrate with FeaturePopup component
- implement recent sources functionality, add landing screen for empty state, and enhance recents management
- add grid and feature popup components, implement coordinate jump functionality
- add URL input for opening remote containers in Inspector component
- implement Inspector and CommandStrip components, enhance AppShell layout, and add drag-and-drop support for tile containers
- add support for opening and managing tile containers in the embedded server
- implement MapCanvas component and default style for map rendering
- update package.json and package-lock.json to include esbuild as a dependency
- add permissions section to CI workflow for least privilege access
- add ignore rule for TypeScript updates in Dependabot configuration
- update README with build instructions and remove unused dependencies from package.json and package-lock.json
- add cargo package ecosystem to Dependabot configuration for Rust advisories
- update Rust version to 1.88 for improved compatibility and security
- update GDAL driver list and binary size measurement in documentation
- implement window management with crash isolation and memory measurement, add open window command
- implement asset fetching and bundling for sprites and glyphs, update CI and documentation
- add asset management scripts and update CI workflow for version checks
- implement job runner with progress reporting and cancellation
- initialize VersaTiles Studio with Tauri and Svelte setup
- add Prettier configuration and package setup for code formatting
- add dependabot configuration for npm and GitHub Actions
- add menu

### Fixes

- add withCargoLockVersion function to manage package versions in Cargo.lock
- stop the smoke-test bundle demanding the signing key
- the pipeline writer guards its own destination
- set timeout limits for CI jobs to prevent hangs during execution
- save_vpl checks its destination, as export_graph already does
- remove unnecessary backslash unescaping in documentation identifier tests
- enable caching of dependencies on job failure in CI workflow
- enable manual triggering of the CI bundle job
- block pkg-config for GDAL only, not for everything
- clarify operation requirements for valid graph connections
- cancelling a job leaves the bar quiet
- ensure proper synchronization of graph state after opening a VPL document
- the landing screen scrolls, and the status bar stays on top
- Save suggests the graph's name, not pipeline.vpl
- an open project is one with a graph, not one with a container
- an unbuildable document is not built
- the unsaved dot tracks the graph it belongs to
- a selection does not outlive the graph it was made in
- a source inside a composite can be removed again
- the core owns the map camera, and the docs say what is true
- update NodeCard styles for improved path display and alignment
- enhance graph handling and parameter management in NodeCard and PipelinePane
- prevent double registration of GDAL drivers to avoid process abort
- lint warnings
- only draw tile formats a map can render
- disable scrolling in window
- update comments for clarity on job bar and mode bar positioning in explore mode
- replace assertAllowedRepo with resolveRepo for safer repository validation
- update funding information in FUNDING.yml

### Refactoring

- upstream decides what a pipeline gets wrong (vt#224)
- upstream reads the CSV header now (vt#237, vt#238)
- upstream supplies the operation summary now
- consolidate temporary directory creation for tests into a shared module
- optimize CSV header reading by reducing file reads
- read a CSV header with the reader the pipeline uses
- buttons carry no box unless they ask for one
- components live with their owners
- group PipelinePane's callbacks by what they act on
- one component per argument
- extract HelpTrigger and ArgumentField from NodeCard
- sidebar and pane components for improved structure and functionality
- VPL serialization and parsing to utilize upstream's lossless CST
- remove font-size declarations and update type scale for consistency
- styling and implement design tokens

### Documentation

- badges, and an actual LICENSE file
- update README with CI and coverage badges
- two more asks filed (vt#252, vt#253)
- close the divergence, and stop the layout drifting again
- two more asks filed upstream (vt#248, vt#249)
- drop S0.13 — the app was already named correctly
- the core owns the style's recipe, not the style (Q36)
- what a path crossing the IPC boundary may be
- update architecture and test documentation to reflect changes in upstream parser integration
- clarify upstream capability considerations in architecture
- Q35 — a name is chosen once, and cursors are not core state
- Q33 reverses Q32 on required arguments rather than completing it
- two doc comments described functions that had changed under them
- setPipelineText is not a shim, and its name is a placeholder
- say why the selection is lifted, and that the core does not own it
- previewName says what it is, and the map follows the pin
- say which half of Q32's serving model is built
- split the GDAL fork out of Q19, collapse superseded text
- point at the decision log instead of restating it
- reconcile the documentation with the code
- how components are organised and named
- record the open upstream asks, and fail when #229 lands
- Q33 — the node form explains itself without symbols
- a project holds several named graphs (Q32)
- update architecture and decisions documentation to clarify pane structure and export ownership
- record that GDAL cannot link into Studio (S3.5 blocked)
- add undo history
- add support for opening .vpl files in the editor and enhance UI interactions for file handling
- update documentation to reflect removal of command strip and adjustments to status bar
- update components and styling documentation for dark theme implementation
- add styling documentation for consistent CSS rules and design tokens
- clarify asset management details and update feature descriptions in documentation
- clarify decision documentation and update UI concept for mode bar functionality
- update audience, decisions, features, scope, and UI documentation for clarity on GDAL support and project settings
- update decisions, ecosystem, features, and scope documentation to include details on statically bundled GDAL and fixed driver set
- add repository layout section to architecture documentation for improved clarity on project structure
- update README and architecture documentation to include Svelte components and clarify UI design decisions
- clarify sources panel decisions and UI layout for improved understanding
- Refactor documentation for clarity and conciseness
- update documentation to reflect funding milestones and clarify feature stages for Release 1
- enhance ecosystem and UI documentation with practical details and clarifications for improved understanding
- update feature catalogue to clarify feature stages and remove dropped items for Release 1
- update decisions, ecosystem, features, and UI documentation to clarify the removal of comparison views for Release 1
- update decisions, ecosystem, features, scope, and UI documentation to reflect the removal of the multi-source layer stack (A3) and its implications for Release 1
- clarify Sources panel functionality and mode distinctions in UI documentation
- update architecture and decisions documentation to clarify project structure and UI principles for Release 1
- add UI concept documentation outlining the application structure and user interface stages for Release 1
- Refine roadmap, scope, and vision documents for Release 1
- update documentation to include undo/redo feature in release 1 and clarify its implementation stages
- update documentation to clarify project scope, architecture, decisions, and feature catalogue for release 1
- update architecture, audiences, ecosystem, features, roadmap, and vision documentation to clarify project scope and decisions for release 1
- update decisions and feature documentation to clarify node graph requirements and scope for release 1
- update documentation to clarify Release 1 targets for Linux and macOS, and adjust audience IDs
- update roadmap and decisions documentation to reflect early release strategy and project directory structure
- update project file structure to use a directory with a YAML manifest and real files; adjust related documentation
- enhance architecture and decisions documentation with three planes of communication and generated parameter forms
- update release 1 scope to include Linux packaging and Homebrew cask; defer Windows and Apple notarisation
- define Release 1 scope and commitments in documentation
- enhance documentation with glyph generation details and audience needs
- update architecture diagram to use Mermaid syntax for clarity and detail
- update architecture and decisions documentation for clarity and detail

### Tests

- the default type size may not be restated
- add documentation link and identifier validation tests

### Build

- name the checks and add eslint
- bump the action group with 2 updates

### CI

- coverage for both codebases, under separate flags
- cache the Linux package downloads
- install only the Linux packages that are actually needed

### Chores

- one convention for every npm script
- versatiles-rs 4.9.1, and adopt the four that landed
- versatiles-rs 4.9.0, where MBTiles adapts instead of refusing
- upgrade dependencies for maplibre-gl, svelte-check, tsx, and vitest
- delete PipelineGraph and VplNodeCard
- update dependencies in package.json

### Other

- revert: stay on CodeQL default setup
- tools: one PDF of every planning document
- style: rules that extend another are nested inside it
- Remove legacy files and add foundational documentation for VersaTiles Studio
- add funding.yml
- stuff
- basic layout
- upgrade dependencies
- update icon
- cleanup
- initial commit
