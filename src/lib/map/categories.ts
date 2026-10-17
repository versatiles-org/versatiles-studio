/**
 * What a layer is *about*, as a name a person would use ([the layer stack](../../../docs/layers.md)).
 *
 * **The id level is unreadable on its own.** `colorful` is 253 layers whose top-level prefixes form
 * runs that repeat - `street`, `tunnel` and `bridge` are the same roads underground, on the surface
 * and on a bridge, and `label` comes once before the POIs and once after them - because those
 * prefixes encode z-order. That is the style's engineering, and it is not a category anyone thinks in.
 *
 * Seventeen prefixes mapped onto seven categories collapse every preset to seven rows without
 * breaking a single run - which matters more than the tidiness: a category that was not contiguous in
 * paint order could not be dragged as one thing, and the tree would be describing a map that is not
 * on screen.
 *
 * **Sites are land and POIs are labels** because that is where v7 paints them: `site-*` between the
 * land cover and the water, `poi-*` between the house numbers and the street names. Each is still a
 * level of its own one row down, so nothing that could be switched off before has been lost.
 *
 * **This table belongs upstream.** `@versatiles/style` already keys its own rule tables on these
 * prefixes, so a `groupOf(id)` export there would let this file be deleted - as a lookup rather than
 * per-layer `metadata`, which would be copied into every exported `style.json`. Until then it lives
 * here, with a test that reads the real presets, so a preset that grows a prefix fails a test rather
 * than quietly appearing as a category of its own.
 */

/** Prefix to category. The seven values are the rows a person sees for a preset style. */
export const CATEGORIES: Record<string, string> = {
	background: 'Background',
	land: 'Land & water',
	water: 'Land & water',
	site: 'Land & water',
	airport: 'Airport',
	building: 'Buildings',
	tunnel: 'Roads & rails',
	bridge: 'Roads & rails',
	street: 'Roads & rails',
	way: 'Roads & rails',
	transport: 'Roads & rails',
	aerialway: 'Roads & rails',
	poi: 'Labels',
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

/**
 * Categories that no longer exist, and where what they held is now: the category, then the level it
 * became inside it.
 *
 * **Eyes are stored as paths, so a renamed category strands every eye written under the old name.**
 * `@versatiles/style` v7 moved sites in among the land cover and POIs in among the labels, and the
 * table followed (see above) - so a project that had hidden "Points of interest" would open with its
 * POIs back on, and no row left to switch them off from.
 */
const RENAMED: Record<string, [string, string]> = {
	Sites: ['Land & water', 'site'],
	'Points of interest': ['Labels', 'poi']
};

/**
 * What a stored eye path means today.
 *
 * The category level is replaced and the rest kept: `Sites/site/education` was always a `site` level
 * below the category, so it becomes `Land & water/site/education`, and the bare `Sites` becomes that
 * level itself rather than the whole of `Land & water`.
 *
 * **Read, never rewritten.** The path the core stores stays as it is, and every match reports it as
 * stored - so opening the eye removes the entry that is there, and the old name leaves the project
 * the first time someone touches it. The core never interprets these paths, and this keeps it so.
 */
export function currentPath(stored: string): string {
	const [head, ...rest] = stored.split('/');
	const renamed = RENAMED[head];
	if (!renamed) return stored;
	return (rest.length > 0 ? [renamed[0], ...rest] : renamed).join('/');
}

/**
 * The path of a source's own row in the tree: no category, no level, no layer.
 *
 * **An eye stored here hides every layer the source draws, and nothing else changes.** The graph is
 * still built and mounted - that is the switch in the Sources pane - so the rows stay in the tree
 * and the eye can be found again. Before this was spelled out, the row stored the empty path and
 * nothing read it: the row went grey while the map went on drawing the source (S8.1).
 */
export const WHOLE_SOURCE = '';

/** Whether a stored eye covers this path: the path itself, one above it, or the whole source. */
export function covers(stored: string, path: string): boolean {
	const current = currentPath(stored);
	if (current === WHOLE_SOURCE) return true;
	return path === current || path.startsWith(`${current}/`);
}

/**
 * Whether an eye above this layer is closed. Says which, as stored, so the pane can offer to open
 * the one that did.
 *
 * Nearest first, so the source's own eye comes last: it is above every category.
 */
export function hiddenBy(id: string, hidden: Iterable<string>): string | null {
	const stored = [...hidden];
	for (const path of ancestors(id)) {
		const found = stored.find((eye) => currentPath(eye) === path);
		if (found !== undefined) return found;
	}
	return stored.includes(WHOLE_SOURCE) ? WHOLE_SOURCE : null;
}
