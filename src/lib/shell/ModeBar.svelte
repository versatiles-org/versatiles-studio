<script lang="ts">
	// **Map · Assets** ([Q22], G7, S4.1).
	//
	// Not four modes. Explore, Pipeline, Style and Publish were merged into one surface because the
	// work moves between them constantly; what is left is the difference between working with the
	// map and going somewhere else to fetch something you will bring back to it.
	//
	// It arrives now and not earlier for the reason Q22 gives: with one occupant it would be chrome
	// that switches between nothing and itself. Font families are its second.

	let { mode, onChange }: { mode: string; onChange: (mode: string) => void } = $props();

	// **`Map`, not `Map mode`.** The bar is already understood as modes, so the word is redundant —
	// and the label reads against its sibling: the map is the thing being made, assets are what it
	// consumes.
	const MODES = [
		{ id: 'map', label: 'Map' },
		{ id: 'assets', label: 'Assets' }
	];
</script>

<nav class="bar" aria-label="Mode">
	{#each MODES as entry (entry.id)}
		<button
			type="button"
			class="mode"
			class:on={mode === entry.id}
			aria-current={mode === entry.id ? 'page' : undefined}
			onclick={() => onChange(entry.id)}
		>
			{entry.label}
		</button>
	{/each}
</nav>

<style>
	.bar {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--rule);
		background: var(--chrome);
	}

	.mode {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		color: var(--ink-2);
		font-size: var(--text-sm);

		&:hover {
			color: var(--ink);
		}

		/* The current mode carries the surface it opens onto, so the bar reads as a set of tabs over
		   one window rather than as a row of buttons. */
		&.on {
			background: var(--surface);
			color: var(--ink);
		}
	}
</style>
