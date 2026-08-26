<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { tileToLngLat } from './tile-grid';

	// A5's jump box. Accepts what a tile person actually has in hand: `z/x/y`, or `lat, lng[, zoom]`.
	let { map }: { map: MaplibreMap | undefined } = $props();

	let text = $state('');
	let invalid = $state(false);

	function jump(event: SubmitEvent) {
		event.preventDefault();
		const target = parse(text.trim());
		invalid = !target;
		if (!target || !map) return;
		map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom ?? map.getZoom() });
		text = '';
	}

	/** `z/x/y` → centre of that tile. `lat, lng` or `lat, lng, zoom` → that point. */
	export function parse(input: string): { lat: number; lng: number; zoom?: number } | null {
		const tile = /^(\d{1,2})\/(\d+)\/(\d+)$/.exec(input);
		if (tile) {
			const [z, x, y] = tile.slice(1).map(Number);
			if (x >= 2 ** z || y >= 2 ** z) return null;
			const [w, n] = tileToLngLat(x, y, z);
			const [e, s] = tileToLngLat(x + 1, y + 1, z);
			return { lat: (n + s) / 2, lng: (w + e) / 2, zoom: z };
		}

		const parts = input
			.split(/[,\s]+/)
			.filter(Boolean)
			.map(Number);
		if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
		const [lng, lat, zoom] = parts;
		if (Math.abs(lat) > 85.06 || Math.abs(lng) > 180) return null;
		return { lat, lng, zoom };
	}
</script>

<form onsubmit={jump} class:invalid>
	<input
		bind:value={text}
		oninput={() => (invalid = false)}
		type="text"
		placeholder="z/x/y or lng,lat"
		spellcheck="false"
		aria-label="Jump to coordinate or tile"
	/>
</form>

<style>
	/* Placed by the map's control stack ([Q52]), not by itself. */
	form {
		display: block;
	}

	/* The same surface as the buttons beside it ([Q52]): `base.css` gives every input the panel
	   background and no shadow, which is right in a pane and wrong on a map - it read as a form field
	   dropped into a row of floating controls. Border, radius and padding already matched; the size
	   and the shadow were what set it apart.
	   
	   Mono stays. What is typed here is a coordinate, and the digits should line up. */
	input {
		width: 9rem;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--float-bg);
		box-shadow: var(--shadow);
	}

	.invalid input {
		border-color: var(--error);
		background: var(--error-bg);
	}
</style>
