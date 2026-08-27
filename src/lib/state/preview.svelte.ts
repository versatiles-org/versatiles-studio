/**
 * Keeping the map showing what the pipeline produces (M4, C3, [Q32]).
 *
 * This is the rule that connects two things which otherwise do not know about each other: the
 * document being edited, and the tiles on screen. It lived in `App.svelte` as four functions two
 * hundred lines apart, and the rules below were enforced by the order of statements inside them -
 * true, but not visible from any one call site, and not testable at all.
 *
 * Three of those rules are the reason this is a module:
 *
 * * **The old layer comes off before the new name goes on.** Taking a mount off the map needs the
 *   name it went on under, and there is only ever one such name; overwriting it first leaks a layer
 *   that nothing can remove afterwards.
 * * **A superseded build touches nothing.** Editing again cancels the build that is now out of
 *   date, and the cancelled one must not write its result over the newer one on its way out.
 * * **An invalid document is not built at all**, and still has to quiet the status bar - nothing
 *   downstream will clear the "Opening …" the caller set.
 *
 * **What this does not own: the map, or the status bar.** The map is created by `MapCanvas` and
 * bound by `App`, so it arrives as an argument. The bar is told what happened rather than written
 * to, because "what the preview did" and "what the application is saying" are different questions -
 * and a function that returns its outcome can be tested, where one that sets a status cannot.
 *
 * [Q32]: ../../../docs/decisions.md
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import { addContainerToMap, fitToBounds, removeContainerFromMap } from '../map/add-source';
import { whyNotRenderable } from '../map/tile-format';
import { walk } from '../vpl/node-at';
import { mountGraph, openContainer, type DocumentView, type OpenedContainer, type Preview } from '../ipc/commands';

/** What a refresh did, for the caller to say in the status bar. */
export type Refreshed =
	/** On the map. The bar can go quiet. */
	| { kind: 'shown' }
	/**
	 * There was nothing to build on - no map yet, or no graph. Nothing happened, so nothing is
	 * said: this is the reload case, where the document is back from the core before the map
	 * exists, and whatever the bar is reporting is still in progress.
	 */
	| { kind: 'unavailable' }
	/** There was a graph, and it was not built. The bar should stop claiming to be working on it. */
	| { kind: 'nothing' }
	/** A newer build owns the map. Leave the bar alone: that build is still working. */
	| { kind: 'superseded' }
	/** Built, but the map cannot draw this format. */
	| { kind: 'unrenderable'; message: string };

/** What a refresh needs to know that this module does not own. */
export interface Context {
	map: MaplibreMap | undefined;
	pipeline: DocumentView | null;
	/**
	 * Whether a style recipe is drawing these tiles - asked as a function, not passed as a value.
	 *
	 * It depends on the preview this call is about to produce, so the answer before the build is the
	 * previous preview's and would put hairlines over a styled map every other refresh.
	 */
	styled: () => boolean;
	/**
	 * Whether this window already knows where it is looking.
	 *
	 * True when the core handed back a camera for this project - which is what a *reloaded* window
	 * gets and a new one does not ([Q48](../../../docs/decisions.md), S7.4). Framing the data over
	 * the top of it would undo the one thing a reload is supposed to preserve.
	 */
	restored: boolean;
}

/** The opened containers, each with the read node it corresponds to (Q22). */
let containers = $state<OpenedContainer[]>([]);

/** The last preview that was built, so a style swap can restore it without rebuilding. */
let last = $state<Preview | null>(null);

/**
 * Every graph built this session, by name ([S6.5](../../../docs/history.md)).
 *
 * **What the stack is drawn from.** A style names several sources now, so the map needs every
 * graph's tiles and not only the one being edited. Built once - [`mountAll`] does it when a project
 * opens, where a person already expects to wait - and refreshed one at a time afterwards, so typing
 * costs exactly what it costs today rather than a job per graph per keystroke.
 */
let built = $state<Record<string, Preview>>({});

/**
 * The mount whose layers *this module* put on the map, or `null` when it has none there.
 *
 * Kept rather than derived, because taking a layer off again needs the name it went on under, and
 * by the time it has to come off the graph may have been renamed or switched off ([Q32]).
 *
 * **Only ever set once the layers are actually on.** It used to be set as soon as a build succeeded,
 * hairlines drawn or not - so a styled map, which draws its own layers and gets no hairlines, left
 * this pointing at a source the *recipe* owns. The next refresh then tried to remove that source,
 * which MapLibre refuses while the recipe's layers are drawing from it, once per save.
 */
let mountedName = $state<string | null>(null);

/**
 * Whether tiles are on screen, which is not the same question as the one above.
 *
 * The camera's rule ("frame the data when it first appears, and never again") is about what a person
 * can see, so a styled preview counts even though this module drew none of it. Reading `mountedName`
 * for it would refit the map the moment a style was switched off.
 */
