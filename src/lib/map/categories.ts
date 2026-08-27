/**
 * What a layer is *about*, as a name a person would use ([the layer stack](../../../docs/layers.md)).
 *
 * **The id level is unreadable on its own.** `colorful` is 324 layers whose top-level prefixes form
 * 22 runs, six of them repeated names - `street` three times, `bridge` once as a single layer and
 * once as ninety-one - because those prefixes encode z-order: the same roads underground, on the
 * surface and on a bridge. That is the style's engineering, and it is not a category anyone thinks
 * in.
 *
 * Sixteen prefixes mapped onto nine categories collapse it to nine rows, and `neutrino` to seven,
 * without breaking a single run - which matters more than the tidiness: a category that was not
 * contiguous in paint order could not be dragged as one thing, and the tree would be describing a
 * map that is not on screen.
 *
 * **This table belongs upstream.** `@versatiles/style` already keys its own rule tables on these
 * prefixes, so a `groupOf(id)` export there would let this file be deleted - as a lookup rather than
 * per-layer `metadata`, which would be copied into every exported `style.json`. Until then it lives
 * here, with a test that reads the real presets, so a preset that grows a prefix fails a test rather
 * than quietly appearing as a category of its own.
 */

/** Prefix to category. The nine values are the rows a person sees for a preset style. */
export const CATEGORIES: Record<string, string> = {
	background: 'Background',
	land: 'Land & water',
	water: 'Land & water',
	site: 'Sites',
	airport: 'Airport',
	building: 'Buildings',
	tunnel: 'Roads & rails',
	bridge: 'Roads & rails',
	street: 'Roads & rails',
	way: 'Roads & rails',
	transport: 'Roads & rails',
	poi: 'Points of interest',
	boundary: 'Boundaries',
	label: 'Labels',
	marking: 'Labels',
	symbol: 'Labels'
};

/**
 * A layer id as its path components.
 *
 * Three separators, because two conventions meet here: the presets write `label-place-city` and a
 * derived style writes `derived:water_polygons`. The same rule reads both, and the tile layer of a
 * derived style lands at the second level without a special case.
 *
 * **`_` is not one of them.** It joins words inside a single name rather than separating two:
 * splitting it turns `water_polygons` into a `water` holding a `polygons`, and files `poi-man_made`
 * under a level called `man`. Every tile layer Shortbread declares is spelled that way, so the
 * mistake would be on most rows of most derived styles.
 */
export function parts(id: string): string[] {
	return id.split(/[-:.]+/).filter(Boolean);
}

/**
 * The category a layer belongs to, or `null` for a prefix the table does not know.
 *
 * `null` is not a failure - it is a third-party preset, a derived style, or a preset that has grown
 * a prefix since this was written. The tree falls back to the raw first component there, which
 * degrades to a level of the id rather than to a category that would be a guess.
 */
export function categoryOf(id: string): string | null {
	const [first] = parts(id);
	return first ? (CATEGORIES[first] ?? null) : null;
}

/** What a layer is filed under at the top level: its category, else its own first component. */
export function headingOf(id: string): string {
	return categoryOf(id) ?? parts(id)[0] ?? id;
}
