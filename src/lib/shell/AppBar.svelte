<script lang="ts">
	import UpdateNotice from './UpdateNotice.svelte';

	// The application's own bar: what is about *Studio* or *the project*, rather than about one
	// pane's output ([Q31]).
	//
	// **It was the mode bar** ([Q22], S4.1) — Map · Assets — until [Q39] made the asset manager a
	// dialog. That left one mode, which is the state Q22 itself called chrome that switches between
	// nothing and itself, so the tabs went and the errand became a button among the others.

	let {
		onOpenAssets,
		onOpenProject,
		onSaveProject,
		onSaveCopy,
		hasProject
	}: {
		/** Fonts to install (G7, S4.1) — an errand you leave the window for and come back from, which
		 *  is what a dialog is. */
		onOpenAssets: () => void;
		/** Opening and saving a *project* (G1, S5.1) — app-level work, so it sits on the app-level
		 *  bar rather than in a pane, which under [Q31] owns only what it emits. Native menus
		 *  (S0.1) are where these belong eventually. */
		onOpenProject: () => void;
		onSaveProject: () => void;
		/** A copy that works on another machine (S5.1) — the data comes with it. */
		onSaveCopy: () => void;
		/** False with nothing open: there is no project to copy. */
		hasProject: boolean;
	} = $props();
</script>

<nav class="bar" aria-label="Application">
	<span class="spacer"></span>
	<!-- Left of the project actions, and quiet until it has something to say (G4, S5.8). -->
	<UpdateNotice />
	<span class="divider" aria-hidden="true"></span>
	<button type="button" class="project" onclick={onOpenAssets}>Fonts…</button>
	<span class="divider" aria-hidden="true"></span>
	<button type="button" class="project" onclick={onOpenProject}>Open project…</button>
	<button type="button" class="project" onclick={onSaveProject}>Save project…</button>
	<button type="button" class="project" onclick={onSaveCopy} disabled={!hasProject}>Save a copy…</button>
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
