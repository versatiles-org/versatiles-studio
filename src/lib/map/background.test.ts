import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, buildBackground, isBackgroundId } from './background';

const SERVER = 'http://127.0.0.1:1234';

describe('buildBackground', () => {
	it('builds nothing for none', async () => {
		expect(await buildBackground('none', SERVER)).toBeNull();
	});

	/**
	 * The point of generating rather than fetching a hosted style: only the tiles are remote. A
	 * hosted style brings its own sprite and glyph URLs, so every font and icon would be fetched
	 * from the network too.
	 */
	it('takes tiles from the network and assets from our own server', async () => {
		for (const { id } of BACKGROUNDS.filter((b) => b.id !== 'none')) {
			const style = await buildBackground(id, SERVER);
			expect(style, id).not.toBeNull();

			expect(style!.glyphs, id).toContain(SERVER);
			expect(JSON.stringify(style!.sprite), id).toContain(SERVER);

			const tiles = Object.values(style!.sources).flatMap((source) =>
				'tiles' in source && source.tiles ? source.tiles : []
			);
			expect(tiles.length, id).toBeGreaterThan(0);
			expect(
				tiles.every((url) => url.startsWith('https://tiles.versatiles.org/')),
				id
			).toBe(true);
		}
	});

	it('produces a style with layers to draw', async () => {
		const style = await buildBackground('colorful', SERVER);
		expect(style!.layers.length).toBeGreaterThan(100);
	});

	it('gives satellite a raster source', async () => {
		const style = await buildBackground('satellite', SERVER);
		const types = Object.values(style!.sources).map((source) => source.type);
		expect(types).toContain('raster');
	});
});

describe('isBackgroundId', () => {
	/** A persisted value from an older build must not be able to break the map. */
	it('accepts only ids we know', () => {
		for (const { id } of BACKGROUNDS) expect(isBackgroundId(id), id).toBe(true);
		for (const value of ['terrain', '', null, 42, undefined]) expect(isBackgroundId(value)).toBe(false);
	});
});

describe('the catalogue', () => {
	it('offers off, light, dark and imagery, in that order', () => {
		expect(BACKGROUNDS[0].id).toBe('none');
		const groups = [...new Set(BACKGROUNDS.map((b) => b.group))];
		expect(groups).toEqual(['off', 'light', 'dark', 'imagery']);
	});
});
