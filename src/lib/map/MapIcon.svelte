<script lang="ts" module>
	/** The icons the map's controls use. */
	export type MapIconName =
		'search' | 'star' | 'star-filled' | 'fit' | 'layers' | 'grid' | 'plus' | 'minus' | 'compass';
</script>

<script lang="ts">
	// The map controls' icons, drawn inline the way the rest of Studio's few icons are - no icon
	// font, no sprite, nothing to load. A 16-unit box and a 1.3 stroke, matching the eye in
	// `GraphList`, so they read as one set beside it.
	//
	// Decorative: every button that shows one carries its own `aria-label` and `title`.

	let { name, size = 16 }: { name: MapIconName; size?: number } = $props();
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
	{:else if name === 'plus'}
		<path d="M8 3v10M3 8h10" />
	{:else if name === 'minus'}
		<path d="M3 8h10" />
	{:else if name === 'compass'}
		<!-- North in the accent half, so which way is up reads at a glance once the map turns. -->
		<path d="M8 1.5 10.5 8h-5Z" fill="currentColor" stroke="none" />
		<path d="M8 14.5 5.5 8h5Z" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
