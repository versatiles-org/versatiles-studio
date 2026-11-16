//! Folders listed for Studio's own file dialog - on this computer, or on an SFTP or WebDAV server.
//!
//! **One shape for all three**, because the dialog is one dialog: a tab for this computer and one for
//! a server, drawn the same and walked the same. A [`Listing`] is a folder and what is in it, and
//! every [`Entry`] carries the `location` that choosing it hands back - a path, an `sftp://` URL or
//! an `https://` one - so the webview never builds any of them and cannot get one wrong.
//!
//! **Hidden files are not listed.** A name starting with a dot is configuration, not data, and a
//! home folder lists more of those than of anything worth opening. A folder can still be typed.
//!
//! **Signing in to SFTP is versatiles-rs's.** An [`SftpServer`] names a host, a user and at most a
//! key file; the SSH agent, `~/.ssh/config` and the default keys are tried by
//! `sftp_utils::open_session` without being asked. No password is ever held for one: one in an
//! `sftp://` URL would be written into the pipeline's text, the project and the recents. WebDAV is
//! signed in to with a password, kept out of every URL by [`crate::webdav`].

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;
use versatiles_core::io::sftp_utils::{self, Sftp, SshHandle};

/// One thing in a folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Entry {
	pub name: String,
	/// A folder to go into, rather than a file to choose.
	pub folder: bool,
	/// Bytes, for a file whose size is known.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub size: Option<u64>,
	/// Seconds since the Unix epoch.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub modified: Option<u64>,
	/// What choosing it means: an absolute path, or an `sftp://` URL. For a folder, what to list next.
	pub location: String,
}

/// A folder and what is in it: folders first, then files, each by name.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Listing {
	/// The folder, as its own system writes it.
	pub path: String,
	/// The folder above it, to list for "up" - `None` at the top.
	pub parent: Option<String>,
	pub entries: Vec<Entry>,
}

/// A server the dialog browses, by how it is reached.
///
/// **One type for both**, so the dialog keeps one list of the servers it has used rather than one
/// per protocol, and a saved server says which it is. Tagged in its JSON, `"protocol": "sftp"`: a
/// server saved before WebDAV existed has no tag, and `store::Browsing::load` gives it this one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "protocol", rename_all = "lowercase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Server {
	Sftp(SftpServer),
	Webdav(crate::webdav::WebdavServer),
}

impl Server {
	/// Whether two servers are the same login, whatever else differs - the key file, say - so a
	/// server used again replaces its entry in the list rather than appearing twice.
	#[must_use]
	pub fn same_login(&self, other: &Server) -> bool {
		match (self, other) {
			(Server::Sftp(a), Server::Sftp(b)) => {
				a.host.trim() == b.host.trim() && a.port == b.port && a.user.trim() == b.user.trim()
			}
			(Server::Webdav(a), Server::Webdav(b)) => a.same_login(b),
			_ => false,
		}
	}
}

/// An SFTP server, as the dialog connects to it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct SftpServer {
	pub host: String,
	pub port: u16,
	pub user: String,
	/// A private key to sign in with, when it is not one the agent or `~/.ssh` already offers.
	pub identity: Option<String>,
}

impl SftpServer {
	/// The `sftp://` URL of a path on this server - never with a password, since there is none.
	pub fn url(&self, path: &str) -> Result<Url> {
		let mut url = Url::parse(&format!("sftp://{}", self.host.trim()))
			.with_context(|| format!("{:?} is not a host name", self.host))?;
		url.set_username(self.user.trim())
			.map_err(|()| anyhow::anyhow!("{:?} cannot be a user name", self.user))?;
		if self.port != 22 {
			url.set_port(Some(self.port))
				.map_err(|()| anyhow::anyhow!("{} cannot be a port", self.port))?;
		}
		url.set_path(path);
		Ok(url)
	}

	/// Whether an `sftp://` URL is on this server: the same host, port and user.
	#[must_use]
	pub fn serves(&self, url: &str) -> bool {
		let Ok(url) = Url::parse(url) else { return false };
		url.scheme() == "sftp"
			&& url.host_str() == Some(self.host.trim())
			&& url.port().unwrap_or(22) == self.port
			&& url.username() == self.user.trim()
	}

