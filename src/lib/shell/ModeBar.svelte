<script lang="ts">
	// **Map · Assets** ([Q22], G7, S4.1).
	//
	// Not four modes. Explore, Pipeline, Style and Publish were merged into one surface because the
	// work moves between them constantly; what is left is the difference between working with the
	// map and going somewhere else to fetch something you will bring back to it.
	//
	// It arrives now and not earlier for the reason Q22 gives: with one occupant it would be chrome
	// that switches between nothing and itself. Font families are its second.

	let {
		mode,
		onChange,
		onOpenProject,
		onSaveProject,
		onDeploy,
		canDeploy
	}: {
		mode: string;
		onChange: (mode: string) => void;
		/** Opening and saving a *project* (G1, S5.1) — app-level work, so it sits on the app-level
		 *  bar rather than in a pane, which under [Q31] owns only what it emits. Native menus
		 *  (S0.1) are where these belong eventually. */
		onOpenProject: () => void;
		onSaveProject: () => void;
		/** The commands that reproduce this project outside Studio (C7, S5.5). Beside the project
		 *  actions because it is about the project rather than about one graph — a serve config
		 *  names every graph at once, which no pane is in a position to emit. */
		onDeploy: () => void;
		/** False with nothing open: all four artefacts would name no tiles. */
		canDeploy: boolean;
	} = $props();

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

	<span class="spacer"></span>
	<button type="button" class="project" onclick={onOpenProject}>Open project…</button>
	<button type="button" class="project" onclick={onSaveProject}>Save project…</button>
	<button type="button" class="project" onclick={onDeploy} disabled={!canDeploy}>Run elsewhere…</button>
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

	.spacer {
		flex: 1;
	}

	.project {
		padding: var(--space-1) var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);

		&:hover {
			color: var(--ink);
		}

		&:disabled {
			opacity: 0.4;
		}
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
