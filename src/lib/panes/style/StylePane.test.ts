// @vitest-environment jsdom

/**
 * What the style pane shows for each kind of tileset (S6.1-S6.7), and what it writes back.
 *
 * **The first test in this repository that renders a component.** Everything else asserts a pure
 * function, which is right for a decision and useless for the thing this pane kept getting wrong:
 * offering controls that do nothing. `controls.ts` can say what a slider's neutral is; only a render
 * can say whether the slider is on screen at all.
 *
 * **Prop-driven, so no backend is stubbed** (S10.8). The pane is handed the source's style and hands
 * every write back through `actions`, the way the Layers and Sources panes already did - so what a
 * press *records* is a call this file can see, rather than a command a stub would have to answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import StylePane from './StylePane.svelte';

const VECTOR = { type: 'vector', theme: 'colorful', recolor: {}, overrides: {} };

const noop = () => ({
	setTheme: vi.fn(),
	setKind: vi.fn(),
	setRaster: vi.fn(),
	setHillshade: vi.fn(),
	previewRecolor: vi.fn(),
	commitRecolor: vi.fn(),
	cancelRecolor: vi.fn(),
	pruneOverrides: vi.fn(),
	exportAs: vi.fn(),
	exportBundle: vi.fn()
});

/** Renders the pane over one source, with the style the core would have handed back for it. */
function open(options: {
	kind?: string | null;
	appearance?: object;
	tileFormat?: string;
	tileSchema?: string | null;
	layers?: string[];
}) {
	const { kind = null, appearance = VECTOR, tileFormat = 'mvt', tileSchema = null, layers = [] } = options;
	const actions = noop();
	render(StylePane, {
		sourceStyle: { kind, appearance } as never,
		source: { tileFormat, tileSchema, layers },
		basis: 'preset',
		actions
	});
	return actions;
}

afterEach(cleanup);

describe('what the pane offers for each kind of tileset', () => {
	// The case the pane was designed for, and the only one that worked before S6.1.
	//
	// **The layer tree is no longer here.** It became project-wide when order stopped belonging to
	// sources, so this pane says how one source is *drawn* and the Layers pane says where those
	// layers land ([the layer stack](../../../../docs/layers.md)).
	it('offers the themes for Shortbread vector tiles, and no layer tree', () => {
		open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });

		const picker = screen.getByLabelText('Theme') as HTMLSelectElement;
		expect(picker.value).toBe('colorful');
		// The library's list, grouped: its own palettes with their dark partners, then the lookalikes.
		const groups = [...picker.querySelectorAll('optgroup')].map((group) => group.label);
		expect(groups).toEqual(['Palettes', 'Lookalikes']);
		expect([...picker.options].map((option) => option.value)).toContain('gray-dark');
		expect([...picker.options].map((option) => option.value)).toContain('positrino');
		expect(screen.queryByText('Layers')).toBeNull();
	});

	// A hand-edited file, or one from a build with a theme this one lacks: the default is drawn, and
	// the pane says so instead of showing an empty dropdown (S11.3).
	it('says when the recipe names a theme this build does not have', () => {
		open({
			appearance: { ...VECTOR, theme: 'no-such-theme' },
			layers: ['water_polygons', 'street_polygons', 'boundaries']
		});
		expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('colorful');
		expect(screen.getByText(/names a theme \(no-such-theme\) this build does not have/)).toBeTruthy();
	});

	// **The bug S6.3 fixed.** Every preset was selectable over a photograph and none of them did
	// anything - a control that looks identical to a working one is worse than no control.
	it('offers no presets for imagery, and offers the raster adjustments instead', () => {
		open({
			kind: 'rasterImage',
			appearance: { type: 'raster', adjust: {} },
			tileFormat: 'png',
			tileSchema: 'rgb'
		});

		expect(screen.queryByLabelText('Theme')).toBeNull();
		expect(screen.getByText('Opacity')).toBeTruthy();
		expect(screen.getByText('Scaling')).toBeTruthy();
	});

	// A DEM and a photograph are the same PNG; only `tile_schema` separates them (S6.6).
	it('offers relief for elevation, and not the imagery controls', () => {
		open({
			kind: 'rasterDem',
			appearance: { type: 'hillshade', shade: {} },
			tileFormat: 'png',
			tileSchema: 'dem/mapbox'
		});

		expect(screen.getByText('Hillshade')).toBeTruthy();
		// The section names the technique, the slider names what it does - so `Relief` is the one
		// control, not an echo of the heading above it.
		expect(screen.getByText('Relief')).toBeTruthy();
		expect(screen.getByText('Light from')).toBeTruthy();
		expect(screen.queryByText('Opacity')).toBeNull();
	});

	// **The kind picks the editor** (S11.2). Tiles no builder knows have no theme to choose and nothing
	// to recolour: the pane says what they are drawn as, and where a layer can be changed.
	it('offers no theme and no recolouring for tiles of no known schema', () => {
		open({ appearance: { type: 'inspector', overrides: {} }, layers: ['parcels', 'roads'] });

		expect(screen.getByText('Inspector style')).toBeTruthy();
		expect(screen.queryByLabelText('Theme')).toBeNull();
		expect(screen.queryByText('Invert brightness')).toBeNull();
		// Reading them as a schema is how a theme comes back, and the picker is still there to do it.
		expect(screen.getByLabelText('Read as')).toBeTruthy();
	});

	// The picker offers only what the format can be (S11.4): vector readings for `mvt`, raster ones for
	// an image. A correction stays possible within a format, where it means something.
	it('offers "Read as" only the kinds the format allows', () => {
		open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		const vector = [...(screen.getByLabelText('Read as') as HTMLSelectElement).options].map((o) => o.value);
		expect(vector).toContain('vectorOther');
		expect(vector).not.toContain('rasterImage');
		cleanup();

		open({ kind: 'rasterImage', appearance: { type: 'raster', adjust: {} }, tileFormat: 'png', tileSchema: 'rgb' });
		const raster = [...(screen.getByLabelText('Read as') as HTMLSelectElement).options].map((o) => o.value);
		expect(raster).toEqual(['rasterImage', 'rasterDem']);
	});

	// A theme that draws nothing means the tiles are not what they were read as, so the note offers
	// the reading that would draw them rather than leaving someone to try the other themes (S11.4).
	it('offers to read the tiles as "other" when the theme draws none of their layers', async () => {
		const actions = noop();
		render(StylePane, {
			sourceStyle: { kind: 'vectorShortbread', appearance: VECTOR } as never,
			source: { tileFormat: 'mvt', tileSchema: null, layers: ['parcels', 'roads', 'sensors'] },
			basis: 'fallback',
			actions
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read as Vector · other' }));
		// The derived reading for these layers is already "other", so the correction is cleared rather
		// than recorded - the recipe holds corrections, not answers.
		expect(actions.setKind).toHaveBeenCalledWith(null);
	});

	// Nothing published says how VersaTiles packs elevation, so it says so rather than guessing.
	it('says an unreadable DEM encoding cannot be shaded, and offers the picker', () => {
		open({
			kind: 'rasterDem',
			appearance: { type: 'hillshade', shade: {} },
			tileFormat: 'png',
			tileSchema: 'dem/versatiles'
		});

		expect(screen.getByText(/do not say how their elevation is packed/)).toBeTruthy();
		expect(screen.getByText('Encoding')).toBeTruthy();
		// No sliders until something can decode the pixels.
		expect(screen.queryByText('Light from')).toBeNull();
	});
});

