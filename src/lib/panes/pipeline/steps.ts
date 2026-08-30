/**
 * The per-zoom curve behind [`Control::Steps`] - `raster_format`'s `quality` and
 * `quality_translucent` (S3.4).
 *
 * **A small language, read here so nobody else has to.** The written form is a comma-separated list
 * whose rules are all invisible: a bare number is *positional*, so the comma advances a counter that
 * starts before zoom 0; `z:v` sets that counter outright; an empty part still advances it; and every
 * entry fills forward to zoom 31. `80,70` is therefore not two qualities but a step - 80 at zoom 0
 * and 70 from zoom 1 down - which is not something a text box can be expected to teach.
 *
 * **Written against upstream's own table.** `parse_quality` in `raster_format.rs` has seven cases
 * pinned in a test; those seven are the cases in `steps.test.ts`, so the two implementations cannot
 * drift without one of them going red.
 *
 * The value is resolved to one entry per zoom and *then* reduced back to breakpoints, rather than
 * being read as breakpoints directly. That is what makes an out-of-order or overlapping string -
 * `14:50,10:30`, where the second entry overwrites the first from zoom 10 down - come back as the
 * curve it means rather than as the two rules it was written as.
 */

/** How many zoom levels the format addresses. `parse_quality` fills an array of exactly this many. */
export const ZOOMS = 32;

/** One breakpoint: from `zoom` downwards the value is `value`, until the next breakpoint. */
export interface Step {
	zoom: number;
	value: number;
}

/** Upstream parses the zoom as an `i32` and then bounds it; a `+` is accepted, a `0-10` is not. */
const ZOOM = /^[+-]?\d+$/;
/** And the value as a `u8`, which takes no sign. */
const VALUE = /^\+?\d+$/;

/**
 * What each zoom resolves to, or `null` when the text is not this language at all.
 *
 * `null` inside the array is a zoom the curve says nothing about, which is what an absent setting
 * means: the encoder's own default. `null` for the whole call is a parse failure, and the caller's
 * cue to leave the text alone and let `check` explain it.
 */
export function resolve(text: string, max = 100, maxZoom = ZOOMS - 1): (number | null)[] | null {
	const levels: (number | null)[] = Array.from({ length: ZOOMS }, () => null);
	let zoom = -1;

	for (const raw of text.split(',')) {
		zoom += 1;
		let part = raw.trim();
		// An empty part is not nothing: it has already moved the counter, which is the whole of what
		// `,80` means.
		if (part === '') continue;

		const colon = part.indexOf(':');
		if (colon >= 0) {
			const written = part.slice(0, colon).trim();
			if (!ZOOM.test(written)) return null;
			zoom = Number(written);
			if (zoom < 0 || zoom > maxZoom) return null;
			part = part.slice(colon + 1).trim();
		}

		if (!VALUE.test(part)) return null;
		const value = Number(part);
		if (value < 0 || value > max) return null;
		// Forward-fill, which is the rule that makes the last entry win for the whole tail.
		for (let z = zoom; z < ZOOMS; z += 1) levels[z] = value;
	}

	return levels;
}

/**
 * The breakpoints a resolved curve is made of - one per change, and none for a zoom that repeats
 * the one above it.
 *
 * A curve never returns to "unset" once it has a value, because every entry fills forward, so a
 * `null` after a number cannot occur and is not represented.
 */
export function toSteps(levels: (number | null)[]): Step[] {
	const steps: Step[] = [];
	let previous: number | null = null;
	levels.forEach((value, zoom) => {
		if (value !== null && value !== previous) steps.push({ zoom, value });
		previous = value;
	});
	return steps;
}

/**
 * The written form of a set of breakpoints, canonical and stable through a round trip.
 *
 * **Explicit `z:v`, with one exception.** The positional form is the confusing half of the language
 * and an editor never needs to produce it - except for the case that is most of them, a single
 * quality for every zoom, where `80` is what a person would write and what they will read back in
 * the VPL. Anything else is spelled out, so the text says what it means without counting commas.
 *
 * Sorted by zoom, and one entry per zoom: a later breakpoint at the same zoom is the one that
 * survives, which is what the parser does with it too.
 */
export function fromSteps(steps: Step[]): string {
	const byZoom = new Map<number, number>();
	for (const step of steps) byZoom.set(step.zoom, step.value);

	const ordered = [...byZoom.entries()].sort(([a], [b]) => a - b);
	if (ordered.length === 0) return '';
	if (ordered.length === 1 && ordered[0][0] === 0) return String(ordered[0][1]);
	return ordered.map(([zoom, value]) => `${zoom}:${value}`).join(',');
}

/** The breakpoints `text` means, or `null` when it is not this language. */
export function parseSteps(text: string, max = 100, maxZoom = ZOOMS - 1): Step[] | null {
	const levels = resolve(text, max, maxZoom);
	return levels === null ? null : toSteps(levels);
}

/**
 * The curve in a sentence - `z0-13: 80 · z14+: 50` - for the line under the editor.
 *
 * **The thing the written form hides.** Someone reading `80,70,14:50` cannot see which zooms get
 * what without running the counter in their head; this is that answer, and it is read-only so it
 * cannot disagree with the rows above it.
 */
export function describeSteps(steps: Step[]): string {
	if (steps.length === 0) return 'unset at every zoom - the encoder decides';
	return steps
		.map((step, index) => {
			const next = steps[index + 1];
			if (!next) return `z${step.zoom}+: ${step.value}`;
			return next.zoom === step.zoom + 1
				? `z${step.zoom}: ${step.value}`
				: `z${step.zoom}-${next.zoom - 1}: ${step.value}`;
		})
		.join(' · ');
}
