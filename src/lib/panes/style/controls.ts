/**
 * What the style pane's controls are, and what each one shows - apart from the component that draws
 * them (S6.1-S6.7).
 *
 * The same split `layer-tree.ts` next door makes, for the same reason: the pane's script had grown
 * to three hundred lines, and almost none of it was markup. A slider's neutral value, whether a
 * field counts as changed, which reading a picker should clear rather than record - those are
 * decisions with right answers, and a decision inside a `.svelte` file is one no test can ask about.
 *
 * **Written after a rule went wrong exactly that way.** The map's background became unreachable for
 * three items because the rule deciding it lived in a `$derived` where nothing could reach it. What
 * is left in the component is binding and layout.
 */

import type { DemEncoding, Hillshade, Preset, RasterAdjust, Recolor, SourceKind } from '../../ipc/commands';
import type { KindBasis } from '../../map/source-kind';
import type { StyleBasis } from '../../map/style';
import type { MapToken } from '../../styles/tokens';

/** One slider: its range, and the value that means "unchanged". */
export interface Slider<K extends string> {
	key: K;
	label: string;
	min: number;
	max: number;
	step: number;
	/**
	 * What a cleared control returns to.
	 *
	 * **Not always zero.** A multiplier's identity is 1, and an opacity's is 1 - stored beside the
	 * range so the two cannot disagree, which they did while the neutral was a literal in three
	 * places.
	 */
	neutral: number;
	unit: string;
}

// -- where a style starts ------------------------------------------------------------------------

export const PRESETS: { id: Preset; label: string; note: string }[] = [
	{ id: 'colorful', label: 'Colorful', note: 'the default, full colour' },
	{ id: 'graybeard', label: 'Graybeard', note: 'muted greys' },
	{ id: 'neutrino', label: 'Neutrino', note: 'minimal, few layers' },
	{ id: 'shadow', label: 'Shadow', note: 'dark' },
	{ id: 'eclipse', label: 'Eclipse', note: 'dark, high contrast' },
	{ id: 'satellite', label: 'Satellite', note: 'for imagery underneath' },
	// Not one of `@versatiles/style`'s six. The others know what `water_polygons` means; this one
	// knows only what the tiles turn out to contain, which is the only thing that works when they
	// are not Shortbread (S4.4, D2).
	{ id: 'derived', label: 'From the data', note: 'every layer these tiles actually have' }
];

export const KIND_OPTIONS: SourceKind[] = ['vectorShortbread', 'vectorOther', 'rasterImage', 'rasterDem'];

// -- the three sets of sliders -------------------------------------------------------------------

export type RecolorKey = 'rotate' | 'saturate' | 'brightness' | 'contrast' | 'gamma';

