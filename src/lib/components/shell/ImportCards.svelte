<script lang="ts">
	import type { ImportKind } from '../../ipc/commands';

	// The ways into the application, as cards (S3.2).
	//
	// One component in two places — the landing screen and "+ Add source" — because they ask the
	// same question and answering it differently in each would be the drift the catalogue exists to
	// prevent. The list itself comes from the core, which derives it from the operations this build
	// actually has: a card can never offer something that would fail on the first click.
	//
	// `compact` is the only difference between the two uses, and it is spacing, not content.
	let {
		kinds,
		onChoose,
		compact = false
	}: {
		kinds: ImportKind[];
		onChoose: (kind: ImportKind) => void;
		/** Denser, for the pane. The landing screen has room to breathe; a sidebar does not. */
		compact?: boolean;
	} = $props();
</script>

<div class="cards" class:compact>
	{#each kinds as kind (kind.id)}
		<button type="button" class="card" onclick={() => onChoose(kind)}>
			<strong>{kind.label}</strong>
			<span class="detail">{kind.detail}</span>
			<!-- What picking a file might not settle. "May", not "will": since S3.4 a CSV whose
			     header names its coordinate columns arrives with them already filled in, and only a
			     file that does not gets asked. Promising the question every time would make the
			     common case look like more work than it is. -->
			{#if kind.needs.length > 0}
				<span class="needs">
					may ask for {kind.needs.map((need) => need.replace(/_/g, ' ')).join(' and ')}
				</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-5);
	}
	.cards.compact {
		grid-template-columns: 1fr;
		gap: var(--space-2);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		text-align: left;
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.compact .card {
		gap: var(--space-1);
		padding: var(--space-3);
		border-radius: var(--radius);
		font-size: var(--text-sm);
	}
	.card:hover {
		border-color: var(--accent);
	}
	.card strong {
		font-weight: 600;
	}
	.detail {
		color: var(--ink-2);
	}
	.needs {
		color: var(--ink-2);
		font-size: var(--text-sm);
		font-style: italic;
	}
	.compact .needs,
	.compact .detail {
		font-size: var(--text-xs);
	}
</style>
