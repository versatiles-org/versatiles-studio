<script lang="ts">
	import { BACKGROUNDS, type BackgroundId } from './background';

	// The controls that act on the map rather than on the pipeline.
	//
	// Gathered into one cluster because they had started to accumulate as loose buttons in the
	// corner: what belongs here is anything about *looking* at the result, and nothing about what
	// the result is - that is the left pane's business.
	let {
		background,
		showGrid,
		gridLevel,
		gridNudged = false,
		canReset,
		onBackground,
		onToggleGrid,
		onGridLevel,
		onReset
	}: {
		background: BackgroundId;
		showGrid: boolean;
		/** The level the grid is drawing, which is the source's own unless someone walked off it. */
		gridLevel: number;
		/** Whether that is off the level MapLibre is actually requesting. */
		gridNudged?: boolean;
		/** False when there is nothing open, so there is no extent to return to. */
		canReset: boolean;
		onBackground: (id: BackgroundId) => void;
		onToggleGrid: () => void;
		/** Walks the grid a level in or out; `0` puts it back on the source's own. */
		onGridLevel: (by: number) => void;
		onReset: () => void;
	} = $props();

	/** Grouped so light and dark options are not shuffled together. */
	const groups = $derived([
		{ label: '', items: BACKGROUNDS.filter((b) => b.group === 'off') },
		{ label: 'Light', items: BACKGROUNDS.filter((b) => b.group === 'light') },
		{ label: 'Dark', items: BACKGROUNDS.filter((b) => b.group === 'dark') },
		{ label: 'Imagery', items: BACKGROUNDS.filter((b) => b.group === 'imagery') }
	]);
</script>

<div class="controls">
	<label class="picker">
		<span class="visually-hidden">Background map</span>
		<select
			value={background}
			title="Background map - the only part of Studio that fetches from the network"
			onchange={(event) => onBackground(event.currentTarget.value as BackgroundId)}
		>
			{#each groups as group (group.label)}
				{#if group.label}
					<optgroup label={group.label}>
						{#each group.items as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
					</optgroup>
				{:else}
					{#each group.items as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
				{/if}
			{/each}
		</select>
	</label>

	<button type="button" class:on={showGrid} onclick={onToggleGrid} title="Show the z/x/y tile grid (A5)">
		z/x/y grid
	</button>

	<!-- **Only while the grid is on.** Off, this cluster is one button doing one thing, which is what
	     it was; a stepper for a grid that is not drawn would be a permanent control for an occasional
	     question.

	     Three targets and no mode names, because the offset is not a constant: it is one level for a
	     256px source, nought or one for imagery depending on where in the zoom you are, and a stack
	     whose sources disagree has no single right answer at all. A nudge covers every case; a named
	     mode stops being true in the third. -->
	{#if showGrid}
		<div class="stepper" role="group" aria-label="Grid zoom level">
			<button type="button" onclick={() => onGridLevel(-1)} disabled={gridLevel === 0} title="One level out">
				&minus;
			</button>
			<!-- The number is the readout *and* the way back: what changed is the level, so the level
			     carries the mark and undoes it, rather than a fourth button in the corner. -->
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

	<button type="button" disabled={!canReset} onclick={onReset} title="Fit the map to what is open"> Reset view </button>
</div>

<style>
	.controls {
		position: absolute;
		right: var(--space-4);
		bottom: var(--space-4);
		z-index: 4;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		/* Wraps rather than running under the attribution on a narrow window. */
		flex-wrap: wrap;
		justify-content: flex-end;
		max-width: calc(100% - var(--space-5));
	}

	button,
	select {
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	button:disabled {
		opacity: 0.5;
	}

	.picker {
		display: block;
	}

	/* One control, not three: the buttons share the border and the shadow that each of the others
	   carries on its own, so the group reads as a single thing to set one number with. */
	.stepper {
		display: flex;
		align-items: stretch;
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		overflow: hidden;

		button {
			border: 0;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
			line-height: 1;

			&:hover:not(:disabled) {
				background: var(--chrome);
			}
		}

		.level {
			font-family: var(--font-mono);
			/* Wide enough for two digits, so walking from z9 to z10 does not move the buttons. */
			min-width: 3.4em;
			text-align: center;
			border-left: 1px solid var(--rule);
			border-right: 1px solid var(--rule);

			/* Off the source's own level. Marked rather than merely different: a grid one level out
			   is the bug this control exists for, so it must never be the quiet state. */
			&.nudged {
				color: var(--accent);
				font-weight: 600;
				box-shadow: inset 0 -2px 0 var(--accent);
			}
		}
	}
</style>
