/**
 * What a source's tiles are, as far as drawing them is concerned (S6.1).
 *
 * The style pane has four editors and this is what picks between them. Four cases, and only one of
 * them worked before this existed: a preset was pointed at whatever the pipeline produced, and when
 * the layer names did not match - which is most of the time - the answer was to draw no style at
 * all. See [Style Use Cases](../../../docs/history.md).
 *
 * **The container's own answer first, a guess second, and the person last.** `tile_schema` is a
 * declaration and beats anything inferred from the bytes; where it is absent the format and the
 * probed layers narrow it as far as they can, which is not always far enough. A DEM and a
 * photograph are both `png` with no vector layers, so `Recipe.kind` exists to settle what nothing
 * else can.
 */

import { guessSchema } from '@versatiles/style';
import type { SchemaName } from '@versatiles/style';
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
	openmaptiles: 'vectorOpenMapTiles',
	rgb: 'rasterImage',
	rgba: 'rasterImage',
	'dem/mapbox': 'rasterDem',
	'dem/terrarium': 'rasterDem',
	'dem/versatiles': 'rasterDem'
};

/** The kind each schema the builders can draw is. `mapbox` is recognised upstream but not drawn. */
const BY_GUESS: Partial<Record<SchemaName, SourceKind>> = {
	shortbread: 'vectorShortbread',
	openmaptiles: 'vectorOpenMapTiles',
	protomaps: 'vectorProtomaps'
};

/**
 * How many of a schema's own layers a container needs before it counts as that schema.
 *
 * **`guessSchema` alone is too generous for this.** It calls a tileset a schema when at least half of
 * its layers are that schema's - right for a basemap, wrong for a pipeline's output, which is most of
 * what Studio draws. Protomaps names its layers `places`, `roads` and `water`, so a CSV turned into one
 * layer called `places` is "Protomaps" by that rule, and a basemap style would be drawn over somebody's
 * data. Three layers of one schema is past what anyone names by accident - one more than the
 * Shortbread check this replaces asked for - and every basemap clears it with room to spare.
 */
const MIN_MATCHED = 3;

/** The schema these layer names belong to, as a kind, or `null` when they belong to none. */
function guessedKind(layers: string[]): SourceKind | null {
	// Names only: `guessSchema` reads `vector_layers`, and where the fields would decide between two
	// schemas sharing a name it counts the name for both - which the bar above absorbs.
	const guess = guessSchema({ tilejson: '3.0.0', tiles: [], vector_layers: layers.map((id) => ({ id, fields: {} })) });
	if (guess.type !== 'vector' || guess.schema === undefined) return null;
	const best = guess.candidates.find((candidate) => candidate.schema === guess.schema);
	if (!best || best.matched.length < MIN_MATCHED) return null;
	return BY_GUESS[guess.schema] ?? null;
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
		return { kind: guessedKind(layers) ?? 'vectorOther', basis: 'inferred' };
	}

	// **Imagery rather than DEM, because guessing DEM is the expensive mistake.** Read a photograph
	// as a DEM and the map shows hillshade of noise; read a DEM as a photograph and it shows the
	// encoded colours - wrong, but recognisably a picture, and the picker is right there.
	return { kind: 'rasterImage', basis: 'inferred' };
}

/** What each kind is called in the pane. */
export const KIND_LABELS: Record<SourceKind, string> = {
	vectorShortbread: 'Vector · Shortbread',
	vectorOpenMapTiles: 'Vector · OpenMapTiles',
	vectorProtomaps: 'Vector · Protomaps',
	vectorOther: 'Vector · other',
	rasterImage: 'Raster · imagery',
	rasterDem: 'Raster · elevation'
};

/** Whether a kind is drawn from vector tiles, which is what the presets and the layer tree need. */
export const isVector = (kind: SourceKind): boolean =>
	kind === 'vectorShortbread' || kind === 'vectorOpenMapTiles' || kind === 'vectorProtomaps' || kind === 'vectorOther';
