//! VersaTiles Studio core.
//!
//! A plain Rust library with **no Tauri types**, so it can be driven by ordinary tests with no
//! Tauri runtime ([Q3](../../../docs/decisions.md)). `src-tauri` is a thin binding over this.
//!
//! Modules mirror the core services in `docs/architecture.md`.

pub mod project;
pub mod vpl;
pub mod jobs;
pub mod analysis;
pub mod assets;
pub mod server;
