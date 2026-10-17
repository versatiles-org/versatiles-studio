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
 * every reading is offered, and each is titled by where it *is* (`52.52° N, 13.4° E`) so the two
 * cannot be mistaken for each other. Where only one order is possible - a number over 85, or compass
 * letters that say which is which - only one is offered.
 *
 * **Where each reading lands decides which comes first** (`rank`). `52.52° N` and `52.52° E` are
 * hard to tell apart in the head; "in your data" and "6,100 km south-east" are not. Both are worked
 * out here, from the map, without asking anyone.
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
	return osmLink(input) ?? tile(input) ?? notation(input) ?? numbers(input) ?? [];
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
	return [point(lng, lat, zoom, ['from a map link'])];
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

	return bothOrders(a, b, zoom, []);
}

/// Two numbers with nothing to say which is which: every order that can be true, lat/lng first.
function bothOrders(a: number, b: number, zoom: number | undefined, how: string[]): Candidate[] | null {
	const readings: Candidate[] = [];
	if (isLat(a) && isLng(b)) readings.push(point(b, a, zoom, ['lat, lng', ...how]));
	if (isLng(a) && isLat(b) && a !== b) readings.push(point(a, b, zoom, ['lng, lat', ...how]));
	return readings.length > 0 ? readings : null;
}

// -- written coordinates -----------------------------------------------------------------------

/** What a compass letter says: which axis, and which side of it. German `O` (Ost) is east. */
const HEMISPHERES: Record<string, { axis: 'lat' | 'lng'; sign: 1 | -1 }> = {
	N: { axis: 'lat', sign: 1 },
	S: { axis: 'lat', sign: -1 },
	E: { axis: 'lng', sign: 1 },
	O: { axis: 'lng', sign: 1 },
	W: { axis: 'lng', sign: -1 }
};

/** How a part was written, most detailed last - a pair is labelled by its more detailed half. */
const NOTATIONS = ['decimal', 'minutes', 'seconds'] as const;
type Notation = (typeof NOTATIONS)[number];
const NOTATION_LABEL: Record<Notation, string | null> = {
	decimal: null,
	minutes: 'degrees, decimal minutes',
	seconds: 'degrees, minutes, seconds'
};

/** One half of a written coordinate. */
interface Part {
	value: number;
	/** Fixed by a compass letter, or open. */
	axis: 'lat' | 'lng' | null;
	notation: Notation;
}

const NUM = String.raw`\d+(?:\.\d+)?`;
/// Degrees, then minutes and seconds if written - each with its mark, since without them `52 31 7`
/// is three numbers, not one angle.
const BODY = String.raw`([-+]?${NUM})\s*°?\s*(?:(${NUM})\s*'\s*(?:(${NUM})\s*"\s*)?)?`;
/// A letter before or after, not both: either alternative is one way of writing a part.
const PART = String.raw`(?:([NSEWO])\s*${BODY}|${BODY}([NSEWO])?)`;
const WRITTEN = new RegExp(String.raw`^${PART}\s*[,;]?\s*${PART}$`, 'i');

/**
 * A coordinate written the way a page or a device writes it: `52.52 N, 13.40 E`, `13.4E 52.52N`,
 * `52° 31′ 7″ N, 13° 24′ 30″ E`, `52°31.12'N 13°24.5'E`. Only text with a compass letter or a
 * degree, minute or second mark comes here; plain numbers are `numbers`', which also reads a zoom
 * and a box.
 */
