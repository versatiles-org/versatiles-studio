/**
 * The shapes a crop is drawn as, and the rules for turning a drag into one (F2, S5.2, S5.4).
 *
 * Apart from `CropOverlay`, which binds them to the map, for the reason `layer-tree.ts` gives: these
 * are decisions with right answers - where the dimming stops, when two corners are a rectangle and
 * when they are a click - and a decision inside a `.svelte` file is one no test can ask about.
 */

/** West, south, east, north. */
export type BBox = [number, number, number, number];

/** A point on the map, in the shape MapLibre hands one over. */
export interface LngLatish {
	lng: number;
	lat: number;
}

/**
 * Where the dimmed world stops.
 *
 * **The Web Mercator limit, not the pole.** Beyond it there is no map to dim, and a polygon reaching
 * ±90 projects to infinity - which MapLibre draws as nothing at all.
 */
export const MERCATOR_LIMIT = 85.05;

type Ring = [number, number][];

/** A box's own ring, closed, wound the way GeoJSON wants an outer ring. */
function ring([west, south, east, north]: BBox): Ring {
	return [
		[west, south],
		[east, south],
		[east, north],
		[west, north],
		[west, south]
	];
}

function collection(coordinates: Ring[]) {
	return {
		type: 'FeatureCollection' as const,
		features: [
			{
				type: 'Feature' as const,
				properties: {},
				geometry: { type: 'Polygon' as const, coordinates }
			}
		]
	};
}

/**
 * The rectangle itself - what a drag in flight is drawn as.
 *
 * **Not the dimmed form.** Dimming is right for a crop that exists, since it says which part of the
 * world survives, and wrong for one being dragged: starting a small box turned the whole map dark
 * and grew a hole in it, which reads as the map breaking rather than as a rectangle being drawn.
 */
export function rectangle(box: BBox) {
	return collection([ring(box)]);
}

/**
 * The world with the crop punched out of it - what a finished crop is drawn as.
 *
 * One polygon with a hole does both jobs: the fill dims the outside, the line traces the edge. Two
 * shapes could be drawn out of step with each other; one cannot.
 */
export function outside(box: BBox) {
	return collection([
		[
			[-180, -MERCATOR_LIMIT],
			[180, -MERCATOR_LIMIT],
			[180, MERCATOR_LIMIT],
			[-180, MERCATOR_LIMIT],
			[-180, -MERCATOR_LIMIT]
		],
		ring(box)
	]);
}

/**
 * The box two corners describe, whichever way the drag went.
 *
 * Sorted rather than assumed: a drag up-and-left is as ordinary as one down-and-right, and a bbox
 * with its edges the wrong way round is refused further down (`export::Bounds::check`) with a
 * message about the west edge that would be baffling here.
 */
export function boxBetween(a: LngLatish, b: LngLatish): BBox {
	return [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
}

/**
 * Whether a finished drag is a rectangle at all.
 *
 * **A click is not an empty selection.** Two identical corners would otherwise clear the crop
 * someone was only trying to look at - which is a thing you cannot undo by clicking again.
 */
export function isRectangle(box: BBox): boolean {
	return box[0] !== box[2] && box[1] !== box[3];
}
