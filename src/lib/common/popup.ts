/**
 * Where a popup goes, given the thing it belongs to ([Q58]).
 *
 * **Arithmetic, not a component**, because it is the part three popups had in common and the only
 * part worth testing on its own: `Help`, `Picker` and the map's `Dropdown` each measure a trigger and
 * work out a rectangle, and each had written this out again. A pure function can be checked against a
 * window of a known size, which is not true of anything that has to be rendered first.
 *
 * **Fixed coordinates, from a measured rect.** A pane scrolls and clips, so a list drawn inside one
 * cannot escape it; `position: fixed` from the trigger's rectangle sidesteps that without portals or
 * per-ancestor listeners. The cost is that a scroll invalidates the measurement, which is why every
 * caller closes on scroll rather than chasing it.
 */

/** Breathing room between a popup and the window's edges. */
const EDGE = 8;

/** How much room below the trigger is enough to open downward without cramping the list. */
const ROOM = 220;

export interface Placement {
	left: number;
	width: number;
	/** Set when the popup opens downward. */
	top?: number;
	/** Set instead when it opens upward, measured from the bottom of the window. */
	bottom?: number;
}

/** The window a popup has to fit inside. Passed in so the arithmetic can be tested. */
export interface Viewport {
	width: number;
	height: number;
}

/**
 * Under the trigger, pulled inside the window, and above it instead when there is more room there.
 *
 * **Flipping is the ordinary case, not the exceptional one**: a node near the bottom of a long chain
 * is where most of these open. `bottom` rather than a computed `top` for the flipped case, so a list
 * that grows while open grows upward from the trigger instead of sliding over it.
 */
export function place(
	rect: { left: number; bottom: number; top: number; width: number },
	viewport: Viewport,
	minWidth = 240
): Placement {
	const width = Math.min(Math.max(rect.width, minWidth), Math.max(viewport.width - 2 * EDGE, 0));
	const left = Math.max(EDGE, Math.min(rect.left, viewport.width - EDGE - width));
	const below = viewport.height - rect.bottom;
	const flip = below < ROOM && rect.top > below;

	return {
		left,
		width,
		top: flip ? undefined : rect.bottom + 4,
		bottom: flip ? viewport.height - rect.top + 4 : undefined
	};
}

/** The window as `place` wants it. Separate so a test never has to touch the real one. */
export const windowSize = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
