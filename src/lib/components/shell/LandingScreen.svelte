<script lang="ts">
	import type { RecentEntry } from '../../ipc/commands';

	// What an empty window shows (Q13). A **launcher, not a wizard**: it disappears the moment a
	// project is open, and everything on it is also reachable from inside the workbench. It gains
	// import cards at S3 and "start a style" at S4 — nothing here gates anything.
	let {
		recents,
		onOpenFile,
		onOpenUrl,
		onForget
	}: {
		recents: RecentEntry[];
		onOpenFile: () => void;
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
	<h1>VersaTiles Studio</h1>

	<div class="ways">
		<button class="card" onclick={onOpenFile}>
			<strong>Open a tile container</strong>
			<span>.versatiles · .mbtiles · .pmtiles · .tar</span>
		</button>

		<form class="card" onsubmit={submit}>
			<strong>Open a remote URL</strong>
			<span>HTTPS or SFTP — a planet file opens from its index</span>
			<div class="row">
				<input bind:value={url} type="text" placeholder="https://…" spellcheck="false" />
				<button type="submit" disabled={!url.trim()}>Open</button>
			</div>
		</form>
	</div>

	{#if recents.length}
		<section class="recents">
			<h2>Recent</h2>
			<ul>
				{#each recents as entry (entry.source)}
					<li>
						<button class="recent" onclick={() => onOpenUrl(entry.source)} title={entry.source}>
							<span class="name">{filename(entry.source)}</span>
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

<style>
	.landing {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.6rem;
		padding: 2rem;
		background: var(--chrome);
	}
	h1 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 600;
	}
	.ways {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.8rem;
		width: min(38rem, 100%);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		text-align: left;
		padding: 0.9rem;
		border: 1px solid var(--rule);
		border-radius: 5px;
		background: var(--surface);
		font: inherit;
		cursor: pointer;
	}
	form.card {
		cursor: default;
	}
	.card strong {
		font-weight: 600;
	}
	.card span {
		color: var(--ink-2);
		font-size: 0.75rem;
	}
	.row {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}
	.row input {
		flex: 1;
		min-width: 0;
		font:
			0.75rem ui-monospace,
			monospace;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--rule);
		border-radius: 3px;
	}
	.row button {
		font: inherit;
		font-size: 0.75rem;
	}
	.recents {
		width: min(38rem, 100%);
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
	}
	.recent {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		padding: 0.3rem 0.4rem;
		border-radius: 3px;
		cursor: pointer;
	}
	.recent:hover {
		background: var(--surface);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		color: var(--ink-2);
		font-size: 0.72rem;
		flex: none;
	}
	.forget {
		border: 0;
		background: none;
		color: var(--ink-2);
		cursor: pointer;
		padding: 0 0.3rem;
	}
	.drop {
		margin: 0;
		color: var(--ink-2);
		font-size: 0.75rem;
	}
</style>
