<script lang="ts">
	import Note from '../common/Note.svelte';
	import Icon from '../common/Icon.svelte';
	import { children, neighbour, parent, type TileAt } from '../state/tile-dialog.svelte';

	// Where to go from one tile, drawn as where it is (S14.5).
	//
	// **A little map, not a row of words.** Parent, four children and four arrows in a line asked
	// the reader to turn "SE" and an arrow back into a place. Here the tile is the middle of a 3×3
	// grid: the eight squares around it are its neighbours, where they lie, and its four quarters
	// are its children, where they lie. Only the parent has no place on that map, so it is a button
	// beside it, with its address.
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

<div class="navigator">
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

	<div class="side">
		<div class="up">
			<button type="button" class="button" disabled={!up} onclick={() => go(up)}>Parent</button>
			{#if up}<span class="where">{name(up)}</span>{/if}
		</div>
		<Note>A square beside the tile is its neighbour; a quarter of it zooms in.</Note>
	</div>
</div>

<style>
	.navigator {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.grid {
		--cell: 2.25rem;

		display: grid;
		grid-template-columns: repeat(3, var(--cell));
		grid-template-rows: repeat(3, var(--cell));
		gap: 2px;
		flex: none;
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

	/* The tile itself: the accent's edge, and its four quarters inside it. */
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

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.up {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.where {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
