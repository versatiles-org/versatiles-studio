//! Project model — a directory holding a `project.yaml` manifest beside real `.vpl` and
//! `style.json` files (G1, [Q6]).
//!
//! Not implemented yet; the manifest arrives at S5.1. Recent sources and bookmarks are **not**
//! here: they are application state, not project state, and live in [`crate::store`]
//! ([Q21](../../../docs/decisions.md)).
//!
//! [Q6]: ../../../docs/decisions.md
