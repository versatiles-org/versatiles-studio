<script lang="ts" module>
	/** Every icon Studio draws. */
	export type IconName =
		// The map's controls.
		| 'search'
		| 'star'
		| 'star-filled'
		| 'fit'
		| 'layers'
		| 'grid'
		| 'heat'
		| 'plus'
		| 'minus'
		| 'compass'
		// The panes' glyph buttons, and the two switches.
		| 'eye'
		| 'eye-off'
		| 'power'
		| 'remove'
		| 'rename'
		| 'up'
		| 'down'
		| 'left'
		| 'right'
		| 'undo'
		| 'redo'
		| 'format'
		| 'browse'
		| 'steps'
		| 'draw'
		| 'chevron';
</script>

<script lang="ts">
	// Studio's icons, drawn inline - no icon font, no sprite, nothing to load (S13).
	//
	// **One set, not two.** The map's controls had these as `MapIcon`, and the panes drew their
	// glyph buttons with text - ×, ✎, ↑, ↓, ↺, ↻, ¶, …, ▭, ⋮, ◉, ○ - which render in whatever the
	// platform's UI font makes of each character, so a × on macOS and one on Linux were different
	// weights beside the same label. The power switch was an SVG pasted into two components. A
	// 16-unit box and one stroke width, so every glyph reads as one set wherever it sits.
	//
	// Decorative: every button that shows one carries its own `aria-label` and `title`.

	let { name, size = 16 }: { name: IconName; size?: number | string } = $props();
</script>

<svg
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
	fill="none"
	stroke="currentColor"
	stroke-width="1.3"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#if name === 'search'}
		<circle cx="7" cy="7" r="4.5" />
		<path d="m10.4 10.4 3.6 3.6" />
	{:else if name === 'star' || name === 'star-filled'}
		<path
			d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"
			fill={name === 'star-filled' ? 'currentColor' : 'none'}
		/>
	{:else if name === 'fit'}
		<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
		<rect x="5.5" y="5.5" width="5" height="5" rx="0.5" />
	{:else if name === 'layers'}
		<path d="m8 2 6 3.2L8 8.4 2 5.2Z" />
		<path d="m2 8 6 3.2L14 8" />
		<path d="m2 10.8 6 3.2 6-3.2" />
	{:else if name === 'grid'}
		<rect x="2" y="2" width="12" height="12" rx="0.5" />
		<path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
	{:else if name === 'heat'}
		<!-- Squares of three weights: a size map reads as a grid whose cells differ. -->
		<rect x="2" y="2" width="5" height="5" rx="0.5" fill="currentColor" fill-opacity="0.25" />
		<rect x="9" y="2" width="5" height="5" rx="0.5" fill="currentColor" />
		<rect x="2" y="9" width="5" height="5" rx="0.5" fill="currentColor" fill-opacity="0.6" />
		<rect x="9" y="9" width="5" height="5" rx="0.5" />
	{:else if name === 'plus'}
		<path d="M8 3v10M3 8h10" />
	{:else if name === 'minus'}
		<path d="M3 8h10" />
	{:else if name === 'compass'}
		<!-- North in the accent half, so which way is up reads at a glance once the map turns. -->
		<path d="M8 1.5 10.5 8h-5Z" fill="currentColor" stroke="none" />
		<path d="M8 14.5 5.5 8h5Z" />
	{:else if name === 'eye'}
		<path d="M1.5 8s2.4-4.3 6.5-4.3S14.5 8 14.5 8s-2.4 4.3-6.5 4.3S1.5 8 1.5 8Z" />
		<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
	{:else if name === 'eye-off'}
		<path d="M1.5 8s2.4-4.3 6.5-4.3S14.5 8 14.5 8s-2.4 4.3-6.5 4.3S1.5 8 1.5 8Z" />
		<circle cx="8" cy="8" r="2" />
	{:else if name === 'power'}
		<path d="M5.2 4.6a4.6 4.6 0 1 0 5.6 0" />
		<path d="M8 2.2v5.6" />
	{:else if name === 'remove'}
		<path d="m4 4 8 8M12 4l-8 8" />
	{:else if name === 'rename'}
		<path d="m11.3 2.7 2 2L5 13H3v-2Z" />
		<path d="m9.8 4.2 2 2" />
	{:else if name === 'up'}
		<path d="M8 13V3M4 7l4-4 4 4" />
	{:else if name === 'down'}
		<path d="M8 3v10M4 9l4 4 4-4" />
	{:else if name === 'left'}
		<path d="M13 8H3m4-4L3 8l4 4" />
	{:else if name === 'right'}
		<path d="M3 8h10M9 4l4 4-4 4" />
	{:else if name === 'undo'}
		<path d="M3.5 6.5H9a3.5 3.5 0 0 1 0 7H6" />
		<path d="M6 4 3.5 6.5 6 9" />
	{:else if name === 'redo'}
		<path d="M12.5 6.5H7a3.5 3.5 0 0 0 0 7h3" />
		<path d="M10 4l2.5 2.5L10 9" />
	{:else if name === 'format'}
		<path d="M3 4h10M3 8h7M3 12h10" />
	{:else if name === 'browse'}
		<circle cx="4" cy="8" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
	{:else if name === 'steps'}
		<path d="M2 13h3V9h3V5h3V2h3" />
	{:else if name === 'draw'}
		<rect x="2.5" y="4" width="11" height="8" rx="0.5" stroke-dasharray="2 1.6" />
	{:else if name === 'chevron'}
		<path d="m6 3 5 5-5 5" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
