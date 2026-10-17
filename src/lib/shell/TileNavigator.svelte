<script lang="ts">
	import Icon from '../common/Icon.svelte';
	import { children, neighbour, parent, type TileAt } from '../state/tile-dialog.svelte';

	// Where to go from one tile, drawn as where it is (S14.5).
	//
	// **A little map, not a row of words.** Parent, four children and four arrows in a line asked
	// the reader to turn "SE" and an arrow back into a place. Here the tile is the middle of a 3×3
	// grid: the eight squares around it are its neighbours, where they lie, and its four quarters
	// are its children, where they lie. Only the parent has no place on that map, so it is the zoom
	// out beneath it, as on the map's own controls.
	//
	// **On the drawing**, in its corner like the map's controls: it is about where this tile is, and
	// the drawing is the tile. Each square says in its tooltip where it goes, so there is no sentence
	// explaining them.
	//
	// East and west wrap round the antimeridian as the map does; past the poles there is nothing, and
	// that square is drawn but cannot be pressed.
	let {
		at,
		onGo
	}: {
		at: TileAt;
		onGo: (z: number, x: number, y: number) => void;
	} = $props();

	const COMPASS = [
		['North-west', 'North', 'North-east'],
		['West', null, 'East'],
		['South-west', 'South', 'South-east']
	] as const;
	const QUARTERS = ['north-west', 'north-east', 'south-west', 'south-east'] as const;
	/** The arrow a straight step carries; a diagonal is plain, its place says enough. */
	const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
		North: 'up',
		South: 'down',
		West: 'left',
		East: 'right'
	};

	const up = $derived(parent(at.z, at.x, at.y));
	const down = $derived(children(at.z, at.x, at.y));
	const name = (tile: { z: number; x: number; y: number }) => `${tile.z}/${tile.x}/${tile.y}`;

	function go(target: { z: number; x: number; y: number } | null) {
		if (target) onGo(target.z, target.x, target.y);
	}
</script>

<div class="navigator popover" role="group" aria-label="Move to another tile">
	<div class="grid" role="group" aria-label="Neighbours and children">
		{#each COMPASS as row, dy (dy)}
			{#each row as label, dx (dx)}
				{#if label === null}
					<div class="here" role="group" aria-label="Children of {name(at)}">
						{#each down as child, i (i)}
							<button
								type="button"
								class="quarter"
								aria-label="Child {QUARTERS[i]}"
								title="Zoom in: {name(child)}"
								onclick={() => go(child)}
							></button>
						{/each}
					</div>
				{:else}
					{@const target = neighbour(at.z, at.x, at.y, dx - 1, dy - 1)}
					<button
						type="button"
						class="cell"
						aria-label={label}
						title={target ? `${label}: ${name(target)}` : `${label}: past the edge of the world`}
						disabled={!target}
						onclick={() => go(target)}
						>{#if ARROWS[label]}<Icon name={ARROWS[label]} size="0.9em" />{/if}</button
					>
				{/if}
			{/each}
		{/each}
	</div>
	<button
		type="button"
		class="cell out"
		aria-label="Parent"
		title={up ? `Zoom out: ${name(up)}` : 'Zoom out: this is the whole world'}
		disabled={!up}
		onclick={() => go(up)}><Icon name="minus" size="0.9em" /></button
	>
</div>

<style>
	.navigator {
		--cell: 2rem;

		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-1);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, var(--cell));
		grid-template-rows: repeat(3, var(--cell));
		gap: 2px;
	}

	.cell,
	.quarter {
		padding: 0;
		border: 1px solid var(--rule);
		background: var(--chrome);
		cursor: pointer;

		&:hover:not(:disabled) {
			border-color: var(--accent);
			background: color-mix(in srgb, var(--accent) 18%, var(--chrome));
		}

		&:disabled {
			opacity: var(--disabled-opacity);
			cursor: default;
		}
	}

	.cell {
		display: grid;
		place-items: center;
		border-radius: var(--radius);
		color: var(--ink-2);
	}

	/* The parent, the width of the grid: one level up is the one move with no place on it. */
	.out {
		height: 1.5rem;
	}

	/* The gap between the quarters shows the accent behind them, so the tile reads as four. */
	.here {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 1px;
		background: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.quarter {
		border: none;
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));

		&:hover {
			background: var(--accent);
		}
	}
</style>
