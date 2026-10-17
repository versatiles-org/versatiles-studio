/**
 * What the map's search field can mean, and where each meaning goes.
 *
 * **One field for everything a person has in hand**: a tile from a log line, a coordinate from
 * another map, a bounding box from a container's metadata, or the name of a place. The first three
 * are read here, without the network; the last is asked of geocode.versatiles.org - the Photon
 * instance the VersaTiles site's own search uses, with the same conventions (`geocodeUrl`).
 *
 * **Readings, not a verdict.** `52.52, 13.40` is lat/lng or lng/lat depending on who wrote it -
 * Google Maps, OSM links and Wikipedia write latitude first, GeoJSON and the readout in the corner
 * write longitude first - and both are valid whenever both numbers are under 90. Rather than guessing,
 * every reading is offered, lat/lng first as the likelier, and each is titled by where it *is*
 * (`52.52° N, 13.4° E`) so the two cannot be mistaken for each other. Where only one order is
 * possible, only one is offered.
 */

import { tileToLngLat } from './tile-grid';

/** Where a result takes the map. */
export type Target =
	| { kind: 'point'; center: [number, number]; zoom?: number }
	| { kind: 'bounds'; bounds: [number, number, number, number]; maxZoom?: number };

/** One line in the result list. */
export interface Candidate {
	/** What it is, for the icon and for a screen reader. */
	type: 'tile' | 'coordinate' | 'bbox' | 'place';
	title: string;
	/** The second line: how it was read, or where a place is. */
	context: string;
	target: Target;
	/** Whether a marker belongs at the result - a point does, a tile or a box is its own outline. */
	marker: boolean;
}

const MAX_LAT = 85.0511;

const finite = (values: number[]) => values.every((value) => Number.isFinite(value));
const isLng = (value: number) => Math.abs(value) <= 180;
const isLat = (value: number) => Math.abs(value) <= MAX_LAT;
const isZoom = (value: number | undefined) => value === undefined || (value >= 0 && value <= 24);

/** A number as it should be read back: no trailing zeros, at most six places. */
const fmt = (value: number) => String(Number(value.toFixed(6)));

/**
 * Everything `text` can be read as without asking anyone, best first - or an empty list, which means
 * it is a place name (or nothing).
 */
export function parseQuery(text: string): Candidate[] {
	const input = text.trim();
	if (!input) return [];
	return osmLink(input) ?? tile(input) ?? numbers(input) ?? [];
}

/**
 * `z/x/y`, alone or at the end of a tile URL - `…/tiles/osm/12/2200/1343.pbf?v=3` is what a log or a
 * network panel hands you, and retyping three numbers out of it is the chore this saves.
 */