let showing = $state(false);

/** The vector layers a preview's tiles actually contain, for deciding whether a preset can draw. */
export function layersIn(preview: Preview | null | undefined): string[] {
	return ((preview?.info.tileJson?.vector_layers ?? []) as { id?: string }[])
		.map((layer) => layer.id)
		.filter((id): id is string => typeof id === 'string');
}

/** The layers the mounted tiles actually contain, for deciding whether a preset can draw them. */

/**
 * Opens a container and remembers it.
 *
 * Does not put it on the map - the map shows what the *pipeline* produces (C3), and a container is
 * only ever an input to that.
 */
async function mount(source: string): Promise<OpenedContainer> {
	const result = await openContainer(source);
	containers = [...containers.filter((c) => c.info.source !== result.info.source), result];
	return result;
}

export const preview = {
	get containers(): OpenedContainer[] {
		return containers;
	},

	get last(): Preview | null {
		return last;
	},

	/** Every graph built this session, by name - the stack a style is composed over (S6.5). */
	get built(): Record<string, Preview> {
		return built;
	},

	/**
	 * Builds every graph that has not been built yet.
	 *
	 * **Called when a project opens, not on every refresh.** Building all of them each time the text
	 * changed would be a job apiece for tiles nobody is editing, which is the cost
	 * `refresh` deliberately avoided before anything drew more than one source.
	 *
	 * Failures are per graph and silent here: one graph that will not build must not stop the others
	 * arriving, and the one being edited reports its own problems through `refresh`.
	 */
	async mountAll(ids: number[]): Promise<void> {
		const results = await Promise.all(ids.map((id) => mountGraph(id).catch(() => null)));
		const next = { ...built };
		for (const result of results) {
			if (result) next[result.name] = result;
		}
		built = next;
	},

	/**
	 * Rebuilds one graph, whatever it now produces ([Q49]).
	 *
	 * For a change to *what a graph is* rather than to which graph is on screen: switching a node
	 * off changes the tiles served under that graph's name, and the stack has to follow even when
	 * the graph is not the one being edited. `null` back means it has nothing to serve any more, so
	 * its entry goes.
	 */
	async rebuild(id: number): Promise<void> {
		const result = await mountGraph(id).catch(() => null);
		if (result) built = { ...built, [result.name]: result };
	},

	/** Forgets a graph's tiles - for one that has been removed, or switched off. */
	forget(name: string): void {
		if (!(name in built)) return;
		const next = { ...built };
		delete next[name];
		built = next;
	},

	/** Opens a container and remembers it. See `mount`. */
	mount,

	/**
	 * Builds what the map should show, and puts it there.
	 *
	 * This is what "instantly see the result" means (M4): changing the pipeline changes the tiles
	 * rather than a number in a form. **Which** pipeline is the eyes' to say ([Q49]): the core
	 * builds the graph's effective document, so what arrives here is the pipeline whose nodes are
	 * switched on - under the graph's own name, like any other graph in the stack.
	 */
	async refresh({ map, pipeline, styled, restored }: Context): Promise<Refreshed> {
		if (!map || !pipeline) return { kind: 'unavailable' };

		// **A document that does not validate is not built.** `＋ operation…` inserts a node with its
		// required parameters unset by design - [Q33] decided that "required" is said by the field
		// being present and empty - so an invalid document is the ordinary state one second after
		// adding an operation, not an exceptional one. Building it anyway replaced a diagnostic that
		// names the node and the missing parameter with whatever the builder happened to say on its
		// way out, in the status bar, where it is furthest from the field that needs filling in.
		//
		// The map keeps what it last drew, which is what already happens while the text does not
		// parse. What the user is meant to look at is the empty field in the node they just added.
		if (pipeline.diagnostics.length > 0) return { kind: 'nothing' };

		// The build is a job in the runner's `latest` lane, so **editing again stops the build that
		// is now out of date** rather than leaving it to finish. That also removes the token this
		// used to carry: which preview is current is the runner's to know, and a second answer to
		// that question in here could only ever disagree with it.
		//
		// [Q32] wants every graph mounted so a style can name them all. That arrives with the style
		// at S4 - until something renders them, building every graph on every refresh is a job
		// apiece for tiles nobody draws. Half of it falls out already: a mount is keyed by name and
		// nothing unmounts on a graph switch, so each graph visited stays served until it is removed.
		const result = await mountGraph(pipeline.graph);

		// Either a newer build of this graph owns the map already, or the graph has nothing to
		// serve - it is switched off, or switched off down to nothing. Neither is a reason to take
		// what is on the map off it: `forget` is what does that, when the eye says so.
		if (!result) return { kind: 'nothing' };

		// **Whether anything was already drawn, read before it is cleared.** It decides the camera
		// below, and two lines from now the answer is gone.
		const wasShowing = showing;

		// Off the map before the name is overwritten - afterwards there is nothing left to remove it
		// with, and the layer stays on the map for the rest of the session.
		if (mountedName) removeContainerFromMap(map, mountedName);
		mountedName = null;

		last = result;
		// The edited graph's entry in the stack follows what was just built, so the map shows the
		// edit rather than what this graph looked like when the project opened.
		built = { ...built, [result.name]: result };
		showing = true;

		// **The camera moves when tiles first appear, and never again on its own.** Every edit to
		// the VPL rebuilds the preview, so refitting here would drag the map back to the data's
		// extent on every keystroke that parses - panning somewhere to look at a change and being
		// thrown out of it. Framing the data again is a deliberate act with a button of its own.
		//
		// **Before the question of who draws the tiles**, which this used to sit after. Framing is
		// not one of the things a recipe takes over: whether the map is drawn by a style or by the
		// hairlines below, the first sight of data is the moment to look at it. Sitting below the
		// early return meant a window opened at null island and stayed there - and since S6.2
		// derives a style for very nearly everything, that was almost every window. "Reset view"
		// worked, which is what made it look like a missing gesture rather than a missing camera.
		//
		// **And not over a camera the window already has.** A reloaded window comes back to where it
		// was looking; a new one has nothing to come back to, so the data decides.
		if (!wasShowing && !restored && result.info.bbox) fitToBounds(map, result.info.bbox);

		// The hairlines are what a *styled* map does not need: when the recipe renders these tiles,
		// its own layers draw them and a line over the top would be a second opinion (S4.3). Asked
		// after the build, because the answer is about the preview the build just produced.
		//
		// Nothing is mounted in that case - the recipe's own source and layers are, and they are not
		// this module's to take off again.
		if (styled()) return { kind: 'shown' };

		// A format the map cannot draw is a thing to say, not a blank map with errors in the console
		// - which is what it used to be.
		if (!addContainerToMap(map, result)) {
			return { kind: 'unrenderable', message: whyNotRenderable(result.info.tileFormat) };
		}

		mountedName = result.name;
		return { kind: 'shown' };
	},

	/**
	 * Makes the containers match what the pipeline reads.
	 *
	 * The read nodes are the sources (Q22), so editing one - pointing `filename` somewhere else, or
	 * deleting a node - has to move the map with it. Without this the document and the picture drift
	 * apart, which is the one thing merging the modes was meant to prevent.
	 *
	 * `onOpening` is called before each container that has to be read, which is not always instant:
	 * a remote one reads its index over the network.
	 */
	async syncContainers(pipeline: DocumentView, onOpening: (source: string) => void): Promise<void> {
		// A plain Set, not `SvelteSet`: this is a local working set inside one call, never held in
		// `$state` and never read reactively, so there is nothing for a reactive wrapper to do.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const wanted = new Set<string>();
		for (const { node } of walk(pipeline.pipeline)) {
			if (node.name !== 'from_container') continue;
			const property = node.properties.find((p) => p.key === 'filename');
			if (property?.value.kind === 'single' && property.value.value) wanted.add(property.value.value);
		}

		containers = containers.filter((c) => wanted.has(c.info.source));

		for (const source of wanted) {
			if (containers.some((c) => c.info.source === source)) continue;
			onOpening(source);
			await mount(source);
		}
	},

	/**
	 * Puts the preview back after a style swap, which discards every layer added to the old style.
	 *
	 * Not the hairlines when the recipe is drawing these tiles: they are the fallback for a preset
	 * that matches nothing, and adding them over a styled map would put a line over every feature
	 * the style just drew.
	 */
	restore(map: MaplibreMap | undefined, styled: boolean): void {
		// Whatever was mounted went with the old style, so it is no longer this module's to remove -
		// and the new style may well own a source of that same name.
		mountedName = null;
		if (map && last && !styled && addContainerToMap(map, last)) mountedName = last.name;
	},

	/**
	 * Takes the preview off the map and forgets it.
	 *
	 * For the case `refresh` cannot cover: with no graph left it returns early, so the layer it drew
	 * would outlive the document it came from - a map still showing tiles from a graph that is gone.
	 */
	clear(map: MaplibreMap | undefined): void {
		if (mountedName && map) removeContainerFromMap(map, mountedName);
		mountedName = null;
		showing = false;
	},

	/**
	 * Test seam: the module is a singleton, and state from one case must not reach the next.
	 *
	 * **Every field, or the seam lies.** `built` was added with the source stack (S6.5) and not added
	 * here, so graphs mounted by one case were still in the stack for the next - which a test only
	 * notices if it happens to assert on the whole of it.
	 */
	reset(): void {
		containers = [];
		last = null;
		mountedName = null;
		showing = false;
		built = {};
	}
};
