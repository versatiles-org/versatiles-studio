<script lang="ts">
	import { Marker, type Map as MaplibreMap } from 'maplibre-gl';
	import { geocode, MIN_PLACE_QUERY, parseQuery, type Candidate } from './search';
	import Tooltip from './Tooltip.svelte';

	// The map's search field: a place, a coordinate, a tile or a bounding box, in one box.
	//
	// **It says what it understood before it goes anywhere.** The old field jumped on Enter or turned
	// red, and `13.40, 52.52` went wherever its one reading of the order said - which for half the
	// coordinates anyone pastes was the wrong half of the world. Now every reading is a line in a list,
	// labelled with how it was read, and Enter takes the first. See `search.ts` for the readings.
	//
	// **Places come from the network**, from geocode.versatiles.org, and only for text that is not a
	// coordinate, a tile or a box - so the offline cases never leave the machine, and a query that
	// could not be sent says so rather than claiming there was nothing to find.

	let {
		map,
		/** For tests: the geocoder call. */
		search = geocode
	}: {
		map: MaplibreMap | undefined;
		search?: typeof geocode;
	} = $props();

	const PAUSE_MS = 250;

	let text = $state('');
	let field = $state<HTMLInputElement>();
	let open = $state(false);
	let highlighted = $state(0);

	/// What the text can be read as here, without asking anyone.
	const local = $derived(parseQuery(text));
	/// What the geocoder found for it - only ever asked when `local` is empty.
	let places = $state<Candidate[]>([]);
	let status = $state<'idle' | 'searching' | 'failed'>('idle');

	const results = $derived(local.length > 0 ? local : places);

	/// **Asked after a pause, and only the latest answer kept**: a request per keystroke would be a
	/// request per character, and a slow answer to an earlier query must not replace a newer list.
	$effect(() => {
		const query = text.trim();
		places = [];
		highlighted = 0;
		// The title of what was just chosen is in the field to say where you are, not to be searched for.
		if (local.length > 0 || query.length < MIN_PLACE_QUERY || text === chosen) {
			status = 'idle';
			return;
		}
		status = 'searching';
		const controller = new AbortController();
		const near = map ? map.getCenter() : null;
		const timer = setTimeout(async () => {
			try {
				places = await search(query, near && { lng: near.lng, lat: near.lat }, { signal: controller.signal });
				status = 'idle';
			} catch (error) {
				if ((error as Error).name !== 'AbortError') status = 'failed';
			}
		}, PAUSE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	/// Where the last result was, until the next search or a clear: a place you jumped to is easy to
	/// lose once the map moves on.
	let marker: Marker | null = null;
	/// The text a choice left in the field.
	let chosen = $state<string | null>(null);

	function clearMarker() {
		marker?.remove();
		marker = null;
	}

	function choose(candidate: Candidate | undefined) {
		if (!candidate || !map) return;
		const { target } = candidate;
		if (target.kind === 'bounds') {
			const [west, south, east, north] = target.bounds;
			map.fitBounds(
				[
					[west, south],
					[east, north]
				],
				{ padding: 40, maxZoom: target.maxZoom, duration: 600 }
			);
		} else {
			map.flyTo({ center: target.center, zoom: target.zoom ?? Math.max(map.getZoom(), 12), duration: 600 });
		}

		clearMarker();
		if (candidate.marker) {
			const element = document.createElement('div');
			element.className = 'search-marker';
			const center = target.kind === 'point' ? target.center : centreOf(target.bounds);
			marker = new Marker({ element }).setLngLat(center).addTo(map);
		}

		// The field keeps what was found, so it reads as where you are; selecting it all means the next
		// thing typed replaces it.
		text = candidate.title;
		chosen = candidate.title;
		open = false;
		field?.select();
	}

	const centreOf = ([west, south, east, north]: [number, number, number, number]): [number, number] => [
		(west + east) / 2,
		(south + north) / 2
	];

	function onKeyDown(event: KeyboardEvent) {
		// The map listens for the same keys - arrows pan, +/- zoom - and must not while typing.
		event.stopPropagation();
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				open = true;
				if (results.length > 0) {
					const by = event.key === 'ArrowDown' ? 1 : -1;
					highlighted = (highlighted + by + results.length) % results.length;
				}
				break;
			case 'Enter':
				event.preventDefault();
				// Nothing highlighted means the first, so Enter always does something when there is one.
				choose(results[highlighted] ?? results[0]);
				break;
			case 'Escape':
				event.preventDefault();
				dismissed = true;
				// Twice: first the list, then the text and the marker.
				if (open && text) open = false;
				else {
					text = '';
					clearMarker();
				}
				break;
		}
	}

	$effect(() => () => clearMarker());

	const ICONS: Record<Candidate['type'], string> = { tile: '▦', coordinate: '⌖', bbox: '⬚', place: '⌂' };

	/// What to say when there is nothing to list - and nothing, while there is nothing to say.
	const message = $derived.by(() => {
		if (results.length > 0 || !text.trim()) return null;
		if (status === 'searching') return 'Searching…';
		if (status === 'failed') return 'Place search is unavailable - Studio may be offline.';
		// Too short to search: the hint is still up and says what to type.
		if (text.trim().length < MIN_PLACE_QUERY) return null;
		return 'Nothing found';
	});

	const listId = 'map-search-results';
	const hintId = 'map-search-hint';

	const listShown = $derived(open && (results.length > 0 || message !== null));

	/// **The hint is for the moment someone wonders what to type**: hovering over the field, or in it
	/// with too little typed to show anything. A list takes its place - it sits in the same spot, and
	/// says more. Escape puts it away until the next keystroke or focus.
	const HOVER_MS = 400;
	let hovering = $state(false);
	let focused = $state(false);
	let dismissed = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	const hintShown = $derived(
		!dismissed && !listShown && (hovering || (focused && text.trim().length < MIN_PLACE_QUERY))
	);

	function onPointerEnter() {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => (hovering = true), HOVER_MS);
	}

	function onPointerLeave() {
		clearTimeout(hoverTimer);
		hovering = false;
	}

	$effect(() => () => clearTimeout(hoverTimer));
</script>

<div class="search">
	<input
		bind:this={field}
		bind:value={text}
		type="text"
		placeholder="Search a place, coordinate or tile"
		spellcheck="false"
		autocomplete="off"
		role="combobox"
		aria-label="Search for a place, coordinate or tile"
		aria-autocomplete="list"
		aria-expanded={listShown}
		aria-controls={listId}
		aria-activedescendant={open && results.length > 0 ? `${listId}-${highlighted}` : undefined}
		aria-describedby={hintId}
		oninput={() => {
			open = true;
			dismissed = false;
		}}
		onfocus={() => {
			open = text.trim().length > 0;
			focused = true;
			dismissed = false;
		}}
		onblur={() => {
			open = false;
			focused = false;
		}}
		onpointerenter={onPointerEnter}
		onpointerleave={onPointerLeave}
		onkeydown={onKeyDown}
	/>

	<!-- Generic on purpose: an example is there to show the shape, and one taken from the view would
	     read as a result. -->
	<div class="below hint">
		<Tooltip id={hintId} shown={hintShown}>
			<dl>
				<dt>Berlin</dt>
				<dd>a place</dd>
				<dt>52.52, 13.40</dt>
				<dd>latitude, longitude</dd>
				<dt>12/2200/1343</dt>
				<dd>a tile z/x/y</dd>
			</dl>
		</Tooltip>
	</div>

	{#if listShown}
		<!-- `mousedown` is stopped so the field keeps focus: a blur would close the list before the
		     click on a result landed. -->
		<ul
			id={listId}
			class="below"
			role="listbox"
			aria-label="Search results"
			onmousedown={(event) => event.preventDefault()}
		>
			{#each results as candidate, index (index)}
				<li
					id="{listId}-{index}"
					role="option"
					aria-selected={index === highlighted}
					class:highlighted={index === highlighted}
					onclick={() => choose(candidate)}
					onkeydown={() => {}}
					onmouseenter={() => (highlighted = index)}
				>
					<span class="icon" aria-hidden="true">{ICONS[candidate.type]}</span>
					<span class="text">
						<span class="title truncate">{candidate.title}</span>
						{#if candidate.context}<span class="context truncate">{candidate.context}</span>{/if}
					</span>
				</li>
			{/each}
			{#if message}
				<li class="message" role="presentation">{message}</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	/* The anchor for the list. Placed by the strip it sits in (`MapControls`), not by itself. */
	.search {
		position: relative;
		height: 100%;
	}

	/* Set into the strip, which carries the surface. Wide enough for a coordinate pair with six places
	   - what the old 9rem cut off - and mono, so the digits of one line up under the next. */
	input {
		width: 16rem;
		height: 100%;
		border: 0;
		background: none;
		box-shadow: none;
		/* `base.css`'s ring, drawn inside the field rather than over the strip's edge it sits against. */
		outline-offset: -2px;
		font-family: var(--font-mono);
		font-size: var(--text-sm);

		/* A sentence, not a coordinate: the mono face is for what is typed. */
		&::placeholder {
			font-family: var(--font-ui);
		}
	}

	/* The list and the hint share a spot: under the whole strip, not only the field - the strip's left
	   edge is the search icon. */
	.below {
		position: absolute;
		top: calc(100% + var(--space-2) + 1px);
		left: calc(-2rem - 1px);
		width: 24rem;
		z-index: 2;
	}

	/* The hint passes the pointer through to the map, so its box must too - and it is as wide as its
	   three lines, not the list's width: empty space beside them would read as room for results. */
	.hint {
		width: max-content;
		pointer-events: none;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 var(--space-4);
		margin: 0;
	}

	dt {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	dd {
		margin: 0;
	}

	ul {
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		cursor: pointer;

		&.highlighted {
			background: color-mix(in srgb, var(--accent) 12%, transparent);
		}
	}

	.icon {
		flex: none;
		width: 1.2em;
		text-align: center;
		color: var(--ink-2);
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		font-size: var(--text-sm);
	}

	.context {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.message {
		cursor: default;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	/* The marker is made in JavaScript and handed to MapLibre, so it is outside this component's
	   scope - hence `:global`, kept to the one class. */
	:global(.search-marker) {
		width: 14px;
		height: 14px;
		border: 3px solid var(--accent-ink);
		border-radius: 50%;
		background: var(--accent);
		box-shadow: var(--shadow);
	}
</style>
