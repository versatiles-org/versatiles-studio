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

/** The stops as a CSS gradient, spaced by elevation. Outside the ramp the ends hold, as upstream's do. */
export function rampGradient(stops: RampStop[]): string {
	if (stops.length === 0) return 'none';
	const lowest = stops[0].meters;
	const span = stops[stops.length - 1].meters - lowest;
	const colours = stops.map(({ meters, color }) => `#${color} ${span > 0 ? ((meters - lowest) / span) * 100 : 0}%`);
	return `linear-gradient(to right, ${stops.length > 1 ? colours.join(', ') : `${colours[0]}, ${colours[0]}`})`;
}