describe('what a press records', () => {
	it('records the theme that was chosen, by the name the library spells it', async () => {
		const actions = open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		await fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'muted' } });
		expect(actions.setTheme).toHaveBeenCalledWith('muted');
	});

	// A slider commits once, on release, and previews before that - the undo stack sees one entry.
	it('previews a slider and commits it once', async () => {
		const actions = open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		const slider = screen.getAllByRole('slider')[0];
		await fireEvent.input(slider, { target: { value: slider.getAttribute('max') } });
		await fireEvent.change(slider);
		expect(actions.previewRecolor).toHaveBeenCalledTimes(1);
		expect(actions.commitRecolor).toHaveBeenCalledTimes(1);
	});

	it('hands the whole map to the export, and the code only when there is one', async () => {
		const actions = open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		// Nothing rendered yet, so nothing to write: the buttons say so rather than calling.
		expect((screen.getByRole('button', { name: 'style.json' }) as HTMLButtonElement).disabled).toBe(true);
		expect(actions.exportAs).not.toHaveBeenCalled();
	});
});

describe('what the pane says about the tiles', () => {
	it('reports a declared kind as declared', () => {
		open({ kind: null, tileFormat: 'png', tileSchema: 'rgb', appearance: { type: 'raster', adjust: {} } });
		expect(screen.getByText('the container says so.')).toBeTruthy();
	});

	it('reports a guess as a guess', () => {
		open({ layers: ['places'] });
		expect(screen.getByText('worked out from the tiles.')).toBeTruthy();
	});

	// S6.1's whole point: a reading someone corrected must say it was corrected.
	it('reports a correction as the person’s', () => {
		open({ kind: 'vectorOther', layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		expect(screen.getByText('you set this.')).toBeTruthy();
	});
});

/**
 * The pane with nothing open ([Q54]). It used to be unreachable - the whole sidebar was hidden while
 * a project had no sources - and every section here is conditional on a source, so what was left
 * once the sidebar stayed was an empty column.
 */
describe('a project with no sources', () => {
	it('says there is nothing to style rather than drawing nothing', () => {
		render(StylePane, {
			sourceStyle: { kind: null, appearance: VECTOR } as never,
			source: null,
			basis: 'none',
			actions: noop()
		});

		expect(screen.getByText(/Nothing to style yet/)).toBeTruthy();
	});

	it('offers no export of a style that does not exist', () => {
		render(StylePane, {
			sourceStyle: { kind: null, appearance: VECTOR } as never,
			source: null,
			basis: 'none',
			actions: noop()
		});

		expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
	});
});

describe('the style check beside the export (S14.9)', () => {
	const show = (problems: { message: string; severity: 'error' | 'warning' }[] | null) =>
		render(StylePane, {
			sourceStyle: { kind: null, appearance: VECTOR } as never,
			source: { tileFormat: 'mvt', tileSchema: null, layers: [] },
			rendered: { version: 8, sources: {}, layers: [] },
			basis: 'preset',
			problems,
			actions: noop()
		});

	it('says nothing before the check has run', () => {
		show(null);
		expect(screen.queryByText(/MapLibre style spec/)).toBeNull();
	});

	it('says when the style passes', () => {
		show([]);
		expect(screen.getByText('The style passes the MapLibre style spec.')).toBeTruthy();
	});

	it('lists what fails, says MapLibre will refuse it, and counts what it does not list', () => {
		show(
			Array.from({ length: 10 }, (_, i) => ({
				message: `layer "l${i}".paint.fill-color: color expected, number found`,
				severity: 'error' as const
			}))
		);
		expect(
			screen.getByText('10 problems against the MapLibre style spec - MapLibre will refuse the file.')
		).toBeTruthy();
		expect(screen.getByRole('list', { name: 'Style problems' }).children).toHaveLength(8);
		expect(screen.getByText('And 2 more.')).toBeTruthy();
	});
});
