<script lang="ts" module>
	/** One line or set of bars: a name for the legend, its colour as a token, and a count per step. */
	export interface Series {
		name: string;
		colour: string;
		counts: readonly number[];
	}
</script>

<script lang="ts">
	// A raster tile's pixels, counted (the tile dialog). Lines, one per colour channel, for imagery;
	// bars over the heights for a DEM, whose channels mean nothing one at a time.
	//
	// Drawn in pixels and read out below, for the reasons `SizeHistogram` gives: the dialog's column
	// is as wide as the window, and a tooltip would cover the neighbours being compared.

	let {
		series,
		bars = false,
		ticks,
		describe,
		label
	}: {
		series: Series[];
		/** Bars rather than lines: for one series over ranges, such as heights. */
		bars?: boolean;
		/** Where the axis is labelled, by step. */
		ticks: { at: number; text: string }[];
		/** What a step holds, in a sentence, for the readout. */
		describe: (step: number) => string;
		/** What is counted, for a screen reader. */
		label: string;
	} = $props();

	let width = $state(320);
	let hovered = $state<number | null>(null);

	const LEFT = 4;
	const RIGHT = 4;
	const TOP = 6;
	const PLOT = 90;
	const BOTTOM = 18;
	const HEIGHT = TOP + PLOT + BOTTOM;
	const baseline = TOP + PLOT;

	const steps = $derived(series[0]?.counts.length ?? 0);
	const slot = $derived(Math.max(1, (width - LEFT - RIGHT) / Math.max(1, steps)));
	const highest = $derived(Math.max(1, ...series.flatMap((one) => one.counts)));
	const x = (step: number) => LEFT + (step + 0.5) * slot;
	const y = (count: number) => baseline - (count / highest) * PLOT;

	const line = (counts: readonly number[]) => counts.map((count, step) => `${x(step)},${y(count)}`).join(' ');

	/// A bar: square at the baseline, rounded 4 px at its end, a 2 px gap to its neighbours.
	function bar(count: number, step: number): string {
		const w = Math.max(1, Math.min(24, slot - 2));
		const left = LEFT + step * slot + (slot - w) / 2;
		const h = (count / highest) * PLOT;
		const top = baseline - h;
		const r = Math.min(4, h, w / 2);
		return `M${left},${baseline}V${top + r}Q${left},${top} ${left + r},${top}H${left + w - r}Q${left + w},${top} ${left + w},${top + r}V${baseline}Z`;
	}

	const readout = $derived(
		hovered === null ? `Point at the chart, or use the arrow keys, for the counts.` : describe(hovered)
	);

	function point(event: PointerEvent): void {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const step = Math.floor((event.clientX - box.left - LEFT) / slot);
		hovered = step >= 0 && step < steps ? step : null;
	}

	function key(event: KeyboardEvent): void {
		if (steps === 0) return;
		const big = Math.max(1, Math.round(steps / 16));
		if (event.key === 'ArrowRight') hovered = hovered === null ? 0 : Math.min(steps - 1, hovered + 1);
		else if (event.key === 'ArrowLeft') hovered = hovered === null ? steps - 1 : Math.max(0, hovered - 1);
		else if (event.key === 'PageUp') hovered = Math.min(steps - 1, (hovered ?? 0) + big);
		else if (event.key === 'PageDown') hovered = Math.max(0, (hovered ?? 0) - big);
		else if (event.key === 'Home') hovered = 0;
		else if (event.key === 'End') hovered = steps - 1;
		else if (event.key === 'Escape') hovered = null;
		else return;
		event.preventDefault();
	}
</script>

<figure>
	<div bind:clientWidth={width}>
		<!-- One stop for the keyboard and a slider to a screen reader, as in `SizeHistogram`. -->
		<svg
			{width}
			height={HEIGHT}
			role="slider"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(0, steps - 1)}
			aria-valuenow={hovered ?? 0}
			aria-valuetext={readout}
			tabindex="0"
			onpointermove={point}
			onpointerleave={() => (hovered = null)}
			onkeydown={key}
			onblur={() => (hovered = null)}
		>
			{#if hovered !== null && !bars}
				<line class="cross" x1={x(hovered)} x2={x(hovered)} y1={TOP} y2={baseline} />
			{/if}
			{#each series as one (one.name)}
				{#if bars}
					{#each one.counts as count, step (step)}
						{#if count > 0}
							<path class="bar" class:hovered={hovered === step} style:fill={one.colour} d={bar(count, step)} />
						{/if}
					{/each}
				{:else}
					<polyline class="line" style:stroke={one.colour} points={line(one.counts)} />
				{/if}
			{/each}
			<line class="grid" x1={LEFT} x2={width - RIGHT} y1={baseline} y2={baseline} />
			{#each ticks as tick (tick.at)}
				<text
					class="axis"
					x={x(tick.at)}
					y={HEIGHT - 4}
					text-anchor={tick.at === 0 ? 'start' : tick.at === steps - 1 ? 'end' : 'middle'}>{tick.text}</text
				>
			{/each}
		</svg>
	</div>
	{#if series.length > 1}
		<!-- More than one line, so they are named here and not by colour alone. -->
		<ul class="legend">
			{#each series as one (one.name)}
				<li><span class="key" style:background={one.colour}></span>{one.name}</li>
			{/each}
		</ul>
	{/if}
	<figcaption aria-hidden="true">{readout}</figcaption>
</figure>

<style>
	figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		min-width: 0;
	}

	svg {
		display: block;

		&:focus-visible {
			outline-offset: 2px;
		}
	}

	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.bar.hovered {
		opacity: 0.7;
	}

	.cross,
	.grid {
		stroke: var(--rule);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}

	.axis {
		fill: var(--ink-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	figcaption {
		min-height: 1.45em;
		color: var(--ink-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.legend {
		display: flex;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--ink-2);
		font-size: var(--text-xs);

		li {
			display: flex;
			align-items: center;
			gap: var(--space-1);
		}
	}

	/* A short stroke in the line's colour: the legend mirrors the mark. */
	.key {
		width: 1rem;
		height: 2px;
		border-radius: var(--radius);
	}
</style>
