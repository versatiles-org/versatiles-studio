import { describe, expect, it } from 'vitest';
import { renderableAs, whyNotRenderable } from './tile-format';

describe('renderableAs', () => {
	it('draws vector tiles as vector', () => {
		expect(renderableAs('mvt')).toBe('vector');
	});

	it('draws image formats as raster', () => {
		for (const format of ['png', 'jpg', 'webp', 'avif']) {
			expect(renderableAs(format), format).toBe('raster');
		}
	});

	/**
	 * The bug this exists to prevent: treating "not mvt" as "raster" put a raster layer over these,
	 * and MapLibre reported a decode failure for every tile it fetched.
	 */
	it('refuses the formats a map cannot draw', () => {
		for (const format of ['bin', 'json', 'geojson', 'topojson', 'svg']) {
			expect(renderableAs(format), format).toBeNull();
		}
	});

	it('does not care about case', () => {
		expect(renderableAs('PNG')).toBe('raster');
		expect(renderableAs('MVT')).toBe('vector');
	});

	/** `bin` is upstream's default, so it means "unknown" rather than a format in its own right. */
	it('says something useful about why', () => {
		expect(whyNotRenderable('bin')).toMatch(/could not be determined/);
		expect(whyNotRenderable('geojson')).toMatch(/geojson/);
		expect(whyNotRenderable('geojson')).toMatch(/mvt/);
	});
});
