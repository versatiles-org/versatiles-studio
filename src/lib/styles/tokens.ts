/**
 * Reading design tokens from JavaScript.
 *
 * MapLibre paint properties take colour strings, not CSS — `'line-color': 'var(--accent)'` is not a
 * thing. Without this the map's colours would be the one part of the application that a theme could
 * not reach, and they would drift from the chrome around them. Before this existed, the map
 * background in `default-style.ts` and the `--map-bg` behind the canvas were already two different
 * greys.
 *
 * See docs/styling.md.
 */

/** The map's own colours, named here so a caller cannot invent a fifth blue. */
export type MapToken = '--map-bg' | '--map-grid' | '--map-grid-halo' | '--map-feature';

/**
 * The computed value of a token from `:root`.
 *
 * Reads the live value rather than a copy, so it follows a theme change on the next call. Callers
 * are map layers, which are rebuilt when the style is, so that is often enough — a token that has
 * to update in place would need the layer's paint set again.
 */
export function token(name: MapToken): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	if (value) return value;
	// A missing token means tokens.css did not load, which is a build problem rather than a runtime
	// one. Magenta is deliberately hideous: silently drawing something plausible would hide it.
	console.error(`design token ${name} is not defined — is tokens.css imported?`);
	return '#ff00ff';
}
