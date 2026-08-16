<script lang="ts">
	import type { ContainerInfo } from '../../ipc/commands';
	import JsonTree from '../common/JsonTree.svelte';

	// A6 — the right pane shows the parameters of what you are working on, never global settings.
	let {
		containers,
		onOpen,
		onOpenUrl
	}: { containers: ContainerInfo[]; onOpen: () => void; onOpenUrl: (url: string) => void } = $props();

	let url = $state('');

	function submitUrl(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = url.trim();
		if (trimmed) onOpenUrl(trimmed);
	}

	function extent(bbox: ContainerInfo['bbox']): string {
		if (!bbox) return '—';
		return bbox.map((n) => n.toFixed(3)).join(', ');
	}
</script>

<div class="inspector">
	<button class="open" onclick={onOpen}>Open a tile container…</button>

	<!-- A2: HTTPS and SFTP read through byte ranges, so a planet file opens from its index. -->
	<form onsubmit={submitUrl}>
		<input
			bind:value={url}
			type="text"
			placeholder="https://… or sftp://…"
			spellcheck="false"
			autocapitalize="off"
			autocorrect="off"
		/>
		<button type="submit" disabled={!url.trim()}>Open</button>
	</form>

	{#if containers.length === 0}
		<p class="hint">
			Nothing open yet. Drop a <code>.versatiles</code>, <code>.mbtiles</code> or
			<code>.pmtiles</code> file here, or use the button above.
		</p>
	{/if}

	{#each containers as info (info.source)}
		<section>
			<h2 title={info.source}>{info.source.split('/').pop()}</h2>
			<dl>
				<dt>container</dt>
				<dd>{info.container}</dd>
				<dt>tiles</dt>
				<dd>{info.tileFormat}{info.tileCompression === 'none' ? '' : ` · ${info.tileCompression}`}</dd>
				<!-- The real range, from which levels hold tiles — containers routinely overstate it. -->
				<dt>zoom</dt>
				<dd>{info.minZoom}–{info.maxZoom}</dd>
				<dt>extent</dt>
				<dd class="wrap">{extent(info.bbox)}</dd>
			</dl>

			<details>
				<summary>TileJSON</summary>
				<JsonTree value={info.tileJson} />
			</details>
		</section>
	{/each}
</div>

<style>
	.inspector {
		padding: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.open {
		font: inherit;
		padding: 0.35rem;
	}
	form {
		display: flex;
		gap: 0.3rem;
	}
	input {
		flex: 1;
		min-width: 0;
		font:
			0.75rem ui-monospace,
			monospace;
		padding: 0.3rem;
		border: 1px solid var(--rule);
		border-radius: 3px;
	}
	form button {
		font: inherit;
		font-size: 0.75rem;
		padding: 0.2rem 0.6rem;
	}
	.hint {
		margin: 0;
		color: var(--ink-2);
		line-height: 1.5;
	}
	.hint code {
		font-size: 0.9em;
	}
	section {
		border-top: 1px solid var(--rule);
		padding-top: 0.6rem;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 0.82rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.2rem 0.7rem;
		margin: 0 0 0.6rem;
	}
	dt {
		color: var(--ink-2);
	}
	dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}
	dd.wrap {
		white-space: normal;
		word-break: break-word;
	}
	summary {
		cursor: pointer;
		color: var(--ink-2);
	}
</style>
