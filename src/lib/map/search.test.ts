import { describe, expect, it, vi } from 'vitest';
import { geocode, geocodeUrl, geocoderLanguage, parseQuery, placesFrom } from './search';

const titles = (text: string) => parseQuery(text).map((candidate) => candidate.title);
const contexts = (text: string) => parseQuery(text).map((candidate) => candidate.context);

describe('a tile', () => {
	it('reads z/x/y, and fits the view to that tile', () => {
		const [tile] = parseQuery('12/2200/1343');
		expect(tile.type).toBe('tile');
		expect(tile.target.kind).toBe('bounds');
		if (tile.target.kind !== 'bounds') return;
		const [west, south, east, north] = tile.target.bounds;
		expect(west).toBeLessThan(13.4);
		expect(east).toBeGreaterThan(13.4);
		expect(south).toBeLessThan(52.52);
		expect(north).toBeGreaterThan(52.52);
	});

	// What a log line or a network panel hands you.
	it('reads it at the end of a tile URL', () => {
		expect(titles('https://tiles.versatiles.org/tiles/osm/12/2200/1343')).toEqual(['Tile 12/2200/1343']);
		expect(titles('studio://127.0.0.1:5/tiles/berlin/14/8800/5373.pbf?v=3')).toEqual(['Tile 14/8800/5373']);
	});

	it('refuses a tile outside its zoom level', () => {
		expect(parseQuery('2/4/0')).toEqual([]);
	});
});

describe('a coordinate', () => {
	/**
	 * **Both readings, labelled.** The old field read every pair one way, so a pair copied from
	 * Google Maps - lat, lng - landed in the wrong half of the world, or nowhere.
	 */
	it('offers both orders when both are possible, lat/lng first, titled by where each is', () => {
		expect(titles('52.52, 13.40')).toEqual(['52.52° N, 13.4° E', '13.4° N, 52.52° E']);
		expect(contexts('52.52, 13.40')).toEqual(['read as latitude, longitude', 'read as longitude, latitude']);
	});

	it('offers only the order that can be true', () => {
		// 120 cannot be a latitude.
		expect(titles('120, 30')).toEqual(['30° N, 120° E']);
		expect(titles('30, 120')).toEqual(['30° N, 120° E']);
		expect(titles('-33.9, -70.6')).toEqual(['33.9° S, 70.6° W', '70.6° S, 33.9° W']);
	});

	it('reads a third number as the zoom', () => {
		const [first] = parseQuery('52.52 13.4 15');
		expect(first.target).toEqual({ kind: 'point', center: [13.4, 52.52], zoom: 15 });
		expect(first.context).toContain('zoom 15');
	});

	it('takes the point an openstreetmap.org link is at', () => {
		const [found] = parseQuery('https://www.openstreetmap.org/#map=15/52.51627/13.37770');
		expect(found.target).toEqual({ kind: 'point', center: [13.3777, 52.51627], zoom: 15 });
	});

	// `map=12/52/13` is also three whole numbers with slashes - which the tile reading would take.
	it('reads a map link as a link even when its numbers are whole', () => {
		expect(parseQuery('https://example.org/#map=12/52/13')[0].type).toBe('coordinate');
	});
});

describe('a bounding box', () => {
	it('reads four numbers as west, south, east, north', () => {
		const [box] = parseQuery('13.0, 52.3, 13.8, 52.7');
		expect(box.type).toBe('bbox');
		expect(box.target).toEqual({ kind: 'bounds', bounds: [13, 52.3, 13.8, 52.7] });
	});

	it('refuses one whose south is above its north', () => {
		expect(parseQuery('13.0, 52.7, 13.8, 52.3')).toEqual([]);
	});
});

it('leaves a place name to the geocoder', () => {
	expect(parseQuery('Brandenburger Tor')).toEqual([]);
	expect(parseQuery('')).toEqual([]);
});

describe('the geocoder', () => {
	// The geocoder answers 400 for any other language, so an unsupported one must be left out.
	it('asks in a language it has, or lets it choose', () => {
		expect(geocoderLanguage(['de-AT', 'en'])).toBe('de');
		expect(geocoderLanguage(['nl', 'fr-CA'])).toBe('fr');
		expect(geocoderLanguage(['nl'])).toBeNull();
	});

	it('asks near where the map is', () => {
		const url = geocodeUrl('Springfield', { lng: 13.4, lat: 52.5 }, ['nl']);
		expect(url.origin + url.pathname).toBe('https://geocode.versatiles.org/api');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: 'Springfield',
			limit: '5',
			lat: '52.50000',
			lon: '13.40000'
		});
	});

	const ANSWER = {
		features: [
			{
				geometry: { coordinates: [13.38, 52.516] },
				properties: {
					name: 'Brandenburger Tor',
					street: 'Pariser Platz',
					city: 'Berlin',
					postcode: '10117',
					country: 'Germany',
					type: 'house'
				}
			},
			{
				geometry: { coordinates: [13.4, 52.5] },
				// Photon orders an extent [west, north, east, south].
				properties: { name: 'Berlin', type: 'city', country: 'Germany', extent: [13.08, 52.67, 13.76, 52.33] }
			},
			{ geometry: { coordinates: [1, 2] }, properties: { street: 'Unter den Linden', housenumber: '77' } },
			{ properties: { name: 'No geometry' } }
		]
	};

	it('lists places with where they are, and leaves out what it cannot place', () => {
		const places = placesFrom(ANSWER);
		expect(places.map((place) => place.title)).toEqual(['Brandenburger Tor', 'Berlin', 'Unter den Linden 77']);
		expect(places[0].context).toBe('Pariser Platz, 10117 Berlin, Germany');
		expect(places[0].target).toEqual({ kind: 'point', center: [13.38, 52.516], zoom: 17 });
	});

	it('lists two objects that read the same once', () => {
		const twin = { geometry: { coordinates: [13.381, 52.516] }, properties: ANSWER.features[0].properties };
		const places = placesFrom({ features: [ANSWER.features[0], twin] });
		expect(places).toHaveLength(1);
	});

	it('fits an area to its extent, in the order MapLibre wants', () => {
		expect(placesFrom(ANSWER)[1].target).toEqual({ kind: 'bounds', bounds: [13.08, 52.33, 13.76, 52.67], maxZoom: 17 });
	});

	// Offline is a state Studio works in; "nothing found" would be the wrong thing to say about it.
	it('throws when it cannot be reached, rather than finding nothing', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
		await expect(geocode('Berlin', null, { fetcher, languages: [] })).rejects.toThrow('503');
	});
});
