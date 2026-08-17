use anyhow::Result;
/// Does the runtime hand back a cached reader when the file underneath has changed?
#[tokio::test]
async fn stale_reader() -> Result<()> {
	let dir = std::env::temp_dir().join("studio-stale");
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(&dir)?;
	let target = dir.join("swap.versatiles");

	let Some(a) = crate::analysis::tests::sample_container("berlin.versatiles") else { println!("  no samples"); return Ok(()) };
	let Some(b) = crate::analysis::tests::sample_container("berlin.mbtiles") else { println!("  no samples"); return Ok(()) };
	

	let runtime = versatiles::runtime::create_runtime();

	std::fs::copy(&a, &target)?;
	let (_r1, i1) = crate::analysis::open(&runtime, target.to_str().unwrap()).await?;
	println!("  first open : {} z{}-{}", i1.container, i1.min_zoom, i1.max_zoom);

	// Replace the file with a different container at the same path.
	std::fs::copy(&b, &target)?;
	let (_r2, i2) = crate::analysis::open(&runtime, target.to_str().unwrap()).await?;
	println!("  after swap : {} z{}-{}", i2.container, i2.min_zoom, i2.max_zoom);
	println!("  -> runtime {} the change", if i1.container == i2.container { "DID NOT see" } else { "saw" });
	Ok(())
}
