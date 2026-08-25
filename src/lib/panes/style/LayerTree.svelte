<script lang="ts">
	import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
	import { style } from '../../state/style.svelte';
	import type { LayerOverride } from '../../ipc/commands';
	import { colourKey, colourOf, grouped, isExpression, matching, rows } from './layer-tree';
	import { filterOf, format, isOverridden, parse } from './filter';

	// The layers of the style that is on the map (S4.5, D3).
	//
	// **The rendered style, not the recipe.** The recipe holds a preset and a handful of changes;
	// what a person wants to look at is the layers those produce - `colorful` is 324 of them, and
	// none is named in the recipe until someone changes it.
	//
	// So this is a view of the output with the overrides applied on top, and every edit goes back
	// into the recipe as one ([Q36]). Editing the output directly would mean holding 324 layers in
	// the core to change three of them.

	let { rendered }: { rendered: StyleSpecification | null } = $props();

	let query = $state('');

	const all = $derived(rows(rendered));
	const groups = $derived(grouped(matching(all, query)));
	const appearance = $derived(style.source.appearance);
	const overrides = $derived(appearance.type === 'vector' ? appearance.overrides : {});

	const spec = (id: string): LayerSpecification | undefined => rendered?.layers.find((layer) => layer.id === id);

	/// A layer's override as it stands, so an edit adds to it rather than replacing it.
	const overrideOf = (id: string): LayerOverride => (overrides[id] ?? {}) as LayerOverride;

	function setVisible(id: string, visible: boolean) {
		// `undefined` rather than `true`: a layer that is visible because the style says so and one
		// visible because someone said so are the same layer, and storing the second leaves a mark on
		// a layer nobody changed. `Recipe::set_override` drops an override that says nothing.
		void style.setLayer(id, { ...overrideOf(id), visible: visible ? undefined : false });
	}

	function setColour(id: string, colour: string) {
		const layer = spec(id);
		const key = layer && colourKey(layer.type);
		if (!key) return;
		const patch = overrideOf(id);
		void style.setLayer(id, { ...patch, paint: { ...((patch.paint as object) ?? {}), [key]: colour } });
	}

	function reset(id: string) {
		void style.setLayer(id, {});
		if (editing === id) editing = null;
	}

	/// Which layer's filter is open. One at a time: the point of editing a filter is watching the
	/// map change, and a column of open editors leaves no map to watch.
	let editing = $state<string | null>(null);
	/// What is in the box, which is not the filter until it parses.
	let draft = $state('');
	/// What the box held when it opened, so opening one is not itself an edit.
	let loaded = $state('');
	/// Whether what is in the box is what the map is drawing. False while a pause is still running.
	let settled = $state(true);

	function openFilter(id: string) {
		if (editing === id) {
			// Commit before collapsing. The pause that batches typing is only 400 ms, but closing
			// inside it would drop the edit without saying so - and a silently discarded change is
			// worse than an extra undo entry.
			commit(id);
			editing = null;
			return;
		}
		editing = id;
		const current = filterOf(spec(id), overrideOf(id));
		draft = loaded = current === null ? '' : format(current);
		settled = true;
	}

	/// What the box says about what is in it, recomputed as it is typed.
	const parsed = $derived(parse(draft));

	/// Writes the draft, if it is one. Does nothing when it has not changed or does not parse.
	function commit(id: string) {
		if (draft === loaded) return;
		const result = parse(draft);
		if (!result.ok) return; // the box already says why, and the map keeps what worked
		loaded = draft;
		void style.setLayer(id, { ...overrideOf(id), filter: result.filter ?? undefined }).then(() => {
			settled = true;
		});
	}

	/// Applies the filter, live, once typing pauses.
	///
	/// **Live, because a filter is guesswork about data you cannot see** and the map is the only
	/// thing that answers it - that is D3's "live preview". An invalid draft changes nothing and
	/// says so; the map keeps the last filter that worked, the same rule the pipeline preview
	/// follows.
	///
	/// **After a pause, because every commit is an undo entry** ([Q36]). Changing `"river"` to
	/// `"stream"` keeps the JSON valid at every keystroke, so applying on each one would put a dozen
	/// steps on the stack for one edit and make ⌘Z useless here. Recolouring hit this first and
	/// answered it with an explicit preview/commit pair; a filter has no gesture to end, so the pause
	/// is what stands in for releasing the mouse. Same 400 ms as the crop's estimate.
	$effect(() => {
		const id = editing;
		const text = draft;
		// Opening an editor fills the box, and that is not an edit - without this, looking at a
		// layer's filter would mark it as changed.
		if (id === null || text === loaded) return;

		settled = false;
		const timer = setTimeout(() => commit(id), 400);
		return () => clearTimeout(timer);
	});

	/// Gives the style's own filter back, leaving the rest of the override alone.
	function clearFilter(id: string) {
		draft = loaded = '';
		settled = true;
		void style.setLayer(id, { ...overrideOf(id), filter: undefined });
	}

	/// Narrows the zooms a layer is drawn at.
	///
	/// Empty means "as the style says", which is not the same as 0 or 30 - a layer the style draws
	/// from z6 and one someone pinned to z0 look identical at z10 and differ everywhere else.
	function setZoom(id: string, edge: 'minZoom' | 'maxZoom', raw: string) {
		const value = raw.trim() === '' ? undefined : Number(raw);
		if (value !== undefined && !Number.isFinite(value)) return;
		void style.setLayer(id, { ...overrideOf(id), [edge]: value });
	}

	const visible = (id: string) => overrideOf(id).visible !== false;
	const touched = (id: string) => Object.keys(overrideOf(id)).length > 0;