function tile(input: string): Candidate[] | null {
	const match = /(?:^|\/)(\d{1,2})\/(\d+)\/(\d+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(input);
	if (!match) return null;
	const [z, x, y] = match.slice(1).map(Number);
	if (z > 30 || x >= 2 ** z || y >= 2 ** z) return null;
	const [west, north] = tileToLngLat(x, y, z);
	const [east, south] = tileToLngLat(x + 1, y + 1, z);
	return [
		{
			type: 'tile',
			title: `Tile ${z}/${x}/${y}`,
			context: 'z/x/y',
			// Fitted rather than centred, so the tile fills the view whatever the window's size.
			target: { kind: 'bounds', bounds: [west, south, east, north] },
			marker: false
		}
	];
}

/**
 * An openstreetmap.org link, or anything carrying its `map=zoom/lat/lng` - the other thing people
 * paste. Recognised by the parameter, so the many sites that copied the convention work too.
 */
function osmLink(input: string): Candidate[] | null {
	const match = /[#?&]map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(input);
	if (!match) return null;
	const [zoom, lat, lng] = match.slice(1).map(Number);
	if (!isLat(lat) || !isLng(lng) || !isZoom(zoom)) return null;
	return [point(lng, lat, zoom, 'from a map link')];
}

/** Two, three or four numbers: a coordinate, a coordinate and a zoom, or a bounding box. */
function numbers(input: string): Candidate[] | null {
	// Commas, semicolons or whitespace between them; a decimal comma is not supported, because it
	// would make `13,4,52,5` mean two different things.
	if (!/^[-+\d.,;\s]+$/.test(input)) return null;
	const values = input
		.split(/[,;\s]+/)
		.filter(Boolean)
		.map(Number);
	if (!finite(values)) return null;

	if (values.length === 4) {
		const [west, south, east, north] = values;
		if (!isLng(west) || !isLng(east) || !isLat(south) || !isLat(north) || south >= north) return null;
		return [
			{
				type: 'bbox',
				title: `${fmt(west)}, ${fmt(south)}, ${fmt(east)}, ${fmt(north)}`,
				context: 'bounding box · west, south, east, north',
				target: { kind: 'bounds', bounds: [west, south, east, north] },
				marker: false
			}
		];
	}

	if (values.length !== 2 && values.length !== 3) return null;
	const [a, b, zoom] = values;
	if (!isZoom(zoom)) return null;

	const readings: Candidate[] = [];
	if (isLat(a) && isLng(b)) readings.push(point(b, a, zoom, 'read as latitude, longitude'));
	if (isLng(a) && isLat(b) && a !== b) readings.push(point(a, b, zoom, 'read as longitude, latitude'));
	return readings.length > 0 ? readings : null;
}

/** Where a point is, in words that do not depend on an order: `52.52° N, 13.4° E`. */
const place = (lng: number, lat: number) =>
	`${fmt(Math.abs(lat))}° ${lat < 0 ? 'S' : 'N'}, ${fmt(Math.abs(lng))}° ${lng < 0 ? 'W' : 'E'}`;

function point(lng: number, lat: number, zoom: number | undefined, how: string): Candidate {
	return {
		type: 'coordinate',
		title: place(lng, lat),
		context: zoom === undefined ? how : `${how} · zoom ${fmt(zoom)}`,
		target: { kind: 'point', center: [lng, lat], zoom },
		marker: true
	};
}

// -- places ------------------------------------------------------------------------------------

/** The geocoder behind the VersaTiles site's own search. */
export const GEOCODER_URL = 'https://geocode.versatiles.org/api';

/** Shorter than this, a query matches half the world and costs a request for nothing. */
export const MIN_PLACE_QUERY = 3;

/** The geocoder answers 400 for any other language, so an unsupported locale must leave it out. */
const LANGUAGES = ['de', 'en', 'fr'];

/** Photon gives an extent only for areas; a point gets a zoom by what kind of place it is. */
const ZOOM_BY_TYPE: Record<string, number> = {
	country: 4,
	state: 6,
	county: 8,
	city: 11,
	district: 13,
	locality: 14,
	street: 16,
	house: 17
};

/** A building's extent is a few metres across; fitting it would zoom in absurdly far. */
const MAX_FIT_ZOOM = 17;

/** The first of the given languages the geocoder supports, or `null` to let it choose. */
export function geocoderLanguage(tags: readonly string[]): string | null {
	for (const tag of tags) {
		const code = String(tag ?? '')
			.toLowerCase()
			.split('-')[0];
		if (LANGUAGES.includes(code)) return code;
	}
	return null;
}

/**
 * The request for a place name, biased towards where the map is - "Springfield" should find the
 * one in view - and in the reader's language where the geocoder has it.
 */
export function geocodeUrl(
	query: string,
	near: { lng: number; lat: number } | null,
	languages: readonly string[]
): URL {
	const url = new URL(GEOCODER_URL);
	url.searchParams.set('q', query);
	url.searchParams.set('limit', '5');
	if (near) {
		url.searchParams.set('lat', near.lat.toFixed(5));
		url.searchParams.set('lon', near.lng.toFixed(5));
	}
	const language = geocoderLanguage(languages);
	if (language) url.searchParams.set('lang', language);
	return url;
}

interface PhotonFeature {
	geometry?: { coordinates?: [number, number] };
	properties?: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** A geocoder answer as result lines. Defensive: it is somebody else's document. */
export function placesFrom(document: unknown): Candidate[] {
	const features = (document as { features?: unknown })?.features;
	if (!Array.isArray(features)) return [];
	// **One line per thing a person can tell apart.** OSM often has several objects for one place - a
	// station's two platforms, a node and a way - and Photon returns each; listed twice they read the
	// same and lead to the same spot, so the first stands for all.
	const seen = new Set<string>();
	return (features as PhotonFeature[]).flatMap((feature): Candidate[] => {
		const coordinates = feature.geometry?.coordinates;
		const properties = feature.properties ?? {};
		if (!Array.isArray(coordinates) || !finite(coordinates)) return [];

		const street = [text(properties.street), text(properties.housenumber)].filter(Boolean).join(' ');
		const name = text(properties.name);
		const title = name ?? (street || 'Unnamed');
		const context = [
			name && street ? street : null,
			[text(properties.postcode), text(properties.city)].filter(Boolean).join(' '),
			text(properties.state),
			text(properties.country)
		]
			.filter(Boolean)
			.join(', ');

		// Photon orders an extent [west, north, east, south], not GeoJSON's [west, south, east, north].
		const extent = properties.extent;
		const target: Target =
			Array.isArray(extent) && extent.length === 4 && finite(extent as number[])
				? {
						kind: 'bounds',
						bounds: [extent[0], extent[3], extent[2], extent[1]] as [number, number, number, number],
						maxZoom: MAX_FIT_ZOOM
					}
				: { kind: 'point', center: coordinates, zoom: ZOOM_BY_TYPE[String(properties.type)] ?? 14 };

		const key = `${title}\n${context}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [{ type: 'place', title, context, target, marker: true }];
	});
}

/**
 * Places matching a name. Throws when the geocoder cannot be reached, so the field can say so -
 * offline is a state Studio works in, and "no results" would be the wrong thing to say about it.
 */
export async function geocode(
	query: string,
	near: { lng: number; lat: number } | null,
	options: { signal?: AbortSignal; fetcher?: typeof fetch; languages?: readonly string[] } = {}
): Promise<Candidate[]> {
	const { signal, fetcher = fetch, languages = navigator.languages ?? [navigator.language] } = options;
	const response = await fetcher(geocodeUrl(query, near, languages), { signal });
	if (!response.ok) throw new Error(`the geocoder answered ${response.status}`);
	return placesFrom(await response.json());
}
