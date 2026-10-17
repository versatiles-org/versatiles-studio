<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { BACKGROUNDS, hasLabels, swatchOf, type BackgroundId } from './background';
	import Dropdown from './Dropdown.svelte';
	import Icon from '../common/Icon.svelte';
	import Group from '../common/Group.svelte';

	// The controls that act on the map rather than on the pipeline.
	//
	// **Two clusters, by the question each answers.** They used to be five loose chips down the left
	// edge - each with its own shadow, two in lowercase, the coordinate box looking like a sixth button
	// - and read as stickers rather than as controls. What they do splits cleanly:
	//
	// * *Where am I looking* - search for a place, coordinate or tile, the saved views, fit to the
	//   data. One strip, top left, shaped like the search box it is.
	// * *What is drawn* - the background, the tile grid, and the zoom and compass that every map has
	//   and this one did not. One column of square buttons, top right.
	//
	// And a readout, bottom left, of the zoom and the coordinate under the pointer - the number a tile
	// tool is asked most often, which nothing on screen used to show.
	//
	// What belongs here is anything about *looking* at the result, and nothing about what the result
	// is - that is the left pane's business.

	let {
		map,
		views,
		jump,
		background,
		showGrid,
		gridLevel,
		gridNudged = false,
		canReset,
		onBackground,
		backgroundLabels = true,
		onBackgroundLabels = () => {},
		onToggleGrid,
		onGridLevel,
		onReset
	}: {
		/** For the zoom buttons, the compass and the readout. Absent until the map exists. */
		map?: MaplibreMap;
		/** The saved-views control, set into the strip beside the coordinate field. */
		views?: Snippet;
		/** The search field. Passed in: this file arranges, App composes. */
		jump?: Snippet;
		background: BackgroundId;
		showGrid: boolean;
		/** The level the grid is drawing, which is the source's own unless someone walked off it. */
		gridLevel: number;
		/** Whether that is off the level MapLibre is actually requesting. */
		gridNudged?: boolean;
		/** False when there is nothing open, so there is no extent to return to. */
		canReset: boolean;
		onBackground: (id: BackgroundId) => void;
		/** Whether the background draws its own labels - the switch at the foot of its menu. */
		backgroundLabels?: boolean;
		onBackgroundLabels?: (on: boolean) => void;
		onToggleGrid: () => void;
		/** Walks the grid a level in or out; `0` puts it back on the source's own. */
		onGridLevel: (by: number) => void;
		onReset: () => void;
	} = $props();

	/** Grouped by what a background is for - see `BACKGROUNDS`. */
	const groups = $derived([
		{ label: '', items: BACKGROUNDS.filter((b) => b.group === 'off') },
		{ label: 'For data', items: BACKGROUNDS.filter((b) => b.group === 'data') },
		{ label: 'Full map', items: BACKGROUNDS.filter((b) => b.group === 'context') },
		{ label: 'Imagery', items: BACKGROUNDS.filter((b) => b.group === 'imagery') }
	]);

	const backgroundLabel = $derived(BACKGROUNDS.find((item) => item.id === background)?.label ?? 'No background');

	/// The camera, as far as the compass and the readout need it.
	let zoom = $state<number | null>(null);
	let bearing = $state(0);
	let pitch = $state(0);
	/// Under the pointer while it is over the map, the centre otherwise - so the readout always says
	/// *somewhere*, and the place you are pointing at when you are pointing.
	let at = $state<{ lng: number; lat: number } | null>(null);
	let pointer = $state<{ lng: number; lat: number } | null>(null);

	$effect(() => {
		const m = map;
		if (!m) return;
		const camera = () => {
			zoom = m.getZoom();
			bearing = m.getBearing();
			pitch = m.getPitch();
			const centre = m.getCenter();
			at = { lng: centre.lng, lat: centre.lat };
		};
		const moved = (event: { lngLat: { lng: number; lat: number } }) => (pointer = event.lngLat);
		const left = () => (pointer = null);
		camera();
		m.on('move', camera);
		m.on('mousemove', moved);
		m.on('mouseout', left);
		return () => {
			m.off('move', camera);
			m.off('mousemove', moved);
			m.off('mouseout', left);
		};
	});

	const shown = $derived(pointer ?? at);
	/// Five decimals is a metre at the equator - finer than any tile, coarser than noise.
	const coordinate = $derived(shown ? `${shown.lng.toFixed(5)}, ${shown.lat.toFixed(5)}` : '');
	const turned = $derived(Math.abs(bearing) > 0.5 || pitch > 0.5);
