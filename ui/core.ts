/**
 * A stand-in for Studio's Rust core, answering the webview's commands from inside the test.
 *
 * **Typed against the generated bindings**, by the camel-case name the webview calls a command by:
 * an answer of the wrong shape, or for a command that was renamed, does not type-check, so this
 * cannot drift from the real core without saying so.
 *
 * **Strict.** A command with no answer is recorded and refused, and `unanswered` is checked after
 * every test - a page that started asking something new fails here rather than half-rendering.
 */

import type { commands } from '../src/lib/ipc/bindings';
import fixtures from './fixtures/core.json' with { type: 'json' };
import { TILES } from './tiles';

type Commands = typeof commands;
type Ok<R> = R extends { status: 'ok'; data: infer T } ? T : R extends { status: 'error' } ? never : R;
type Returned<K extends keyof Commands> = Ok<Awaited<ReturnType<Commands[K]>>>;

/** What a command answers: its value, or a refusal - the error a `Result` command would return. */
export type Answer<K extends keyof Commands> = (
	args: Record<string, unknown>
) => Returned<K> | Refusal | Promise<Returned<K> | Refusal>;
export type Answers = { [K in keyof Commands]?: Answer<K> };

/** The core saying no, as a `Result` command does. Reaches the page as a rejected `invoke`. */
export interface Refusal {
	refused: string;
}
export const refuse = (reason: string): Refusal => ({ refused: reason });

/** Plugin commands the page sends on its own - a window title, an opener - answered with nothing. */
const PLUGINS = /^plugin:(window|webview|opener|dialog|process|updater)\|/;

/**
 * The core's own data - its catalogue of operations and ways in, a new project's layout and style -
 * as the real core answers it, written out by `src-tauri/src/ui_fixtures.rs`, which fails when this
 * goes stale.
 */
const CORE = fixtures as unknown as {
	importKinds: Returned<'importKinds'>;
	vplOperations: Returned<'vplOperations'>;
	writableFormats: Returned<'writableFormats'>;
	layout: Returned<'layout'>;
	style: Returned<'style'>;
	osm: { graphs: Returned<'graphs'>; graph: Returned<'graph'> };
};

/**
 * A project with one source, OpenStreetMap read from download.versatiles.org: its graph list and
 * its document as the real core makes them (see `ui_fixtures.rs`).
 */
export const OSM_PROJECT: Answers = {
	graphs: () => CORE.osm.graphs,
	graph: () => CORE.osm.graph,
	fieldSuggestions: () => [],
	// Opened by the suite's own `versatiles serve`, so the answer is that server's: its TileJSON for
	// what the container is, and its tile URL for where the map fetches from.
	openContainer: async ({ source }) => ({
		name: 'osm',
		tileUrl: `${TILES}/tiles/osm/{z}/{x}/{y}`,
		vpl: CORE.osm.graph?.text ?? '',
		info: await osmInfo(String(source))
	}),
	mountGraph: async () => {
		const info = await osmInfo('osm');
		const layers = (info.tileJson as { vector_layers?: { id: string; fields?: Record<string, string> }[] })
			.vector_layers;
		return {
			type: 'tiles',
			preview: {
				name: 'osm',
				tileUrl: `${TILES}/tiles/osm/{z}/{x}/{y}`,
				info,
				// From the TileJSON's own list. The real core samples tiles for the counts, the sizes
				// and the commonest geometry; a test that needs those has to answer them itself.
				layers: (layers ?? []).map((layer) => ({
					name: layer.id,
					featureCount: 0,
					encodedBytes: 0,
					propertyKeys: Object.keys(layer.fields ?? {}),
					geometry: 'unknown'
				})),
				// Every transform, as fitting: a vector source rules none of the vector ones out.
				fits: CORE.vplOperations
					.filter((operation) => !operation.name.startsWith('from_'))
					.map((operation) => ({ name: operation.name, reason: null })),
				branchFits: []
			}
		};
	}
};

/** What the suite's server says OpenStreetMap is, as the core's `ContainerInfo`. */
async function osmInfo(source: string): Promise<Returned<'openContainer'>['info']> {
	const tileJson = (await (await fetch(`${TILES}/tiles/osm/tiles.json`)).json()) as {
		minzoom: number;
		maxzoom: number;
		bounds: [number, number, number, number];
		tile_schema?: string;
	};
	return {
		source,
		container: 'versatiles',
		// The core names the format, where the TileJSON gives its MIME type.
		tileFormat: 'mvt',
		tileCompression: 'brotli',
		minZoom: tileJson.minzoom,
		maxZoom: tileJson.maxzoom,
		bbox: tileJson.bounds,
		tileSchema: tileJson.tile_schema ?? null,
		tileJson
	};
}

/** What every page asks at start-up, answered as a fresh install with nothing open would. */
const DEFAULTS: Answers = {
	appVersion: () => '0.7.0',
	importKinds: () => CORE.importKinds,
	vplOperations: () => CORE.vplOperations,
	writableFormats: () => CORE.writableFormats,
	layout: () => CORE.layout,
	style: () => CORE.style,
	serverBaseUrl: () => TILES,
	graphs: () => [],
	// Stored as sent: the real core clamps widths and reconciles panes, which a test does not need.
	setLayout: ({ layout }) => layout as Returned<'setLayout'>,
	listViews: () => [],
	subscribeJobs: () => [],
	recentSources: () => [],
	takeOpened: () => [],
	refreshMenu: () => null,
	diagnostics: () => [],
	browsePlaces: () => [{ label: 'Home', path: '/home/anna' }],
	browsing: () => ({ tab: '', folder: null, servers: [] }),
	browseLocal: () => ({ path: '/home/anna', parent: '/home', entries: [] }),
	rememberBrowsing: () => null,
	forgetServer: () => null
};

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export class FakeCore {
	readonly calls: { command: string; args: Record<string, unknown> }[] = [];
	readonly unanswered: string[] = [];
	/** What the page reported going wrong, through `log_diagnostic` - checked after every test. */
	readonly problems: unknown[] = [];
	readonly #answers = new Map<string, (args: Record<string, unknown>) => unknown>();

	constructor(answers: Answers = {}) {
		const own: Answers = {
			logDiagnostic: ({ report }) => {
				this.problems.push(report);
				return this.problems.length;
			}
		};
		for (const [name, answer] of Object.entries({ ...DEFAULTS, ...own, ...answers })) {
			if (answer) this.#answers.set(snake(name), answer as (args: Record<string, unknown>) => unknown);
		}
	}

	/** How the page's `invoke` reaches this. */
	async handle(command: string, args: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ command, args });
		if (PLUGINS.test(command)) return null;
		const answer = this.#answers.get(command);
		if (!answer) {
			this.unanswered.push(command);
			return refuse(`the fake core has no answer for ${command}`);
		}
		return answer(args);
	}

	/** The arguments of every call to a command, by the name the webview calls it. */
	argsOf(name: keyof Commands): Record<string, unknown>[] {
		return this.calls.filter((call) => call.command === snake(name)).map((call) => call.args);
	}
}
