//! A style with everything it needs beside it (D8, S4.6).
//!
//! A `style.json` on its own is a document full of URLs. Studio's point at the embedded server —
//! `http://127.0.0.1:<an ephemeral port>` — so the exported one is rewritten to the public
//! versatiles.org addresses before it leaves, which works for anyone with a network.
//!
//! **This is the other answer: take the files too.** The bundle holds the style, the glyph ranges
//! for the fonts it names, and the sprite sheet, with relative URLs between them. Unzip it into a
//! web root and the only thing left to point somewhere is the tiles.
//!
//! **Copied out of the archives rather than unpacked to disk first.** The bundled tier ships as
//! `.tar.gz` and stays that way on the machine ([Q9]); a bundle reads the entries it wants straight
//! out and writes them where they belong. Nothing is unpacked that is not carried.
//!
//! **Not [`crate::bundle`]**, which makes a *project* portable. This one is about a style, and the
//! two never appear in the same menu.
//!
//! [Q9]: ../../../../docs/decisions.md

use crate::archive::{self, Entry};
use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Where the style file goes, and the name a reader will look for.
pub const STYLE_FILE: &str = "style.json";

/// The directories the style's relative URLs point at.
///
/// They are not the paths the archives use — the glyph archive's entries are `noto_sans_regular/…`
/// with no prefix at all, and the sprite archive's are `basics/…`. Naming them here is what lets the
/// style say `fonts/{fontstack}/{range}.pbf` regardless.
pub const FONTS_DIR: &str = "fonts";
pub const SPRITES_DIR: &str = "sprites";

/// Writes the bundle, as a directory or as one `.zip`.
///
/// `style` is the finished `style.json` text — the webview renders it and rewrites its URLs, because
/// the generator lives there ([Q36]). `fonts` are the font stacks it names; each is looked for in
/// `glyph_archives` in order, so an installed family (G7) is found as readily as the bundled tier.
///
/// A font nothing has is skipped rather than fatal, and reported: a style naming a font that is not
/// installed still bundles, and the alternative — refusing — would leave someone with nothing while
/// the missing piece is a label MapLibre falls back from anyway.
///
/// [Q36]: ../../../../docs/decisions.md
pub fn write(
	target: &Path,
	zip: bool,
	style: &str,
	fonts: &[String],
	glyph_archives: &[PathBuf],
	sprites: &Path,
) -> Result<Vec<String>> {
	let mut entries = vec![Entry::bytes(STYLE_FILE, style.as_bytes())];

	let mut missing = Vec::new();
	for font in dedup(fonts) {
		let found = glyph_archives.iter().find_map(|archive| {
			let taken = take(archive, &format!("{font}/"), &format!("{FONTS_DIR}/{font}/")).ok()?;
			(!taken.is_empty()).then_some(taken)
		});
		match found {
			Some(mut taken) => entries.append(&mut taken),
			None => missing.push(font),
		}
	}

	entries.append(&mut take(sprites, "basics/", &format!("{SPRITES_DIR}/basics/"))?);

	if zip {
		archive::write_zip(target, &entries)
	} else {
		archive::write_directory(target, &entries)
	}?;
	Ok(missing)
}

/// The font stacks, each once and in a stable order.
///
/// A style names the same font on two hundred layers; without this, each would be a pass over the
/// archive. Sorted so that two runs of the same style produce byte-identical bundles.
fn dedup(fonts: &[String]) -> Vec<String> {
	fonts.iter().cloned().collect::<BTreeSet<_>>().into_iter().collect()
}

