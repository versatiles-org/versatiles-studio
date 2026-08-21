<script lang="ts">
	import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
	import { style } from '../../state/style.svelte';
	import type { LayerOverride } from '../../ipc/commands';
	import { colourKey, colourOf, grouped, isExpression, matching, rows } from './layer-tree';

	// The layers of the style that is on the map (S4.5, D3).
	//
	// **The rendered style, not the recipe.** The recipe holds a preset and a handful of changes;
	// what a person wants to look at is the layers those produce — `colorful` is 324 of them, and
	// none is named in the recipe until someone changes it.
	//
	// So this is a view of the output with the overrides applied on top, and every edit goes back
	// into the recipe as one ([Q36]). Editing the output directly would mean holding 324 layers in
	// the core to change three of them.

	let { rendered }: { rendered: StyleSpecification | null } = $props();

	let query = $state('');

	const all = $derived(rows(rendered));
	const groups = $derived(grouped(matching(all, query)));
	const overrides = $derived(style.current?.overrides ?? {});

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
	}

	/// Narrows the zooms a layer is drawn at.
	///
	/// Empty means "as the style says", which is not the same as 0 or 30 — a layer the style draws
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
						     better than a colour picker that would delete it. The editor is S4.5's own
						     remaining half. -->
						<span class="swatch none" title="This colour is an expression">ƒ</span>
					{:else}
						<span class="swatch none" title="{layer.type} layers have no colour of their own">·</span>
					{/if}

					<span class="name truncate" title="{layer.id} — {layer.type}">{layer.id}</span>

					<label class="zoom">
						<span class="visually-hidden">Lowest zoom for {layer.id}</span>
						<input
							type="number"
							min="0"
							max="30"
							placeholder="–"
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
							placeholder="–"
							value={overrideOf(layer.id).maxZoom ?? ''}
							onchange={(event) => setZoom(layer.id, 'maxZoom', event.currentTarget.value)}
						/>
					</label>

					{#if touched(layer.id)}
						<button type="button" class="reset" title="Undo the changes to this layer" onclick={() => reset(layer.id)}>
							reset
						</button>
					{/if}
				</div>
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

		/* Narrow on purpose: two zooms are two characters each, and a row that gave them room would
		   leave none for the name. */
		.zoom input {
			width: 2.4rem;
			padding: 0 var(--space-1);
			font-size: var(--text-xs);
			text-align: center;
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
