import { describe, expect, it } from 'vitest';
import { osm } from '@versatiles/style';
import { omt } from '@versatiles/style/omt';
import { protomaps } from '@versatiles/style/protomaps';
import {
	BUNDLED_GLYPHS,
	BUNDLED_SPRITE,
	canGenerateCode,
	forExport,
	fontsUsed,
	placeholderFor,
	styleCode,
	TILE_URL_PLACEHOLDER
} from './style-code';
import type { Appearance } from '../ipc/commands';
import type { VectorAppearance } from './style';

const recipe = (over: Record<string, unknown> = {}): VectorAppearance =>
	({ type: 'vector', theme: 'colorful', recolor: {}, overrides: {}, ...over }) as VectorAppearance;

describe('styleCode', () => {
	it('names the theme it started from, in an import that resolves', () => {
		const code = styleCode(recipe({ theme: 'gray' }))!;
		expect(code).toContain("import { osm } from '@versatiles/style';");
		expect(code).toContain('const style = osm({');
		expect(code).toContain('"theme": "gray"');
		expect(code).toContain(`"osm": "${TILE_URL_PLACEHOLDER}"`);
		expect(code.trimEnd().endsWith('export default style;')).toBe(true);
	});

	it('calls the builder the tiles need, imported from its subpath', () => {
		const code = styleCode(recipe({ theme: 'gray' }), undefined, 'openmaptiles')!;
		expect(code).toContain("import { omt } from '@versatiles/style/omt';");
		expect(code).toContain('const style = omt({');
		expect(code).toContain(`"omt": "${TILE_URL_PLACEHOLDER}"`);
		expect(styleCode(recipe(), undefined, 'protomaps')).toContain(
			"import { protomaps } from '@versatiles/style/protomaps';"
		);
	});

	it('says nothing about adjustments that were never made', () => {
		expect(styleCode(recipe())).not.toContain('recolor');
		expect(styleCode(recipe())).not.toContain('overrides');
	});

	it('carries the adjustments that were, in the names the builder takes', () => {
		const code = styleCode(recipe({ recolor: { invertBrightness: true, rotate: 35, tint: 0.5, tintColor: '#f00' } }))!;
		expect(code).toContain('"recolor": {');
		expect(code).toContain('"invertBrightness": true');
		expect(code).toContain('"rotateHue": 35');
		expect(code).toContain('"tint": {');
		expect(code).not.toContain('"rotate"');
		expect(code).not.toContain('"tintColor"');
	});

	/**
	 * **The call has to be one the library accepts.** v6 renamed the recolour fields and v7 throws on
	 * an option it does not know, so a file written in the stored names would fail the moment it ran.
	 */
	it('writes options the builder accepts, for every theme and schema', () => {
		const recolor = { invertBrightness: true, rotate: 35, saturate: -0.5, tint: 0.5, tintColor: '#f00', blend: 0.2 };
		const builders = { osm, omt, protomaps };
		for (const schema of ['shortbread', 'openmaptiles', 'protomaps'] as const) {
			// The builder's own list, so a theme added upstream is checked the day it arrives (S11.3).
			for (const theme of builders[schema === 'shortbread' ? 'osm' : schema === 'openmaptiles' ? 'omt' : 'protomaps']
				.palettes) {
				const code = styleCode(recipe({ theme, recolor }), undefined, schema)!;
				const name = code.match(/const style = (\w+)\(/)![1] as keyof typeof builders;
				const options = JSON.parse(code.slice(code.indexOf('({') + 1, code.indexOf('});') + 1));
				const result = builders[name].validateOptions(options);
				expect(result.ok ? [] : result.issues, `${theme} over ${schema}`).toEqual([]);
			}
		}
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
		// The emitted *data*, not the loop that reads it - the boilerplate names every key it can
		// apply, which is what makes the file work for the ones that are there.
		expect(code).not.toContain('"minZoom"');
		expect(code).toContain('"visible": false');
	});

	// The inspector style is assembled from whatever the tiles turned out to contain, so there is no
	// builder to name - and style.json is the honest form for a style with no shorter description.
	it('has no code for the inspector style', () => {
		const inspector = { type: 'inspector', overrides: {} } as Appearance;
		expect(canGenerateCode(inspector)).toBe(false);
		expect(styleCode(inspector)).toBeNull();
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
		expect(JSON.stringify(out)).toContain(placeholderFor('berlin'));
	});

	/** The map's style carries Svelte proxies, which `structuredClone` refuses - the problems log
	 *  filled with "The object can not be cloned" once the style check ran on every change. */
	it('copies a style with proxies in it', () => {
		const reactive = { ...style, layers: new Proxy([], {}) } as typeof style;
		expect(() => forExport(reactive)).not.toThrow();
	});

	it('leaves the style it was given alone', () => {
		forExport(style);
		expect(JSON.stringify(style)).toContain('studio://');
	});

	// **Each source keeps its own address.** Two identical placeholders leave the reader of the file
	// unable to tell which one was the hillshade, which is the whole use of exporting it.
	it('names the source each placeholder stands for', () => {
		const stacked = {
			version: 8,
			sources: {
				basemap: { type: 'vector', tiles: ['studio://127.0.0.1:52341/tiles/basemap/{z}/{x}/{y}'] },
				hillshade: { type: 'raster-dem', tiles: ['studio://127.0.0.1:52341/tiles/hillshade/{z}/{x}/{y}'] }
			},
			layers: []
		} as unknown as import('maplibre-gl').StyleSpecification;

		const out = forExport(stacked);
		expect((out.sources.basemap as { tiles: string[] }).tiles).toEqual([placeholderFor('basemap')]);
		expect((out.sources.hillshade as { tiles: string[] }).tiles).toEqual([placeholderFor('hillshade')]);
	});

	// **A remote source is somebody's working URL.** The background map is the one that reaches this
	// today: it is the bottom entry of the same stack (S6.5), it names `tiles.versatiles.org`, and
	// replacing that with a placeholder wrote out a style whose basemap could not draw.
	it('leaves a source Studio does not serve alone', () => {
		const withBackground = {
			version: 8,
			sources: {
				background: { type: 'vector', tiles: ['https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'] },
				berlin: { type: 'vector', tiles: ['studio://127.0.0.1:52341/tiles/berlin/{z}/{x}/{y}'] }
			},
			layers: []
		} as unknown as import('maplibre-gl').StyleSpecification;

		const out = forExport(withBackground);
		expect((out.sources.background as { tiles: string[] }).tiles).toEqual([
			'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'
		]);
		expect((out.sources.berlin as { tiles: string[] }).tiles).toEqual([placeholderFor('berlin')]);
	});
});

describe('forExport assets', () => {
	const style = {
		version: 8,
		glyphs: 'http://127.0.0.1:52341/assets/glyphs/{fontstack}/{range}.pbf',
		sprite: [{ id: 'base', url: 'http://127.0.0.1:52341/assets/sprites/base' }],
		sources: {},
		layers: []
	} as unknown as import('maplibre-gl').StyleSpecification;

	// The bug this fixes: an exported style used to carry the ephemeral local port for its glyphs
	// and sprites, so it rendered on someone else's machine as a map with no labels and no icons.
	it('points glyphs and sprites at the public assets by default', () => {
		const out = forExport(style);
		expect(out.glyphs).toBe('https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf');
		// Still a list naming the sheet, because the layers name their icons `base:…`.
		expect(out.sprite).toEqual([{ id: 'base', url: 'https://tiles.versatiles.org/assets/sprites/base' }]);
		expect(JSON.stringify(out)).not.toContain('127.0.0.1');
	});

	it('points them at the bundle’s own copies when asked', () => {
		const out = forExport(style, 'bundled');
		expect(out.glyphs).toBe(BUNDLED_GLYPHS);
		expect(out.sprite).toEqual([{ id: 'base', url: BUNDLED_SPRITE }]);
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

describe('overrides in generated code', () => {
	const withOverrides = recipe({
		overrides: { water: { visible: false }, 'site-school': { visible: false } }
	});

	it('emits every override when nothing says which layers exist', () => {
		const code = styleCode(withOverrides)!;
		expect(code).toContain('water');
		expect(code).toContain('site-school');
	});

	// `neutrino`'s ids are a strict subset of `colorful`'s, so an override made under the larger
	// preset is inert under the smaller. The recipe keeps it - it comes back on the way over - but a
	// generated `neutrino` file setting a property on a layer it does not contain is dead code.
	it('drops the ones the generated style has no layer for', () => {
		const code = styleCode(withOverrides, ['water'])!;
		expect(code).toContain('water');
		expect(code).not.toContain('site-school');
	});

	it('writes no override block when none of them apply', () => {
		expect(styleCode(withOverrides, [])).not.toContain('Layer changes made in Studio');
	});
});
