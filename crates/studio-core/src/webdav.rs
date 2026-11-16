//! Folders on a WebDAV server for the file dialog, and the passwords that sign in to one (#30).
//!
//! **Reading a file is versatiles-rs's.** A `.versatiles` or `.pmtiles` on WebDAV is an ordinary
//! ranged HTTPS `GET`, which it already does. What is here is what the dialog needs on top: listing
//! a folder, with a `PROPFIND`, and signing in without writing a password into any URL.
//!
//! **No password in a URL.** A file chosen here comes back as `https://user@host/…`, because a URL
//! is written into the pipeline's text, the project and the recents. The password is held by
//! [`Passwords`]: for this session in versatiles-rs's credential store, where a source naming the
//! user finds it ([`set_http_password`]), and - when the person asks - in the system keychain, from
//! which it is handed over again the next time Studio starts.
//!
//! **Over https**, or plain http to this machine only: a password sent over plain http to anywhere
//! else is read by the network on its way.

use crate::browse::{Entry, Listing, remote_parent, seconds, sort};
use anyhow::{Context, Result, anyhow, bail, ensure};
use percent_encoding::percent_decode_str;
use quick_xml::{Reader, events::Event};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use url::{Host, Url};
use versatiles_core::io::{forget_http_password, set_http_password};

/// A WebDAV server, as the dialog signs in to it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct WebdavServer {
	/// The folder to start in, as it was typed: `https://cloud.example.org/remote.php/dav/files/anna/`.
	/// Nextcloud and ownCloud serve nothing above a user's own folder, so this is also the top.
	pub address: String,
	pub user: String,
}

impl WebdavServer {
	/// The folder the address names, as a URL: `https://` when no scheme was typed, ending in `/`, and
	/// with no user, password, query or fragment.
	pub fn base(&self) -> Result<Url> {
		let typed = self.address.trim();
		ensure!(!typed.is_empty(), "A WebDAV server needs an address.");
		let full = if typed.contains("://") {
			typed.to_string()
		} else {
			format!("https://{typed}")
		};
		let mut url = Url::parse(&full).with_context(|| format!("{typed} is not an address"))?;
		match url.scheme() {
			"https" => {}
			"http" if is_this_machine(&url) => {}
			"http" => {
				bail!("{typed} is plain http, which shows the password to the network on its way. Use its https address.")
			}
			scheme => bail!("{typed} is not a WebDAV address: it starts with {scheme}://, not https://"),
		}
		ensure!(
			url.username().is_empty() && url.password().is_none(),
			"{typed} has a user name or password in it. They go in the fields below: the address is saved as it is written."
		);
		url.set_query(None);
		url.set_fragment(None);
		if !url.path().ends_with('/') {
			let path = format!("{}/", url.path());
			url.set_path(&path);
		}
		Ok(url)
	}

	/// The URL of a folder or file on this server, by its path as a person reads it: with the user,
	/// and never a password.
	pub fn url(&self, path: &str, folder: bool) -> Result<Url> {
		let mut url = self.base()?;
		let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
		{
			let mut path = url
				.path_segments_mut()
				.map_err(|()| anyhow!("{} cannot have a path", self.address))?;
			path.clear().extend(&segments);
			if folder && !segments.is_empty() {
				path.push("");
			}
		}
		if !self.user.trim().is_empty() {
			url.set_username(self.user.trim())
				.map_err(|()| anyhow!("{:?} cannot be a user name", self.user))?;
		}
		Ok(url)
	}

	/// Whether two are the same login: the same folder on the same server, by the same user.
	#[must_use]
	pub fn same_login(&self, other: &WebdavServer) -> bool {
		let place = |server: &WebdavServer| {
			server
				.base()
				.map_or_else(|_| server.address.trim().to_string(), String::from)
		};
		self.user.trim() == other.user.trim() && place(self) == place(other)
	}

	/// What the keychain files the password under: the user and the server, `anna@https://host`.
	/// The server rather than the folder, since that is what versatiles-rs matches a password by.
	fn account(&self) -> Result<String> {
		Ok(format!(
			"{}@{}",
			self.user.trim(),
			self.base()?.origin().ascii_serialization()
		))
	}

