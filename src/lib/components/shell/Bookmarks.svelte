<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { deleteBookmark, listBookmarks, saveBookmark, type Bookmark } from '../../ipc/commands';

	// A7 — named views. Application-wide, not project-scoped (Q21): a place you want to come back to
	// is worth keeping whether or not a project exists.
	let { map, source }: { map: MaplibreMap | undefined; source: string | null } = $props();

	let bookmarks = $state<Bookmark[]>([]);
	let name = $state('');
	let error = $state<string | null>(null);

	$effect(() => {
		void refresh();
	});

	async function refresh() {
		try {
			bookmarks = await listBookmarks();
		} catch (e) {
			error = String(e);
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || !map) return;
		const centre = map.getCenter();
		try {
			await saveBookmark({
				name: trimmed,
				source,
				lng: centre.lng,
				lat: centre.lat,
				zoom: map.getZoom(),
				bearing: map.getBearing(),
				pitch: map.getPitch(),
				createdAt: 0
			});
			name = '';
			error = null;
			await refresh();
		} catch (e) {
			error = String(e);
		}
	}

	function go(bookmark: Bookmark) {
		map?.jumpTo({
			center: [bookmark.lng, bookmark.lat],
			zoom: bookmark.zoom,
			bearing: bookmark.bearing,
			pitch: bookmark.pitch
		});
	}

	async function remove(bookmark: Bookmark) {
		await deleteBookmark(bookmark.name);
		await refresh();
	}
</script>

<section class="bookmarks">
	<h2>Bookmarks</h2>

	<form onsubmit={save}>
		<input bind:value={name} type="text" placeholder="Name this view" disabled={!map} />
		<button type="submit" disabled={!name.trim() || !map}>Save</button>
	</form>

	{#if error}<p class="err">{error}</p>{/if}

	{#if bookmarks.length}
		<ul>
			{#each bookmarks as bookmark (bookmark.name)}
				<li>
					<button class="go" onclick={() => go(bookmark)} title={bookmark.source ?? 'no source'}>
						<span class="name truncate">{bookmark.name}</span>
						<span class="meta">z{bookmark.zoom.toFixed(1)}</span>
					</button>
					<button class="del" onclick={() => remove(bookmark)} aria-label="Delete">×</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.bookmarks {
		border-top: 1px solid var(--rule);
		padding-top: var(--space-4);
	}
	h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
	}
	form {
		display: flex;
		gap: var(--space-3);
	}
	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}
	form button {
		font: inherit;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-4);
	}
	ul {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
	}
	.go {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
	}
	.go:hover {
		background: var(--chrome);
	}
	.meta {
		color: var(--ink-2);
		font: 0.72rem var(--font-mono);
		flex: none;
	}
	.del {
		border: 0;
		background: none;
		color: var(--ink-2);
		padding: 0 var(--space-2);
	}
	.err {
		color: var(--error);
		margin: var(--space-3) 0 0;
		font-size: var(--text-sm);
	}
</style>