/// Reads every entry under `prefix` out of a `.tar.gz`, renaming it under `into`.
///
/// **One pass.** A tar is a stream with no index, so seeking to a name means reading to it anyway;
/// taking everything wanted in a single walk is both simpler and faster than asking per file.
fn take(archive: &Path, prefix: &str, into: &str) -> Result<Vec<Entry>> {
	let file = std::fs::File::open(archive).with_context(|| format!("reading {}", archive.display()))?;
	let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));

	let mut out = Vec::new();
	for entry in tar.entries().context("reading the archive")? {
		let mut entry = entry.context("reading an archive entry")?;
		if !entry.header().entry_type().is_file() {
			continue;
		}
		let path = entry.path().context("reading an entry's name")?.to_path_buf();
		// Entries are written as `./noto_sans_regular/0-255.pbf` by some packers and without the
		// `./` by others; the archives here use both, so it is stripped rather than matched.
		let name = path.to_string_lossy();
		let Some(rest) = name.trim_start_matches("./").strip_prefix(prefix) else {
			continue;
		};

		// **The archive decides this name, so the archive is not trusted with it.** `rest` is
		// whatever the `.tar.gz` says, and a font family is downloaded from the network; an entry
		// called `noto_sans_regular/../../../../.ssh/authorized_keys` would otherwise be written
		// exactly there. Refused here, at the read, rather than at the write — the entry is already
		// wrong, and the bundle should not be half-made before anyone notices.
		let path = format!("{into}{rest}");
		crate::paths::within(Path::new(""), &path)
			.with_context(|| format!("{} contains an entry that escapes the bundle", archive.display()))?;

		let mut bytes = Vec::new();
		entry.read_to_end(&mut bytes).context("reading an entry's contents")?;
		out.push(Entry::bytes(path, bytes));
	}
	Ok(out)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The archives as they ship. Skipped when they have not been fetched, so a fresh clone still
	/// passes `cargo test` before `npm run assets:fetch` has run.
	fn resources() -> Option<(PathBuf, PathBuf)> {
		let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources");
		let glyphs = dir.join("glyphs.tar.gz");
		let sprites = dir.join("sprites.tar.gz");
		(glyphs.exists() && sprites.exists()).then_some((glyphs, sprites))
	}

	const STYLE: &str = r#"{"version":8,"glyphs":"fonts/{fontstack}/{range}.pbf"}"#;

	#[test]
	fn a_bundle_holds_the_style_its_glyphs_and_its_sprites() {
		let Some((glyphs, sprites)) = resources() else {
			eprintln!("skipping: run `npm run assets:fetch` first");
			return;
		};

		let out = crate::testing::dir("style-bundle");
		let missing = write(
			&out,
			false,
			STYLE,
			&["noto_sans_regular".to_string()],
			&[glyphs],
			&sprites,
		)
		.unwrap();

		assert!(missing.is_empty(), "{missing:?}");
		assert_eq!(std::fs::read_to_string(out.join(STYLE_FILE)).unwrap(), STYLE);
		assert!(
			out.join("fonts/noto_sans_regular/0-255.pbf").is_file(),
			"the Latin range is what a style needs first"
		);
		assert!(out.join("sprites/basics/sprites.json").is_file());
		assert!(out.join("sprites/basics/sprites@2x.png").is_file());
	}

	/// The style's URLs are relative to itself, so what it asks for has to be where it says.
	#[test]
	fn the_paths_are_the_ones_the_style_names() {
		let Some((glyphs, sprites)) = resources() else {
			return;
		};

		let out = crate::testing::dir("style-bundle-paths");
		write(&out, false, STYLE, &["noto_sans_bold".to_string()], &[glyphs], &sprites).unwrap();

		// `fonts/{fontstack}/{range}.pbf` with fontstack=noto_sans_bold, range=0-255.
		let asked = out.join(
			STYLE
				.split("\"glyphs\":\"")
				.nth(1)
				.unwrap()
				.trim_end_matches("\"}")
				.replace("{fontstack}", "noto_sans_bold")
				.replace("{range}", "0-255"),
		);
		assert!(asked.is_file(), "{}", asked.display());
	}

	/// A font nothing has is a label MapLibre falls back from; refusing the whole bundle over it
	/// would leave someone with nothing at all.
	#[test]
	fn a_font_no_archive_has_is_reported_rather_than_fatal() {
		let Some((glyphs, sprites)) = resources() else {
			return;
		};

		let out = crate::testing::dir("style-bundle-missing");
		let missing = write(
			&out,
			false,
			STYLE,
			&["noto_sans_regular".to_string(), "comic_sans_ms".to_string()],
			&[glyphs],
			&sprites,
		)
		.unwrap();

		assert_eq!(missing, vec!["comic_sans_ms".to_string()]);
		assert!(
			out.join("fonts/noto_sans_regular/0-255.pbf").is_file(),
			"the rest still came"
		);
	}

	/// A style names one font on two hundred layers, and each name would otherwise be a pass over
	/// the archive.
	#[test]
	fn a_font_named_twice_is_taken_once() {
		let repeated = ["a".to_string(), "b".to_string(), "a".to_string()];
		assert_eq!(dedup(&repeated), vec!["a".to_string(), "b".to_string()]);
	}

	#[test]
	fn a_zip_holds_the_same_files() {
		let Some((glyphs, sprites)) = resources() else {
			return;
		};

		let path = crate::testing::path("style.zip");
		write(
			&path,
			true,
			STYLE,
			&["noto_sans_regular".to_string()],
			&[glyphs],
			&sprites,
		)
		.unwrap();

		let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
		let names: Vec<String> = archive.file_names().map(str::to_string).collect();
		for expected in [
			STYLE_FILE,
			"fonts/noto_sans_regular/0-255.pbf",
			"sprites/basics/sprites.json",
		] {
			assert!(names.contains(&expected.to_string()), "{names:?}");
		}

		let mut text = String::new();
		archive.by_name(STYLE_FILE).unwrap().read_to_string(&mut text).unwrap();
		assert_eq!(text, STYLE);
	}
}