	/// The folder the address names, as a path a person reads: `/remote.php/dav/files/anna`.
	fn top(&self) -> Result<String> {
		Ok(readable_path(&self.base()?))
	}
}

/// `localhost` or a loopback address: where plain http does not leave the machine.
fn is_this_machine(url: &Url) -> bool {
	match url.host() {
		Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
		Some(Host::Ipv4(ip)) => ip.is_loopback(),
		Some(Host::Ipv6(ip)) => ip.is_loopback(),
		None => false,
	}
}

/// A path with its segments decoded, no empty segments and no trailing slash: `/a/la réunion`.
fn readable_path(url: &Url) -> String {
	let segments: Vec<String> = url
		.path_segments()
		.into_iter()
		.flatten()
		.filter(|segment| !segment.is_empty())
		.map(|segment| percent_decode_str(segment).decode_utf8_lossy().into_owned())
		.collect();
	format!("/{}", segments.join("/"))
}

/// A typed path written the way [`readable_path`] writes one, so the two compare.
fn tidy(path: &str) -> String {
	let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
	format!("/{}", segments.join("/"))
}

/// What is asked of each entry: whether it is a folder, its size, and when it changed.
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>"#;

/// Lists a folder on a server, or the folder its address names when `path` is `None`.
///
/// `password` is what to sign in with, if there is one: the dialog's field, or what [`Passwords`]
/// holds for the server.
pub async fn list(server: &WebdavServer, password: Option<&str>, path: Option<&str>) -> Result<Listing> {
	let top = server.top()?;
	let dir = match path.map(str::trim).filter(|path| !path.is_empty()) {
		Some(path) => tidy(path),
		None => top.clone(),
	};
	// The user goes in a header, not the URL, which would send it twice.
	let mut url = server.url(&dir, true)?;
	let _ = url.set_username("");
	let host = url.host_str().unwrap_or_default().to_string();
	let user = server.user.trim();

	let client = reqwest::Client::builder()
		.user_agent(concat!("versatiles-studio/", env!("CARGO_PKG_VERSION")))
		.timeout(Duration::from_secs(30))
		.build()
		.context("building an HTTP client")?;
	let mut request = client
		.request(reqwest::Method::from_bytes(b"PROPFIND")?, url.clone())
		.header("Depth", "1")
		.header(reqwest::header::CONTENT_TYPE, "application/xml; charset=utf-8")
		.body(PROPFIND_BODY);
	if !user.is_empty() {
		request = request.basic_auth(user, password);
	}
	let response = request
		.send()
		.await
		.with_context(|| format!("{host} cannot be reached"))?;

	match response.status().as_u16() {
		207 => {}
		401 if password.is_some() => bail!("{host} did not accept the password for {user}."),
		401 => bail!("{host} asks for a password for {user}."),
		403 => bail!("{dir} may not be read on {host}."),
		404 => bail!("{dir} cannot be found on {host}."),
		// A plain web server answers a `PROPFIND` with its page, or refuses the method.
		200..=299 | 405 | 501 => bail!("{} does not answer as a WebDAV folder.", server.address.trim()),
		status => bail!("{host} answered {status} for {dir}."),
	}
	let reply = response
		.text()
		.await
		.with_context(|| format!("reading the listing of {dir} from {host}"))?;
	let found = parse(&reply, &url).with_context(|| format!("{host} answered with a listing that cannot be read"))?;

	let mut entries = Vec::new();
	for item in found {
		// The folder's own entry comes first and is not one of its contents; and anything not
		// directly in it is not either, from a server that took `Depth: 1` as a suggestion.
		if remote_parent(&item.path).as_deref() != Some(dir.as_str()) {
			continue;
		}
		let name = item.path.rsplit('/').next().unwrap_or_default().to_string();
		if name.is_empty() || name.starts_with('.') {
			continue;
		}
		entries.push(Entry {
			location: if item.folder {
				item.path.clone()
			} else {
				server.url(&item.path, false)?.to_string()
			},
			name,
			folder: item.folder,
			size: if item.folder { None } else { item.size },
			modified: item.modified,
		});
	}
	sort(&mut entries);
	Ok(Listing {
		parent: if dir == top { None } else { remote_parent(&dir) },
		path: dir,
		entries,
	})
}

