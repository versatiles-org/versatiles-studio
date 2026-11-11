import { describe, expect, it } from 'vitest';
import { absence, ENLARGED, type Bbox, type Extent } from './data-range';

/** A city extract at z14-z16: the first example in #16. */
const CITY: Extent = { minZoom: 14, maxZoom: 16, bbox: [13.3, 52.4, 13.5, 52.6] };
/** Looking at that city. */
const BERLIN: Bbox = [13.2, 52.3, 13.6, 52.7];
/** Looking somewhere else entirely. */
const PARIS: Bbox = [2.2, 48.8, 2.5, 48.9];

describe('when the camera can see the data', () => {
	it('says nothing', () => {
		expect(absence(15, BERLIN, CITY)).toBeNull();
	});

	// A source with no extent is assumed to be everywhere; only its zoom range can rule a view out.
	it('says nothing about where for a source with no extent', () => {
		expect(absence(15, PARIS, { ...CITY, bbox: null })).toBeNull();
	});

	// A level or two of overzoom is how vector tiles are used, and saying so would be constant noise.
	it('says nothing a few levels past the deepest tiles', () => {
		expect(absence(16 + ENLARGED - 1, BERLIN, CITY)).toBeNull();
	});
});

describe('when it cannot', () => {
	// The level MapLibre asks for is below the source's lowest, so it asks for nothing at all.
	it('says the zoom is too low, and where the data is', () => {
		expect(absence(11, BERLIN, CITY)).toEqual({
			reason: 'below',
			message: 'No tiles at this zoom. The data is at z14–z16.'
		});
	});

	it('names a single level once', () => {
		expect(absence(3, BERLIN, { ...CITY, minZoom: 14, maxZoom: 14 })?.message).toBe(
			'No tiles at this zoom. The data is at z14.'
		);
	});

	// Too low and somewhere else: the zoom is said first, since there is nothing anywhere at it.
	it('puts the zoom before the place', () => {
		expect(absence(11, PARIS, CITY)?.reason).toBe('below');
	});

	it('says the data is outside the view', () => {
		expect(absence(15, PARIS, CITY)).toEqual({ reason: 'outside', message: 'The data is outside this view.' });
	});

	// The third example in #16: z0-z4, zoomed far in, so the window is part of one stretched tile.
	it('says how enlarged the tiles are, far past the deepest', () => {
		const lowOnly: Extent = { minZoom: 0, maxZoom: 4, bbox: [-180, -85, 180, 85] };
		expect(absence(12, BERLIN, lowOnly)).toEqual({
			reason: 'above',
			message: 'The data ends at z4, so this is one tile enlarged 256×.'
		});
	});
});

describe('the antimeridian', () => {
	// MapLibre's bounds run past 180 when the world repeats, so Fiji at 179° east and at 181° are the
	// same place, and data at -179° is in a view from 170 to 190.
	const FIJI: Extent = { minZoom: 0, maxZoom: 14, bbox: [-180, -19, -178, -16] };

	it('finds data across it', () => {
		expect(absence(8, [170, -20, 190, -15], FIJI)).toBeNull();
	});

	it('finds it from the other side too', () => {
		expect(absence(8, [-190, -20, -170, -15], { ...FIJI, bbox: [178, -19, 180, -16] })).toBeNull();
	});

	it('counts a view of more than the whole world as covering every longitude', () => {
		expect(absence(1, [-400, -20, 400, -15], FIJI)).toBeNull();
	});
});
