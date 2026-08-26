/**
 * The rectangle a bbox field is showing, and whether it is being drawn (A5, D3).
 *
 * **Because the field and the map are at opposite ends of the window.** A `bbox=` lives in a node's
 * form in the pipeline pane; the rectangle it means belongs on the map, which `App` owns. Threading
 * a callback down through the pane, the chain, the node and the row would put four components in the
 * business of a fifth. One claim here, and both ends read it.
 *
 * **One at a time, deliberately.** Two rectangles on a map are two crops as far as the eye is
 * concerned, and the overlay that draws them dims everything outside - two of those is a mess with
 * no reading. So claiming displaces, which also means the map always shows the field you last
 * touched rather than an accumulation.
 */

/** West, south, east, north, in WGS84 degrees - the order VPL writes and MapLibre reads. */
export type BBox = [number, number, number, number];

/** Who has the map. A token rather than the callback, which is a new closure on every render. */
let holder = $state<string | null>(null);
let shown = $state<BBox | null>(null);
let drawing = $state(false);
/** Where a finished rectangle goes. Not `$state`: nothing renders from it. */
let commit: ((bbox: BBox) => void) | null = null;

export const bboxField = {
	/** The rectangle to draw, or `null` when no field is asking for one. */
	get shown(): BBox | null {
		return shown;
	},

	/** Whether a drag on the map is filling in a field rather than setting the crop. */
	get drawing(): boolean {
		return drawing;
	},

	/** Whether this field is the one the map is answering to. */
	holds(id: string): boolean {
		return holder === id;
	},

	/**
	 * Takes the map, showing what the field holds.
	 *
	 * Called on focus, and again by the draw button - a click blurs the input first, so the button
	 * has to be able to take back what the blur released.
	 */
	focus(id: string, value: BBox | null, onDrawn: (bbox: BBox) => void): void {
		holder = id;
		shown = value;
		commit = onDrawn;
	},

	/** Starts or stops drawing for the field that holds the map. */
	toggleDraw(id: string): void {
		if (holder !== id) return;
		drawing = !drawing;
	},

	/**
	 * A rectangle was finished on the map.
	 *
	 * Drawing stops, and what was drawn stays on screen: the field now holds it, and taking the
	 * rectangle away at the moment it becomes the answer would read as the drag having failed.
	 */
	finish(bbox: BBox): void {
		drawing = false;
		shown = bbox;
		commit?.(bbox);
	},

	/**
	 * Gives the map back, if this field still has it.
	 *
	 * **Not while drawing.** The click that starts a drag on the map blurs the field, and a release
	 * on blur would cancel the drawing before the first pointer-down.
	 */
	release(id: string): void {
		if (holder !== id || drawing) return;
		holder = null;
		shown = null;
		commit = null;
	}
};

/**
 * The four numbers in a field's text, or `null` if it does not hold four.
 *
 * Lenient about how they are written, because the field is: `[13,52,14,53]`, `13, 52, 14, 53` and
 * the same with spaces are all VPL a person types, and a rectangle should appear for each of them.
 * Anything else - three numbers, a half-typed one, a parameter reference - is not a rectangle yet,
 * and drawing a guess would be worse than drawing nothing.
 */
export function parseBbox(text: string): BBox | null {
	const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
	if (!numbers || numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value))) return null;
	const [west, south, east, north] = numbers as BBox;
	// Off the globe is a typo, not a view: MapLibre would take it and fly somewhere nobody meant.
	if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) return null;
	return [west, south, east, north];
}

/**
 * How a drawn rectangle is written back into the document.
 *
 * Six decimals is about ten centimetres, which is finer than anything a drag can mean and short
 * enough to read. Trailing zeros are dropped by `Number`, so a whole degree stays a whole degree.
 */
export function formatBbox(bbox: BBox): string {
	return bbox.map((value) => Number(value.toFixed(6))).join(', ');
}
