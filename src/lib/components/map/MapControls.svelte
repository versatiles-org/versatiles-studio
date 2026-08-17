<script lang="ts">
	import { BACKGROUNDS, type BackgroundId } from '../../map/background';

	// The controls that act on the map rather than on the pipeline.
	//
	// Gathered into one cluster because they had started to accumulate as loose buttons in the
	// corner: what belongs here is anything about *looking* at the result, and nothing about what
	// the result is — that is the left pane's business.
	let {
		background,
		showGrid,
		canReset,
		onBackground,
		onToggleGrid,
		onReset
	}: {
		background: BackgroundId;
		showGrid: boolean;
		/** False when there is nothing open, so there is no extent to return to. */
		canReset: boolean;
		onBackground: (id: BackgroundId) => void;
		onToggleGrid: () => void;
		onReset: () => void;
	} = $props();

	/** Grouped so light and dark options are not shuffled together. */
	const groups = $derived([
		{ label: '', items: BACKGROUNDS.filter((b) => b.group === 'off') },
		{ label: 'Light', items: BACKGROUNDS.filter((b) => b.group === 'light') },
		{ label: 'Dark', items: BACKGROUNDS.filter((b) => b.group === 'dark') },
		{ label: 'Imagery', items: BACKGROUNDS.filter((b) => b.group === 'imagery') }
	]);
</script>

<div class="controls">
	<label class="picker">
		<span class="visually-hidden">Background map</span>
		<select
			value={background}
			title="Background map — the only part of Studio that fetches from the network"
			onchange={(event) => onBackground(event.currentTarget.value as BackgroundId)}
		>
			{#each groups as group (group.label)}
				{#if group.label}
					<optgroup label={group.label}>
						{#each group.items as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
					</optgroup>
				{:else}
					{#each group.items as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
				{/if}
			{/each}
		</select>
	</label>

	<button type="button" class:on={showGrid} onclick={onToggleGrid} title="Show the z/x/y tile grid (A5)">
		z/x/y grid
	</button>

	<button type="button" disabled={!canReset} onclick={onReset} title="Fit the map to what is open"> Reset view </button>
</div>

<style>
	.controls {
		position: absolute;
		right: var(--space-4);
		bottom: var(--space-4);
		z-index: 4;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		/* Wraps rather than running under the attribution on a narrow window. */
		flex-wrap: wrap;
		justify-content: flex-end;
		max-width: calc(100% - var(--space-5));
	}
	button,
	select {
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	button:disabled {
		opacity: 0.5;
	}
	.picker {
		display: block;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
