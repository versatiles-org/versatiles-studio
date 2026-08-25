/**
 * Reading design tokens from JavaScript.
 *
 * MapLibre paint properties take colour strings, not CSS - `'line-color': 'var(--accent)'` is not a
 * thing. Without this the map's colours would be the one part of the application that a theme could
 * not reach, and they would drift from the chrome around them. Before this existed, the map
 * background in `default-style.ts` and the `--map-bg` behind the canvas were already two different
 * greys.
 *
 * See docs/styling.md.
 */

/** The map's own colours, named here so a caller cannot invent a fifth blue. */
export type MapToken =
	| '--map-bg'
	| '--map-grid'
	| '--map-grid-halo'
	| '--map-feature'
	| '--map-pending'
	| '--map-label'
	| '--map-shade-shadow'
	| '--map-shade-highlight'
	| '--map-shade-accent'
	| '--map-crop-dim'
	| '--map-crop-edge';

/**
 * The computed value of a token from `:root`.
 *
 * Reads the live value rather than a copy, so it follows a theme change on the next call. Callers
 * are map layers, which are rebuilt when the style is, so that is often enough - a token that has
 * to update in place would need the layer's paint set again.
 */
export function token(name: MapToken): string {
	const root = getComputedStyle(document.documentElement);
	const value = root.getPropertyValue(name).trim();
	if (!value) {
		// A missing token means tokens.css did not load, which is a build problem rather than a
		// runtime one. Magenta is deliberately hideous: silently drawing something plausible would
		// hide it.
		console.error(`design token ${name} is not defined - is tokens.css imported?`);
		return '#ff00ff';
	}

	// **A token defined as another token must arrive resolved.** The computed value of a custom
	// property is meant to have its `var()` substituted, and a MapLibre paint property is a plain
	// string - it cannot resolve anything. Handed `var(--accent)` it rejects the layer, and a layer
	// that was refused draws nothing and says nothing, which is a whole afternoon.
	//
	// One level, because that is what the token file has: `--map-crop-edge: var(--accent)`.
	const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
	if (!reference) return value;
	const resolved = root.getPropertyValue(reference[1]).trim();
	console.error(`design token ${name} arrived as ${value} rather than a colour - resolving it here`);
	return resolved || '#ff00ff';
}
