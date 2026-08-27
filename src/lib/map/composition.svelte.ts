/**
 * What the map draws, composed from everything that contributes to it
 * ([the layer stack](../../../docs/layers.md), S6.5).
 *
 * `stack.ts` knows how to turn a recipe and a set of builds into one style. This is the half that
 * says *which* recipe and *which* builds - the wiring that lived in a dozen `$derived`s inside
 * `App.svelte`, where a rule about what the map shows can be wrong for three releases without
 * anything failing. It has happened: the background map became unreachable however it was set, and
 * nothing said so.
 *
 * **It asks for nothing.** Every input is already module state - the graphs, the style recipe, what
 * has been built, and the chosen background - so this reads them directly rather than being handed
 * them. The one thing it owns is the server's base URL, because everything here needs it and
 * nothing else does.
 *
 * **What it is not: the selection.** Which graph is on screen belongs to `document`; this reads it
 * to answer "which source is the style pane acting on", which is a question about the composition.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { forExport } from './style-code';
import { drawn as drawsOwnTiles, ordered, stackFor } from './stack';
import { defaultStyle } from './default-style';
import { buildBackground } from './background';
import { serverBaseUrl, type GraphInfo, type LayerOverride } from '../ipc/commands';
import { graphs } from '../state/graphs.svelte';
import { document } from '../state/document.svelte';
import { layout } from '../state/layout.svelte';
import { preview } from '../state/preview.svelte';
import { status } from '../state/status.svelte';
import { style as recipe } from '../state/style.svelte';

/**
 * Where the embedded server is. `null` until it answers.
 *
 * The port is ephemeral, so it is asked for rather than assumed - and until it lands there is no
 * tile URL anything can name, which is why every derivation below is empty without it.
 */
let serverUrl = $state<string | null>(null);

/**
 * The background map, built when it is chosen and held so the stack can read it synchronously.
 *
 * **Held rather than derived** because `buildBackground` is async - `satellite` resolves a raster
 * source over the network - and a `$derived` cannot await.
 */
let background = $state<StyleSpecification | null>(null);

/** The name of the graph on screen, which is what the recipe and the built stack file it under. */
const editedName = $derived(document.graph === null ? null : graphs.nameOf(document.graph));

/** Everything the map draws, and what each source contributed to it. */
const composed = $derived(stackFor({ recipe: recipe.current, built: preview.built, serverUrl, background }));

/**
 * What each source's own style is, before composition renamed anything.
 *
 * **Its own style, not the stack's.** Overrides are keyed on the ids `styleFor` produced, and the
 * composed stack renames those as soon as a second thing draws ([Q51]) - so a tree over the stack
 * would write ids nothing matches, into a recipe they do not belong to.
 */
const sources = $derived.by(() => {
	const out: Record<
		string,
		{ graph: number; hidden: string[]; overrides: Record<string, LayerOverride>; style: StyleSpecification | null }
	> = {};
	for (const graph of graphs.list) {
		const source = recipe.current?.sources[graph.name];
		const appearance = source?.appearance;
		out[graph.name] = {
			graph: graph.id,
			hidden: source?.hidden ?? [],
			overrides: appearance?.type === 'vector' ? appearance.overrides : {},
			style: composed.bases.find((entry) => entry.name === graph.name)?.style ?? null
		};
	}
	return out;
});

/**
 * The graphs in draw order, top of the list first.
 *
 * **The list is the stack** ([Q49], [Q50]), so its order is the recipe's rather than the order
 * graphs happened to be created in. `ordered` is the same rule the map draws by, applied over every
 * graph rather than only the ones that built - a graph that will not build keeps its place in the
 * one control that can move it.
 */
const stacked = $derived.by(() => {
	const byName = new Map(graphs.list.map((graph) => [graph.name, graph]));
	const names = recipe.current ? ordered(recipe.current, [...byName.keys()]) : [...byName.keys()];
	return names
		.map((name) => byName.get(name))
		.filter((graph): graph is GraphInfo => graph !== undefined)
		.reverse();
});

