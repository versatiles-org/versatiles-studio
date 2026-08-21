// Numbers as a person reads them, in the one place that decides how.
//
// Both of these round hard, and deliberately. A byte count and a duration are read to answer a
// question — is this a coffee break or an overnight run, will this fit on the disk — and the digits
// past the first two never change the answer while changing on every update, which reads as noise
// pretending to be precision.

/// Coarser the further away it is, because that is how much of it is real: "about 2 hours" from an
/// average taken over the first minute is a guess, and "1:58:03" is the same guess pretending
/// otherwise.
///
/// Phrased without a subject so each caller can say what it is about — a job says "… left", an
/// estimate says "about …".
export function duration(seconds: number): string {
	if (seconds < 10) return 'a few seconds';
	if (seconds < 90) return `${Math.round(seconds / 5) * 5}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
	return `${(seconds / 3600).toFixed(1)} h`;
}

/// Decimal units, not binary ones: this sits beside a disk's free space and a download, and both of
/// those are quoted in the units below. A tile container is not memory.
export function bytes(count: number): string {
	if (count >= 1e9) return `${(count / 1e9).toFixed(1)} GB`;
	if (count >= 1e6) return `${(count / 1e6).toFixed(1)} MB`;
	if (count >= 1e3) return `${Math.round(count / 1e3)} kB`;
	return `${Math.round(count)} B`;
}

/// Thousands separated, for counts that are read rather than compared — "1,048,576 tiles".
export function count(value: number): string {
	return value.toLocaleString('en-US');
}
