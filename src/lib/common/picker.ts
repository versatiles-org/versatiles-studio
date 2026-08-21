/**
 * What a `Picker` shows: filtering and grouping, apart from the component that draws them.
 *
 * Here rather than inside `Picker.svelte` because these are the parts with answers worth asserting
 * — the ordering rule especially, which is the sort of thing that looks right until a group's rows
 * arrive out of order.
 */

export interface PickerItem {
	/** What `onPick` receives. */
	value: string;
	/** What the row shows. Defaults to `value`. */
	label?: string;
	/** A second line, when there is something worth saying about it. */
	description?: string;
	/** Why this cannot be picked. Present means unpickable — the row still shows, with this. */
	unavailable?: string;
	/** Heading this row sits under. Rows with no group come first, ungrouped. */
	group?: string;
}

/**
 * The items matching `query`.
 *
 * Matched against the label, the description **and** the reason a row is unavailable, so typing
 * "raster" finds both the operations that want raster tiles and the ones refused for not being
 * raster. Case-insensitive substring rather than fuzzy matching: an operation name is something
 * people half-remember, not something they approximate.
 */
export function matching(items: PickerItem[], query: string): PickerItem[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return items;
	return items.filter((item) =>
		`${item.label ?? item.value} ${item.description ?? ''} ${item.unavailable ?? ''}`.toLowerCase().includes(needle)
	);
}

/**
 * The items as consecutive runs sharing a heading.
 *
 * **Runs, not buckets.** Grouping by collecting every row with the same heading would reorder the
 * list to suit the headings; this keeps the caller's order and only draws a heading where it
 * changes. The caller decides what order things go in — it is the one that knows which group
 * matters most.
 */
export function grouped(items: PickerItem[]): { name: string | null; items: PickerItem[] }[] {
	const out: { name: string | null; items: PickerItem[] }[] = [];
	for (const item of items) {
		const name = item.group ?? null;
		const last = out.at(-1);
		if (last && last.name === name) last.items.push(item);
		else out.push({ name, items: [item] });
	}
	return out;
}

/** The rows the arrow keys walk — everything that can actually be chosen. */
export function pickable(items: PickerItem[]): PickerItem[] {
	return items.filter((item) => !item.unavailable);
}
