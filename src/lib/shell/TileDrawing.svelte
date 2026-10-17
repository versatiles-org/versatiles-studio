<script lang="ts" module>
	import type { FeatureDissection, Part } from '../ipc/commands';

	/** The layer colours there are; the ninth layer takes the first again. */
	const COLOURS = 8;

	/** A layer's colour, by its position in the tile - the drawing's and its row's alike. */
	export function layerColour(layer: number): string {
		return `var(--layer-${(layer % COLOURS) + 1})`;
	}

	/** How far past the tile's edge the drawing shows, as a share of its extent: an eighth. */
	const BUFFER = 1 / 8;

	/**
	 * The square the drawing shows - the tile, and as much of the buffer as the features use, up to an
	 * eighth of the tile - and how many features reach further than that.
	 *
	 * **Not as far as the farthest point.** One stray vertex a tile away made the square three tiles
	 * wide and drew the tile itself in its middle third; past the buffer is what a renderer clips
	 * anyway, so it is counted rather than shown.
	 */
	export function reach(features: FeatureDissection[], extent: number): { at: number; side: number; beyond: number } {
		const [low, high] = [-extent * BUFFER, extent * (1 + BUFFER)];
		let [min, max] = [0, extent];
		let beyond = 0;
		for (const feature of features) {
			let out = false;
			for (const part of feature.parts)
				for (const [x, y] of part.points) {
					if (x < low || y < low || x > high || y > high) out = true;
					min = Math.max(low, Math.min(min, x, y));
					max = Math.min(high, Math.max(max, x, y));
				}
			if (out) beyond++;
		}
		const pad = (max - min) / 50;
		return { at: min - pad, side: max - min + 2 * pad, beyond };
	}
</script>

<script lang="ts">
	// One tile drawn alone, in its own coordinates (S14.5, A4).
	//
	// **What the map hides is the point.** The map clips a tile to its edge, closes its rings and
	// fills holes by winding; this draws the buffer past the edge, every vertex if asked, and each
	// ring as it was wound - solid for an outer ring, dashed for a hole, in the error colour for one
	// that encloses nothing. Tile coordinates have y pointing down, which is SVG's own, so nothing
	// is flipped.
	//
	// **A colour per layer**, the same as its swatch in the dialog's tables: one blue for eighteen
	// layers drew a tile nobody could take apart by eye. A picked layer is drawn in full and the
	// others fade; a picked feature takes the accent.
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

	/// The square to show: the tile, and the buffer the features reach into, up to an eighth.
	const box = $derived(reach(features, extent));

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
			style:--hue={layerColour(feature.layer)}
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
		/* Each feature's layer colour comes inline; this is only what a feature with none would get. */
		--hue: var(--map-feature);

		cursor: pointer;
		fill: none;
		stroke: var(--hue);
		stroke-width: 1;

		&.faded {
			opacity: 0.15;
		}

		&.selected {
			stroke: var(--accent);
			stroke-width: 2;
		}
	}

	.fill {
		fill: var(--hue);
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
		fill: var(--hue);
		fill-opacity: 0.5;
	}

	.vertex {
		fill: currentColor;
		stroke: none;
		color: var(--ink);
	}
</style>
