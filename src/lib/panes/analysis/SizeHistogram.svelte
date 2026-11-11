<script lang="ts">
	import type { Histogram } from '../../ipc/commands';
	import { bars, ceiling, compact, describe, lowerBound, size, STEPS, ticks, type Bar } from './histogram';

	// How many tiles there are of each size (#23): one bar per bucket of the core's, on a log scale,
	// with the median, the 95% size and the budget marked.
	//
	// **Drawn in pixels, not a viewBox.** The pane is as wide as someone drags it, and a viewBox would
	// scale the axis text with it. The width is measured and every position worked out from it.
	//
	// **The values are under the chart, not in a floating tooltip.** In a pane this narrow a tooltip
	// covers the bars beside the one pointed at, which are the ones it is being compared with. The same
	// line answers the keyboard: the arrow keys move along the bars.

	let {
		histogram,
		p50,
		p95,
		budget,
		label
	}: {
		histogram: Histogram;
		p50: number;
		p95: number;
		/** The size marked as too big, as the zoom table marks it. */
		budget: number;
		/** What the chart is of, such as "all levels" or "zoom 14", for a screen reader. */
		label: string;
	} = $props();

	let width = $state(280);
	let hovered = $state<number | null>(null);

	const LEFT = 36;
	const RIGHT = 8;
	/// Two rows for the marks' names, so the budget's never lands on the 95%'s.
	const TOP = 28;
	const PLOT = 110;
	const BOTTOM = 18;
	const HEIGHT = TOP + PLOT + BOTTOM;
	/// Wide enough to read as a bar and no wider (the dataviz spec caps a bar at 24 px).
	const BAR = 24;
	/// The surface gap between neighbouring bars, and the gap that sets the empty tiles apart.
	const GAP = 2;

	const list = $derived(bars(histogram));
	const empty = $derived(histogram.empty > 0);
	const sized = $derived(histogram.counts.length);
	/// One slot per bucket, plus one and a half for the empty tiles when there are any.
	const slot = $derived(Math.max(1, (width - LEFT - RIGHT) / Math.max(1, sized + (empty ? 1.5 : 0))));
	const start = $derived(LEFT + (empty ? 1.5 * slot : 0));
	const top = $derived(ceiling(Math.max(0, ...list.map((bar) => bar.tiles))));
	const baseline = TOP + PLOT;

	/// Where a size sits along the axis: buckets are equal steps in log space, so this is linear in log2.
	const along = (bytes: number) => start + (Math.log2(bytes) * STEPS - histogram.first) * slot;
	const smallest = $derived(lowerBound(histogram.first));
	const largest = $derived(lowerBound(histogram.first + sized));
	const inside = (bytes: number) => sized > 0 && bytes >= smallest && bytes <= largest;

	function slotOf(index: number): number {
		if (empty && index === 0) return LEFT;
		return start + (index - (empty ? 1 : 0)) * slot;
	}

	/// A bar as a path: square at the baseline, rounded 4 px at its end.
	function shape(bar: Bar, index: number): string {
		const w = Math.max(1, Math.min(BAR, slot - GAP));
		const x = slotOf(index) + (slot - w) / 2;
		const h = (bar.tiles / top) * PLOT;
		const y = baseline - h;
		const r = Math.min(4, h, w / 2);
		return `M${x},${baseline}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${baseline}Z`;
	}

	/// The axis's own spelling: "1 kB" rather than the column's "1.0 kB".
	const tickLabel = (bytes: number) =>
		bytes < 1e3 ? `${bytes} B` : bytes < 1e6 ? `${bytes / 1e3} kB` : `${bytes / 1e6} MB`;

	/// The marks, each named on the side away from the others: the median to its left, the 95% to its
	/// right, the budget on its own row. Flipped when the name would run off the chart.
	const marks = $derived(
		[
			{ key: 'median', bytes: p50, text: 'median', side: 'end', row: 0 },
			{ key: 'p95', bytes: p95, text: '95%', side: 'start', row: 0 },
			{ key: 'budget', bytes: budget, text: size(budget), side: 'end', row: 1 }
		]
			.filter((mark) => mark.bytes > 0 && inside(mark.bytes))
			.map((mark) => {
				const x = along(mark.bytes);
				const wide = mark.text.length * 6.5;
				let side = mark.side;
				if (side === 'end' && x - wide < 0) side = 'start';
				if (side === 'start' && x + wide > width) side = 'end';
				return { ...mark, x, side, y: 10 + mark.row * 12 };
			})
	);

	const summary = $derived(
		`${label}: median ${size(p50)}, 95% ${size(p95)}. Point at a bar, or use the arrow keys, for its tiles.`
	);
	const readout = $derived(hovered === null || !list[hovered] ? summary : describe(list[hovered]));

	function point(event: PointerEvent): void {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const x = event.clientX - box.left;
		hovered = list.findIndex((_, index) => x >= slotOf(index) && x < slotOf(index) + slot);
		if (hovered < 0) hovered = null;
	}

	function key(event: KeyboardEvent): void {
		if (list.length === 0) return;
		if (event.key === 'ArrowRight') hovered = hovered === null ? 0 : Math.min(list.length - 1, hovered + 1);
		else if (event.key === 'ArrowLeft') hovered = hovered === null ? list.length - 1 : Math.max(0, hovered - 1);
		else if (event.key === 'Home') hovered = 0;
		else if (event.key === 'End') hovered = list.length - 1;
		else if (event.key === 'Escape') hovered = null;
		else return;
		event.preventDefault();
	}