/** The stack entry for the source being edited - how it was drawn, and the style it drew. */
const edited = $derived(composed.bases.find((entry) => entry.name === editedName));

/**
 * The style to hand MapLibre, or `null` before the server has answered.
 *
 * **One owner, and it composes rather than chooses.** It used to choose: a styled recipe won, and
 * the background was what an *unstyled* pipeline sat on. That rule was written when the composed
 * style was null for anything that was not Shortbread - which S6.2 ended by deriving a style for
 * those instead, leaving the background unreachable however it was set. It is the bottom entry of
 * the stack now (S6.5), which is where a basemap belonged all along.
 *
 * The default is what an empty window draws: a ground, so the map is a map before anything is open.
 *
 * **Derived rather than computed on read**, because `MapCanvas` compares styles by reference to
 * decide whether to apply one. `defaultStyle` builds a fresh object every call, so a getter would
 * hand out a different style to every reader - and the markup reads this twice, once to decide
 * whether to mount the map and once to give it the style. That is a full `setStyle` per render.
 */
const mapStyle = $derived(serverUrl === null ? null : (composed.style ?? defaultStyle(serverUrl)));

export const composition = {
	/** Reads the server's base URL. Called once, at startup. */
	async load(): Promise<void> {
		try {
			serverUrl = await serverBaseUrl();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Keeps the background map in step with what was chosen. Returns its teardown.
	 *
	 * An effect rather than a derivation, because building one is asynchronous - see [`background`].
	 */
	follow(): void {
		$effect(() => {
			const chosen = layout.background;
			const url = serverUrl;
			if (!url) return;
			let current = true;
			void (async () => {
				try {
					const next = chosen === 'none' ? null : await buildBackground(chosen, url);
					// A newer choice already resolved, and its answer is the one on the map.
					if (current) background = next;
				} catch (error) {
					if (current) background = null;
					status.fail(error);
				}
			})();
			return () => (current = false);
		});
	},

	get serverUrl(): string | null {
		return serverUrl;
	},

	/** The style to hand MapLibre, or `null` before the server has answered - see [`mapStyle`]. */
	get style(): StyleSpecification | null {
		return mapStyle;
	},

	/** Every drawn layer in paint order, which is what the Layers pane lists. */
	get rows(): (typeof composed)['rows'] {
		return composed.rows;
	},

	/** What each source is, by name - see [`sources`]. */
	get sources(): typeof sources {
		return sources;
	},

	/** The graphs in draw order, top first - see [`stacked`]. */
	get stacked(): GraphInfo[] {
		return stacked;
	},

	/** The name of the graph on screen, which the style and the stack both file it under. */
	get editedName(): string | null {
		return editedName;
	},

	/** The stack entry for the graph on screen, or `undefined` when it draws nothing. */
	get edited(): (typeof composed)['bases'][number] | undefined {
		return edited;
	},

	/**
	 * Whether the graph on screen has its own tiles drawn by a style.
	 *
	 * **Not "is there a style at all".** The hairlines exist to show pipeline output that nothing
	 * else draws, and a background map produces a style without drawing any of it - so asking the
	 * wrong question hides the one thing being edited the moment a basemap is switched on.
	 */
	get drawn(): boolean {
		return drawsOwnTiles(composed, editedName);
	},

	/**
	 * The source the tile grid follows: the one the selected graph drew.
	 *
	 * Its own style rather than the composed stack, because the stack renames the source key when
	 * more than one thing draws, and the *type* and tile size are what decide the level ([Q51]).
	 */
	get gridSource(): { type: string; tileSize?: number } | null {
		const style = edited?.style;
		if (!style) return null;
		const [key] = Object.keys(style.sources);
		return (style.sources[key] ?? null) as { type: string; tileSize?: number } | null;
	},

	/** The `style.json` a project writes beside its manifest, or `null` when nothing draws. */
	text(): string | null {
		return composed.style ? JSON.stringify(forExport(composed.style), null, '\t') : null;
	}
};