</script>

<div class="controls">
	<!-- Where am I looking. One strip, like a search box: the field is what it mostly is, and the two
	     buttons set into its end are the other two ways of saying where. -->
	<div class="strip">
		<span class="lead" aria-hidden="true"><Icon name="search" /></span>
		{@render jump?.()}
		{@render views?.()}
		<button
			type="button"
			class="map-button"
			disabled={!canReset}
			onclick={onReset}
			aria-label="Fit to the data"
			title="Fit the map to what is open"
		>
			<Icon name="fit" />
		</button>
	</div>

	<!-- What is drawn, then how the camera sits: two groups down the right edge, the zoom in the
	     place every other map keeps it. -->
	<div class="column">
		<div class="cluster">
			<!-- **A dropdown, not a `<select>`.** A native popup on macOS obeys none of the map's chrome.
			     `Dropdown` is the saved views' own control, so the two match by construction. -->
			<Dropdown
				label="Background map"
				title="Background map: {backgroundLabel} - its tiles come from versatiles.org"
				width="13rem"
				placement="left"
				bare
			>
				{#snippet icon()}<Icon name="layers" />{/snippet}
				{#snippet panel(close: () => void)}
					<div class="backgrounds" role="group" aria-label="Background map">
						{#each groups as group (group.label)}
							{#snippet options()}
								{#each group.items as item (item.id)}
									{@const swatch = swatchOf(item.id)}
									<button
										type="button"
										class="option"
										class:chosen={item.id === background}
										aria-pressed={item.id === background}
										onclick={() => {
											onBackground(item.id);
											close();
										}}
									>
										<!-- Land, water and a road: enough to tell the palettes apart at a glance, which
									     two called "Colorful" and "Muted" would not. -->
										<span
											class="swatch"
											class:none={!swatch}
											style:--land={swatch?.land}
											style:--water={swatch?.water}
											style:--road={swatch?.road}
											aria-hidden="true"
										></span>
										{item.label}
									</button>
								{/each}
							{/snippet}
							{#if group.label}
								<Group title={group.label}>{@render options()}</Group>
							{:else}
								{@render options()}
							{/if}
						{/each}
					</div>
					<!-- One switch for every background rather than a labelled and an unlabelled copy of
					     each: a background's names are what collide with the data's own. Left open on
					     change, because flipping it is how you compare. -->
					<label class="labels" class:off={!hasLabels(background)}>
						<input
							type="checkbox"
							checked={backgroundLabels}
							disabled={!hasLabels(background)}
							onchange={(event) => onBackgroundLabels(event.currentTarget.checked)}
						/>
						Labels
					</label>
				{/snippet}
			</Dropdown>

			<!-- The stepper opens to the *left* of the grid button, out of the column into the map: it
			     belongs to that button, and only while the grid is drawn - a stepper for a grid that is
			     not on would be a permanent control for an occasional question. -->
			<div class="grid-row">
				{#if showGrid}
					<!-- Three targets and no mode names, because the offset is not a constant: one level for
					     a 256px source, nought or one for imagery depending on the zoom, and no single right
					     answer for a stack whose sources disagree. A nudge covers every case. -->
					<div class="stepper" role="group" aria-label="Grid zoom level">
						<!-- Named, because its − and + sit right above the map's own and step something else:
						     the grid's level, not the camera's. -->
						<span class="tag" aria-hidden="true">grid</span>
						<button type="button" onclick={() => onGridLevel(-1)} disabled={gridLevel === 0} title="One level out">
							&minus;
						</button>
						<!-- The number is the readout *and* the way back: what changed is the level, so the level
						     carries the mark and undoes it. -->
						<button
							type="button"
							class="level"
							class:nudged={gridNudged}
							onclick={() => onGridLevel(0)}
							title={gridNudged ? 'Back to the level being requested' : 'The level MapLibre is requesting'}
						>
							z{gridLevel}
						</button>
						<button type="button" onclick={() => onGridLevel(1)} title="One level in">+</button>
					</div>
				{/if}
				<button
					type="button"
					class="map-button"
					class:on={showGrid}
					aria-pressed={showGrid}
					onclick={onToggleGrid}
					aria-label="Tile grid"
					title="Show the z/x/y tile grid (A5)"
				>
					<Icon name="grid" />
				</button>
			</div>
		</div>

		<div class="cluster">
			<button
				type="button"
				class="map-button"
				disabled={!map}
				onclick={() => map?.zoomIn()}
				aria-label="Zoom in"
				title="Zoom in"
			>
				<Icon name="plus" />
			</button>
			<button
				type="button"
				class="map-button"
				disabled={!map}
				onclick={() => map?.zoomOut()}
				aria-label="Zoom out"
				title="Zoom out"
			>
				<Icon name="minus" />
			</button>
			<!-- Turns with the map, so it is a reading as well as a button: north is where it points. -->
			<button
				type="button"
				class="map-button compass"
				class:turned
				disabled={!map}
				onclick={() => map?.resetNorthPitch()}
				aria-label="Reset bearing and pitch"
				title={turned ? 'Point north and look straight down' : 'North is up'}
			>
				<span style:transform="rotate({-bearing}deg)"><Icon name="compass" /></span>
			</button>
		</div>
	</div>

	{#if zoom !== null}
		<!-- Not a control, so it lets the pointer through to the map. -->
		<p class="readout" aria-live="off">
			<span class="zoom">z{zoom.toFixed(1)}</span>
			<span>{coordinate}</span>
		</p>
	{/if}
</div>

<style>
	/* Over the whole map, letting the pointer through everywhere but the controls themselves - so the
	   clusters can sit in their corners without a box between them that swallows drags. */
	.controls {
		position: absolute;
		inset: 0;
		pointer-events: none;

		> * {
			pointer-events: auto;
		}
	}

	/* The surface every control here shares: one border and one shadow per cluster, not per button. */
	.strip,
	.cluster {
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.strip {
		position: absolute;
		top: var(--space-4);
		left: var(--space-4);
		display: flex;
		align-items: center;
		height: 2rem;

		.lead {
			display: flex;
			padding: 0 var(--space-1) 0 var(--space-3);
			color: var(--ink-2);
		}

		/* Square in the column, full height in the strip, with a rule against the field. */
		.map-button {
			height: 100%;
			border-left: 1px solid var(--rule);
		}

		/* A rule between the field and the buttons set into its end. */
		> :global(.dropdown) {
			border-left: 1px solid var(--rule);
			height: 100%;
		}

		> :global(.dropdown .toggle) {
			height: 100%;
		}
	}

	.column {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
	}

	/* Square buttons stacked into one control, a rule between each. */
	.cluster {
		display: flex;
		flex-direction: column;

		> :global(*:not(:first-child)) {
			border-top: 1px solid var(--rule);
		}
	}

	/* A square button on the map. Not the kit's `.icon`, which is a glyph in a pane's row at label
	   size: this is a control on a floating surface, full ink, with a face of its own on hover. The two
	   shared a class name for a release, and this one overrode the other property by property. */
	.map-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		color: var(--ink);

		&:hover:not(:disabled) {
			background: var(--chrome);
		}

		&:disabled {
			opacity: var(--disabled-opacity);
		}

		&.on {
			background: var(--accent);
			color: var(--accent-ink);

			/* **Hover has to be said again here.** The plain hover above is the more specific rule - a
			   class and two pseudo-classes against two classes - so on its own it replaced the accent
			   with `--chrome` and kept the accent's ink: a black square in the dark theme, a white icon
			   on near-white in the light one. Pressed stays pressed under the pointer, a shade deeper. */
			&:hover:not(:disabled) {
				background: color-mix(in srgb, var(--accent) 85%, var(--ink));
			}
		}
	}

	.compass {
		color: var(--ink-2);

		span {
			display: flex;
			transition: transform 0.15s;
		}

		&.turned {
			color: var(--accent);
		}
	}

	/* The grid button keeps its place in the column; the stepper hangs off its left into the map. */
	.grid-row {
		position: relative;

		.stepper {
			position: absolute;
			top: 0;
			right: calc(100% + var(--space-2));
		}
	}

	/* One control, not three: the buttons share one border and shadow, so the group reads as a single
	   thing to set one number with. */
	.stepper {
		display: flex;
		align-items: stretch;
		height: 2rem;
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		overflow: hidden;

		button {
			font-size: var(--text-sm);
			padding: 0 var(--space-3);
			border: 0;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
			line-height: 1;

			&:hover:not(:disabled) {
				background: var(--chrome);
			}

			&:disabled {
				opacity: var(--disabled-opacity);
			}
		}

		.tag {
			display: flex;
			align-items: center;
			padding: 0 var(--space-1) 0 var(--space-3);
			color: var(--ink-2);
			font-size: var(--text-xs);
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}

		.level {
			font-family: var(--font-mono);
			/* Wide enough for two digits, so walking from z9 to z10 does not move the buttons. */
			min-width: 3.4em;
			text-align: center;
			border-left: 1px solid var(--rule);
			border-right: 1px solid var(--rule);

			/* Off the source's own level. Marked rather than merely different: a grid one level out is
			   the bug this control exists for, so it must never be the quiet state. */
			&.nudged {
				color: var(--accent);
				font-weight: 600;
				box-shadow: inset 0 -2px 0 var(--accent);
			}
		}
	}

	.readout {
		position: absolute;
		left: var(--space-4);
		bottom: var(--space-4);
		margin: 0;
		display: flex;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--float-bg) 85%, transparent);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-2);
		pointer-events: none;

		.zoom {
			color: var(--ink);
			font-weight: 600;
		}
	}

	/* The groups of the kit, one per kind of background, stacked at the kit's rhythm. */
	.backgrounds {
		display: flex;
		flex-direction: column;
		gap: var(--gap-group);
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		text-align: left;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);

		&:hover {
			background: var(--chrome);
		}

		/* The one in use, marked the way the views list marks the view you are on. */
		&.chosen {
			background: color-mix(in srgb, var(--accent) 12%, transparent);
			box-shadow: inset 2px 0 0 var(--accent);
		}
	}

	/* Pinned to the foot of the panel, which scrolls in a short window: a setting that applies to
	   every choice above it must not be the thing that scrolls out of sight. */
	.labels {
		position: sticky;
		bottom: calc(-1 * var(--space-3));
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) calc(-1 * var(--space-3)) calc(-1 * var(--space-3));
		padding: var(--space-2) var(--space-5) var(--space-3);
		border-top: 1px solid var(--rule);
		/* Opaque: `--float-bg` is this at 94%, which let the options scrolling under it show through. */
		background: var(--surface);
		font-size: var(--text-sm);

		&.off {
			color: var(--ink-2);
		}
	}

	/* Land, with a band of water across the bottom and a road across the land. */
	.swatch {
		flex: none;
		width: 1.6rem;
		height: 1.1rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background:
			linear-gradient(to bottom, transparent 62%, var(--water) 62%),
			linear-gradient(160deg, transparent 38%, var(--road) 38%, var(--road) 52%, transparent 52%), var(--land);

		/* Nothing drawn under the data: the empty square, struck through. */
		&.none {
			background: linear-gradient(to top right, transparent 47%, var(--rule) 47%, var(--rule) 53%, transparent 53%);
		}
	}
</style>
