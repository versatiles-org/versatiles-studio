import { describe, expect, it } from 'vitest';
import { renderStyle } from './style';
import type { Recipe } from '../ipc/commands';

const BASE = 'http://127.0.0.1:8080';
const SOURCES = [{ name: 'berlin', tileUrl: `${BASE}/tiles/berlin/{z}/{x}/{y}` }];

function recipe(over: Partial<Recipe> = {}): Recipe {
	return { preset: 'colorful', recolor: {}, overrides: {}, ...over } as Recipe;
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
		expect(renderStyle(recipe({ preset: 'derived' } as Partial<Recipe>), SOURCES, BASE)).toBeNull();
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
		const same = renderStyle(recipe({ recolor: { gamma: undefined, rotate: null } as never }), SOURCES, BASE)!;
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
