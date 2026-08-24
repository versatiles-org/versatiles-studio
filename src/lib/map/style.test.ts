import { describe, expect, it } from 'vitest';
import { deriveStyle, drawsAnything, rasterPaint, renderStyle, styleFor } from './style';
import type { Appearance } from '../ipc/commands';
import type { VectorAppearance } from './style';

const BASE = 'http://127.0.0.1:8080';
const SOURCES = [{ name: 'berlin', tileUrl: `${BASE}/tiles/berlin/{z}/{x}/{y}` }];

function recipe(over: Record<string, unknown> = {}): VectorAppearance {
	return { type: 'vector', preset: 'colorful', recolor: {}, overrides: {}, ...over } as VectorAppearance;
}

/** The raster half of the union, for the cases that are about imagery. */
function raster(adjust: Record<string, unknown> = {}): Appearance {
	return { type: 'raster', adjust } as Appearance;
}

describe('renderStyle', () => {
	it('renders a preset over the project’s own tiles', () => {
		const style = renderStyle(recipe(), SOURCES, BASE);
		expect(style).not.toBeNull();
		expect(style!.layers.length).toBeGreaterThan(100);
		expect(JSON.stringify(style!.sources)).toContain('/tiles/berlin/');
	});

	// Every pipeline tile goes through Studio's queue, or the status bar's count is of some of them
	// (S2.16). Glyphs and sprites do not: they are a handful of requests, not per-tile work.
	it('routes its tiles through the queue and its assets straight at the server', () => {
		const style = renderStyle(recipe(), SOURCES, BASE)!;
		expect(JSON.stringify(style.sources)).toContain('studio://');
		expect(style.glyphs).toContain('http://');
	});

	// G5 promises Studio works offline once its assets are installed, so nothing in a generated
	// style may point at versatiles.org — the builders' own default.
	it('serves glyphs and sprites from the embedded server, never the network', () => {
		const style = renderStyle(recipe(), SOURCES, BASE)!;
		expect(style.glyphs).toContain(BASE);
		expect(JSON.stringify(style.sprite)).toContain(BASE);
		const remote = JSON.stringify({ glyphs: style.glyphs, sprite: style.sprite });
		expect(remote).not.toContain('versatiles.org');
	});

	it('has nothing to render for a preset that does not exist yet', () => {
		// `derived` is S4.4. Until it exists, no style is the honest answer.
		expect(renderStyle(recipe({ preset: 'derived' }), SOURCES, BASE)).toBeNull();
	});

	it('applies the recolouring rather than ignoring it', () => {
		const plain = renderStyle(recipe(), SOURCES, BASE)!;
		const dark = renderStyle(recipe({ recolor: { invertBrightness: true } }), SOURCES, BASE)!;
		expect(JSON.stringify(dark.layers)).not.toEqual(JSON.stringify(plain.layers));
	});

	// An unset field must be absent, not present-and-undefined: the builder tests some options for
	// presence, so `{ gamma: undefined }` is not the same as `{}`.
	it('an explicitly undefined adjustment changes nothing', () => {
		const plain = renderStyle(recipe(), SOURCES, BASE)!;
		const same = renderStyle(recipe({ recolor: { gamma: undefined, rotate: null } }), SOURCES, BASE)!;
		expect(JSON.stringify(same.layers)).toEqual(JSON.stringify(plain.layers));
	});
});

describe('layer overrides', () => {
	function layerNamed(style: ReturnType<typeof renderStyle>, id: string) {
		return style!.layers.find((layer) => layer.id === id) as Record<string, never> | undefined;
	}

	function anyLayerId(): string {
		return renderStyle(recipe(), SOURCES, BASE)!.layers[1].id;
	}

	it('hides a layer through layout.visibility, where MapLibre reads it', () => {
		const id = anyLayerId();
		const style = renderStyle(recipe({ overrides: { [id]: { visible: false } } }), SOURCES, BASE);
		expect(layerNamed(style, id)!.layout).toMatchObject({ visibility: 'none' });
	});

	it('merges paint so an override does not wipe the preset’s other properties', () => {
		const id = renderStyle(recipe(), SOURCES, BASE)!.layers.find(
			(l) => 'paint' in l && Object.keys((l as { paint: object }).paint ?? {}).length > 1
		)!.id;
		const before = layerNamed(renderStyle(recipe(), SOURCES, BASE), id)!.paint as Record<string, unknown>;
		const style = renderStyle(
			recipe({ overrides: { [id]: { paint: { 'fill-opacity': 0.25 } } } as never }),
			SOURCES,
			BASE
		);
		const after = layerNamed(style, id)!.paint as Record<string, unknown>;
		expect(after['fill-opacity']).toBe(0.25);
		for (const key of Object.keys(before)) {
			if (key !== 'fill-opacity') expect(after[key]).toEqual(before[key]);
		}
	});

	it('leaves layers with no override exactly as the preset built them', () => {
		const id = anyLayerId();
		const plain = renderStyle(recipe(), SOURCES, BASE)!;
		const patched = renderStyle(recipe({ overrides: { [id]: { visible: false } } }), SOURCES, BASE)!;
		const untouched = plain.layers.filter((l) => l.id !== id);
		expect(JSON.stringify(patched.layers.filter((l) => l.id !== id))).toEqual(JSON.stringify(untouched));
	});
});

