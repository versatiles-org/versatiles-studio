import { describe, expect, it } from 'vitest';
import {
	BUNDLED_GLYPHS,
	BUNDLED_SPRITE,
	canGenerateCode,
	forExport,
	fontsUsed,
	styleCode,
	TILE_URL_PLACEHOLDER
} from './style-code';
import type { Appearance } from '../ipc/commands';
import type { VectorAppearance } from './style';

const recipe = (over: Record<string, unknown> = {}): VectorAppearance =>
	({ type: 'vector', preset: 'colorful', recolor: {}, overrides: {}, ...over }) as VectorAppearance;

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
			} as Partial<Appearance>)
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
		expect(canGenerateCode(recipe({ preset: 'derived' } as Partial<Appearance>))).toBe(false);
		expect(styleCode(recipe({ preset: 'derived' } as Partial<Appearance>))).toBeNull();
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

describe('forExport assets', () => {
	const style = {
		version: 8,
		glyphs: 'http://127.0.0.1:52341/assets/glyphs/{fontstack}/{range}.pbf',
		sprite: 'http://127.0.0.1:52341/assets/sprites/basics/sprites',
		sources: {},
		layers: []
	} as unknown as import('maplibre-gl').StyleSpecification;

	// The bug this fixes: an exported style used to carry the ephemeral local port for its glyphs
	// and sprites, so it rendered on someone else's machine as a map with no labels and no icons.
	it('points glyphs and sprites at the public assets by default', () => {
		const out = forExport(style);
		expect(out.glyphs).toBe('https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf');
		expect(out.sprite).toBe('https://tiles.versatiles.org/assets/sprites/basics/sprites');
		expect(JSON.stringify(out)).not.toContain('127.0.0.1');
	});

	it('points them at the bundle’s own copies when asked', () => {
		const out = forExport(style, 'bundled');
		expect(out.glyphs).toBe(BUNDLED_GLYPHS);
		expect(out.sprite).toBe(BUNDLED_SPRITE);
	});
});

describe('fontsUsed', () => {
	const symbol = (fonts: unknown) =>
		({ id: 'l', type: 'symbol', source: 's', layout: { 'text-font': fonts } }) as never;

	it('names every font stack once, sorted', () => {
		const style = {
			version: 8,
			sources: {},
			layers: [symbol(['noto_sans_bold']), symbol(['noto_sans_regular']), symbol(['noto_sans_bold'])]
		} as unknown as import('maplibre-gl').StyleSpecification;
		expect(fontsUsed(style)).toEqual(['noto_sans_bold', 'noto_sans_regular']);
	});

	// A font a bundle cannot see beats a bundle carrying every font installed.
	it('leaves an expression alone rather than guessing what it evaluates to', () => {
		const style = {
			version: 8,
			sources: {},
			layers: [symbol(['case', ['has', 'x'], ['literal', ['a']], ['literal', ['b']]])]
		} as unknown as import('maplibre-gl').StyleSpecification;
		expect(fontsUsed(style)).toEqual([]);
	});

	it('ignores layers that carry no text', () => {
		const style = {
			version: 8,
			sources: {},
			layers: [{ id: 'w', type: 'fill', source: 's' }]
		} as unknown as import('maplibre-gl').StyleSpecification;
		expect(fontsUsed(style)).toEqual([]);
	});
});
