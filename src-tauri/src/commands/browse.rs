//! Studio's own file dialog: folders on this computer and on SFTP and WebDAV servers, and where it
//! was.
//!
//! The listing is the core's ([`studio_core::browse`], [`studio_core::webdav`]); what is here is
//! where to start - the folder the dialog was last in, or the home folder - keeping that for next
//! time, and the passwords a WebDAV server is signed in to with.

use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use studio_core::browse::{Listing, Server, SftpServer};
use studio_core::store::{Browsing, SavedServer};
use studio_core::webdav::{self, Passwords, WebdavServer};
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
///
/// `password` and `remember` are a WebDAV server's: what was typed into the dialog's field, and
/// whether to keep it in the keychain. An empty field signs in with the password this session or the
/// keychain already has. An SFTP server ignores both (Q73).
#[tauri::command]
#[specta::specta]
pub async fn browse_remote(
	state: State<'_, AppState>,
	server: Server,
	path: Option<String>,
	password: Option<String>,
	remember: bool,
) -> Result<Listing, String> {
	// A remembered folder that has gone since is not worth an error: start where the server does.
	let remembered = match path {
		Some(_) => None,
		None => state
			.browsing
			.lock()
			.await
			.servers
			.iter()
			.find(|saved| saved.server.same_login(&server))
			.and_then(|saved| saved.folder.clone()),
	};
	match server {
		Server::Sftp(sftp) => list_sftp(&state, &sftp, path, remembered).await,
		Server::Webdav(webdav) => list_webdav(&state, webdav, path, remembered, password, remember).await,
	}
	.map_err(|e| format!("{e:#}"))
}

async fn list_sftp(
	state: &AppState,
	server: &SftpServer,
	path: Option<String>,
	remembered: Option<String>,
) -> anyhow::Result<Listing> {
	if let Some(folder) = remembered
		&& let Ok(listing) = state.sessions.list(server, Some(&folder)).await
	{
		return Ok(listing);
	}
	state.sessions.list(server, path.as_deref()).await
}

async fn list_webdav(
	state: &AppState,
	server: WebdavServer,
	path: Option<String>,
	remembered: Option<String>,
	password: Option<String>,
	remember: bool,
) -> anyhow::Result<Listing> {
	let typed = password.filter(|password| !password.is_empty());
	let signing = match &typed {
		Some(password) => Some(password.clone()),
		// A keychain that cannot be read is a sign-in without a password, which the server answers
		// with a request for one - more use to the person than the keychain's own error.
		None => match with_passwords(state, server.clone(), |passwords, server| passwords.password(&server)).await {
			Ok(found) => found,
			Err(error) => {
				crate::warn(&state.diagnostics, "A kept WebDAV password could not be read", &error);
				None
			}
		},
	};
	let listing = match remembered {
		Some(folder) => match webdav::list(&server, signing.as_deref(), Some(&folder)).await {
			Ok(listing) => Ok(listing),
			Err(_) => webdav::list(&server, signing.as_deref(), path.as_deref()).await,
		},
		None => webdav::list(&server, signing.as_deref(), path.as_deref()).await,
	}?;
	// **Kept once it has signed in**, not before: a password the server refused is not one to keep.
	// The listing stands even if keeping it fails, and the problem log says why.
	if let Some(password) = typed {
		let kept = with_passwords(state, server, move |passwords, server| {
			passwords.signed_in(&server, &password, remember)
		})
		.await;
		if let Err(error) = kept {
			crate::warn(&state.diagnostics, "The WebDAV password could not be kept", &error);
		}
	}
	Ok(listing)
}

/// Runs `work` on the passwords off the async threads: a keychain may block, or ask the person.
async fn with_passwords<T: Send + 'static>(
	state: &AppState,
	server: WebdavServer,
	work: impl FnOnce(&Passwords, WebdavServer) -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
	let passwords = state.passwords.clone();
	tauri::async_runtime::spawn_blocking(move || work(&passwords, server)).await?
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

/// Takes a server off the dialog's list - and a WebDAV server's password out of this session and
/// the keychain, since a server forgotten is not one to sign in to again unasked.
#[tauri::command]
#[specta::specta]
pub async fn forget_server(state: State<'_, AppState>, server: Server) -> Result<(), String> {
	{
		let mut browsing = state.browsing.lock().await;
		browsing.servers.retain(|saved| !saved.server.same_login(&server));
		browsing.save(&state.data_dir).map_err(|e| format!("{e:#}"))?;
	}
	if let Server::Webdav(webdav) = server {
		with_passwords(&state, webdav, |passwords, server| passwords.forget(&server))
			.await
			.map_err(|e| format!("{e:#}"))?;
	}
	Ok(())
}

/// Hands the passwords kept for the saved WebDAV servers to versatiles-rs, so a source on one opens
/// without the dialog having been used this session. On a thread of its own: a keychain may ask the
/// person first, and start-up should not wait for the answer.
pub fn restore_passwords(
	passwords: std::sync::Arc<Passwords>,
	browsing: &Browsing,
	diagnostics: studio_core::diagnostics::Diagnostics,
) {
	let servers: Vec<WebdavServer> = browsing
		.servers
		.iter()
		.filter_map(|saved| match &saved.server {
			Server::Webdav(webdav) => Some(webdav.clone()),
			Server::Sftp(_) => None,
		})
		.collect();
	// None saved, no keychain asked - which is also what keeps a test run off the Secret Service.
	if servers.is_empty() {
		return;
	}
	std::thread::spawn(move || {
		for error in passwords.restore(&servers) {
			crate::warn(&diagnostics, "A kept WebDAV password could not be read", &error);
		}
	});
}

/// The key file a saved server signs in with, for a source on it - see [`studio_core::browse::identity_for`].
pub async fn identity_for(state: &AppState, location: &str) -> Option<String> {
	let browsing = state.browsing.lock().await;
	studio_core::browse::identity_for(location, browsing.servers.iter().map(|saved| &saved.server))
}
