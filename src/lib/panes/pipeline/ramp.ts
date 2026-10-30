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
 * Upstream's own default, the hypsometric tint it uses when `ramp` is not set.
 *
 * Copied because it is not exposed anywhere, and only ever a place to start from: leaving the
 * parameter unset still means whatever upstream's default has become.
 */
export const DEFAULT_RAMP =
	'-11000:24507e,-200:8cb4d8,0:bcd8ec,0.01:a8c896,300:cad6a2,800:e4dcae,1500:d6bf98,2500:bea58a,4000:e4e0dc,6000:ffffff';

/** A colour as this writes it, or `null` when it is not one. */
function normalise(color: string): string | null {
	const digits = color.trim().replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(digits)) return digits;
	if (/^[0-9a-f]{3,4}$/.test(digits)) return [...digits].map((digit) => digit + digit).join('');
	return null;
}

/** The stops a written ramp holds, or `null` when upstream would refuse it. */
export function parseRamp(text: string): RampStop[] | null {
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

/** The stops as a CSS gradient, spaced by elevation. Outside the ramp the ends hold, as upstream's do. */
export function rampGradient(stops: RampStop[]): string {
	if (stops.length === 0) return 'none';
	const lowest = stops[0].meters;
	const span = stops[stops.length - 1].meters - lowest;
	const colours = stops.map(({ meters, color }) => `#${color} ${span > 0 ? ((meters - lowest) / span) * 100 : 0}%`);
	return `linear-gradient(to right, ${stops.length > 1 ? colours.join(', ') : `${colours[0]}, ${colours[0]}`})`;
}
