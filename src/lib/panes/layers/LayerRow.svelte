<script lang="ts">
	import type { LayerSpecification } from 'maplibre-gl';
	import type { LayerOverride } from '../../ipc/commands';
	import { colourKey, colourOf, isExpression } from './paint';
	import { filterOf, format, isOverridden, parse } from './filter';

	// One layer, with everything that can be said about it in a row (D3).
	//
	// **Split out of the old `LayerTree.svelte`** when the tree became project-wide. The row is the
	// half that did not change: an eye, a swatch, a zoom range and a filter belong to a layer, and a
	// layer does not care whether the tree above it lists one source or four.
	//
	// **It writes through its source, not through the focused one.** The tree now shows every
	// source's layers at once, so which recipe an edit lands in is a property of the row rather than
	// of the pane - which is the bug [Q51] describes, in the place it would come back.
	let {
		id,
		type,
		spec = undefined,
		override = {},
		hiddenBy = null,
		onOverride
	}: {
		/** The layer's id in its own source's style, which is what an override is keyed on. */
		id: string;
		type: string;
		/** The layer as its own style has it, for reading what the override is changing. */
		spec?: LayerSpecification;
		override?: LayerOverride;
		/** The path of the closed eye above this layer, if there is one. */
		hiddenBy?: string | null;
		onOverride: (id: string, patch: LayerOverride) => void;
	} = $props();

	const visible = $derived(override.visible !== false && hiddenBy === null);
	const touched = $derived(Object.keys(override).length > 0);
	const colour = $derived(spec ? colourOf(spec, override.paint) : null);

	function setVisible(next: boolean) {
		// `undefined` rather than `true`: a layer visible because the style says so and one visible
		// because someone said so are the same layer, and storing the second leaves a mark on a layer
		// nobody changed.
		onOverride(id, { ...override, visible: next ? undefined : false });
	}

	function setColour(value: string) {
		const key = spec && colourKey(spec.type);
		if (!key) return;
		onOverride(id, { ...override, paint: { ...((override.paint as object) ?? {}), [key]: value } });
	}

	function setZoom(edge: 'minZoom' | 'maxZoom', raw: string) {
		const value = raw === '' ? undefined : Number(raw);
		if (value !== undefined && !Number.isFinite(value)) return;
		onOverride(id, { ...override, [edge]: value });
	}

	/// Whether the filter editor is open. One at a time is the pane's business, so it says so.
	let editing = $state(false);
	/// What is in the box, which is not the filter until it parses.
	let draft = $state('');
	/// What the box held when it opened, so opening one is not itself an edit.
	let loaded = $state('');
	let settled = $state(true);

	function toggleFilter() {
		if (editing) {
			// Commit before collapsing. The pause that batches typing is only 400 ms, but closing
			// inside it would drop the edit without saying so.
			commit();
			editing = false;
			return;
		}
		const current = filterOf(spec, override);
		draft = loaded = current === null ? '' : format(current);
		settled = true;
		editing = true;
	}

	const parsed = $derived(parse(draft));

	function commit() {
		if (draft === loaded) return;
		const result = parse(draft);
		if (!result.ok) return; // the box already says why, and the map keeps what worked
		loaded = draft;
		onOverride(id, { ...override, filter: result.filter ?? undefined });
		settled = true;
	}

	/// Applies the filter, live, once typing pauses.
	///
	/// **Live, because a filter is guesswork about data you cannot see** and the map is the only
	/// thing that answers it. **After a pause, because every commit is an undo entry** ([Q36]):
	/// changing `"river"` to `"stream"` keeps the JSON valid at every keystroke, so applying on each
	/// one would put a dozen steps on the stack for one edit.
	$effect(() => {
		const text = draft;
		if (!editing || text === loaded) return;
		settled = false;
		const timer = setTimeout(commit, 400);
		return () => clearTimeout(timer);
	});

	function clearFilter() {
		draft = loaded = '';
		settled = true;
		onOverride(id, { ...override, filter: undefined });
	}
</script>

<div class="layer" class:hidden={!visible}>
	<button
		type="button"
		class="eye"
		disabled={hiddenBy !== null}
		title={hiddenBy !== null ? `Hidden by the eye on ${hiddenBy}` : visible ? 'Hide this layer' : 'Show this layer'}
		aria-pressed={visible}
		aria-label={visible ? `Hide ${id}` : `Show ${id}`}
		onclick={() => setVisible(!visible)}
	>
		{visible ? '◉' : '○'}
	</button>

	{#if colour !== null}
		<input
			type="color"
			class="swatch"
			value={colour}
			title="Colour of {id}"
			aria-label="Colour of {id}"
			oninput={(event) => setColour(event.currentTarget.value)}
		/>
	{:else if spec && isExpression(spec, override.paint)}
		<!-- An expression is a real value this cannot show as one swatch, and saying so is better than
		     a colour picker that would delete it ([Q37]). -->
		<span class="swatch none" title="This colour is an expression">ƒ</span>
	{:else}
		<span class="swatch none" title="{type} layers have no colour of their own">·</span>
	{/if}

	<span class="name truncate" title="{id} - {type}">{id}</span>

	<label class="zoom">
		<span class="visually-hidden">Lowest zoom for {id}</span>
		<input
			type="number"
			min="0"
			max="30"
			placeholder="-"
			value={override.minZoom ?? ''}
			onchange={(event) => setZoom('minZoom', event.currentTarget.value)}
		/>
	</label>
	<label class="zoom">
		<span class="visually-hidden">Highest zoom for {id}</span>
		<input
			type="number"
			min="0"
			max="30"
			placeholder="-"
			value={override.maxZoom ?? ''}
			onchange={(event) => setZoom('maxZoom', event.currentTarget.value)}
		/>
	</label>

	<button
		type="button"
		class="funnel"
		class:set={isOverridden(override)}
		class:open={editing}
		title={filterOf(spec, override) === null
			? 'This layer has no filter - add one'
			: 'Edit which features this layer draws'}
		aria-expanded={editing}
		aria-label="Filter for {id}"
		onclick={toggleFilter}
	>
		{editing ? '▾' : '▸'}
	</button>

	{#if touched}
		<button type="button" class="reset" title="Undo the changes to this layer" onclick={() => onOverride(id, {})}>
			reset
		</button>
	{/if}
</div>

{#if editing}
	<!-- Under the row it belongs to, not in a modal: a filter is guesswork about data you cannot see,
	     so the map has to stay visible while it is typed. -->
	<div class="editor">
		<textarea
			class="expression"
			rows="5"
			spellcheck="false"
			aria-label="Filter expression for {id}"
			aria-invalid={!parsed.ok}
			bind:value={draft}></textarea>

		<p class="verdict" aria-live="polite">
			{#if !parsed.ok}
				<span class="problem">{parsed.problem}</span>
			{:else if !settled}
				<span class="waiting">applying…</span>
			{:else}
				<span class="applied">on the map</span>
			{/if}
			{#if isOverridden(override)}
				<button type="button" class="reset" onclick={clearFilter}>use the style’s own</button>
			{/if}
		</p>
	</div>
{/if}

<style>
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
</style>
