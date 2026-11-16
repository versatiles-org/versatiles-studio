//! The system's keychain, for the WebDAV passwords a person asked Studio to keep (#30).
//!
//! Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux - whichever
//! `keyring` finds. What is kept, and when, is `studio_core::webdav::Passwords`'s to decide; this is
//! only where.

use anyhow::{Context, Result};
use studio_core::webdav::Keychain;

/// What the entries are filed under, so a person looking through their keychain knows whose they are.
const SERVICE: &str = "org.versatiles.studio";

pub struct SystemKeychain;

fn entry(account: &str) -> Result<keyring::Entry> {
	keyring::Entry::new(SERVICE, account).context("the system keychain cannot be reached")
}

impl Keychain for SystemKeychain {
	fn get(&self, account: &str) -> Result<Option<String>> {
		match entry(account)?.get_password() {
			Ok(password) => Ok(Some(password)),
			Err(keyring::Error::NoEntry) => Ok(None),
			Err(error) => Err(error).context("reading a password from the keychain"),
		}
	}

	fn set(&self, account: &str, password: &str) -> Result<()> {
		entry(account)?
			.set_password(password)
			.context("keeping the password in the keychain")
	}

	fn delete(&self, account: &str) -> Result<()> {
		match entry(account)?.delete_credential() {
			Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
			Err(error) => Err(error).context("taking the password out of the keychain"),
		}
	}
}