</script>

<h2 class="section-label">Layers</h2>

{#if all.length === 0}
	<p class="note">Nothing is being drawn yet.</p>
{:else}
	<input type="text" class="filter" placeholder="Filter layers…" bind:value={query} aria-label="Filter layers" />

	<div class="tree">
		{#each groups as group, index (group.source + String(index))}
			<p class="group">{group.source ?? 'background'}</p>
			{#each group.layers as layer (layer.id)}
				{@const current = spec(layer.id)}
				{@const colour = current ? colourOf(current, overrideOf(layer.id).paint) : null}
				<div class="layer" class:hidden={!visible(layer.id)}>
					<button
						type="button"
						class="eye"
						title={visible(layer.id) ? 'Hide this layer' : 'Show this layer'}
						aria-pressed={visible(layer.id)}
						onclick={() => setVisible(layer.id, !visible(layer.id))}
					>
						{visible(layer.id) ? '◉' : '○'}
					</button>

					{#if colour !== null}
						<input
							type="color"
							class="swatch"
							value={colour}
							title="Colour of {layer.id}"
							aria-label="Colour of {layer.id}"
							oninput={(event) => setColour(layer.id, event.currentTarget.value)}
						/>
					{:else if current && isExpression(current, overrideOf(layer.id).paint)}
						<!-- An expression is a real value this cannot show as one swatch, and saying so is
						     better than a colour picker that would delete it. Not editable, and that is
						     settled rather than pending: nothing Studio can produce puts an expression
						     here ([Q37](../../../../docs/decisions.md)). -->
						<span class="swatch none" title="This colour is an expression">ƒ</span>
					{:else}
						<span class="swatch none" title="{layer.type} layers have no colour of their own">·</span>
					{/if}

					<span class="name truncate" title="{layer.id} - {layer.type}">{layer.id}</span>

					<label class="zoom">
						<span class="visually-hidden">Lowest zoom for {layer.id}</span>
						<input
							type="number"
							min="0"
							max="30"
							placeholder="-"
							value={overrideOf(layer.id).minZoom ?? ''}
							onchange={(event) => setZoom(layer.id, 'minZoom', event.currentTarget.value)}
						/>
					</label>
					<label class="zoom">
						<span class="visually-hidden">Highest zoom for {layer.id}</span>
						<input
							type="number"
							min="0"
							max="30"
							placeholder="-"
							value={overrideOf(layer.id).maxZoom ?? ''}
							onchange={(event) => setZoom(layer.id, 'maxZoom', event.currentTarget.value)}
						/>
					</label>

					<button
						type="button"
						class="funnel"
						class:set={isOverridden(overrideOf(layer.id))}
						class:open={editing === layer.id}
						title={filterOf(spec(layer.id), overrideOf(layer.id)) === null
							? 'This layer has no filter - add one'
							: 'Edit which features this layer draws'}
						aria-expanded={editing === layer.id}
						onclick={() => openFilter(layer.id)}
					>
						{editing === layer.id ? '▾' : '▸'}
					</button>

					{#if touched(layer.id)}
						<button type="button" class="reset" title="Undo the changes to this layer" onclick={() => reset(layer.id)}>
							reset
						</button>
					{/if}
				</div>

				{#if editing === layer.id}
					<!-- Under the row it belongs to, not in a modal: a filter is guesswork about data you
					     cannot see, so the map has to stay visible while it is typed (the same reasoning
					     that moved the crop out of its dialog at S5.2). -->
					<div class="editor">
						<textarea
							class="expression"
							rows="5"
							spellcheck="false"
							aria-label="Filter for {layer.id}"
							aria-invalid={!parsed.ok}
							bind:value={draft}></textarea>

						<p class="verdict" aria-live="polite">
							{#if !parsed.ok}
								<span class="problem">{parsed.problem}</span>
							{:else if draft.trim() === ''}
								No filter - this layer draws everything in {layer.source ?? 'its source'}.
							{:else if settled}
								<span class="fine">This is what the map is drawing.</span>
							{:else}
								Applying…
							{/if}
						</p>

						{#if isOverridden(overrideOf(layer.id))}
							<button type="button" class="reset" onclick={() => clearFilter(layer.id)}>
								back to the style's filter
							</button>
						{/if}
					</div>
				{/if}
			{/each}
		{/each}

		{#if groups.length === 0}
			<p class="note">Nothing matches “{query}”.</p>
		{/if}
	</div>
{/if}

<style>
	.filter {
		width: 100%;
		font-size: var(--text-sm);
	}

	/* Its own scroll: a generated style runs to a few hundred layers, and the pane above it should
	   not have to be scrolled past to reach the preset buttons. */
	.tree {
		max-height: 24rem;
		overflow-y: auto;
		margin-top: var(--space-2);
	}

	.group {
		position: sticky;
		top: 0;
		margin: var(--space-2) 0 var(--space-1);
		background: var(--surface);
		color: var(--ink-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.layer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: 1px 0;

		/* Dimmed rather than removed: a hidden layer is still a layer, and finding it again should
		   not mean clearing the filter. */
		&.hidden .name {
			color: var(--ink-2);
			text-decoration: line-through;
		}

		.name {
			flex: 1;
			min-width: 0;
			font-size: var(--text-xs);
		}

		.eye {
			color: var(--ink-2);
			font-size: var(--text-xs);
		}

		.reset {
			color: var(--accent);
			font-size: var(--text-xs);
		}

		/* A disclosure triangle rather than an `ƒ`: the swatch beside it already means "this value is
		   an expression", and two of those in one row would be two things with one name. Always
		   present, so rows do not shift when a layer gains a filter; quiet until it carries an
		   override of the user's. */
		.funnel {
			color: var(--ink-2);
			font-size: var(--text-xs);
			font-style: italic;

			&.set {
				color: var(--accent);
			}

			&.open {
				color: var(--ink);
			}
		}

		/* Narrow on purpose: two zooms are two characters each, and a row that gave them room would
		   leave none for the name. */
		.zoom input {
			width: 2.4rem;
			padding: 0 var(--space-1);
			font-size: var(--text-xs);
			text-align: center;
		}
	}

	/* Indented under its row, so a tree of 324 layers still reads as a tree with one open. */
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: var(--space-1) 0 var(--space-2) var(--space-4);
		padding-left: var(--space-2);
		border-left: 2px solid var(--rule);

		.expression {
			width: 100%;
			padding: var(--space-1);
			border: 1px solid var(--rule);
			border-radius: var(--radius-sm);
			background: var(--surface);
			color: var(--ink);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			line-height: 1.45;
			resize: vertical;

			&[aria-invalid='true'] {
				border-color: var(--error);
			}
		}

		.verdict {
			margin: 0;
			color: var(--ink-2);
			font-size: var(--text-xs);
			/* Two lines' worth, so the box below does not jump as the message changes length. */
			min-height: 2.4em;
		}

		.problem {
			color: var(--error);
		}

		.fine {
			color: var(--ink-2);
		}

		.reset {
			align-self: flex-start;
			color: var(--accent);
			font-size: var(--text-xs);
		}
	}

	.swatch {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}

	.none {
		display: grid;
		place-items: center;
		border-style: dashed;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
</style>
