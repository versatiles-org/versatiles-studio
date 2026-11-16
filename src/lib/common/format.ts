// Numbers as a person reads them, in the one place that decides how.
//
// Both of these round hard, and deliberately. A byte count and a duration are read to answer a
// question - is this a coffee break or an overnight run, will this fit on the disk - and the digits
// past the first two never change the answer while changing on every update, which reads as noise
// pretending to be precision.

/// Coarser the further away it is, because that is how much of it is real: "about 2 hours" from an
/// average taken over the first minute is a guess, and "1:58:03" is the same guess pretending
/// otherwise.
///
/// Phrased without a subject so each caller can say what it is about - a job says "… left", an
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

/// Always megabytes, for a **column** of sizes rather than one size in a sentence.
///
/// `bytes` picks the unit that suits each number, which is right when the number is read on its own
/// and wrong when it is read down a list: `900 kB` above `1.2 GB` cannot be compared at a glance,
/// and the eye has to parse a unit per row to find the big one. One unit for the column makes the
/// digits line up and the comparison free.
export function megabytes(count: number): string {
	return `${tenths(count / 1e6)} MB`;
}

/// Always kilobytes, for a column of **tile** sizes (S14.2).
///
/// The same argument as `megabytes`, one unit down: a tile is tens of kilobytes, and the budget a
/// vector tile is held to - 500 kB - is quoted in this unit.
///
/// **One decimal, always.** It used to be one below ten and none above, which put `9.8 kB` over
/// `12 kB` in the same column: the digits no longer lined up, and two numbers rounded two ways do
/// not compare at a glance. The same holds for every column of figures - one unit and one precision
/// down it, or the comparison the column is for has to be done in the reader's head.
export function kilobytes(count: number): string {
	return `${tenths(count / 1e3)} kB`;
}

/// Every byte, for a column of sizes too small for kilobytes to tell apart - an attribute, one
/// feature's geometry - where `0.0 kB` would be three rows of the same nothing.
export function exactBytes(value: number): string {
	return `${count(value)} B`;
}

/// One decimal, thousands separated: `1,234.5`.
const tenths = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/// Thousands separated, for counts that are read rather than compared - "1,048,576 tiles".
export function count(value: number): string {
	return value.toLocaleString('en-US');
}

/// "2nd", "3rd", "11th", "21st" - for "every 3rd feature".
export function ordinal(n: number): string {
	const tens = n % 100;
	const suffix =
		tens >= 11 && tens <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
	return `${n}${suffix}`;
}
