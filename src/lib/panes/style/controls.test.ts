import { describe, expect, it } from 'vitest';
import {
	DRAWN_AS,
	HILLSHADE_SLIDERS,
	RASTER_SLIDERS,
	RECOLOR_SLIDERS,
	editing,
	encodingChoice,
	inertOverrides,
	isAdjusted,
	isSet,
	kindChoice,
	reordered,
	resamplingChoice,
	sliderValue,
	stackRows,
	withSlider
} from './controls';

describe('slider values', () => {
	it('shows what was stored', () => {
		expect(sliderValue(RECOLOR_SLIDERS, { rotate: 40 }, 'rotate')).toBe(40);
	});

	// A multiplier's identity is not zero, and neither is an opacity's. The neutral lives beside the
	// range so the two cannot disagree - they did, while it was a literal in three places.
	it('falls back to a neutral that is not always zero', () => {
		expect(sliderValue(RECOLOR_SLIDERS, {}, 'rotate')).toBe(0);
		expect(sliderValue(RECOLOR_SLIDERS, {}, 'contrast')).toBe(1);
		expect(sliderValue(RECOLOR_SLIDERS, {}, 'gamma')).toBe(1);
		expect(sliderValue(RASTER_SLIDERS, {}, 'opacity')).toBe(1);
		expect(sliderValue(RASTER_SLIDERS, {}, 'saturation')).toBe(0);
		expect(sliderValue(HILLSHADE_SLIDERS, {}, 'direction')).toBe(335);
	});

	it('treats an explicit zero as a value, not as absence', () => {
		expect(sliderValue(RECOLOR_SLIDERS, { contrast: 0 }, 'contrast')).toBe(0);
	});

	it('falls back when the field is null, which is how the wire spells absent', () => {
		expect(sliderValue(RECOLOR_SLIDERS, { gamma: null }, 'gamma')).toBe(1);
	});
});

describe('writing a slider back', () => {
	it('stores a value that is not neutral', () => {
		expect(withSlider(RECOLOR_SLIDERS, {}, 'rotate', '40')).toEqual({ rotate: 40 });
	});

	// The recipe stores only what changed. A slider returned to the middle must leave no trace, or an
	// untouched style and a reset one compare unequal and the undo stack records a non-change.
	it('stores nothing at all at the neutral value', () => {
		expect(withSlider(RECOLOR_SLIDERS, { rotate: 40 }, 'rotate', '0')).toEqual({ rotate: undefined });
		expect(withSlider(RECOLOR_SLIDERS, {}, 'contrast', '1')).toEqual({ contrast: undefined });
		expect(withSlider(RASTER_SLIDERS, {}, 'opacity', '1')).toEqual({ opacity: undefined });
	});

	it('leaves the other fields alone', () => {
		expect(withSlider(RECOLOR_SLIDERS, { rotate: 40, gamma: 1.5 }, 'saturate', '-0.5')).toEqual({
			rotate: 40,
			gamma: 1.5,
			saturate: -0.5
		});
	});
});

describe('what counts as changed', () => {
	it('is false for nothing set, which is what hides a reset button', () => {
		expect(isAdjusted({})).toBe(false);
		expect(isAdjusted(null)).toBe(false);
		expect(isAdjusted({ rotate: undefined, gamma: null })).toBe(false);
	});

	it('is true once anything is set, including zero', () => {
		expect(isAdjusted({ rotate: 0 })).toBe(true);
		expect(isAdjusted({ resampling: 'nearest' })).toBe(true);
	});

	it('answers per field for the per-field resets', () => {
		expect(isSet({ rotate: 0 }, 'rotate')).toBe(true);
		expect(isSet({ rotate: undefined }, 'rotate')).toBe(false);
		expect(isSet(undefined, 'rotate')).toBe(false);
	});
});

describe('the pickers', () => {
	// The recipe holds the correction, not the answer - so choosing what was derived anyway clears
	// the override, and a container that later gains a `tile_schema` is read better rather than stuck.
	it('clears the override when the derived reading is chosen', () => {
		expect(kindChoice('rasterImage', 'rasterImage')).toBeNull();
		expect(kindChoice('rasterDem', 'rasterImage')).toBe('rasterDem');
		expect(kindChoice('vectorOther', null)).toBe('vectorOther');
	});

	// `linear` is MapLibre's default, so it is absence rather than a value - the same rule the
	// sliders follow, and the reason an untouched style exports nothing about resampling.
	it('stores resampling only when it is not the default', () => {
		expect(resamplingChoice('linear')).toBeNull();
		expect(resamplingChoice('nearest')).toBe('nearest');
	});

	it('hands the encoding question back on the empty option', () => {
		expect(encodingChoice('')).toBeNull();
		expect(encodingChoice('mapbox')).toBe('mapbox');
		expect(encodingChoice('terrarium')).toBe('terrarium');
	});
});

describe('the stack list', () => {
	// `order` is bottom-first because that is the order layers are emitted in; a list of what covers
	// what reads top-first.
	it('shows the top of the map first', () => {
		expect(stackRows(['basemap', 'places'])).toEqual(['places', 'basemap']);
	});

	it('returns the whole order after a move, because that is what the command takes', () => {
		expect(reordered(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
		expect(reordered(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
	});

	it('refuses a move off either end rather than wrapping', () => {
		expect(reordered(['a', 'b'], 'a', -1)).toBeNull();
		expect(reordered(['a', 'b'], 'b', 1)).toBeNull();
		expect(reordered(['a', 'b'], 'missing', 1)).toBeNull();
	});

	it('does not mutate the order it was given', () => {
		const order = ['a', 'b'];
		reordered(order, 'a', 1);
		expect(order).toEqual(['a', 'b']);
	});
});

describe('what the pane says out loud', () => {
	// A source that drew nothing must say so; one drawn by its chosen preset needs no explanation.
	it('has a phrase for every way a source can be drawn', () => {
		expect(DRAWN_AS.none).toBe('not drawn');
		expect(DRAWN_AS.preset).toBe('');
		expect(Object.values(DRAWN_AS).every((phrase) => typeof phrase === 'string')).toBe(true);
	});

	// Kept rather than dropped, because the presets share a namespace - so they need saying out loud
	// or they are invisible, since the tree lists layers rather than overrides.
	it('names the overrides with no layer to land on', () => {
		expect(inertOverrides({ water: {}, 'site-school': {} }, ['water'])).toEqual(['site-school']);
		expect(inertOverrides({ water: {} }, ['water'])).toEqual([]);
		expect(inertOverrides({}, [])).toEqual([]);
	});
});

describe('reading the appearance union', () => {
	it('gives the vector half its recolour and overrides, and nothing else', () => {
		const seen = editing({ type: 'vector', recolor: { rotate: 10 }, overrides: { water: {} } } as never);
		expect(seen.recolor).toEqual({ rotate: 10 });
		expect(seen.overrides).toEqual({ water: {} });
		expect(seen.raster).toEqual({});
		expect(seen.shade).toEqual({});
	});

	it('gives raster its adjustment and no recolour', () => {
		const seen = editing({ type: 'raster', adjust: { opacity: 0.5 } } as never);
		expect(seen.raster).toEqual({ opacity: 0.5 });
		expect(seen.recolor).toBeNull();
	});

	it('gives elevation its shade', () => {
		expect(editing({ type: 'hillshade', shade: { exaggeration: 0.8 } } as never).shade).toEqual({
			exaggeration: 0.8
		});
	});
});