</script>

<div class="histogram">
	<figure>
		<div class="plot" bind:clientWidth={width}>
			<!-- One stop for the keyboard, not one per bar: thirty tab stops to cross one chart would be
		     worse than the arrow keys. **A slider**, because that is what this is to a keyboard - the
		     arrows move along the bars - and its spoken value is the readout below. -->
			<svg
				{width}
				height={HEIGHT}
				role="slider"
				aria-label="Tile sizes, {label}"
				aria-valuemin={0}
				aria-valuemax={Math.max(0, list.length - 1)}
				aria-valuenow={hovered ?? 0}
				aria-valuetext={readout}
				tabindex="0"
				onpointermove={point}
				onpointerleave={() => (hovered = null)}
				onkeydown={key}
				onblur={() => (hovered = null)}
			>
				<line class="grid" x1={LEFT} x2={width - RIGHT} y1={TOP} y2={TOP} />
				<text class="axis" x={LEFT - 4} y={TOP + 4} text-anchor="end">{compact(top)}</text>
				<text class="axis" x={LEFT - 4} y={baseline} text-anchor="end">0</text>

				{#each list as bar, index (bar.bucket ?? 'empty')}
					<path class="bar" class:hovered={hovered === index} d={shape(bar, index)} />
				{/each}

				<line class="grid" x1={LEFT} x2={width - RIGHT} y1={baseline} y2={baseline} />
				{#if empty}
					<text class="axis" x={LEFT + slot / 2} y={HEIGHT - 4} text-anchor="middle">0 B</text>
				{/if}
				{#each ticks(smallest, largest) as tick (tick)}
					<line class="tick" x1={along(tick)} x2={along(tick)} y1={baseline} y2={baseline + 3} />
					<text class="axis" x={along(tick)} y={HEIGHT - 4} text-anchor="middle">{tickLabel(tick)}</text>
				{/each}

				{#each marks as mark (mark.key)}
					<line class="mark" class:budget={mark.key === 'budget'} x1={mark.x} x2={mark.x} y1={TOP} y2={baseline} />
					<text
						class="mark-name"
						class:budget={mark.key === 'budget'}
						x={mark.side === 'end' ? mark.x - 3 : mark.x + 3}
						y={mark.y}
						text-anchor={mark.side}>{mark.text}</text
					>
				{/each}
			</svg>
		</div>
		<!-- Hidden from a screen reader, which hears the same words as the slider's value. -->
		<figcaption aria-hidden="true">{readout}</figcaption>
	</figure>

	<!-- The chart's twin, for whoever reads tables rather than shapes - and for every count the bars
	     are too small to show. -->
	<details>
		<summary>As a table</summary>
		<table class="figures" aria-label="Tiles by size, {label}">
			<thead><tr><th scope="col">Size</th><th scope="col">Tiles</th></tr></thead>
			<tbody>
				{#each list.filter((bar) => bar.tiles > 0) as bar (bar.bucket ?? 'empty')}
					<tr>
						<th scope="row">{bar.bucket === null ? '0 B' : `${size(bar.low)} – ${size(bar.high)}`}</th>
						<td>{bar.tiles.toLocaleString('en-US')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</div>

<style>
	.histogram,
	figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		min-width: 0;
	}

	.plot {
		min-width: 0;
	}

	svg {
		display: block;
		border-radius: var(--radius);

		/* The ring is base.css's; only its distance is the chart's, so it clears the bars. */
		&:focus-visible {
			outline-offset: 2px;
		}
	}

	.bar {
		fill: var(--accent);

		&.hovered {
			fill: color-mix(in srgb, var(--accent) 65%, var(--ink));
		}
	}

	/* Hairlines one step off the surface: the frame is not data. */
	.grid,
	.tick {
		stroke: var(--rule);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}

	.mark {
		stroke: var(--ink-2);
		stroke-width: 1;
		shape-rendering: crispEdges;

		&.budget {
			stroke: var(--error);
		}
	}

	.axis,
	.mark-name {
		fill: var(--ink-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.mark-name.budget {
		fill: var(--error);
	}

	figcaption {
		min-height: 1.45em;
		color: var(--ink-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	summary {
		cursor: pointer;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}
</style>
