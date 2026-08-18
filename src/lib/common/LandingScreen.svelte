<script lang="ts">
	import type { ImportKind, RecentEntry } from '../ipc/commands';
	import ImportCards from './ImportCards.svelte';

	// What an empty window shows (Q13). A **launcher, not a wizard**: it disappears the moment a
	// project is open, and everything on it is also reachable from inside the workbench. It gained
	// its import cards at S3.2 and gains "start a style" at S4 — nothing here gates anything.
	//
	// The cards come from the core's catalogue rather than being written out here, which is what
	// removed the "Open a tile container" card that named four extensions the drop handler and the
	// file dialog each repeated in their own words.
	let {
		kinds,
		recents,
		onImport,
		onOpenUrl,
		onForget
	}: {
		/** Every way in this build has, in the order the core offers them. */
		kinds: ImportKind[];
		recents: RecentEntry[];
		onImport: (kind: ImportKind) => void;
		onOpenUrl: (url: string) => void;
		onForget: (source: string) => void;
	} = $props();

	let url = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = url.trim();
		if (trimmed) onOpenUrl(trimmed);
	}

	const filename = (source: string) => source.split(/[/\\]/).pop() || source;

	function when(seconds: number): string {
		const elapsed = Date.now() / 1000 - seconds;
		if (elapsed < 60) return 'just now';
		if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
		if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)} h ago`;
		return `${Math.floor(elapsed / 86_400)} d ago`;
	}
</script>

<div class="landing">
	<div class="sheet">
		<h1>VersaTiles Studio</h1>

		<div class="ways">
			<ImportCards {kinds} onChoose={onImport} />

			<!-- Not a card in the catalogue: a URL is not a *kind* of data, it is a place one comes
			     from, and every kind that can be read over HTTP can be read from here. -->
			<form class="card" onsubmit={submit}>
				<strong>Open a remote URL</strong>
				<span>HTTPS or SFTP — a planet file opens from its index</span>
				<div class="row">
					<input bind:value={url} type="text" placeholder="https://…" spellcheck="false" />
					<button type="submit" class="button" disabled={!url.trim()}>Open</button>
				</div>
			</form>
		</div>

		{#if recents.length}
			<section class="recents">
				<h2 class="section-label">Recent</h2>
				<ul>
					{#each recents as entry (entry.source)}
						<li>
							<button class="recent" onclick={() => onOpenUrl(entry.source)} title={entry.source}>
								<span class="name truncate">{filename(entry.source)}</span>
								<span class="meta">{when(entry.openedAt)}</span>
							</button>
							<button class="forget" onclick={() => onForget(entry.source)} aria-label="Forget">×</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<p class="drop">…or drop a file anywhere in this window.</p>
	</div>
</div>

<style>
	.name {
		font-family: var(--font-mono);
	}

	/* The scroller. `justify-content: center` used to do the centring here, which reads well until
	   the content is taller than the window: centred overflow spills past *both* edges, so the
	   heading goes off the top where no scrollbar can reach it. Centring moved to the sheet's auto
	   margins, which collapse to zero the moment there is nothing to spare. */
	.landing {
		height: 100%;
		display: flex;
		overflow-y: auto;
		/* The map is behind this, and scrolling past the end of a list should not start panning it. */
		overscroll-behavior: contain;
		padding: var(--space-6);
		background: var(--chrome);
	}

	.sheet {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		width: min(42rem, 100%);
	}

	h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
	}

	.ways {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: min(42rem, 100%);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		text-align: left;
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);

		strong {
			font-weight: 600;
		}

		span {
			color: var(--ink-2);
		}
	}

	form.card {
		cursor: default;
	}

	.row {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-3);

		input {
			flex: 1;
			min-width: 0;
			font-family: var(--font-mono);
		}

		button {
			padding: var(--space-2) var(--space-4);
		}
	}

	.recents {
		width: min(38rem, 100%);
	}

	h2 {
		margin: 0 0 var(--space-3);
	}

	li {
		display: flex;
		align-items: center;
	}

	.recent {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		text-align: left;
		padding: var(--space-3) var(--space-3);
		border-radius: var(--radius);

		&:hover {
			background: var(--surface);
		}
	}

	.meta {
		color: var(--ink-2);
		font-size: var(--text-sm);
		flex: none;
	}

	.forget {
		color: var(--ink-2);
		padding: 0 var(--space-3);
	}

	.drop {
		margin: 0;
		color: var(--ink-2);
	}
</style>
