/**
 * The colours behind [`Control::Ramp`] - `dem_colorize`'s `ramp`.
 *
 * `0:00a000,1000:c8b464` is a list of stops, each an elevation in metres and a colour. The rules are
 * `ColorRamp::try_from`'s upstream: a colour is `RRGGBB` or `RRGGBBAA` with an optional `#`, or the
 * short forms of those, and the elevations ascend.
 */

/** One stop. `color` is hex digits with no `#`, six or eight of them, the way this writes them. */
export interface RampStop {
	meters: number;
	color: string;
}

/**
 * Upstream's hypsometric tint: what `ramp=default` stands for, and what `dem_colorize` uses when
 * `ramp` is not set.
 *
 * Copied because it is not exposed anywhere, and only ever used to draw the preview and to start
 * editing from: writing `default` still means whatever upstream's default has become.
 */
export const DEFAULT_RAMP =
	'-11000:24507e,-200:8cb4d8,0:bcd8ec,0.01:a8c896,300:cad6a2,800:e4dcae,1500:d6bf98,2500:bea58a,4000:e4e0dc,6000:ffffff';

/**
 * The ramps upstream knows by name, and the stops each stands for. `ColorRamp::try_from` in
 * versatiles-rs 5.6 has one; a name added there needs adding here before the dialog can offer it.
 */
export const NAMED_RAMPS: Readonly<Record<string, string>> = { default: DEFAULT_RAMP };

/** The name a written ramp is, or `null` when it is a list of stops or nothing upstream knows. */
export function rampName(text: string): string | null {
	const name = text.trim();
	return Object.hasOwn(NAMED_RAMPS, name) ? name : null;
}

/** A colour as this writes it, or `null` when it is not one. */
function normalise(color: string): string | null {
	const digits = color.trim().replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(digits)) return digits;
	if (/^[0-9a-f]{3,4}$/.test(digits)) return [...digits].map((digit) => digit + digit).join('');
	return null;
}

/** The stops a written ramp holds, a named one included, or `null` when upstream would refuse it. */
export function parseRamp(text: string): RampStop[] | null {
	const name = rampName(text);
	if (name !== null) return parseRamp(NAMED_RAMPS[name]);
	const stops: RampStop[] = [];
	for (const part of text.split(',').map((piece) => piece.trim())) {
		if (part === '') continue;
		const colon = part.indexOf(':');
		if (colon < 0) return null;
		const elevation = part.slice(0, colon).trim();
		const meters = Number(elevation);
		const color = normalise(part.slice(colon + 1));
		if (elevation === '' || !Number.isFinite(meters) || color === null) return null;
		const previous = stops.at(-1);
		if (previous && meters <= previous.meters) return null;
		stops.push({ meters, color });
	}
	return stops.length > 0 ? stops : null;
}

/** The written form. Stops are written in the order given, so the caller keeps them sorted. */
export function fromRamp(stops: RampStop[]): string {
	return stops.map(({ meters, color }) => `${meters}:${color}`).join(',');
}

/** Whether two stops share an elevation, which is the one thing sorting cannot settle. */
export function hasDuplicates(stops: RampStop[]): boolean {
	return new Set(stops.map((stop) => stop.meters)).size < stops.length;
}

/** Whether any stop is see-through, which makes the tiles RGBA and a JPEG source's tiles PNG. */
export function isTranslucent(stops: RampStop[]): boolean {
	return stops.some(({ color }) => color.length === 8 && !color.endsWith('ff'));
}

/**
 * A gradient the generator offers, as the colours it passes through, evenly spaced (#17).
 *
 * **Anchors, not a formula.** Upstream blends linearly in RGB between stops, and so does the CSS
 * preview, so a gradient written as enough well-chosen anchors is exactly what both draw, with the
 * fewest stops in the VPL. A rainbow from its six hues alone would blend through mud; these are
 * sampled from palettes made for the purpose, at as few points as still look clean.
 */
export interface Gradient {
	id: string;
	label: string;
	colors: readonly string[];
}