/// One entry of a `PROPFIND` reply.
#[derive(Debug, Default, PartialEq, Eq)]
struct Found {
	/// As [`readable_path`] writes it.
	path: String,
	folder: bool,
	size: Option<u64>,
	modified: Option<u64>,
}

/// The properties one `propstat` reports, and whether it reports them as found.
#[derive(Default)]
struct Props {
	found: bool,
	folder: bool,
	size: Option<u64>,
	modified: Option<u64>,
}

/// Reads a `207 Multi-Status` reply into its entries.
///
/// **By the elements' local names**, not their prefixes: Apache writes `D:` and `lp1:`, Nextcloud
/// `d:`, others the default namespace, and all of them mean `DAV:`. **Only properties reported as
/// found** count - a server lists the ones it does not have in a `propstat` of their own, with a
/// `404`. **Links may be paths or full URLs**, percent-encoded either way; they are read against the
/// URL that was asked.
fn parse(xml: &str, asked: &Url) -> Result<Vec<Found>> {
	let mut reader = Reader::from_str(xml);
	let mut open: Vec<String> = Vec::new();
	let mut text = String::new();
	let mut href: Option<String> = None;
	let mut props: Option<Props> = None;
	let mut kept = Props::default();
	let mut found = Vec::new();

	loop {
		match reader.read_event()? {
			Event::Start(element) => {
				let name = String::from_utf8_lossy(element.local_name().as_ref()).into_owned();
				match name.as_str() {
					"response" => {
						href = None;
						kept = Props::default();
					}
					"propstat" => props = Some(Props::default()),
					"collection" if open.last().is_some_and(|parent| parent == "resourcetype") => {
						if let Some(props) = props.as_mut() {
							props.folder = true;
						}
					}
					_ => {}
				}
				open.push(name);
				text.clear();
			}
			Event::Empty(element) => {
				if element.local_name().as_ref() == b"collection"
					&& open.last().is_some_and(|parent| parent == "resourcetype")
					&& let Some(props) = props.as_mut()
				{
					props.folder = true;
				}
			}
			Event::Text(part) => text.push_str(&part.decode()?),
			Event::CData(part) => text.push_str(&part.decode()?),
			Event::GeneralRef(reference) => match reference.resolve_char_ref()? {
				Some(character) => text.push(character),
				None => text.push(match reference.decode()?.as_ref() {
					"amp" => '&',
					"lt" => '<',
					"gt" => '>',
					"quot" => '"',
					"apos" => '\'',
					other => bail!("&{other}; is not an entity XML defines"),
				}),
			},
			Event::End(_) => {
				let name = open.pop().unwrap_or_default();
				let parent = open.last().map(String::as_str);
				let value = text.trim();
				match (name.as_str(), parent) {
					("href", Some("response")) => href = Some(value.to_string()),
					("status", Some("propstat")) => {
						if let Some(props) = props.as_mut() {
							props.found = value.split_whitespace().nth(1) == Some("200");
						}
					}
					("getcontentlength", _) => {
						if let Some(props) = props.as_mut() {
							props.size = value.parse().ok();
						}
					}
					("getlastmodified", _) => {
						if let Some(props) = props.as_mut() {
							props.modified = httpdate::parse_http_date(value).ok().and_then(seconds);
						}
					}
					("propstat", _) => {
						if let Some(props) = props.take().filter(|props| props.found) {
							kept = Props {
								found: true,
								folder: kept.folder || props.folder,
								size: props.size.or(kept.size),
								modified: props.modified.or(kept.modified),
							};
						}
					}
					("response", _) => {
						// An entry with no property found is one the server could not report on.
						if let Some(link) = href.take().filter(|_| kept.found) {
							let url = asked.join(&link).with_context(|| format!("{link} is not a link"))?;
							found.push(Found {
								path: readable_path(&url),
								folder: kept.folder || link.ends_with('/'),
								size: kept.size,
								modified: kept.modified,
							});
						}
					}
					_ => {}
				}
				text.clear();
			}
			Event::Eof => break,
			_ => {}
		}
	}
	Ok(found)
}

