/**
 * What a source's tiles are, as far as drawing them is concerned (S6.1).
 *
 * The style pane has four editors and this is what picks between them. Four cases, and only one of
 * them worked before this existed: a preset was pointed at whatever the pipeline produced, and when
 * the layer names did not match - which is most of the time - the answer was to draw no style at
 * all. See [Style Use Cases](../../../docs/style-use-cases.md).
 *
 * **The container's own answer first, a guess second, and the person last.** `tile_schema` is a
 * declaration and beats anything inferred from the bytes; where it is absent the format and the
 * probed layers narrow it as far as they can, which is not always far enough. A DEM and a
 * photograph are both `png` with no vector layers, so `Recipe.kind` exists to settle what nothing
 * else can.
 */

import type { SourceKind } from '../ipc/commands';

/** What the reading was based on, so the pane can say so rather than just asserting. */
export type KindBasis = 'declared' | 'inferred' | 'chosen';

export interface KindReading {
	kind: SourceKind;
	basis: KindBasis;
}

/**
 * `tile_schema`'s spellings, as `versatiles_core` writes them.
 *
 * Deliberately not exhaustive over upstream's enum: an unlisted schema falls through to the format,
 * which is the same answer this would give for `other`. A new schema upstream therefore degrades to
 * a guess rather than to a wrong declaration.
 */
const BY_SCHEMA: Record<string, SourceKind> = {
	'shortbread@1.0': 'vectorShortbread',
	openmaptiles: 'vectorOther',
	rgb: 'rasterImage',
	rgba: 'rasterImage',
	'dem/mapbox': 'rasterDem',
	'dem/terrarium': 'rasterDem',
	'dem/versatiles': 'rasterDem'
};

/**
 * Layers that mean Shortbread, for a container that does not say so itself.
 *
 * Three, not the whole schema: these are load-bearing in every Shortbread map and none of them is a
 * name somebody reaches for by accident. Matching on the full list would fail a container that
 * legitimately omits a layer, and matching on one would call any tileset with a `water` layer a
 * basemap.
 */
const SHORTBREAD_MARKERS = ['water_polygons', 'street_polygons', 'boundaries'];

/** Whether these layer names look like Shortbread's. */
function looksLikeShortbread(layers: string[]): boolean {
	const present = new Set(layers);
	return SHORTBREAD_MARKERS.filter((marker) => present.has(marker)).length >= 2;
}

/**
 * What this source is, and how confidently.
 *
 * `override` is [`Recipe.kind`](../ipc/commands) - what someone said explicitly, which wins over
 * both of the others.
 */
export function sourceKind(
	tileFormat: string,
	tileSchema: string | null | undefined,
	layers: string[],
	override?: SourceKind | null
): KindReading {
	if (override) return { kind: override, basis: 'chosen' };

	if (tileSchema) {
		const declared = BY_SCHEMA[tileSchema.toLowerCase()];
		if (declared) return { kind: declared, basis: 'declared' };
	}

	// No declaration, or one this does not know. The format splits vector from raster reliably;
	// nothing after that is reliable, which is what `basis: 'inferred'` is telling the pane to say.
	const format = tileFormat.toLowerCase();
	if (format === 'mvt') {
		return { kind: looksLikeShortbread(layers) ? 'vectorShortbread' : 'vectorOther', basis: 'inferred' };
	}

	// **Imagery rather than DEM, because guessing DEM is the expensive mistake.** Read a photograph
	// as a DEM and the map shows hillshade of noise; read a DEM as a photograph and it shows the
	// encoded colours - wrong, but recognisably a picture, and the picker is right there.
	return { kind: 'rasterImage', basis: 'inferred' };
}

/** What each kind is called in the pane. */
export const KIND_LABELS: Record<SourceKind, string> = {
	vectorShortbread: 'Vector · Shortbread',
	vectorOther: 'Vector · other',
	rasterImage: 'Raster · imagery',
	rasterDem: 'Raster · elevation'
};

/** Whether a kind is drawn from vector tiles, which is what the presets and the layer tree need. */
export const isVector = (kind: SourceKind): boolean => kind === 'vectorShortbread' || kind === 'vectorOther';
