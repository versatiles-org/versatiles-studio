/**
 * Putting a mount on the map and taking it off again, against a map that records rather than draws.
 *
 * The case these exist for: **a mount's name is also the style's source name** ([Q32]), so as soon
 * as a recipe draws the same graph there are two sets of layers on one source — this module's
 * hairlines and the recipe's own. Removing "the mount" by matching layer ids therefore removed the
 * recipe's layer when the style drew one source, and when it drew several — where `composeStyle`
 * prefixes ids — it removed nothing and then asked MapLibre to remove a source still in use, which
 * is refused with `Source "pipeline" cannot be removed while layer "pipeline/pipeline:raster" is
 * using it.` once per save.
 */

import { describe, expect, it } from 'vitest';
import type { LayerSpecification, Map as MaplibreMap } from 'maplibre-gl';
import { addContainerToMap, removeContainerFromMap } from './add-source';

/** A raster mount, which is the whole of what a `png` container draws. */
function raster(name: string, tileFormat = 'png') {
	return {
		name,
		tileUrl: 'http://127.0.0.1:8080/tiles/{z}/{x}/{y}',
		info: {
			source: `${name}.versatiles`,
			tileFormat,
			minZoom: 0,
			maxZoom: 14,
			bbox: null,
			tileJson: null
		} as never
	};
}

/** A map that records what it was asked to do, and refuses what MapLibre refuses. */
function fakeMap(layers: LayerSpecification[] = [], sources: string[] = []) {
	const held = new Set(sources);
	const style = [...layers];
	const errors: string[] = [];

	const map = {
		getStyle: () => ({ layers: [...style] }),
		getSource: (id: string) => (held.has(id) ? { id } : undefined),
		addSource: (id: string) => {
			// The real one throws, which is what makes adding over a style's source worth avoiding.
			if (held.has(id)) throw new Error(`Source "${id}" already exists.`);
			held.add(id);
		},
		removeSource: (id: string) => {
			const user = style.find((layer) => 'source' in layer && layer.source === id);
			// MapLibre reports this rather than throwing, which is why it only ever showed up in the
			// console — the caller carries on believing the source is gone.
			if (user) return void errors.push(`Source "${id}" cannot be removed while layer "${user.id}" is using it.`);
			held.delete(id);
		},
		addLayer: (layer: LayerSpecification) => void style.push(layer),
		removeLayer: (id: string) =>
			void style.splice(
				style.findIndex((layer) => layer.id === id),
				1
			)
	};

	return {
		map: map as unknown as MaplibreMap,
		errors,
		layerIds: () => style.map((layer) => layer.id),
		sourceIds: () => [...held]
	};
}

/** What a recipe drawing this mount alongside another source puts on the map (`composeStyle`). */
const COMPOSED: LayerSpecification[] = [
	{ id: 'background/background', type: 'background' },
	{ id: 'pipeline/pipeline:raster', type: 'raster', source: 'pipeline' }
];

describe('addContainerToMap', () => {
	it('draws a raster container as one layer on its own source', () => {
		const fake = fakeMap();
		expect(addContainerToMap(fake.map, raster('pipeline'))).toBe(true);
		expect(fake.sourceIds()).toEqual(['pipeline']);
		expect(fake.layerIds()).toEqual(['pipeline:raster']);
	});

	it('draws nothing for a format the map cannot render', () => {
		const fake = fakeMap();
		expect(addContainerToMap(fake.map, raster('pipeline', 'bin'))).toBe(false);
		expect(fake.sourceIds()).toEqual([]);
		expect(fake.layerIds()).toEqual([]);
	});

	it('sits on a source of that name it did not add rather than adding a second', () => {
		// `addSource` throws on a name already taken, and the style's source holds the same graph's
		// tiles — there is nothing to replace it with.
		const fake = fakeMap(COMPOSED, ['pipeline']);
		expect(addContainerToMap(fake.map, raster('pipeline'))).toBe(true);
		expect(fake.sourceIds()).toEqual(['pipeline']);
		expect(fake.layerIds()).toContain('pipeline:raster');
		expect(fake.layerIds(), "the recipe's own layer stays").toContain('pipeline/pipeline:raster');
	});
});

describe('removeContainerFromMap', () => {
	it('takes off what it added, source and all', () => {
		const fake = fakeMap();
		addContainerToMap(fake.map, raster('pipeline'));
		removeContainerFromMap(fake.map, 'pipeline');
		expect(fake.layerIds()).toEqual([]);
		expect(fake.sourceIds()).toEqual([]);
		expect(fake.errors).toEqual([]);
	});

	it('leaves a source a recipe is still drawing from', () => {
		const fake = fakeMap(COMPOSED, ['pipeline']);
		removeContainerFromMap(fake.map, 'pipeline');
		expect(fake.layerIds()).toEqual(['background/background', 'pipeline/pipeline:raster']);
		expect(fake.sourceIds()).toEqual(['pipeline']);
		expect(fake.errors, 'nothing to report in the console').toEqual([]);
	});

	it("leaves a recipe's layer that happens to be named like its own", () => {
		// One source drawn means `composeStyle` does not prefix, so the recipe's layer is called
		// exactly what this module would have called its own. It carries no mount marker, and that is
		// the only thing that tells them apart.
		const fake = fakeMap([{ id: 'pipeline:raster', type: 'raster', source: 'pipeline' }], ['pipeline']);
		removeContainerFromMap(fake.map, 'pipeline');
		expect(fake.layerIds()).toEqual(['pipeline:raster']);
		expect(fake.sourceIds()).toEqual(['pipeline']);
		expect(fake.errors).toEqual([]);
	});

	it('takes its own layers off a source someone else keeps', () => {
		const fake = fakeMap(COMPOSED, ['pipeline']);
		addContainerToMap(fake.map, raster('pipeline'));
		removeContainerFromMap(fake.map, 'pipeline');
		expect(fake.layerIds()).toEqual(['background/background', 'pipeline/pipeline:raster']);
		expect(fake.sourceIds()).toEqual(['pipeline']);
		expect(fake.errors).toEqual([]);
	});

	it('says nothing about a mount that was never there', () => {
		const fake = fakeMap();
		removeContainerFromMap(fake.map, 'gone');
		expect(fake.errors).toEqual([]);
	});
});
