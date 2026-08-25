<script lang="ts">
	import UpdateNotice from './UpdateNotice.svelte';

	// The application's own bar: what is about *Studio* or *the project*, rather than about one
	// pane's output ([Q31]).
	//
	// **It was the mode bar** ([Q22], S4.1) — Map · Assets — until [Q39] made the asset manager a
	// dialog. That left one mode, which is the state Q22 itself called chrome that switches between
	// nothing and itself, so the tabs went and the errand became a button among the others.
	//
	// **And it is now nearly empty**, because opening and saving a project went to the native menu
	// where they belong (S0.1) — which is what this file's own comment said should happen. What is
	// left is the two that are not plain commands: an errand, and a status line. Both have a home
	// coming, and this strip goes with them.

	let {
		onOpenAssets
	}: {
		/** Fonts to install (G7, S4.1) — an errand you leave the window for and come back from, which
		 *  is what a dialog is. */
		onOpenAssets: () => void;
	} = $props();
</script>

<nav class="bar" aria-label="Application">
	<span class="spacer"></span>
	<!-- Left of the project actions, and quiet until it has something to say (G4, S5.8). -->
	<UpdateNotice />
	<span class="divider" aria-hidden="true"></span>
	<button type="button" class="project" onclick={onOpenAssets}>Fonts…</button>
</nav>

<style>
	.bar {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		/* Room on the right for the alpha ribbon, which crosses this corner and is not part of the
		   flow. Without it the last button sits under the band. */
		padding: var(--space-1) 5rem var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--rule);
		background: var(--chrome);
	}

	.spacer {
		flex: 1;
	}

	.divider {
		width: 1px;
		align-self: stretch;
		margin: 0 var(--space-1);
		background: var(--rule);
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
</style>
