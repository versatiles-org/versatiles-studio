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

/**
 * The component at `depth` of a layer's own id, or `null` once the id is exhausted.
 *
 * Depth 0 is the heading - a category, or the id's own first component when no category claims it.
 * Everything below is the id itself, which is why a derived style's `derived:water_polygons` puts
 * the tile layer at depth 1 without this knowing anything about derived styles.
 */
export function componentAt(id: string, depth: number): string | null {
	if (depth === 0) return headingOf(id);
	// **An id whose heading came from itself has spent that component.** `derived:water_polygons` is
	// headed `derived`, so the level below it is `water_polygons` - without the offset the tree
	// nests `derived` inside `derived` and every derived style is one row deeper than it should be.
	const spent = categoryOf(id) === null ? 1 : 0;
	return parts(id)[depth - 1 + spent] ?? null;
}

/**
 * Every path that would hide this layer, nearest first.
 *
 * The resolution rule in one place: a layer is hidden when its own override says so, or when any of
 * these is in its source's hidden set. Nearest first so a caller can say *which* eye did it.
 */
export function ancestors(id: string): string[] {
	const out: string[] = [];
	let path = '';
	for (let depth = 0; ; depth++) {
		const component = componentAt(id, depth);
		if (component === null) break;
		path = path ? `${path}/${component}` : component;
		out.push(path);
	}
	return out.reverse();
}

/** Whether an eye above this layer is closed. Says which, so the pane can offer to open it. */
export function hiddenBy(id: string, hidden: Iterable<string>): string | null {
	const set = hidden instanceof Set ? hidden : new Set(hidden);
	return ancestors(id).find((path) => set.has(path)) ?? null;
}