#[cfg(test)]
mod traversal_tests {
	use super::*;

	/// A `.tar.gz` whose one entry is named `entry`, **built header-first**.
	///
	/// `tar::Builder::append_data` refuses a name containing `..` — the writer has its own guard —
	/// so a hostile archive cannot be produced with the ordinary API, and neither GNU nor BSD `tar`
	/// will make one either. The bytes are therefore assembled by hand: a 512-byte header with the
	/// name written straight into the field, the body padded to a block, and the two zero blocks
	/// that end an archive.
	///
	/// That the writer refuses is not a defence. It says only that this file did not come from a
	/// well-behaved tool, which is exactly what is assumed about an archive fetched over a network.
	fn archive_naming(entry: &str) -> PathBuf {
		use std::io::Write as _;

		let body = b"pwned";
		let mut header = tar::Header::new_gnu();
		header.set_size(body.len() as u64);
		header.set_mode(0o644);
		header.set_entry_type(tar::EntryType::Regular);
		// Past `set_path`, which is where the validation lives.
		let name = header.as_gnu_mut().expect("a GNU header").name.as_mut();
		name[..entry.len()].copy_from_slice(entry.as_bytes());
		header.set_cksum();

		let path = crate::testing::path("hostile.tar.gz");
		let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(&path).unwrap(), flate2::Compression::fast());
		gz.write_all(header.as_bytes()).unwrap();
		let mut block = [0u8; 512];
		block[..body.len()].copy_from_slice(body);
		gz.write_all(&block).unwrap();
		gz.write_all(&[0u8; 1024]).unwrap();
		gz.finish().unwrap();
		path
	}

	/// **The bug this guard was added for — zip slip.** `take` used to build each entry's
	/// destination from the name inside the archive, so a font family downloaded from the network
	/// could name `…/../../../..` and `write_directory` would write exactly there.
	#[test]
	fn an_archive_entry_cannot_escape_the_bundle() {
		let hostile = archive_naming("noto_sans_regular/../../../../pwned.pbf");

		let error = take(
			&hostile,
			"noto_sans_regular/",
			&format!("{FONTS_DIR}/noto_sans_regular/"),
		)
		.unwrap_err();
		assert!(format!("{error:#}").contains("escapes the bundle"), "{error:#}");
	}

	// The matching test for the *writer* refusing an escaping entry lives in `crate::archive`,
	// which now owns both writers — one guard, tested where it is.

	/// The guard has to refuse the hostile entry without refusing the ordinary ones beside it.
	#[test]
	fn an_ordinary_entry_still_comes_through() {
		let ordinary = archive_naming("noto_sans_regular/0-255.pbf");

		let taken = take(
			&ordinary,
			"noto_sans_regular/",
			&format!("{FONTS_DIR}/noto_sans_regular/"),
		)
		.unwrap();
		assert_eq!(taken.len(), 1);
		assert_eq!(taken[0].path, "fonts/noto_sans_regular/0-255.pbf");
	}
}
