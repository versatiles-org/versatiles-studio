/**
 * Reading what a container says its tiles contain.
 *
 * One question - *which vector layers are in here* - and it was answered in three places: `stack.ts`
 * deciding what a derived style should draw, `preview.svelte.ts` telling the style pane what a
 * preset has to work with, and `add-source.ts` choosing which hairlines to add. Two of them were
 * character-for-character the same function under two names.
 *
 * **Its own module because of who needs it.** `add-source.ts` is mechanism - put a source on the map
 * - and `stack.ts` is policy - which sources there are and in what order. Keeping the shared copy in
 * `stack.ts` would have the first importing the second, which is the direction `categories.ts`
 * already exists to avoid one level up.
 */

import type { ContainerInfo } from '../ipc/commands';

/**
 * The vector layers a container declares, in the order it declares them.
 *
 * **What it declares, not what a probe saw.** `Preview.layers` reports on one tile - the middle of
 * the bounds at the source's lowest zoom, which is the emptiest tile in the pyramid - so a basemap
 * declaring 34 layers can sample as two. This is the list of what exists; the sample is what is
 * known about each.
 *
 * Empty for a raster container, for one whose TileJSON says nothing, and for no container at all -
 * none of which is a failure, and each of which a caller would otherwise have to guard separately.
 */
export function declaredLayers(info: ContainerInfo | null | undefined): string[] {
	const layers = info?.tileJson?.vector_layers;
	if (!Array.isArray(layers)) return [];
	return layers.map((layer) => (layer as { id?: string }).id).filter((id): id is string => typeof id === 'string');
}
