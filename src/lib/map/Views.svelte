<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { deleteView, listViews, reorderViews, saveView, type Camera, type View } from '../ipc/commands';

	// A7's named views, application-wide rather than project-scoped ([Q21]): a place you want to
	// come back to is worth keeping whether or not a project exists.
	//
	// **On the map, not in a pane** ([Q38]). What this does is move the camera - the same job as the
	// `CoordinateJump` box in the corner below - and nothing to do with what an opened container
	// turns out to be, which is all the inspector it used to live in is for.
	//
	// Top-left, a corner to itself: it is the one map control that opens a panel, and it opens
	// downward into the map rather than upward past the window edge.
	//
	// One button rather than an open form: naming a view is occasional, jumping between them is
	// constant, and the always-visible "Name this view" input charged the frequent act for the rare
	// one.
	let { map }: { map: MaplibreMap | undefined } = $props();

	let views = $state<View[]>([]);
	let open = $state(false);
	let naming = $state(false);
	let name = $state('');
	let error = $state<string | null>(null);
	/// The whole control, so a pointer landing anywhere inside it does not count as clicking away.
	let root = $state<HTMLDivElement>();

	/// Where the camera is now, so the list can say which view you are on.
	///
	/// From `moveend` rather than every frame: mid-gesture the answer is "none of them", and
	/// re-rendering the list to say so at sixty hertz buys nobody anything. A jump ends in a
	/// `moveend` too, so arriving marks the row.
	let camera = $state<Camera | null>(null);

	$effect(() => {
		void refresh();
	});

	$effect(() => {
		const m = map;
		if (!m) return;
		const report = () => {
			const centre = m.getCenter();
			camera = {
				lng: centre.lng,
				lat: centre.lat,
				zoom: m.getZoom(),
				bearing: m.getBearing(),
				pitch: m.getPitch()
			};
		};
		report();
		m.on('moveend', report);
		return () => void m.off('moveend', report);
	});

	/// How close counts as being on a view.
	///
	/// Generous enough to survive the round trip through MapLibre - a zoom can come back
	/// constrained by the style's limits, a latitude nudged by the projection - and tight enough
	/// that two views of the same city do not both light up.
	const NEAR = { degrees: 1e-4, zoom: 0.01, angle: 0.5 };

	/// Bearings are a circle: 359.9° and 0.1° are two tenths apart, not three hundred and sixty.
	function turn(a: number, b: number): number {
		const diff = Math.abs(a - b) % 360;
		return Math.min(diff, 360 - diff);
	}

	function isHere(view: View, at: Camera | null): boolean {
		if (!at) return false;
		return (
			Math.abs(view.lng - at.lng) < NEAR.degrees &&
			Math.abs(view.lat - at.lat) < NEAR.degrees &&
			Math.abs(view.zoom - at.zoom) < NEAR.zoom &&
			// Both sides default: `bearing` and `pitch` are absent in a file written before a view had
			// an angle, and a flat north-up view is what that meant.
			turn(view.bearing ?? 0, at.bearing ?? 0) < NEAR.angle &&
			Math.abs((view.pitch ?? 0) - (at.pitch ?? 0)) < NEAR.angle
		);
	}

	const here = $derived(views.find((view) => isHere(view, camera)) ?? null);

	async function refresh() {
		try {
			views = await listViews();
			error = null;
		} catch (e) {
			error = String(e);
		}
	}

	function go(view: View) {
		// A jump, not a flight: these are used to compare the same place at two zooms or two angles,
		// and an animation between them is time spent watching the thing you are comparing slide past.
		map?.jumpTo({
			center: [view.lng, view.lat],
			zoom: view.zoom,
			bearing: view.bearing ?? 0,
			pitch: view.pitch ?? 0
		});
		close();
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || !camera) return;
		try {
			// The angle is part of the view: two people asked to save "Berlin" pitched and flat mean
			// two views, and restoring one of them north-up would be restoring a different place.
			await saveView({ name: trimmed, ...camera, createdAt: 0 });
			name = '';
			naming = false;
			error = null;
			await refresh();
		} catch (e) {
			error = String(e);
		}
	}

	async function remove(view: View) {
		try {
			await deleteView(view.name);
			await refresh();
		} catch (e) {
			error = String(e);
		}
	}

	/// Moves a view one place, and takes the core's word for where everything ended up.
	async function nudge(from: number, to: number) {
		if (to < 0 || to >= views.length) return;
		const order = views.map((view) => view.name);
		order.splice(to, 0, ...order.splice(from, 1));
		try {
			views = await reorderViews(order);
			error = null;
		} catch (e) {
			error = String(e);
		}
	}

	/// Closes, and forgets a half-typed name.
	///
	/// Reopening on the input you abandoned would offer to name a view at a camera you have since
	/// moved away from, which is not the view you were naming.
	function close() {
		open = false;
		naming = false;
		name = '';
		error = null;
	}

	function dismiss(event: MouseEvent) {
		if (open && root && !root.contains(event.target as Node)) close();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && open) close();
	}}
	onpointerdown={dismiss}
