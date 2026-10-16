/**
 * Ready-made remote sources, for the dialog that opens one.
 *
 * **Mostly download.versatiles.org's own catalogue**, fetched rather than copied: it gains a dataset
 * or a release every month, and a list kept here would be wrong by the next one. Read defensively,
 * because it is somebody else's document - an entry missing what the dialog needs is left out rather
 * than shown half-empty, and a document that is not a catalogue at all is no shortcuts rather than
 * an error in a window that has other ways in.
 *
 * Fetched by the webview, not the core: the catalogue is served with `access-control-allow-origin: *`,
 * and nothing about it needs a file system.
 */

/** Where the catalogue is. */
export const CATALOG_URL = 'https://download.versatiles.org/catalog.json';

/** One shortcut: a source that can be opened as it is. */
export interface Shortcut {
	/** What it is called in the list. */
	title: string;
	/** What it is, as plain text - the catalogue writes HTML, and none of it is rendered as such. */
	description: string[];
	/** `vector` or `raster`, as the source says. */
	tileType: string;
	/** What is opened: a container, or a TileJSON. */
	url: string;
	/** Bytes, for a file; `null` for a tile server, which has no size. */
	size: number | null;
	/** When this release was made, where the catalogue says. */
	date: string | null;
	/** Who publishes it - grouped under that in the dialog. */
	publisher: string;
}

/**
 * Sources that are not in the catalogue, and are known to open.
 *
 * **Only ones checked to work end to end.** tiles.versatiles.org's own TileJSONs belong here and are
 * not, yet: they give their tile URLs relative to the document, and `from_tilejson` uses the template
 * as written rather than resolving it, so every tile request fails. That is a fix in versatiles-rs, and
 * the shortcut goes in with it.
 */
export const EXTRA: Shortcut[] = [
	{
		title: 'OpenFreeMap',
		description: [
			'The whole planet as a tile server, in the OpenMapTiles schema.',
			'© OpenMapTiles, © OpenStreetMap contributors'
		],
		tileType: 'vector',
		url: 'https://tiles.openfreemap.org/planet',
		size: null,
		date: null,
		publisher: 'openfreemap.org'
	}
];

/** HTML as the text a person would read in it. */
function plain(html: string): string {
	return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The shortcuts a catalogue document offers, in its own order. */
export function parseCatalog(document: unknown): Shortcut[] {
	if (!isRecord(document) || !Array.isArray(document.datasets)) return [];
	return document.datasets.flatMap((dataset): Shortcut[] => {
		if (!isRecord(dataset) || !isRecord(dataset.latest)) return [];
		const { title, description, tileType } = dataset;
		const { url, size, date } = dataset.latest;
		if (typeof title !== 'string' || typeof url !== 'string' || !/^https:\/\//.test(url)) return [];
		return [
			{
				title,
				description: Array.isArray(description)
					? description.filter((line): line is string => typeof line === 'string').map(plain)
					: [],
				tileType: typeof tileType === 'string' ? tileType : 'vector',
				url,
				size: typeof size === 'number' ? size : null,
				date: typeof date === 'string' ? date : null,
				publisher: 'download.versatiles.org'
			}
		];
	});
}

/**
 * The catalogue's shortcuts, or `null` when it cannot be had.
 *
 * `null` rather than an empty list, so the dialog can say *why* there is nothing: offline is a state
 * Studio promises to work in (G5), and "no shortcuts" would read as the catalogue being empty. Never
 * throws, for the same reason.
 */
export async function fetchCatalog(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Shortcut[] | null> {
	try {
		const response = await fetcher(CATALOG_URL, { signal });
		if (!response.ok) return null;
		return parseCatalog(await response.json());
	} catch {
		return null;
	}
}
