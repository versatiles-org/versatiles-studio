import { describe, expect, it } from 'vitest';
import { canGenerateCode, forExport, styleCode, TILE_URL_PLACEHOLDER } from './style-code';
import type { Recipe } from '../ipc/commands';

const recipe = (over: Partial<Recipe> = {}): Recipe =>
	({ preset: 'colorful', recolor: {}, overrides: {}, ...over }) as Recipe;

describe('styleCode', () => {
	it('names the preset it started from, in an import that resolves', () => {
		const code = styleCode(recipe({ preset: 'graybeard' }))!;
		expect(code).toContain("import { graybeard } from '@versatiles/style';");
		expect(code).toContain('const style = graybeard({');
		expect(code).toContain(`tiles: ['${TILE_URL_PLACEHOLDER}']`);
		expect(code.trimEnd().endsWith('export default style;')).toBe(true);
	});

	it('says nothing about adjustments that were never made', () => {
		expect(styleCode(recipe())).not.toContain('recolor');
		expect(styleCode(recipe())).not.toContain('overrides');
	});

	it('carries the adjustments that were', () => {
		const code = styleCode(recipe({ recolor: { invertBrightness: true, rotate: 35 } }))!;
		expect(code).toContain('recolor: {');
		expect(code).toContain('invertBrightness: true');
		expect(code).toContain('rotate: 35');
	});

	// The builder takes no argument for per-layer changes, so they are applied to the built style.
	// Written out rather than described, or the file would not run.
	it('applies layer changes as code that runs', () => {
		const code = styleCode(
			recipe({
				overrides: { water: { visible: false }, roads: { paint: { 'line-color': '#123456' } } }
			} as Partial<Recipe>)
		)!;
		expect(code).toContain('// Layer changes made in Studio.');
		expect(code).toContain('for (const layer of style.layers)');
		expect(code).toContain('"water"');
		expect(code).toContain('line-color');
	});

	it('leaves out the keys a patch never set', () => {
		const code = styleCode(recipe({ overrides: { water: { visible: false, minZoom: null } } } as never))!;
		// The emitted *data*, not the loop that reads it — the boilerplate names every key it can
		// apply, which is what makes the file work for the ones that are there.
		expect(code).not.toContain('"minZoom"');
		expect(code).toContain('"visible": false');
	});

	// A derived style is assembled from whatever the tiles turned out to contain, so there is no
	// builder to name — and style.json is the honest form for a style with no shorter description.
	it('has no code for a style that was derived rather than chosen', () => {
		expect(canGenerateCode(recipe({ preset: 'derived' } as Partial<Recipe>))).toBe(false);
		expect(styleCode(recipe({ preset: 'derived' } as Partial<Recipe>))).toBeNull();
	});
});

describe('forExport', () => {
	const style = {
		version: 8,
		sources: { berlin: { type: 'vector', tiles: ['studio://127.0.0.1:52341/tiles/berlin/{z}/{x}/{y}?v=3'] } },
		layers: []
	} as unknown as import('maplibre-gl').StyleSpecification;

	// A style taken out of Studio and pointed at an ephemeral localhost port works once, on one
	// machine, until the window closes.
	it('replaces the local tile URL with one the reader is meant to change', () => {
		const out = forExport(style);
		expect(JSON.stringify(out)).not.toContain('studio://');
		expect(JSON.stringify(out)).toContain(TILE_URL_PLACEHOLDER);
	});

	it('leaves the style it was given alone', () => {
		forExport(style);
		expect(JSON.stringify(style)).toContain('studio://');
	});
});
