<script lang="ts">
	import { style } from '../../state/style.svelte';
	import type { Preset, Recolor } from '../../ipc/commands';

	// The style, as the recipe it is made from (S4.2, D1, [Q36]).
	//
	// **Presets and adjustments only.** The layer tree is D3 and arrives at S4.5; what is here is
	// the whole of D1 — where a style starts, and the adjustments that apply to every colour in it
	// at once. Building the tree first would have meant a list of 324 layers before there was any
	// way to change one.
	//
	// The controls below preview continuously and commit once, which is why each is bound to a
	// local value rather than to the recipe: a slider bound to the core would record an undo entry
	// per pixel of travel ([Q36]).

	const PRESETS: { id: Preset; label: string; note: string }[] = [
		{ id: 'colorful', label: 'Colorful', note: 'the default, full colour' },
		{ id: 'graybeard', label: 'Graybeard', note: 'muted greys' },
		{ id: 'neutrino', label: 'Neutrino', note: 'minimal, few layers' },
		{ id: 'shadow', label: 'Shadow', note: 'dark' },
		{ id: 'eclipse', label: 'Eclipse', note: 'dark, high contrast' },
		{ id: 'satellite', label: 'Satellite', note: 'for imagery underneath' }
	];

	/// Each slider's range and the value that means "unchanged".
	///
	/// The neutral value is what a cleared control returns to, and it is not always zero — a
	/// multiplier's identity is 1. Stored beside the range so the two cannot disagree.
	const SLIDERS = [
		{ key: 'rotate', label: 'Hue', min: -180, max: 180, step: 1, neutral: 0, unit: '°' },
		{ key: 'saturate', label: 'Saturation', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
		{ key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
		{ key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05, neutral: 1, unit: '×' },
		{ key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.05, neutral: 1, unit: '×' }
	] as const;

	const recipe = $derived(style.current);

	/// What the sliders show. Read from the recipe, written by dragging, committed on release.
	const value = (key: string): number => {
		const slider = SLIDERS.find((s) => s.key === key)!;
		const held = (recipe?.recolor as Record<string, number | null | undefined>)?.[key];
		return held ?? slider.neutral;
	};

	/// Applies one field of the recolouring without recording it.
	function preview(key: string, raw: string) {
		const slider = SLIDERS.find((s) => s.key === key)!;
		const next = Number(raw);
		style.previewRecolor({
			...(recipe?.recolor ?? {}),
			// Back to "unset" at the neutral value, so a slider returned to the middle leaves no
			// trace in the recipe and none in the exported code.
			[key]: next === slider.neutral ? undefined : next
		} as Recolor);
	}

	function invert(on: boolean) {
		style.previewRecolor({ ...(recipe?.recolor ?? {}), invertBrightness: on || undefined } as Recolor);
		void style.commitRecolor();
	}

	function reset() {
		style.previewRecolor({});
		void style.commitRecolor();
	}

	const adjusted = $derived(Object.values(recipe?.recolor ?? {}).some((v) => v !== undefined && v !== null));
</script>

{#if recipe}
	<section class="style-pane">
		<h2 class="section-label">Preset</h2>
		<div class="presets">
			{#each PRESETS as preset (preset.id)}
				<button
					type="button"
					class="preset"
					class:chosen={recipe.preset === preset.id}
					aria-pressed={recipe.preset === preset.id}
					title={preset.note}
					onclick={() => void style.setPreset(preset.id)}
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<h2 class="section-label">
			Adjust
			{#if adjusted}
				<button type="button" class="reset" onclick={reset}>reset</button>
			{/if}
		</h2>

		<label class="toggle">
			<input
				type="checkbox"
				checked={recipe.recolor.invertBrightness ?? false}
				onchange={(event) => invert(event.currentTarget.checked)}
			/>
			Invert brightness
			<!-- D5's whole feature. Hues are kept, so a light style becomes a dark one rather than a
			     photographic negative. -->
			<span class="note">light ↔ dark</span>
		</label>

		{#each SLIDERS as slider (slider.key)}
			<label class="slider">
				<span class="name">{slider.label}</span>
				<input
					type="range"
					min={slider.min}
					max={slider.max}
					step={slider.step}
					value={value(slider.key)}
					oninput={(event) => preview(slider.key, event.currentTarget.value)}
					onchange={() => void style.commitRecolor()}
					onpointercancel={() => style.cancelRecolor()}
				/>
				<span class="amount">{value(slider.key)}{slider.unit}</span>
			</label>
		{/each}

		<p class="note">The layer tree is D3 and arrives with S4.5. These apply to every colour in the style at once.</p>
	</section>
{/if}

<style>
	.style-pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}

	.preset {
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--ink-2);
		font-size: var(--text-sm);
		cursor: pointer;

		&:hover {
			color: var(--ink);
		}

		&.chosen {
			border-color: var(--accent);
			color: var(--ink);
		}
	}

	.reset {
		margin-left: var(--space-2);
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.slider {
		display: grid;
		grid-template-columns: 5.5rem 1fr 3rem;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-xs);

		.name {
			white-space: nowrap;
		}

		/* A number that changes as the slider moves; without this the row twitches as digits
		   change width. */
		.amount {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			text-align: right;
		}

		input {
			min-width: 0;
		}
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}
</style>