export const RECOLOR_SLIDERS: Slider<RecolorKey>[] = [
	{ key: 'rotate', label: 'Hue', min: -180, max: 180, step: 1, neutral: 0, unit: '°' },
	{ key: 'saturate', label: 'Saturation', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
	{ key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
	{ key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05, neutral: 1, unit: '×' },
	{ key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.05, neutral: 1, unit: '×' }
];

export type RasterKey = 'hue' | 'saturation' | 'brightness' | 'contrast' | 'opacity';

/**
 * The raster controls, in MapLibre's own units.
 *
 * **Not `RECOLOR_SLIDERS` under different labels.** `rotate` and `saturate` happen to mean the same
 * thing; contrast and brightness do not - `Recolor`'s are a multiplier and an offset where
 * MapLibre's are an offset and a pair of range endpoints. Two lists that look alike beat one list
 * with a conversion table nobody can read.
 */
export const RASTER_SLIDERS: Slider<RasterKey>[] = [
	{ key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, neutral: 0, unit: '°' },
	{ key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
	{ key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
	{ key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
	{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, neutral: 1, unit: '' }
];

export type ShadeKey = 'exaggeration' | 'direction' | 'altitude';

export const HILLSHADE_SLIDERS: Slider<ShadeKey>[] = [
	{ key: 'exaggeration', label: 'Relief', min: 0, max: 1, step: 0.05, neutral: 0.5, unit: '' },
	{ key: 'direction', label: 'Light from', min: 0, max: 359, step: 1, neutral: 335, unit: '°' },
	{ key: 'altitude', label: 'Light height', min: 0, max: 90, step: 1, neutral: 45, unit: '°' }
];

/**
 * The three lights, defaulting to tokens rather than to MapLibre's pure black and white - which is
 * heavy over a light basemap and invisible over a dark one, and cannot follow the theme.
 */
export const HILLSHADE_COLOURS: { key: 'shadow' | 'highlight' | 'accent'; label: string; token: MapToken }[] = [
	{ key: 'shadow', label: 'Shadow', token: '--map-shade-shadow' },
	{ key: 'highlight', label: 'Highlight', token: '--map-shade-highlight' },
	{ key: 'accent', label: 'Accent', token: '--map-shade-accent' }
];

// -- reading a value out of a recipe -------------------------------------------------------------

/** What a slider shows: what was stored, or its neutral when nothing was. */
export function sliderValue<K extends string>(
	sliders: Slider<K>[],
	held: Record<string, number | null | undefined> | undefined,
	key: K
): number {
	return held?.[key] ?? sliders.find((slider) => slider.key === key)!.neutral;
}

/**
 * What one field of a recolouring becomes when a slider moves.
 *
 * **Neutral means absent, not the neutral number.** A slider returned to the middle must leave no
 * trace in the recipe - otherwise an untouched style and a reset one compare unequal, the undo stack
 * records a non-change, and the exported code carries settings nobody chose.
 */
export function withSlider<K extends string, T extends object>(
	sliders: Slider<K>[],
	held: T,
	key: K,
	raw: string | number
): T {
	const next = Number(raw);
	const neutral = sliders.find((slider) => slider.key === key)!.neutral;
	return { ...held, [key]: next === neutral ? undefined : next };
}

/** Whether anything in an adjustment has been set - which is what a "reset" button appears for. */
export function isAdjusted(held: object | null | undefined): boolean {
	return Object.values(held ?? {}).some((value) => value != null);
}

/** Whether one field has been set, which is what its own little reset appears for. */
export function isSet(held: Record<string, unknown> | undefined, key: string): boolean {
	return held?.[key] != null;
}

// -- the pickers ---------------------------------------------------------------------------------

/**
 * What to store when someone picks a kind from the list.
 *
 * **`null` when they pick the reading Studio already made.** The recipe holds the *correction*, not
 * the answer - so choosing what was derived anyway clears the override rather than freezing it, and
 * a container that later gains a `tile_schema` is read better instead of being stuck.
 */
export function kindChoice(chosen: SourceKind, derived: SourceKind | null): SourceKind | null {
	return chosen === derived ? null : chosen;
}

/** What to store for resampling. `linear` is MapLibre's default, so it is absence rather than a value. */
export function resamplingChoice(chosen: string): RasterAdjust['resampling'] {
	return chosen === 'nearest' ? 'nearest' : null;
}

/** What to store for a DEM encoding. The empty option hands the question back to the container. */
export function encodingChoice(chosen: string): DemEncoding | null {
	return chosen === 'mapbox' || chosen === 'terrarium' ? chosen : null;
}

// -- the stack -----------------------------------------------------------------------------------

/**
 * The stack as the list shows it: top of the map first.
 *
 * `Recipe.order` is bottom-first, because that is the order layers are emitted in. A person reading
 * a list of what covers what expects the top at the top, so it is reversed here rather than stored
 * that way - which keeps the file matching the render.
 */
export function stackRows<T>(stack: T[]): T[] {
	return [...stack].reverse();
}

/**
 * The draw order after moving one source, or `null` when it cannot move.
 *
 * Takes the bottom-first order and returns the whole list, because that is what the command takes:
 * a reorder is one gesture with one result, and "move this one up" would need the two ends to agree
 * about what the list was beforehand.
 */
export function reordered(order: string[], name: string, by: number): string[] | null {
	const at = order.indexOf(name);
	const to = at + by;
	if (at < 0 || to < 0 || to >= order.length) return null;
	const next = [...order];
	[next[at], next[to]] = [next[to], next[at]];
	return next;
}

// -- what the pane says out loud -----------------------------------------------------------------

/** What a source is contributing, said plainly rather than as a term of art. */
export const DRAWN_AS: Record<StyleBasis, string> = {
	preset: '',
	derived: 'from its own layers',
	fallback: 'from its own layers',
	raster: 'as an image',
	hillshade: 'as relief',
	none: 'not drawn'
};

/** Why the pane is showing this reading of what the tiles are. */
export const BASIS_NOTE: Record<KindBasis, string> = {
	declared: 'the container says so',
	inferred: 'worked out from the tiles',
	chosen: 'you set this'
};

/**
 * Overrides with no layer to land on.
 *
 * **Invisible otherwise, because the tree lists layers rather than overrides.** They are kept and
 * not dropped - the six presets share a namespace, so one that goes quiet under a smaller preset
 * applies again under a larger - which is exactly why they need saying out loud (S6.7).
 */
export function inertOverrides(overrides: Record<string, unknown>, present: string[]): string[] {
	return Object.keys(overrides).filter((id) => !present.includes(id));
}

/** Reads the appearance union into the three shapes the pane draws from. */
export function editing(appearance: { type: string } & Record<string, unknown>): {
	recolor: Recolor | null;
	raster: RasterAdjust;
	shade: Hillshade;
	overrides: Record<string, unknown>;
} {
	return {
		recolor: appearance.type === 'vector' ? (appearance.recolor as Recolor) : null,
		raster: appearance.type === 'raster' ? (appearance.adjust as RasterAdjust) : {},
		shade: appearance.type === 'hillshade' ? (appearance.shade as Hillshade) : {},
		overrides: appearance.type === 'vector' ? (appearance.overrides as Record<string, unknown>) : {}
	};
}