/// Where passwords are kept between sessions: the system keychain in the application, a map in a
/// test. Called off the async threads - a keychain may ask the person, and may block until they
/// answer.
pub trait Keychain: Send + Sync {
	fn get(&self, account: &str) -> Result<Option<String>>;
	fn set(&self, account: &str, password: &str) -> Result<()>;
	/// Removes the password, and succeeds when there was none.
	fn delete(&self, account: &str) -> Result<()>;
}

/// The passwords the dialog has signed in to WebDAV servers with.
///
/// **Three places, and no others.** This session's are held here, and in versatiles-rs's credential
/// store, which is where reading a source from the server finds them. Those the person asked to
/// keep are in the [`Keychain`] too, and go back into the other two when Studio starts
/// ([`Passwords::restore`]). Never in a URL, a pipeline, a project or `browsing.json`.
pub struct Passwords {
	keychain: Box<dyn Keychain>,
	held: Mutex<HashMap<String, String>>,
}

impl Passwords {
	pub fn new(keychain: impl Keychain + 'static) -> Self {
		Self {
			keychain: Box::new(keychain),
			held: Mutex::new(HashMap::new()),
		}
	}

	/// The password to sign in to `server` with: this session's, or else the keychain's - which is
	/// then this session's too.
	pub fn password(&self, server: &WebdavServer) -> Result<Option<String>> {
		let account = server.account()?;
		if let Some(password) = self.held().get(&account) {
			return Ok(Some(password.clone()));
		}
		let Some(password) = self.keychain.get(&account)? else {
			return Ok(None);
		};
		self.hold(server, &account, &password)?;
		Ok(Some(password))
	}

	/// A password that signed in: held for this session, and kept in the keychain or taken out of it,
	/// as the person asked.
	pub fn signed_in(&self, server: &WebdavServer, password: &str, keep: bool) -> Result<()> {
		let account = server.account()?;
		self.hold(server, &account, password)?;
		if keep {
			self.keychain.set(&account, password)
		} else {
			self.keychain.delete(&account)
		}
	}

	/// Forgets the password everywhere it is kept - for a server taken off the dialog's list.
	pub fn forget(&self, server: &WebdavServer) -> Result<()> {
		let account = server.account()?;
		self.held().remove(&account);
		forget_http_password(&server.base()?, server.user.trim())?;
		self.keychain.delete(&account)
	}

