//! Studio's own file dialog: folders on this computer and on SFTP servers, and where it was.
//!
//! The listing is the core's ([`studio_core::browse`]); what is here is where to start - the folder
//! the dialog was last in, or the home folder - and keeping that for next time.

use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use studio_core::browse::{Listing, Server};
use studio_core::store::{Browsing, SavedServer};
use tauri::{AppHandle, Manager, State};

/// A folder offered beside the listing, by the name a person knows it by.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Place {
	pub label: String,
	pub path: String,
}

/// The folders everybody has: home, the desktop, documents, downloads - those that exist.
#[tauri::command]
#[specta::specta]
pub fn browse_places(app: AppHandle) -> Vec<Place> {
	let paths = app.path();
	[
		("Home", paths.home_dir()),
		("Desktop", paths.desktop_dir()),
		("Documents", paths.document_dir()),
		("Downloads", paths.download_dir()),
	]
	.into_iter()
	.filter_map(|(label, dir)| {
		let dir = dir.ok().filter(|dir| dir.is_dir())?;
		Some(Place {
			label: label.to_string(),
			path: dir.to_string_lossy().into_owned(),
		})
	})
	.collect()
}

/// Lists a folder on this computer - or, given none, the one the dialog was last in, or home.
#[tauri::command]
#[specta::specta]
pub async fn browse_local(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> Result<Listing, String> {
	let start = match path {
		Some(path) => PathBuf::from(path),
		None => {
			let remembered = state.browsing.lock().await.folder.clone().map(PathBuf::from);
			match remembered.filter(|dir| dir.is_dir()) {
				Some(dir) => dir,
				None => app.path().home_dir().map_err(|e| format!("{e:#}"))?,
			}
		}
	};
	// Off the async threads: a folder on a network drive can take its time to answer.
	tauri::async_runtime::spawn_blocking(move || studio_core::browse::list_local(&start))
		.await
		.map_err(|e| format!("{e:#}"))?
		.map_err(|e| format!("{e:#}"))
}

/// Lists a folder on a server - or, given none, the one the dialog was last in there, or the folder
/// the server signs in to.
#[tauri::command]
#[specta::specta]
pub async fn browse_remote(
	state: State<'_, AppState>,
	server: Server,
	path: Option<String>,
) -> Result<Listing, String> {
	if path.is_some() {
		return state
			.sessions
			.list(&server, path.as_deref())
			.await
			.map_err(|e| format!("{e:#}"));
	}
	let remembered = state
		.browsing
		.lock()
		.await
		.servers
		.iter()
		.find(|saved| same_login(&saved.server, &server))
		.and_then(|saved| saved.folder.clone());
	// A remembered folder that has gone since is not worth an error: start where the server does.
	if let Some(folder) = remembered
		&& let Ok(listing) = state.sessions.list(&server, Some(&folder)).await
	{
		return Ok(listing);
	}
	state.sessions.list(&server, None).await.map_err(|e| format!("{e:#}"))
}

fn same_login(a: &Server, b: &Server) -> bool {
	a.host == b.host && a.port == b.port && a.user == b.user
}

/// Where the dialog was, for it to open there again.
#[tauri::command]
#[specta::specta]
pub async fn browsing(state: State<'_, AppState>) -> Result<Browsing, String> {
	Ok(state.browsing.lock().await.clone())
}

/// Keeps where the dialog was when something was chosen: the tab, the local folder, and the server
/// with its folder, which moves to the top of the list.
///
/// A failed write is logged and swallowed, like the layout's: losing a folder costs one more click.
#[tauri::command]
#[specta::specta]
pub async fn remember_browsing(
	state: State<'_, AppState>,
	tab: String,
	folder: Option<String>,
	server: Option<SavedServer>,
) -> Result<(), String> {
	let mut browsing = state.browsing.lock().await;
	browsing.tab = tab;
	if folder.is_some() {
		browsing.folder = folder;
	}
	if let Some(saved) = server {
		browsing.record(saved.server, saved.folder);
	}
	if let Err(error) = browsing.save(&state.data_dir) {
		eprintln!("could not save the file dialog's state: {error:#}");
	}
	Ok(())
}

/// Takes a server off the dialog's list.
#[tauri::command]
#[specta::specta]
pub async fn forget_server(state: State<'_, AppState>, server: Server) -> Result<(), String> {
	let mut browsing = state.browsing.lock().await;
	browsing.servers.retain(|saved| !same_login(&saved.server, &server));
	browsing.save(&state.data_dir).map_err(|e| format!("{e:#}"))
}

/// The key file a saved server signs in with, for a source on it - see [`studio_core::browse::identity_for`].
pub async fn identity_for(state: &AppState, location: &str) -> Option<String> {
	let browsing = state.browsing.lock().await;
	studio_core::browse::identity_for(location, browsing.servers.iter().map(|saved| &saved.server))
}
