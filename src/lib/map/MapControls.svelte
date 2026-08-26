<script lang="ts">
	import type { Snippet } from 'svelte';
	import { BACKGROUNDS, type BackgroundId } from './background';
	import Dropdown from './Dropdown.svelte';

	// The controls that act on the map rather than on the pipeline.
	//
	// Gathered into one cluster because they had started to accumulate as loose buttons in the
	// corner: what belongs here is anything about *looking* at the result, and nothing about what
	// the result is - that is the left pane's business.
	let {
		views,
		jump,
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
		/** The saved-views dropdown, rendered beside `reset` - both answer "where am I looking". */
		views?: Snippet;
		/** The coordinate box. Passed in for the same reason: this file arranges, App composes. */
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
	<!-- The saved views and "reset" on one line: both answer "where am I looking", and reset is the
	     view you did not have to name. -->
	<div class="row">
		{@render views?.()}
		<button type="button" disabled={!canReset} onclick={onReset} title="Fit the map to what is open"> reset </button>
	</div>

	{@render jump?.()}

	<!-- **A dropdown, not a `<select>`.** A native popup on macOS obeys none of the map's chrome, and
	     everywhere else it reads as a form field on a map made of buttons. `Dropdown` is the saved
	     views' own control, so the two match by construction rather than by anyone remembering to
	     keep them in step. -->
	<Dropdown
		label={BACKGROUNDS.find((item) => item.id === background)?.label ?? 'Background'}
		title="Background map - the only part of Studio that fetches from the network"
		width="11rem"
	>
		{#snippet panel(close: () => void)}
			<div role="group" aria-label="Background map">
				{#each groups as group (group.label)}
					{#if group.label}<p class="group">{group.label}</p>{/if}
					{#each group.items as item (item.id)}
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
							{item.label}
						</button>
					{/each}
				{/each}
			</div>
		{/snippet}
	</Dropdown>

	<!-- The stepper opens to the *right* of the grid button rather than under it: it belongs to that
	     button, and a column of two would read as two controls that happen to be adjacent. -->
	<div class="row">
		<button type="button" class:on={showGrid} onclick={onToggleGrid} title="Show the z/x/y tile grid (A5)">
			grid
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
	</div>
</div>

<style>
	/* A column in the map's control stack ([Q52]). Each control is as wide as what it says rather
	   than stretched to the widest, so the stack reads as a list of separate things down one edge -
	   which is what they are - instead of a panel with a ragged right. */
	.controls {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	/* Two controls that belong together stay on one line; everything else is its own row. */
	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	/* Which group of backgrounds follows - the `<optgroup>`s the native popup used to draw. */
	.group {
		margin: var(--space-3) 0 var(--space-1);
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);

		&:first-child {
			margin-top: 0;
		}
	}

	.option {
		display: block;
		width: 100%;
		text-align: left;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: none;
		box-shadow: none;

		&:hover {
			background: var(--chrome);
		}

		/* The one in use, marked the way the views list marks the view you are on. */
		&.chosen {
			background: color-mix(in srgb, var(--accent) 12%, transparent);
			box-shadow: inset 2px 0 0 var(--accent);
		}
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