describe('drawsAnything', () => {
	const style = renderStyle(recipe(), SOURCES, BASE)!;

	it('is true for the schema the presets are written against', () => {
		// Shortbread's own names, which is what `colorful` draws.
		expect(drawsAnything(style, ['water_polygons', 'street_motorway', 'boundaries'])).toBe(true);
	});

	it('is false for a container that names its layers something else', () => {
		expect(drawsAnything(style, ['parcels', 'zoning', 'my_layer'])).toBe(false);
	});

	// A raster source has no vector layers at all, and a preset has nothing to draw from it.
	it('is false when there are no layers to match', () => {
		expect(drawsAnything(style, [])).toBe(false);
	});

	it('needs only one layer in common to be worth drawing', () => {
		expect(drawsAnything(style, ['nothing_like_it', 'water_polygons'])).toBe(true);
	});
});

describe('deriveStyle', () => {
	// Deliberately not Shortbread names — `buildings` is one, which is the whole difficulty this
	// function exists for: a container that shares a name or two with the schema still gets a nearly
	// empty map from a preset.
	const LAYERS = [
		{ name: 'roads', geometry: 'line' },
		{ name: 'parcels', geometry: 'polygon' },
		{ name: 'sensors', geometry: 'point' },
		{ name: 'mystery', geometry: 'unknown' }
	];

	const style = deriveStyle(LAYERS, SOURCES, BASE)!;

	it('draws every layer the tiles have', () => {
		const drawn = new Set(style.layers.map((l) => ('source-layer' in l ? l['source-layer'] : null)));
		for (const layer of LAYERS) expect(drawn).toContain(layer.name);
	});

	// The whole point: a preset over these tiles draws nothing, and this draws all of them.
	it('is what a preset cannot be for tiles it was not written for', () => {
		expect(
			drawsAnything(
				style,
				LAYERS.map((l) => l.name)
			)
		).toBe(true);
		expect(
			drawsAnything(
				renderStyle(recipe(), SOURCES, BASE)!,
				LAYERS.map((l) => l.name)
			)
		).toBe(false);
	});

	it('draws each geometry as something that can show it', () => {
		const kinds = (name: string) =>
			style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === name).map((l) => l.type);
		expect(kinds('parcels')).toEqual(['fill', 'line']);
		expect(kinds('sensors')).toEqual(['circle']);
		expect(kinds('roads')).toEqual(['line']);
		// An unnamed geometry gets the guess that hides the least.
		expect(kinds('mystery')).toEqual(['line']);
	});

	// A layer of building footprints drawn over the roads hides them, which is the map this exists
	// to rescue you from.
	it('puts polygons under lines under points', () => {
		const at = (name: string) => style.layers.findIndex((l) => 'source-layer' in l && l['source-layer'] === name);
		expect(at('parcels')).toBeLessThan(at('roads'));
		expect(at('roads')).toBeLessThan(at('sensors'));
	});

	it('gives a layer the same colour every time and its neighbour a different one', () => {
		const again = deriveStyle(LAYERS, SOURCES, BASE)!;
		expect(JSON.stringify(again.layers)).toEqual(JSON.stringify(style.layers));

		const colours = new Set(
			style.layers.map((l) => JSON.stringify(Object.values(('paint' in l ? l.paint : {}) ?? {})[0]))
		);
		expect(colours.size).toBeGreaterThan(2);
	});

	it('routes its tiles through the queue, like every other pipeline tile', () => {
		expect(JSON.stringify(style.sources)).toContain('studio://');
	});

	it('has nothing to derive from nothing', () => {
		expect(deriveStyle([], SOURCES, BASE)).toBeNull();
		expect(deriveStyle(LAYERS, [], BASE)).toBeNull();
	});
});