	/// The key file as a path the SSH code can open: `~/` is the home folder, and an empty field is
	/// no key at all.
	///
	/// **Expanded here, not by whoever typed it**, because a shell is not involved: `~/.ssh/box` is a
	/// folder called `~` to everything but a shell, and that is what `from_container` would be told.
	#[must_use]
	pub fn identity_path(&self) -> Option<String> {
		let identity = self.identity.as_deref()?.trim();
		if identity.is_empty() {
			return None;
		}
		match identity.strip_prefix("~/") {
			Some(rest) => std::env::home_dir().map(|home| home.join(rest).to_string_lossy().into_owned()),
			None => Some(identity.to_string()),
		}
	}

	/// What tells two connections apart: the same server reached with another key is another login.
	fn key(&self) -> String {
		format!(
			"{}@{}:{}|{}",
			self.user.trim(),
			self.host.trim(),
			self.port,
			self.identity.as_deref().unwrap_or("")
		)
	}
}

/// The key file of the saved server an `sftp://` URL is on, for `from_container`'s `ssh_identity`.
///
/// `None` for anything else - a local path, a server signed in to through the agent - which is what
/// lets the read node say nothing it does not need to.
#[must_use]
pub fn identity_for<'a>(location: &str, servers: impl IntoIterator<Item = &'a Server>) -> Option<String> {
	servers
		.into_iter()
		.find_map(|server| match server {
			Server::Sftp(sftp) if sftp.serves(location) => Some(sftp),
			_ => None,
		})
		.and_then(SftpServer::identity_path)
}

/// Lists a folder on this computer.
pub fn list_local(dir: &Path) -> Result<Listing> {
	// Canonical, so "up" from a folder reached through a link goes where the folder is, and the path
	// shown is one the system would recognise.
	let dir = std::fs::canonicalize(dir).with_context(|| format!("{} cannot be found", dir.display()))?;
	let read = std::fs::read_dir(&dir).with_context(|| format!("{} cannot be read", dir.display()))?;
	let mut entries = Vec::new();
	for entry in read.flatten() {
		let name = entry.file_name().to_string_lossy().into_owned();
		if name.starts_with('.') {
			continue;
		}
		// Followed through a link, so a link to a folder is a folder. A link to nothing is left out:
		// there is nothing to open behind it.
		let Ok(metadata) = std::fs::metadata(entry.path()) else {
			continue;
		};
		let folder = metadata.is_dir();
		entries.push(Entry {
			name,
			folder,
			size: (!folder).then_some(metadata.len()),
			modified: metadata.modified().ok().and_then(seconds),
			location: entry.path().to_string_lossy().into_owned(),
		});
	}
	sort(&mut entries);
	Ok(Listing {
		path: dir.to_string_lossy().into_owned(),
		parent: dir.parent().map(|parent| parent.to_string_lossy().into_owned()),
		entries,
	})
}

/// Folders first, then by name as a person reads it: case aside.
pub(crate) fn sort(entries: &mut [Entry]) {
	entries.sort_by(|a, b| {
		b.folder
			.cmp(&a.folder)
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
			.then_with(|| a.name.cmp(&b.name))
	});
}

pub(crate) fn seconds(time: SystemTime) -> Option<u64> {
	time.duration_since(UNIX_EPOCH).ok().map(|since| since.as_secs())
}

/// The folder above a remote one, or `None` at `/`.
pub(crate) fn remote_parent(path: &str) -> Option<String> {
	let trimmed = path.trim_end_matches('/');
	if trimmed.is_empty() {
		return None;
	}
	match trimmed.rfind('/') {
		Some(0) => Some("/".to_string()),
		Some(at) => Some(trimmed[..at].to_string()),
		None => None,
	}
}

fn remote_join(dir: &str, name: &str) -> String {
	if dir.ends_with('/') {
		format!("{dir}{name}")
	} else {
		format!("{dir}/{name}")
	}
}

/// How long a connection is kept after the last listing. Long enough to walk a few folders without
/// a handshake each, short enough that a dialog closed and forgotten does not hold a login open.
const IDLE: Duration = Duration::from_secs(120);

/// A signed-in connection, kept between listings.
struct Held {
	/// Kept alive for as long as the SFTP channel over it is used.
	_handle: SshHandle,
	sftp: Arc<Sftp>,
	used: Instant,
}

