<script lang="ts">
	import type { FeatureDissection, Part } from '../ipc/commands';

	// One tile drawn alone, in its own coordinates (S14.5, A4).
	//
	// **What the map hides is the point.** The map clips a tile to its edge, closes its rings and
	// fills holes by winding; this draws the buffer past the edge, every vertex if asked, and each
	// ring as it was wound - solid for an outer ring, dashed for a hole, in the error colour for one
	// that encloses nothing. Tile coordinates have y pointing down, which is SVG's own, so nothing
	// is flipped.
	//
	// Strokes do not scale: an extent of 4096 in a 400 px square would make a one-unit line a
	// tenth of a pixel.
	let {
		features,
		extent,
		selected,
		focus,
		vertices,
		onSelect
	}: {
		features: FeatureDissection[];
		/** The tile's edge, in its coordinates. */
		extent: number;
		/** The feature picked, by layer and position in it. */
		selected: { layer: number; index: number } | null;
		/** The layer to draw in full; the others are faded. `null` draws every layer in full. */
		focus: number | null;
		/** Whether to mark every vertex. */
		vertices: boolean;
		onSelect: (layer: number, index: number) => void;
	} = $props();

	/// The square to show: the tile, and whatever of the buffer the features reach into.
	const box = $derived.by(() => {
		let [min, max] = [0, extent];
		for (const feature of features)
			for (const part of feature.parts)
				for (const [x, y] of part.points) {
					min = Math.min(min, x, y);
					max = Math.max(max, x, y);
				}
		const pad = (max - min) / 50;
		return { at: min - pad, side: max - min + 2 * pad };
	});

	/// A point's radius and a vertex's, in tile units, so they read the same at any extent.
	const dot = $derived(box.side / 400);

	const path = (parts: Part[]) =>
		parts.map((part) => `M${part.points.map(([x, y]) => `${x} ${y}`).join('L')}${part.closed ? 'Z' : ''}`).join('');

	const isSelected = (feature: FeatureDissection) =>
		selected?.layer === feature.layer && selected.index === feature.index;
</script>

<svg
	viewBox="{box.at} {box.at} {box.side} {box.side}"
	role="img"
	aria-label="The tile drawn alone, with its buffer, in its own coordinates"
>
	<rect class="edge" x="0" y="0" width={extent} height={extent} vector-effect="non-scaling-stroke" />
	{#each features as feature (`${feature.layer}/${feature.index}`)}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<g
			class="feature {feature.kind}"
			class:faded={focus !== null && feature.layer !== focus}
			class:selected={isSelected(feature)}
			onclick={() => onSelect(feature.layer, feature.index)}
		>
			{#if feature.kind === 'point'}
				{#each feature.parts as part, i (i)}
					<circle cx={part.points[0][0]} cy={part.points[0][1]} r={dot} vector-effect="non-scaling-stroke" />
				{/each}
			{:else if feature.kind === 'polygon'}
				<path class="fill" d={path(feature.parts)} />
				{#each feature.parts as part, i (i)}
					<path
						class="ring"
						class:hole={(part.area ?? 0) < 0}
						class:degenerate={!part.closed || !part.area}
						d={path([part])}
						vector-effect="non-scaling-stroke"
					/>
				{/each}
			{:else}
				<path
					class="line"
					class:degenerate={feature.malformed}
					d={path(feature.parts)}
					vector-effect="non-scaling-stroke"
				/>
			{/if}
			{#if vertices && feature.kind !== 'point'}
				{#each feature.parts as part, i (i)}
					{#each part.points as [x, y], j (j)}
						<circle class="vertex" cx={x} cy={y} r={dot / 2} />
					{/each}
				{/each}
			{/if}
		</g>
	{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--map-bg);
	}

	.edge {
		fill: none;
		stroke: var(--ink-2);
		stroke-dasharray: 4 3;
	}

	.feature {
		cursor: pointer;
		fill: none;
		stroke: var(--map-feature);
		stroke-width: 1;

		&.faded {
			opacity: 0.2;
		}

		&.selected {
			stroke: var(--accent);
			stroke-width: 2;
		}
	}

	.fill {
		fill: var(--map-feature);
		fill-opacity: 0.15;
		fill-rule: evenodd;
		stroke: none;
	}

	.selected .fill {
		fill: var(--accent);
	}

	.hole {
		stroke-dasharray: 3 2;
	}

	.degenerate {
		stroke: var(--error);
	}

	.point circle {
		fill: var(--map-feature);
		fill-opacity: 0.5;
	}

	.vertex {
		fill: currentColor;
		stroke: none;
		color: var(--ink);
	}
</style>