describe('styleFor', () => {
	const SHORTBREAD = ['water_polygons', 'street_polygons', 'boundaries'];
	const PLACES = [{ name: 'places', geometry: 'point' }];

	it('uses the preset when it draws these tiles', () => {
		const { style, basis } = styleFor(
			recipe(),
			{ kind: 'vectorShortbread', tileFormat: 'mvt', layers: PLACES, mountedLayers: SHORTBREAD },
			SOURCES,
			BASE
		);
		expect(basis).toBe('preset');
		expect(style!.layers.length).toBeGreaterThan(50);
	});

	// S6.2's whole point. Before this, a preset that matched no layer produced `null`, and the map
	// showed a bare background — for the most common thing the pipeline pane produces.
	it('derives when the preset would draw nothing', () => {
		const { style, basis } = styleFor(
			recipe(),
			{ kind: 'vectorShortbread', tileFormat: 'mvt', layers: PLACES, mountedLayers: ['places'] },
			SOURCES,
			BASE
		);
		expect(basis).toBe('fallback');
		expect(style).not.toBeNull();
		expect(style!.layers.some((layer) => 'source-layer' in layer && layer['source-layer'] === 'places')).toBe(true);
	});

	it('keeps `derived` distinct from falling back to it', () => {
		const chosen = styleFor(
			recipe({ preset: 'derived' }),
			{ kind: 'vectorShortbread', tileFormat: 'mvt', layers: PLACES, mountedLayers: ['places'] },
			SOURCES,
			BASE
		);
		expect(chosen.basis).toBe('derived');
	});

	// Raster has no vector layers to derive from, and inventing something to draw would be worse
	// than the honest background. S6.3 and S6.6 are what fill this in.
	it('draws nothing when there are no layers to derive from', () => {
		const { style, basis } = styleFor(
			recipe(),
			{ kind: 'vectorShortbread', tileFormat: 'mvt', layers: [], mountedLayers: [] },
			SOURCES,
			BASE
		);
		expect(basis).toBe('none');
		expect(style).toBeNull();
	});

	it('reports `none` for a derived preset with nothing to derive', () => {
		const { basis } = styleFor(
			recipe({ preset: 'derived' }),
			{ kind: 'vectorShortbread', tileFormat: 'mvt', layers: [], mountedLayers: [] },
			SOURCES,
			BASE
		);
		expect(basis).toBe('none');
	});
});

describe('styleFor and formats the map cannot read as vector', () => {
	const PLACES = [{ name: 'places', geometry: 'point' }];

	// S6.3 replaced this: raster used to be the case with no answer at all.
	it('draws imagery as a raster layer', () => {
		const { style, basis } = styleFor(
			recipe(),
			{ kind: 'rasterImage', tileFormat: 'png', layers: [], mountedLayers: [] },
			SOURCES,
			BASE
		);
		expect(basis).toBe('raster');
		expect(style!.layers).toHaveLength(1);
		expect(style!.layers[0].type).toBe('raster');
	});

	// Until S6.6 gives it hillshade, elevation is left to the container layer `preview` already
	// added — a raster style over it would claim to be adjusting something it does not understand.
	it('leaves elevation alone', () => {
		expect(
			styleFor(raster(), { kind: 'rasterDem', tileFormat: 'png', layers: [], mountedLayers: [] }, SOURCES, BASE).basis
		).toBe('none');
	});

	// The kind can be a guess or something set by hand; neither makes MapLibre able to decode `mvt`
	// as an image, so the format overrules it.
	it('refuses imagery over vector tiles', () => {
		expect(
			styleFor(raster(), { kind: 'rasterImage', tileFormat: 'mvt', layers: [], mountedLayers: [] }, SOURCES, BASE).basis
		).toBe('none');
	});

	// `bin` is the default variant upstream, so a container whose format could not be determined
	// lands there. Deriving over it would point a vector source at tiles MapLibre cannot decode.
	it('refuses to derive over an undetermined format', () => {
		expect(
			styleFor(
				recipe(),
				{ kind: 'rasterImage', tileFormat: 'bin', layers: PLACES, mountedLayers: ['places'] },
				SOURCES,
				BASE
			)
		).toEqual({ style: null, basis: 'none' });
	});
});

describe('rasterPaint', () => {
	it('says nothing when nothing was adjusted', () => {
		expect(rasterPaint({})).toEqual({});
	});

	it('passes through the properties that share MapLibre’s units', () => {
		expect(rasterPaint({ hue: 40, saturation: -0.5, contrast: 0.25, opacity: 0.8 })).toEqual({
			'raster-hue-rotate': 40,
			'raster-saturation': -0.5,
			'raster-contrast': 0.25,
			'raster-opacity': 0.8
		});
	});

	// One control, two endpoints: brightening lifts the floor, darkening lowers the ceiling, and
	// only the endpoint that moved is written.
	it('turns one brightness control into the endpoint that moved', () => {
		expect(rasterPaint({ brightness: 0.3 })).toEqual({ 'raster-brightness-min': 0.3 });
		expect(rasterPaint({ brightness: -0.25 })).toEqual({ 'raster-brightness-max': 0.75 });
		expect(rasterPaint({ brightness: 0 })).toEqual({});
	});

	it('clamps a brightness beyond the range rather than emitting it', () => {
		expect(rasterPaint({ brightness: 5 })).toEqual({ 'raster-brightness-min': 1 });
	});

	it('carries resampling, which is the control a scan wants', () => {
		expect(rasterPaint({ resampling: 'nearest' })).toEqual({ 'raster-resampling': 'nearest' });
	});
});