	/// Hands the keychain's passwords for these servers to versatiles-rs, so a source on one of them
	/// opens without the dialog having been used this session. What could not be read is returned,
	/// for the problem log; a server with no password kept is not a problem.
	pub fn restore<'a>(&self, servers: impl IntoIterator<Item = &'a WebdavServer>) -> Vec<anyhow::Error> {
		servers
			.into_iter()
			.filter_map(|server| {
				self
					.password(server)
					.with_context(|| format!("reading the password for {} from the keychain", server.address))
					.err()
			})
			.collect()
	}

	fn hold(&self, server: &WebdavServer, account: &str, password: &str) -> Result<()> {
		set_http_password(&server.base()?, server.user.trim(), password)?;
		self.held().insert(account.to_string(), password.to_string());
		Ok(())
	}

	fn held(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
		self.held.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use base64::Engine as _;
	use std::sync::Arc;
	use tokio::io::{AsyncReadExt, AsyncWriteExt};

	fn server(address: &str) -> WebdavServer {
		WebdavServer {
			address: address.into(),
			user: "anna".into(),
		}
	}

	#[test]
	fn an_address_is_https_unless_it_says_otherwise_and_names_a_folder() -> Result<()> {
		let base = server("cloud.example.org/remote.php/dav/files/anna").base()?;
		assert_eq!(base.as_str(), "https://cloud.example.org/remote.php/dav/files/anna/");
		assert_eq!(
			server("https://cloud.example.org/dav/?x=1#y").base()?.as_str(),
			"https://cloud.example.org/dav/"
		);
		// Plain http stays on this machine, where it is what a local server and a test speak.
		assert_eq!(
			server("http://127.0.0.1:8080/").base()?.as_str(),
			"http://127.0.0.1:8080/"
		);
		assert_eq!(server("http://localhost/dav").base()?.as_str(), "http://localhost/dav/");
		Ok(())
	}

	#[test]
	fn an_address_that_would_give_the_password_away_is_refused() {
		let refusal = |address: &str| format!("{:#}", server(address).base().unwrap_err());
		assert!(refusal("http://cloud.example.org/").contains("plain http"));
		assert!(refusal("https://anna:secret@cloud.example.org/").contains("go in the fields below"));
		assert!(refusal("ftp://cloud.example.org/").contains("not a WebDAV address"));
		assert!(refusal("  ").contains("needs an address"));
	}

	#[test]
	fn a_file_s_url_names_the_user_and_never_a_password() -> Result<()> {
		let at = server("https://cloud.example.org:8443/remote.php/dav/files/anna/");
		assert_eq!(
			at.url("/remote.php/dav/files/anna/Maps/la réunion #1.versatiles", false)?
				.as_str(),
			"https://anna@cloud.example.org:8443/remote.php/dav/files/anna/Maps/la%20r%C3%A9union%20%231.versatiles"
		);
		assert_eq!(
			at.url("/remote.php/dav/files/anna/Maps", true)?.as_str(),
			"https://anna@cloud.example.org:8443/remote.php/dav/files/anna/Maps/"
		);
		Ok(())
	}

	#[test]
	fn a_login_is_the_folder_the_server_and_the_user() {
		assert!(server("cloud.example.org/dav").same_login(&server("https://cloud.example.org/dav/")));
		assert!(!server("cloud.example.org/dav").same_login(&server("cloud.example.org/other")));
		assert!(!server("cloud.example.org/dav").same_login(&WebdavServer {
			user: "ben".into(),
			..server("cloud.example.org/dav")
		}));
	}

	/// What Apache's `mod_dav` answers: `D:` for the elements and `lp1:` for the properties it serves
	/// itself, the size of a folder as a property it does not have, and lowercase escapes.
	const APACHE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:ns0="DAV:">
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>/dav/maps/</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype>
<lp1:getlastmodified>Mon, 16 Nov 2026 10:00:00 GMT</lp1:getlastmodified>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
<D:propstat>
<D:prop>
<getcontentlength xmlns="DAV:"/>
</D:prop>
<D:status>HTTP/1.1 404 Not Found</D:status>
</D:propstat>
</D:response>
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>/dav/maps/la%20r%c3%a9union.versatiles</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype/>
<lp1:getcontentlength>12345</lp1:getcontentlength>
<lp1:getlastmodified>Sun, 15 Nov 2026 09:30:00 GMT</lp1:getlastmodified>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>/dav/maps/tiles/</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>
</D:multistatus>"#;

	/// What Nextcloud and ownCloud (sabre/dav) answer: `d:`, everything on one line, and the folder's
	/// own entry without the slash the request ended in.
	const NEXTCLOUD: &str = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:response><d:href>/remote.php/dav/files/anna/Maps/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Mon, 16 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/anna/Maps/Berlin%20%26%20Brandenburg.pmtiles</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>2048</d:getcontentlength><d:getlastmodified>Sat, 14 Nov 2026 08:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;

	/// What nginx's `dav_ext` and IIS answer: the default namespace, and links as full URLs.
	const FULL_URLS: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<multistatus xmlns="DAV:">
<response><href>https://dav.example.org/share/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>https://dav.example.org/share/a&amp;b.versatiles</href><propstat><prop><resourcetype></resourcetype><getcontentlength>7</getcontentlength></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>https://dav.example.org/share/gone.versatiles</href><status>HTTP/1.1 404 Not Found</status></response>
</multistatus>"#;

	fn parsed(xml: &str, asked: &str) -> Vec<Found> {
		parse(xml, &Url::parse(asked).unwrap()).unwrap()
	}

	#[test]
	fn apache_s_listing_is_read_by_its_local_names_and_its_found_properties() {
		let found = parsed(APACHE, "https://dav.example.org/dav/maps/");
		assert_eq!(
			found,
			[
				Found {
					path: "/dav/maps".into(),
					folder: true,
					size: None,
					modified: Some(1_794_823_200),
				},
				Found {
					path: "/dav/maps/la réunion.versatiles".into(),
					folder: false,
					size: Some(12345),
					modified: Some(1_794_735_000),
				},
				Found {
					path: "/dav/maps/tiles".into(),
					folder: true,
					size: None,
					modified: None,
				},
			]
		);
	}

	#[test]
	fn nextcloud_s_listing_decodes_its_names() {
		let found = parsed(NEXTCLOUD, "https://cloud.example.org/remote.php/dav/files/anna/Maps/");
		assert_eq!(found.len(), 2);
		assert_eq!(found[0].path, "/remote.php/dav/files/anna/Maps");
		assert!(found[0].folder);
		assert_eq!(
			found[1].path,
			"/remote.php/dav/files/anna/Maps/Berlin & Brandenburg.pmtiles"
		);
		assert_eq!(found[1].size, Some(2048));
	}

	#[test]
	fn links_written_as_full_urls_are_read_and_an_entry_with_nothing_found_is_left_out() {
		let found = parsed(FULL_URLS, "https://dav.example.org/share/");
		let paths: Vec<_> = found.iter().map(|each| each.path.as_str()).collect();
		assert_eq!(paths, ["/share", "/share/a&b.versatiles"]);
		assert!(found[0].folder);
		assert!(!found[1].folder, "an empty resourcetype is a file");
	}

	/// What the fake server below saw of one request.
	#[derive(Debug, Clone)]
	struct Seen {
		method: String,
		path: String,
		headers: HashMap<String, String>,
	}

	impl Seen {
		/// The `Authorization` header's user and password, decoded.
		fn signed_in_as(&self) -> Option<String> {
			let encoded = self.headers.get("authorization")?.strip_prefix("Basic ")?;
			String::from_utf8(base64::engine::general_purpose::STANDARD.decode(encoded).ok()?).ok()
		}
	}

	/// A WebDAV server in a few lines: answers every request with what `answer` says, one request per
	/// connection, and keeps what it was asked.
	struct Fake {
		address: String,
		seen: Arc<Mutex<Vec<Seen>>>,
	}

	impl Fake {
		async fn start(
			answer: impl Fn(&Seen) -> (u16, Vec<(&'static str, String)>, Vec<u8>) + Send + Sync + 'static,
		) -> Self {
			let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
			let address = format!("http://{}", listener.local_addr().unwrap());
			let seen = Arc::new(Mutex::new(Vec::new()));
			let answer = Arc::new(answer);
			let log = seen.clone();
			tokio::spawn(async move {
				while let Ok((mut socket, _)) = listener.accept().await {
					let answer = answer.clone();
					let log = log.clone();
					tokio::spawn(async move {
						let Some(request) = read_request(&mut socket).await else {
							return;
						};
						log.lock().unwrap().push(request.clone());
						let (status, headers, body) = answer(&request);
						let mut head = format!(
							"HTTP/1.1 {status} Whatever\r\nContent-Length: {}\r\nConnection: close\r\n",
							body.len()
						);
						for (name, value) in headers {
							head.push_str(&format!("{name}: {value}\r\n"));
						}
						head.push_str("\r\n");
						let _ = socket.write_all(head.as_bytes()).await;
						let _ = socket.write_all(&body).await;
						let _ = socket.shutdown().await;
					});
				}
			});
			Self { address, seen }
		}

		fn seen(&self) -> Vec<Seen> {
			self.seen.lock().unwrap().clone()
		}
	}

	async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Seen> {
		let mut bytes = Vec::new();
		let mut buffer = [0u8; 4096];
		let end = loop {
			let read = socket.read(&mut buffer).await.ok()?;
			if read == 0 {
				return None;
			}
			bytes.extend_from_slice(&buffer[..read]);
			if let Some(at) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
				break at;
			}
		};
		let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
		let mut lines = head.lines();
		let mut first = lines.next()?.split_whitespace();
		let (method, path) = (first.next()?.to_string(), first.next()?.to_string());
		let headers: HashMap<String, String> = lines
			.filter_map(|line| line.split_once(':'))
			.map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_string()))
			.collect();
		// The body is read so the client is not left writing into a closed socket.
		let length: usize = headers
			.get("content-length")
			.and_then(|value| value.parse().ok())
			.unwrap_or(0);
		while bytes.len() < end + 4 + length {
			let read = socket.read(&mut buffer).await.ok()?;
			if read == 0 {
				break;
			}
			bytes.extend_from_slice(&buffer[..read]);
		}
		Some(Seen { method, path, headers })
	}

	/// A listing of `/dav/maps/` with a file and a folder, behind the password `secret`.
	fn maps(request: &Seen) -> (u16, Vec<(&'static str, String)>, Vec<u8>) {
		if request.signed_in_as().as_deref() != Some("anna:secret") {
			return (401, vec![("WWW-Authenticate", "Basic realm=\"dav\"".into())], vec![]);
		}
		let reply = APACHE.replace("/dav/maps/tiles/", "/dav/maps/.hidden/");
		let reply = reply.replace("</D:multistatus>", "<D:response><D:href>/dav/maps/tiles/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>");
		(
			207,
			vec![("Content-Type", "application/xml; charset=utf-8".into())],
			reply.into_bytes(),
		)
	}

	#[tokio::test]
	async fn a_folder_is_listed_with_one_propfind_signed_in_with_the_password() -> Result<()> {
		let fake = Fake::start(maps).await;
		let at = server(&format!("{}/dav/maps", fake.address));

		let listing = list(&at, Some("secret"), None).await?;
		let names: Vec<_> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
		assert_eq!(
			names,
			["tiles", "la réunion.versatiles"],
			"folders first, the folder itself and hidden files out"
		);
		assert_eq!(listing.path, "/dav/maps");
		assert_eq!(listing.parent, None, "the address is the top");
		assert_eq!(listing.entries[0].location, "/dav/maps/tiles");
		let file = &listing.entries[1];
		assert_eq!(file.size, Some(12345));
		let port = Url::parse(&fake.address)?.port().unwrap();
		assert_eq!(
			file.location,
			format!("http://anna@127.0.0.1:{port}/dav/maps/la%20r%C3%A9union.versatiles"),
			"a chosen file carries the user and never the password"
		);

		let seen = fake.seen();
		assert_eq!(seen.len(), 1);
		assert_eq!(seen[0].method, "PROPFIND");
		assert_eq!(seen[0].path, "/dav/maps/");
		assert_eq!(seen[0].headers.get("depth").map(String::as_str), Some("1"));
		Ok(())
	}

	#[tokio::test]
	async fn a_folder_below_the_address_can_go_up_to_it() -> Result<()> {
		let fake = Fake::start(|_| (207, vec![], br#"<multistatus xmlns="DAV:"/>"#.to_vec())).await;
		let at = server(&format!("{}/dav", fake.address));
		let listing = list(&at, Some("secret"), Some("/dav/maps/")).await?;
		assert_eq!(listing.path, "/dav/maps");
		assert_eq!(listing.parent.as_deref(), Some("/dav"));
		assert!(listing.entries.is_empty(), "an empty folder lists nothing");
		Ok(())
	}

	#[tokio::test]
	async fn a_refused_sign_in_says_whether_a_password_was_sent() {
		let fake = Fake::start(maps).await;
		let at = server(&format!("{}/dav/maps/", fake.address));
		let wrong = format!("{:#}", list(&at, Some("wrong"), None).await.unwrap_err());
		assert!(wrong.contains("did not accept the password for anna"), "{wrong}");
		let none = format!("{:#}", list(&at, None, None).await.unwrap_err());
		assert!(none.contains("asks for a password for anna"), "{none}");
	}

	#[tokio::test]
	async fn a_web_page_is_not_a_webdav_folder() {
		let fake = Fake::start(|_| {
			(
				200,
				vec![("Content-Type", "text/html".into())],
				b"<html></html>".to_vec(),
			)
		})
		.await;
		let at = server(&fake.address);
		let error = format!("{:#}", list(&at, None, None).await.unwrap_err());
		assert!(error.contains("does not answer as a WebDAV folder"), "{error}");
	}

	/// A keychain in memory, shared between [`Passwords`] the way the system's is between sessions.
	#[derive(Clone, Default)]
	struct Memory(Arc<Mutex<HashMap<String, String>>>);

	impl Keychain for Memory {
		fn get(&self, account: &str) -> Result<Option<String>> {
			Ok(self.0.lock().unwrap().get(account).cloned())
		}
		fn set(&self, account: &str, password: &str) -> Result<()> {
			self.0.lock().unwrap().insert(account.into(), password.into());
			Ok(())
		}
		fn delete(&self, account: &str) -> Result<()> {
			self.0.lock().unwrap().remove(account);
			Ok(())
		}
	}

	#[test]
	fn a_kept_password_is_in_the_keychain_under_the_server_and_comes_back_next_session() -> Result<()> {
		let keychain = Memory::default();
		let at = server("https://cloud.example.org/remote.php/dav/files/anna/");
		Passwords::new(keychain.clone()).signed_in(&at, "secret", true)?;
		assert_eq!(
			keychain.0.lock().unwrap().clone(),
			HashMap::from([("anna@https://cloud.example.org".to_string(), "secret".to_string())])
		);

		// The next session starts with nothing held, and finds it in the keychain.
		let next = Passwords::new(keychain.clone());
		assert!(next.restore([&at]).is_empty());
		assert_eq!(next.password(&at)?.as_deref(), Some("secret"));

		next.forget(&at)?;
		assert!(keychain.0.lock().unwrap().is_empty());
		assert_eq!(next.password(&at)?, None);
		Ok(())
	}

	#[test]
	fn a_password_not_kept_lasts_the_session_and_takes_an_old_one_out_of_the_keychain() -> Result<()> {
		let keychain = Memory::default();
		let at = server("https://cloud.example.org/dav/");
		keychain.set("anna@https://cloud.example.org", "old")?;
		let passwords = Passwords::new(keychain.clone());
		passwords.signed_in(&at, "new", false)?;
		assert_eq!(passwords.password(&at)?.as_deref(), Some("new"));
		assert!(keychain.0.lock().unwrap().is_empty());
		Ok(())
	}

	/// The point of all of it: a file chosen in the dialog is opened by versatiles-rs from a URL that
	/// names only the user, with the password the dialog signed in with.
	#[tokio::test]
	async fn a_chosen_file_opens_with_the_password_signed_in_with() -> Result<()> {
		use versatiles_core::ByteRange;
		use versatiles_core::io::{DataReaderHttp, DataReaderTrait};

		let fake = Fake::start(|request| {
			if request.method == "PROPFIND" {
				return maps(request);
			}
			if request.signed_in_as().as_deref() != Some("anna:secret") {
				return (401, vec![], vec![]);
			}
			(206, vec![("Content-Range", "bytes 0-3/12345".into())], b"abcd".to_vec())
		})
		.await;
		let at = server(&format!("{}/dav/maps/", fake.address));
		let passwords = Passwords::new(Memory::default());

		let listing = list(&at, Some("secret"), None).await?;
		passwords.signed_in(&at, "secret", false)?;
		let chosen = Url::parse(&listing.entries[1].location)?;
		assert_eq!(chosen.password(), None);

		let reader = DataReaderHttp::try_from(&chosen)?;
		assert_eq!(reader.read_range(&ByteRange::new(0, 4)).await?.as_slice(), b"abcd");
		Ok(())
	}
}