/>

<div class="views" bind:this={root}>
	{#if open}
		<div class="panel" role="group" aria-label="Saved views">
			{#if views.length === 0}
				<p class="empty">No saved views yet.</p>
			{/if}

			<ul>
				{#each views as view, index (view.name)}
					<li class:here={view === here}>
						<button
							type="button"
							class="go"
							onclick={() => go(view)}
							title={view === here ? 'You are here' : `Jump to ${view.name}`}
						>
							<span class="name truncate">{view.name}</span>
							<span class="meta">z{view.zoom.toFixed(1)}</span>
						</button>
						<button
							type="button"
							class="edit"
							disabled={index === 0}
							aria-label="Move {view.name} up"
							title="Move up"
							onclick={() => nudge(index, index - 1)}>↑</button
						>
						<button
							type="button"
							class="edit"
							disabled={index === views.length - 1}
							aria-label="Move {view.name} down"
							title="Move down"
							onclick={() => nudge(index, index + 1)}>↓</button
						>
						<button
							type="button"
							class="edit"
							aria-label="Delete {view.name}"
							title="Delete"
							onclick={() => remove(view)}>×</button
						>
					</li>
				{/each}
			</ul>

			{#if naming}
				<!-- svelte-ignore a11y_autofocus -->
				<form onsubmit={save}>
					<input
						bind:value={name}
						type="text"
						placeholder="Name this view"
						autofocus
						spellcheck="false"
						aria-label="Name this view"
						onkeydown={(event) => {
							if (event.key === 'Escape') {
								event.stopPropagation();
								naming = false;
							}
						}}
					/>
					<button type="submit" disabled={!name.trim()}>Save</button>
				</form>
			{:else}
				<button type="button" class="add" disabled={!camera} onclick={() => (naming = true)}>
					＋ Save this view
				</button>
			{/if}

			{#if error}<p class="err">{error}</p>{/if}
		</div>
	{/if}

	<button
		type="button"
		class="toggle"
		class:on={open}
		aria-expanded={open}
		title="Saved views - jump back to a place you named"
		onclick={() => (open ? close() : (open = true))}
	>
		<!-- The name of the view you are on, so the button says where you are rather than only what
		     it opens. -->
		<span class="truncate">{here ? here.name : 'Views'}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>
</div>

<style>
	.views {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 4;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 11rem;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);

		&.on {
			border-color: var(--accent);
		}
	}

	.caret {
		color: var(--ink-2);
		flex: none;
	}

	/* Opens downward, away from the edge the button sits on. */
	.panel {
		position: absolute;
		top: calc(100% + var(--space-2));
		left: 0;
		width: 15rem;
		max-height: 60vh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		border-radius: var(--radius);

		&.here {
			background: color-mix(in srgb, var(--accent) 12%, transparent);
			box-shadow: inset 2px 0 0 var(--accent);
		}
	}

	.go {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		text-align: left;
		padding: var(--space-2) var(--space-3);
	}

	.meta {
		color: var(--ink-2);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		flex: none;
	}

	.edit {
		color: var(--ink-2);
		padding: 0 var(--space-2);

		&:disabled {
			opacity: 0.3;
		}
	}

	.add {
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		color: var(--ink-2);
	}

	.empty {
		margin: 0 0 var(--space-2);
		padding: 0 var(--space-3);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	form {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-2);

		button {
			padding: var(--space-2) var(--space-3);
		}
	}

	input {
		flex: 1;
		min-width: 0;
	}

	.err {
		color: var(--error);
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
	}
</style>
