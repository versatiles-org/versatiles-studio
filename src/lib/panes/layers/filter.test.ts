import { describe, expect, it } from 'vitest';
import { colorful } from '@versatiles/style';
import type { LayerSpecification } from 'maplibre-gl';
import { filterOf, format, isOverridden, parse } from './filter';

describe('reading a layer’s filter', () => {
	const layer = {
		id: 'water',
		type: 'fill',
		filter: ['==', ['get', 'class'], 'river']
	} as unknown as LayerSpecification;

	it('prefers the override to the style’s own', () => {
		expect(filterOf(layer, { filter: ['has', 'name'] })).toEqual(['has', 'name']);
		expect(filterOf(layer, {})).toEqual(['==', ['get', 'class'], 'river']);
	});

	it('says null for a layer with no filter at all', () => {
		// A third state, not an empty one: "draws everything" is not "draws nothing".
		expect(filterOf({ id: 'bg', type: 'background' } as unknown as LayerSpecification, {})).toBeNull();
	});

	it('knows whose filter it is', () => {
		expect(isOverridden({ filter: ['has', 'name'] })).toBe(true);
		expect(isOverridden({ minZoom: 4 })).toBe(false);
		expect(isOverridden(undefined)).toBe(false);
	});
});

describe('parsing what was typed', () => {
	it('accepts an expression filter and a legacy one', () => {
		expect(parse('["==",["get","class"],"river"]')).toEqual({ ok: true, filter: ['==', ['get', 'class'], 'river'] });
		// Legacy v7 filters still appear in styles in the wild, and MapLibre still draws them.
		expect(parse('["==","class","river"]')).toEqual({ ok: true, filter: ['==', 'class', 'river'] });
	});

	it('treats an empty box as clearing the override, not as an error', () => {
		expect(parse('')).toEqual({ ok: true, filter: undefined });
		expect(parse('   \n ')).toEqual({ ok: true, filter: undefined });
	});

	it('reports the operator MapLibre did not recognise', () => {
		const result = parse('["bogus",1,2]');
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toContain('bogus');
	});

	it('reports the wrong number of arguments', () => {
		const result = parse('["==",["get","a"]]');
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.problem).toMatch(/argument/i);
	});

	/**
	 * `featureFilter` accepts all three without complaint, and none is a filter anyone meant to
	 * write - they are what a half-finished edit looks like. Without these the map would silently
	 * start drawing every feature.
	 */
	it('refuses the shapes MapLibre would wave through', () => {
		for (const text of ['"nope"', 'true', '[]', '[1,2]', '42', 'null']) {
			expect(parse(text).ok, text).toBe(false);
		}
	});

	it('says where the JSON went wrong', () => {
		const result = parse('["==",["get","a"]');
		expect(result.ok).toBe(false);
	});
});

describe('formatting a filter to edit', () => {
	it('keeps a short filter on one line', () => {
		expect(format(['has', 'name'])).toBe('["has","name"]');
	});

	it('breaks a long one clause per line, and keeps each clause whole', () => {
		const text = format(['all', ['==', ['get', 'class'], 'river'], ['!=', ['get', 'brunnel'], 'tunnel']]);
		expect(text.split('\n')).toEqual([
			'[',
			'\t"all",',
			'\t["==",["get","class"],"river"],',
			'\t["!=",["get","brunnel"],"tunnel"]',
			']'
		]);
	});

	/** The editor's whole contract: what it shows must parse back to what it was given. */
	it('round-trips every filter the colorful preset uses', () => {
		const filters = colorful({})
			.layers.map((layer) => (layer as { filter?: unknown }).filter)
			.filter((f): f is unknown[] => Array.isArray(f));

		expect(filters.length).toBeGreaterThan(100); // the premise: there are filters to test
		for (const filter of filters) {
			const shown = format(filter);
			const back = parse(shown);
			expect(back.ok, `${shown} did not parse back`).toBe(true);
			expect(back.ok === true && back.filter).toEqual(filter);
		}
	});
});
