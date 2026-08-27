import { describe, expect, it } from 'vitest';
import { colorful, eclipse, graybeard, neutrino, shadow } from '@versatiles/style';
import { CATEGORIES, categoryOf, headingOf, parts } from './categories';

describe('parts', () => {
	it('splits an id into the path a person reads down', () => {
		expect(parts('label-place-city')).toEqual(['label', 'place', 'city']);
		expect(parts('derived:water_polygons:edge')).toEqual(['derived', 'water_polygons', 'edge']);
	});

	// `_` joins words inside one name. Splitting it files `water_polygons` under a `water` holding a
	// `polygons`, which is most rows of most derived styles.
	it('leaves an underscore alone', () => {
		expect(parts('poi-man_made')).toEqual(['poi', 'man_made']);
		expect(parts('derived:street_labels')).toEqual(['derived', 'street_labels']);
	});
});

describe('categoryOf', () => {
	it('files a preset layer under the category it is about', () => {
		expect(categoryOf('label-place-city')).toBe('Labels');
		expect(categoryOf('bridge-transport-rail')).toBe('Roads & rails');
		expect(categoryOf('tunnel-street-primary')).toBe('Roads & rails');
	});

	// A third-party preset, or one that grew a prefix. The tree falls back to the id's own first
	// component rather than to a category that would be a guess.
	it('claims nothing it does not know, and the heading falls back to the id', () => {
		expect(categoryOf('derived:water_polygons')).toBeNull();
		expect(headingOf('derived:water_polygons')).toBe('derived');
		expect(headingOf('label-place-city')).toBe('Labels');
	});
});

/**
 * **The table is a claim about somebody else's package**, so it is checked against the package.
 *
 * A preset that grows a prefix would otherwise appear as a category of its own, at the top level, in
 * a list of nine headings - visible to every user and to no test.
 */
describe('the table against the presets themselves', () => {
	const presets = { colorful, neutrino, graybeard, eclipse, shadow };

	it('has a category for every prefix the presets use', () => {
		const unknown = new Set<string>();
		for (const build of Object.values(presets)) {
			for (const layer of build({}).layers) {
				const [prefix] = parts(layer.id);
				if (!(prefix in CATEGORIES)) unknown.add(prefix);
			}
		}
		expect([...unknown].sort(), 'add it to CATEGORIES, or decide it is a category of its own').toEqual([]);
	});

	it('names no prefix the presets do not have', () => {
		const used = new Set<string>();
		for (const build of Object.values(presets)) {
			for (const layer of build({}).layers) used.add(parts(layer.id)[0]);
		}
		expect(Object.keys(CATEGORIES).filter((prefix) => !used.has(prefix))).toEqual([]);
	});
});
