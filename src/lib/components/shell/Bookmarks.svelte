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
						<span class="name">{bookmark.name}</span>
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
		padding-top: 0.6rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
	}
	form {
		display: flex;
		gap: 0.3rem;
	}
	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.75rem;
		padding: 0.25rem 0.35rem;
		border: 1px solid var(--rule);
		border-radius: 3px;
	}
	form button {
		font: inherit;
		font-size: 0.72rem;
		padding: 0.2rem 0.5rem;
	}
	ul {
		list-style: none;
		margin: 0.45rem 0 0;
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
		gap: 0.6rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.78rem;
		text-align: left;
		padding: 0.22rem 0.3rem;
		border-radius: 3px;
		cursor: pointer;
	}
	.go:hover {
		background: var(--chrome);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		color: var(--ink-2);
		font:
			0.72rem ui-monospace,
			monospace;
		flex: none;
	}
	.del {
		border: 0;
		background: none;
		color: var(--ink-2);
		cursor: pointer;
		padding: 0 0.25rem;
	}
	.err {
		color: #b00;
		margin: 0.4rem 0 0;
		font-size: 0.75rem;
	}
</style>