/// The connections the dialog is browsing through, one per server and key.
///
/// **Kept rather than opened per folder**, because an SSH handshake and sign-in is a second or two,
/// and walking four folders deep would otherwise cost four of them.
#[derive(Default)]
pub struct RemoteSessions {
	held: tokio::sync::Mutex<HashMap<String, Held>>,
}

impl RemoteSessions {
	/// Lists a folder on a server, or the folder it signs in to when `path` is `None`.
	pub async fn list(&self, server: &SftpServer, path: Option<&str>) -> Result<Listing> {
		let key = server.key();
		let mut held = self.held.lock().await;
		held.retain(|_, each| each.used.elapsed() < IDLE);

		// A kept connection the server has since dropped fails once; the second try opens a new one.
		let kept = held.contains_key(&key);
		for fresh in [!kept, true] {
			if fresh {
				held.insert(key.clone(), connect(server).await?);
			}
			let sftp = held.get(&key).map(|each| each.sftp.clone()).context("no connection")?;
			match list_remote(server, &sftp, path).await {
				Ok(listing) => {
					if let Some(each) = held.get_mut(&key) {
						each.used = Instant::now();
					}
					return Ok(listing);
				}
				Err(error) if fresh => {
					held.remove(&key);
					return Err(error);
				}
				Err(_) => {
					held.remove(&key);
				}
			}
		}
		unreachable!("the second pass always connects afresh and returns")
	}
}

async fn connect(server: &SftpServer) -> Result<Held> {
	let url = server.url("/")?;
	let identity = server.identity_path();
	let handle = sftp_utils::open_session(&url, identity.as_deref().map(Path::new)).await?;
	let sftp = sftp_utils::open_sftp(&handle).await?;
	Ok(Held {
		_handle: handle,
		sftp: Arc::new(sftp),
		used: Instant::now(),
	})
}