export const GRADIENTS: readonly Gradient[] = [
	// Turbo, which keeps the rainbow's range of hues without its dark bands and its sudden cyan.
	{ id: 'rainbow', label: 'Rainbow', colors: ['30123b', '4686fb', '1be5b5', 'a4fc3c', 'fbb938', 'e4460a', '7a0403'] },
	{ id: 'heat', label: 'Heat', colors: ['3c0000', '9a0000', 'e83a00', 'ff9a00', 'ffe14a', 'ffffff'] },
	// Viridis: even in lightness, and readable with every common colour-vision deficiency.
	{ id: 'viridis', label: 'Viridis', colors: ['440154', '3b528b', '21918c', '5ec962', 'fde725'] },
	{ id: 'cool-warm', label: 'Cool to warm', colors: ['3b4cc0', '8db0fe', 'dddddd', 'f49a7b', 'b40426'] },
	{ id: 'blues', label: 'Light to dark blue', colors: ['f7fbff', 'c6dbef', '6baed6', '2171b5', '08306b'] },
	{ id: 'greys', label: 'Grayscale', colors: ['000000', 'ffffff'] }
];

/** What the generator is asked for. */
export interface Generation {
	gradient: Gradient;
	/** The lowest and highest elevation, in metres. `low` must be below `high`. */
	low: number;
	high: number;
	/** Runs the gradient from its last colour to its first. */
	reverse: boolean;
	/**
	 * What lies outside the range. `hold` keeps the end colours there, as upstream does past the last
	 * stop; `transparent` leaves it empty, which is what highlighting a range means.
	 */
	outside: 'hold' | 'transparent';
}

/**
 * A range a DEM is likely to span when nothing better is known: sea level to the higher mountains
 * of most countries. Sampling tiles for the real one could miss the extremes, and a person picking
 * a range to highlight knows it better than a sample would.
 */
export const DEFAULT_RANGE = { low: 0, high: 3000 } as const;

/**
 * How far outside the range the transparent stops go. Elevations must strictly ascend, so a hard
 * edge is two stops this close together, as `0` and `0.01` are in upstream's default.
 */
const EDGE = 0.01;

/** Rounded to the centimetre, which keeps every elevation short and never in exponent notation. */
const metres = (value: number): number => Math.round(value * 100) / 100 || 0;

/**
 * The stops for a gradient over a range: one per anchor, evenly spaced, plus a transparent stop
 * just outside each end when the outside is to be left empty.
 */
export function generateRamp({ gradient, low, high, reverse, outside }: Generation): RampStop[] {
	const colors = reverse ? [...gradient.colors].reverse() : [...gradient.colors];
	const last = colors.length - 1;
	const stops = colors.map((color, index) => ({
		meters: metres(last === 0 ? low : low + ((high - low) * index) / last),
		color
	}));
	if (outside === 'hold') return stops;
	return [
		{ meters: metres(low - EDGE), color: `${colors[0]}00` },
		...stops,
		{ meters: metres(high + EDGE), color: `${colors[last]}00` }
	];
}

/**
 * Why a range cannot be generated, or `null` when it can. Checked before generating, so the button
 * says so rather than producing stops upstream would refuse.
 */
export function rangeProblem(low: number, high: number): string | null {
	if (!Number.isFinite(low) || !Number.isFinite(high)) return 'Give both elevations.';
	// Centimetres apart at least, or rounding would put two stops on one elevation.
	if (metres(high) - metres(low) < 0.1) return 'The highest elevation has to be above the lowest.';
	return null;
}

/** The stops as a CSS gradient, spaced by elevation. Outside the ramp the ends hold, as upstream's do. */
export function rampGradient(stops: RampStop[]): string {
	if (stops.length === 0) return 'none';
	const lowest = stops[0].meters;
	const span = stops[stops.length - 1].meters - lowest;
	const colours = stops.map(({ meters, color }) => `#${color} ${span > 0 ? ((meters - lowest) / span) * 100 : 0}%`);
	return `linear-gradient(to right, ${stops.length > 1 ? colours.join(', ') : `${colours[0]}, ${colours[0]}`})`;
}
