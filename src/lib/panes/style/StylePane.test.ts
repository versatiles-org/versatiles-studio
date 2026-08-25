// @vitest-environment jsdom

/**
 * What the style pane shows for each kind of tileset (S6.1-S6.7).
 *
 * **The first test in this repository that renders a component.** Everything else asserts a pure
 * function, which is right for a decision and useless for the thing this pane kept getting wrong:
 * offering controls that do nothing. `controls.ts` can say what a slider's neutral is; only a render
 * can say whether the slider is on screen at all.
 *
 * The backend is stubbed - see `lib/testing/tauri.ts` for what that does and does not prove.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import StylePane from './StylePane.svelte';
import { style } from '../../state/style.svelte';
import { stubTauri, type TauriStub } from '../../testing/tauri';

const VECTOR = { type: 'vector', preset: 'colorful', recolor: {}, overrides: {} };

function recipe(kind: string | null, appearance: object = VECTOR) {
	return { sources: { berlin: { kind, appearance } }, order: ['berlin'] };
}

let tauri: TauriStub;

/** Renders the pane over one source, with the recipe the core would have handed back. */
async function open(options: {
	kind?: string | null;
	appearance?: object;
	tileFormat?: string;
	tileSchema?: string | null;
	layers?: string[];
}) {
	const { kind = null, appearance = VECTOR, tileFormat = 'mvt', tileSchema = null, layers = [] } = options;
	tauri.answer('style', recipe(kind, appearance));
	await style.load();
	style.focus({ id: 1, name: 'berlin' });
	render(StylePane, { source: { tileFormat, tileSchema, layers }, basis: 'preset' });
}

beforeEach(() => {
	tauri = stubTauri({ style_formats: ['json', 'ts'] });
});

afterEach(() => {
	cleanup();
	tauri.restore();
});

describe('what the pane offers for each kind of tileset', () => {
	// The case the pane was designed for, and the only one that worked before S6.1.
	it('offers presets and the layer tree for Shortbread vector tiles', async () => {
		await open({ layers: ['water_polygons', 'street_polygons', 'boundaries'] });

		expect(screen.getByText('Preset')).toBeTruthy();
		expect(screen.getByText('Colorful')).toBeTruthy();
		expect(screen.getByText('Layers')).toBeTruthy();
	});

	// **The bug S6.3 fixed.** Every preset was selectable over a photograph and none of them did
	// anything - a control that looks identical to a working one is worse than no control.
	it('offers no presets for imagery, and offers the raster adjustments instead', async () => {
		await open({
			kind: 'rasterImage',
			appearance: { type: 'raster', adjust: {} },
			tileFormat: 'png',
			tileSchema: 'rgb'
		});

		expect(screen.queryByText('Preset')).toBeNull();
		expect(screen.queryByText('Colorful')).toBeNull();
		expect(screen.getByText('Opacity')).toBeTruthy();
		expect(screen.getByText('Scaling')).toBeTruthy();
	});

	// A DEM and a photograph are the same PNG; only `tile_schema` separates them (S6.6).
	it('offers relief for elevation, and not the imagery controls', async () => {
		await open({
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

	// Nothing published says how VersaTiles packs elevation, so it says so rather than guessing.
	it('says an unreadable DEM encoding cannot be shaded, and offers the picker', async () => {
		await open({
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

describe('what the pane says about the tiles', () => {
	it('reports a declared kind as declared', async () => {
		await open({ kind: null, tileFormat: 'png', tileSchema: 'rgb', appearance: { type: 'raster', adjust: {} } });
		expect(screen.getByText('the container says so.')).toBeTruthy();
	});

	it('reports a guess as a guess', async () => {
		await open({ layers: ['places'] });
		expect(screen.getByText('worked out from the tiles.')).toBeTruthy();
	});

	// S6.1's whole point: a reading someone corrected must say it was corrected.
	it('reports a correction as the person’s', async () => {
		await open({ kind: 'vectorOther', layers: ['water_polygons', 'street_polygons', 'boundaries'] });
		expect(screen.getByText('you set this.')).toBeTruthy();
	});
});