function notation(text: string): Candidate[] | null {
	// The typographic marks and the keyboard ones mean the same; `''` is a second written with what is
	// on the keyboard.
	const input = text
		.replace(/[′’‘´`]/g, "'")
		.replace(/[″“”]|''/g, '"')
		.replace(/º/g, '°');
	if (!/[NSEWO°'"]/i.test(input)) return null;
	const match = WRITTEN.exec(input);
	if (!match) return null;

	// Each `PART` is eight groups, two alternatives of four: a letter and a body, or a body and a
	// letter.
	const parts = [match.slice(1, 9), match.slice(9, 17)].map(([before, ...rest]) =>
		before ? part(rest.slice(0, 3), before) : part(rest.slice(3, 6), rest[6])
	);
	if (parts.some((found) => found === null)) return null;
	const [a, b] = parts as Part[];

	const finest = NOTATIONS[Math.max(NOTATIONS.indexOf(a.notation), NOTATIONS.indexOf(b.notation))];
	const how = NOTATION_LABEL[finest] ? [NOTATION_LABEL[finest]] : [];

	// One letter is enough: the other half is whichever axis is left.
	if (a.axis || b.axis) {
		const aAxis = a.axis ?? (b.axis === 'lat' ? 'lng' : 'lat');
		const bAxis = b.axis ?? (aAxis === 'lat' ? 'lng' : 'lat');
		if (aAxis === bAxis) return null;
		const [lat, lng] = aAxis === 'lat' ? [a.value, b.value] : [b.value, a.value];
		if (!isLat(lat) || !isLng(lng)) return null;
		return [point(lng, lat, undefined, how)];
	}
	return bothOrders(a.value, b.value, undefined, how);
}

/** A part's number, or `null` for one no one could have meant - 75 minutes, or `-52 S`. */
function part([degrees, minutes, seconds]: (string | undefined)[], letter: string | undefined): Part | null {
	if (degrees === undefined) return null;
	const negative = degrees.startsWith('-');
	const whole = Math.abs(Number(degrees));
	if (minutes !== undefined && (!Number.isInteger(whole) || Number(minutes) >= 60)) return null;
	if (seconds !== undefined && (!Number.isInteger(Number(minutes)) || Number(seconds) >= 60)) return null;
	let value = whole + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600;

	const hemisphere = letter ? HEMISPHERES[letter.toUpperCase()] : undefined;
	if (hemisphere && negative) return null;
	if (negative) value = -value;
	if (hemisphere) value *= hemisphere.sign;
	return {
		value,
		axis: hemisphere?.axis ?? null,
		notation: seconds !== undefined ? 'seconds' : minutes !== undefined ? 'minutes' : 'decimal'
	};
}

/** Where a point is, in words that do not depend on an order: `52.52° N, 13.4° E`. */
const place = (lng: number, lat: number) =>
	`${fmt(Math.abs(lat))}° ${lat < 0 ? 'S' : 'N'}, ${fmt(Math.abs(lng))}° ${lng < 0 ? 'W' : 'E'}`;

function point(lng: number, lat: number, zoom: number | undefined, how: string[]): Candidate {
	return {
		type: 'coordinate',
		title: place(lng, lat),
		context: [...how, zoom === undefined ? null : `zoom ${fmt(zoom)}`].filter(Boolean).join(' · '),
		target: { kind: 'point', center: [lng, lat], zoom },
		marker: true
	};
}

// -- where a reading lands ---------------------------------------------------------------------

type Box = [number, number, number, number];

/** What the map is showing, for `rank`. */
export interface View {
	center: { lng: number; lat: number };
	/** What is on screen, [west, south, east, north]. */
	bounds: Box | null;
	/** The extents of the data on the map - the containers that declare one. */
	data: Box[];
}

/**
 * The extents worth comparing against: a source covering the whole world says nothing about where
 * anyone meant - the background has one, and so does a planet extract.
 */
export function dataExtents(sources: Record<string, unknown> | undefined): Box[] {
	return Object.values(sources ?? {}).flatMap((source) => {
		const bounds = (source as { bounds?: unknown })?.bounds;
		if (!Array.isArray(bounds) || bounds.length !== 4 || !finite(bounds as number[])) return [];
		const [west, south, east, north] = bounds as Box;
		const world = east - west >= 359 && north - south >= 160;
		return world ? [] : [bounds as Box];
	});
}

/// Across the antimeridian too: a box from 170 to -170 has its west east of its east.
const contains = ([west, south, east, north]: Box, [lng, lat]: [number, number]) =>
	lat >= south && lat <= north && (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east);

const EARTH_KM = 6371;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in km, and the compass direction it is in, from `from` to `to`. */
function heading(from: { lng: number; lat: number }, [lng, lat]: [number, number]) {
	const [φ1, φ2, Δλ] = [rad(from.lat), rad(lat), rad(lng - from.lng)];
	const a = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
	const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
	const bearing = Math.atan2(
		Math.sin(Δλ) * Math.cos(φ2),
		Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
	);
	const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
	const direction = DIRECTIONS[Math.round(((bearing * 180) / Math.PI + 360) / 45) % 8];
	return { km, direction };
}

/// As precise as a glance needs: `4.2 km`, `320 km`, `6,100 km`.
function distance(km: number): string {
	const rounded = km < 10 ? Number(km.toFixed(1)) : km < 1000 ? Math.round(km) : Math.round(km / 100) * 100;
	return `${rounded.toLocaleString('en')} km`;
}

/**
 * Coordinates labelled with where they land, the likelier first: inside the data on the map, then
 * nearer the view, then the order they came in - lat/lng before lng/lat.
 *
 * **The data first** because Studio is for looking at it: a reading inside the open container is
 * almost certainly the one meant, wherever the view happens to be. Other results are left alone.
 */
export function rank(candidates: Candidate[], view: View | null): Candidate[] {
	if (!view) return candidates;
	const scored = candidates.map((candidate) => {
		if (candidate.type !== 'coordinate' || candidate.target.kind !== 'point') return { candidate, score: null };
		const at = candidate.target.center;
		const inData = view.data.some((box) => contains(box, at));
		const inView = view.bounds !== null && contains(view.bounds, at);
		const { km, direction } = heading(view.center, at);
		const where = [inData ? 'in your data' : null, inView ? 'in view' : `${distance(km)} ${direction}`];
		const context = [...where, candidate.context].filter(Boolean).join(' · ');
		return { candidate: { ...candidate, context }, score: [inData ? 0 : 1, inView ? 0 : km] };
	});
	// Only coordinates move, and only among themselves - a sort is stable, so ties keep their order.
	const points = scored
		.filter((entry) => entry.score !== null)
		.sort((a, b) => a.score![0] - b.score![0] || a.score![1] - b.score![1]);
	let next = 0;
	return scored.map((entry) => (entry.score === null ? entry.candidate : points[next++].candidate));
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
