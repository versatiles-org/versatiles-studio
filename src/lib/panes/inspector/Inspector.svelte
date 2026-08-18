<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import type { ContainerInfo } from '../../ipc/commands';
	import JsonTree from '../../common/JsonTree.svelte';
	import Bookmarks from './Bookmarks.svelte';

	// A6 — the right pane shows the parameters of what you are working on, never global settings.
	let {
		containers,
		onOpen,
		onOpenUrl,
		map
	}: {
		containers: ContainerInfo[];
		onOpen: () => void;
		onOpenUrl: (url: string) => void;
		map: MaplibreMap | undefined;
	} = $props();

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
	<button class="button open" onclick={onOpen}>Open a tile container…</button>

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
			<h2 class="truncate" title={info.source}>{info.source.split('/').pop()}</h2>
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

			<JsonTree value={info.tileJson} name="TileJSON" open={false} />
		</section>
	{/each}

	<Bookmarks {map} source={containers.at(-1)?.source ?? null} />
</div>

<style>
	.inspector {
		height: 100%;
		min-width: 0;
		overflow-y: auto;
		/* Reaching the end must not chain the scroll up to the window, which would rubber-band it. */
		overscroll-behavior: contain;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.open {
		padding: var(--space-3);
	}
	form {
		display: flex;
		gap: var(--space-3);
	}
	input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
	}
	form button {
		padding: var(--space-2) var(--space-4);
	}
	.hint {
		margin: 0;
		color: var(--ink-2);
		line-height: 1.5;
	}
	section {
		border-top: 1px solid var(--rule);
		padding-top: var(--space-4);
	}
	h2 {
		margin: 0 0 var(--space-4);
		font-weight: 600;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-5);
		margin: 0 0 var(--space-4);
	}
	dt {
		color: var(--ink-2);
	}
	dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	dd.wrap {
		white-space: normal;
		word-break: break-word;
	}
</style>