async fn list_remote(server: &SftpServer, sftp: &Sftp, path: Option<&str>) -> Result<Listing> {
	// Where the server puts someone who signs in, when nothing more particular was asked for.
	let dir = match path {
		Some(path) if !path.trim().is_empty() => path.trim().to_string(),
		_ => sftp
			.canonicalize(".")
			.await
			.context("the server would not say which folder it starts in")?,
	};
	let read = sftp
		.read_dir(dir.clone())
		.await
		.with_context(|| format!("{dir} cannot be read on {}", server.host))?;

	let mut entries = Vec::new();
	for entry in read {
		let name = entry.file_name();
		if name.starts_with('.') {
			continue;
		}
		let full = remote_join(&dir, &name);
		let mut metadata = entry.metadata();
		// Followed, like a local link: a link to a folder is a folder, and a link to nothing is left out.
		if entry.file_type().is_symlink() {
			match sftp.metadata(full.clone()).await {
				Ok(target) => metadata = target,
				Err(_) => continue,
			}
		}
		let folder = metadata.is_dir();
		entries.push(Entry {
			name,
			folder,
			size: if folder { None } else { metadata.size },
			modified: metadata.mtime.map(u64::from),
			location: if folder {
				full.clone()
			} else {
				server.url(&full)?.to_string()
			},
		});
	}
	sort(&mut entries);
	Ok(Listing {
		parent: remote_parent(&dir),
		path: dir,
		entries,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn server(identity: Option<&str>) -> SftpServer {
		SftpServer {
			host: "box.example.org".into(),
			port: 23,
			user: "anna".into(),
			identity: identity.map(Into::into),
		}
	}

	#[test]
	fn a_server_writes_its_urls_without_a_password_and_with_its_port() -> Result<()> {
		let url = server(None).url("/home/maps/la réunion.versatiles")?;
		assert_eq!(
			url.as_str(),
			"sftp://anna@box.example.org:23/home/maps/la%20r%C3%A9union.versatiles"
		);
		let default_port = SftpServer {
			port: 22,
			..server(None)
		};
		assert_eq!(default_port.url("/a")?.as_str(), "sftp://anna@box.example.org/a");
		Ok(())
	}

	/// A file chosen from a server signed in to with a key must take that key into its read node.
	#[test]
	fn a_url_finds_the_key_of_the_server_it_is_on() {
		let servers = [
			Server::Sftp(server(Some("/keys/box"))),
			Server::Sftp(SftpServer {
				user: "ben".into(),
				..server(Some("/keys/ben"))
			}),
		];
		assert_eq!(
			identity_for("sftp://anna@box.example.org:23/x.versatiles", &servers).as_deref(),
			Some("/keys/box")
		);
		assert_eq!(
			identity_for("sftp://ben@box.example.org:23/x.versatiles", &servers).as_deref(),
			Some("/keys/ben")
		);
		// Another port, another user, a local path, and a server with no key of its own.
		assert_eq!(identity_for("sftp://anna@box.example.org/x.versatiles", &servers), None);
		assert_eq!(
			identity_for("sftp://carl@box.example.org:23/x.versatiles", &servers),
			None
		);
		assert_eq!(identity_for("/home/anna/x.versatiles", &servers), None);
		assert_eq!(
			identity_for("sftp://anna@box.example.org:23/x", &[Server::Sftp(server(None))]),
			None
		);
	}

	#[test]
	fn a_key_file_in_the_home_folder_is_written_out_in_full() {
		let home = std::env::home_dir().expect("a home folder");
		let expanded = server(Some("~/.ssh/box")).identity_path();
		assert_eq!(expanded, Some(home.join(".ssh/box").to_string_lossy().into_owned()));
		assert_eq!(server(Some("/keys/box")).identity_path().as_deref(), Some("/keys/box"));
		assert_eq!(server(Some("  ")).identity_path(), None, "an empty field is no key");
		assert_eq!(server(None).identity_path(), None);
	}

	#[test]
	fn a_remote_folder_knows_the_one_above_it() {
		assert_eq!(remote_parent("/home/maps").as_deref(), Some("/home"));
		assert_eq!(remote_parent("/home/maps/").as_deref(), Some("/home"));
		assert_eq!(remote_parent("/home").as_deref(), Some("/"));
		assert_eq!(remote_parent("/"), None);
		assert_eq!(remote_join("/", "home"), "/home");
		assert_eq!(remote_join("/home", "maps"), "/home/maps");
	}

	#[test]
	fn a_local_folder_lists_folders_first_and_leaves_hidden_files_out() -> Result<()> {
		let dir = crate::testing::dir("browse-local");
		std::fs::create_dir_all(dir.join("Zeta"))?;
		std::fs::create_dir_all(dir.join("alpha"))?;
		std::fs::write(dir.join("b.versatiles"), b"12345")?;
		std::fs::write(dir.join("A.pmtiles"), b"1")?;
		std::fs::write(dir.join(".hidden"), b"")?;

		let listing = list_local(&dir)?;
		let names: Vec<_> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
		assert_eq!(names, ["alpha", "Zeta", "A.pmtiles", "b.versatiles"]);

		let file = &listing.entries[3];
		assert!(!file.folder);
		assert_eq!(file.size, Some(5));
		assert!(file.modified.is_some());
		assert!(Path::new(&file.location).is_absolute());
		assert!(file.location.ends_with("b.versatiles"));
		assert_eq!(listing.entries[0].size, None, "a folder has no size to show");
		assert_eq!(
			listing.parent.as_deref(),
			std::fs::canonicalize(&dir)?.parent().and_then(Path::to_str)
		);
		Ok(())
	}

	/// What the dialog lists on a server, against the in-process server versatiles-rs tests its own
	/// SFTP with (versatiles-rs#333): a change in `russh-sftp` or in how versatiles-rs opens a session
	/// would otherwise break browsing without anything noticing.
	///
	/// **Through [`list_remote`], not [`RemoteSessions::list`].** The test server signs in with a
	/// password and the dialog never sends one (Q73), so the session is opened here from the server's
	/// own URL - and what is under test is everything after signing in.
	mod over_sftp {
		use super::*;
		use versatiles_core::io::test_sftp_server::TestSftpServer;

		struct Connected {
			_handle: SshHandle,
			sftp: Sftp,
			server: SftpServer,
		}

		async fn connect(test: &TestSftpServer) -> Connected {
			let url = test.url("/");
			let handle = sftp_utils::open_session(&url, None)
				.await
				.expect("signing in to the test server");
			let sftp = sftp_utils::open_sftp(&handle).await.expect("opening SFTP");
			let server = SftpServer {
				host: "127.0.0.1".into(),
				port: url.port().expect("the test server's port"),
				user: "testuser".into(),
				identity: None,
			};
			Connected {
				_handle: handle,
				sftp,
				server,
			}
		}

		fn names(listing: &Listing) -> Vec<&str> {
			listing.entries.iter().map(|entry| entry.name.as_str()).collect()
		}

		#[tokio::test]
		async fn a_folder_lists_folders_first_with_sizes_and_urls_without_a_password() {
			let test = TestSftpServer::start().await;
			test.create_dir("/maps/Zeta").await;
			test.write_file("/maps/b.versatiles", b"12345").await;
			test.write_file("/maps/A.pmtiles", b"1").await;
			test.write_file("/maps/alpha/inside.versatiles", b"").await;
			test.write_file("/maps/.hidden", b"").await;
			let connected = connect(&test).await;

			let listing = list_remote(&connected.server, &connected.sftp, Some("/maps"))
				.await
				.unwrap();
			// More entries than one `readdir` reply carries, so a listing that stops after the first
			// reply is caught here.
			assert_eq!(names(&listing), ["alpha", "Zeta", "A.pmtiles", "b.versatiles"]);
			assert_eq!(listing.path, "/maps");
			assert_eq!(listing.parent.as_deref(), Some("/"));

			let [alpha, _, _, file] = &listing.entries[..] else {
				unreachable!()
			};
			assert!(alpha.folder, "a folder implied by a file in it is a folder");
			assert_eq!(alpha.size, None);
			assert_eq!(
				alpha.location, "/maps/alpha",
				"a folder's location is what to list next"
			);
			assert_eq!(file.size, Some(5));
			assert_eq!(file.modified, Some(1_704_067_200));
			let port = connected.server.port;
			assert_eq!(
				file.location,
				format!("sftp://testuser@127.0.0.1:{port}/maps/b.versatiles")
			);
		}

		#[tokio::test]
		async fn with_no_folder_asked_for_it_lists_where_the_server_signs_in() {
			let test = TestSftpServer::start().await;
			test.write_file("/top.versatiles", b"").await;
			let connected = connect(&test).await;

			let listing = list_remote(&connected.server, &connected.sftp, None).await.unwrap();
			assert_eq!(listing.path, "/");
			assert_eq!(listing.parent, None, "nothing is above the top");
			assert_eq!(names(&listing), ["top.versatiles"]);
		}

		// Like a local link: a link to a folder is a folder, a link to a file has the file's size, and a
		// link to nothing is left out, since there is nothing behind it to open.
		#[tokio::test]
		async fn links_are_followed_and_a_link_to_nothing_is_left_out() {
			let test = TestSftpServer::start().await;
			test.create_dir("/data/tiles").await;
			test.write_file("/data/big.versatiles", b"123").await;
			test.create_dir("/home").await;
			test.create_symlink("/home/tiles", "/data/tiles").await;
			test
				.create_symlink("/home/big.versatiles", "/data/big.versatiles")
				.await;
			test.create_symlink("/home/gone.versatiles", "/data/nothing").await;
			let connected = connect(&test).await;

			let listing = list_remote(&connected.server, &connected.sftp, Some("/home"))
				.await
				.unwrap();
			assert_eq!(names(&listing), ["tiles", "big.versatiles"]);
			assert!(listing.entries[0].folder);
			assert_eq!(listing.entries[1].size, Some(3));
		}

		#[tokio::test]
		async fn a_missing_folder_on_a_server_says_so() {
			let test = TestSftpServer::start().await;
			let connected = connect(&test).await;

			let error = list_remote(&connected.server, &connected.sftp, Some("/nowhere"))
				.await
				.unwrap_err();
			assert!(
				format!("{error:#}").contains("/nowhere cannot be read on 127.0.0.1"),
				"{error:#}"
			);
		}
	}

	#[test]
	fn a_missing_folder_says_so() {
		let error = list_local(Path::new("/nowhere/at/all")).unwrap_err();
		assert!(
			format!("{error:#}").contains("/nowhere/at/all cannot be found"),
			"{error:#}"
		);
	}
}
