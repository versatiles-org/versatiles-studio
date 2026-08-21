//! VersaTiles Studio core.
//!
//! A plain Rust library with **no Tauri types**, so it can be driven by ordinary tests with no
//! Tauri runtime ([Q3](../../../docs/decisions.md)). `src-tauri` is a thin binding over this.
//!
//! Modules mirror the core services in `docs/architecture.md`.

pub mod analysis;
pub mod assets;
pub mod estimate;
pub mod export;
pub mod graphs;
pub mod history;
pub mod import;
pub mod jobs;
pub mod preview;
pub mod project;
pub mod server;
pub mod store;
pub mod style;
pub mod suggest;
pub mod tabular;
#[cfg(test)]
mod testing;
pub mod vpl;
