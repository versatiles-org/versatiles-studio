<script lang="ts" module>
	import type { Elevation, RasterDissection } from '../ipc/commands';

	/** One pixel, as the dialog's caption names it. */
	export interface PointedPixel {
		x: number;
		y: number;
		/** Its value in the tile's own channels: `128`, `128, alpha 255`, `#3a6f2b` or `#3a6f2bff`. */
		value: string | null;
		/** The height it encodes, in metres, for a DEM tile - `null` for imagery and for no data. */
		metres: number | null;
	}

	const hex = (channel: number) => channel.toString(16).padStart(2, '0');

	/** A pixel's value, spelled for the channels the tile has rather than the four a canvas gives. */
	export function spell(rgba: ArrayLike<number>, channels: RasterDissection['channels']): string {
		const [r, g, b, a] = [rgba[0], rgba[1], rgba[2], rgba[3]];
		switch (channels) {
			case 'grey':
				return String(r);
			case 'grey + alpha':
				return `${r}, alpha ${a}`;
			case 'RGB':
				return `#${hex(r)}${hex(g)}${hex(b)}`;
			default:
				return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
		}
	}

	/**
	 * The height a pixel encodes, by upstream's formulas - the same as `dissect.rs`'s, which the
	 * tile's minimum and maximum come from. `null` for a fully transparent pixel, which is no data.
	 */
	export function metres(rgba: ArrayLike<number>, encoding: Elevation['encoding']): number | null {
		if (rgba[3] === 0) return null;
		const raw = rgba[0] * 65_536 + rgba[1] * 256 + rgba[2];
		return encoding === 'mapbox' ? raw * 0.1 - 10_000 : raw / 256 - 32_768;
	}
</script>

<script lang="ts">
	// A raster tile, pixel for pixel - the raster counterpart of `TileDrawing`.
	//
	// **Enlarged without smoothing**, so a pixel reads as a square rather than as the blur the map
	// shows when it scales a tile. **On a checkerboard**, so a transparent pixel looks like one, not
	// like the dialog's background.
	//
	// **Read back through a canvas** to name the pixel under the pointer. The image is the core's
	// lossless PNG, so for an opaque pixel the value is the tile's exactly; for a translucent one a
	// browser may round it, since canvases store colours premultiplied by their alpha. A DEM tile is
	// opaque wherever it has data, so its heights are exact.
	//
	// **A DEM's colours are not its picture.** Terrarium's red and green carry the high bits of a
	// height, so the tile looks like noise; `relief` draws the heights instead, from black at the
	// tile's lowest to white at its highest.

	let {
		raster,
		relief = false,
		onPoint
	}: {
		raster: RasterDissection;
		/** Draws the heights in grey rather than the colours that encode them - for a DEM tile only. */
		relief?: boolean;
		onPoint: (pixel: PointedPixel | null) => void;
	} = $props();

	/** The decoded pixels, RGBA, once the image has loaded - `null` where a canvas cannot read them. */
	let pixels = $state<Uint8ClampedArray | null>(null);
	let canvas = $state<HTMLCanvasElement | undefined>();

	const drawingHeights = $derived(relief && raster.elevation !== null && pixels !== null);

	$effect(() => {
		const { image, width, height } = raster;
		pixels = null;
		const img = new Image();
		img.onload = () => {
			const scratch = document.createElement('canvas');
			scratch.width = width;
			scratch.height = height;
			const context = scratch.getContext('2d', { willReadFrequently: true });
			if (!context) return;
			context.drawImage(img, 0, 0);
			pixels = context.getImageData(0, 0, width, height).data;
		};
		img.src = image;
		return () => {
			img.onload = null;
		};
	});

	$effect(() => {
		const elevation = raster.elevation;
		const context = canvas?.getContext('2d');
		if (!drawingHeights || !elevation || !pixels || !context) return;
		const { width, height } = raster;
		const span = elevation.max - elevation.min || 1;
		const grey = context.createImageData(width, height);
		for (let at = 0; at < pixels.length; at += 4) {
			const here = metres(pixels.subarray(at, at + 4), elevation.encoding);
			if (here === null) continue;
			const level = Math.round(((here - elevation.min) / span) * 255);
			grey.data.set([level, level, level, 255], at);
		}
		context.putImageData(grey, 0, 0);
	});

	function point(event: PointerEvent): void {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return;
		const x = Math.floor(((event.clientX - box.left) / box.width) * raster.width);
		const y = Math.floor(((event.clientY - box.top) / box.height) * raster.height);
		if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return onPoint(null);
		const at = (y * raster.width + x) * 4;
		const pixel = pixels?.subarray(at, at + 4);
		onPoint({
			x,
			y,
			value: pixel ? spell(pixel, raster.channels) : null,
			metres: pixel && raster.elevation ? metres(pixel, raster.elevation.encoding) : null
		});
	}
</script>

<div class="checker" onpointermove={point} onpointerleave={() => onPoint(null)} role="presentation">
	{#if drawingHeights}
		<canvas
			bind:this={canvas}
			width={raster.width}
			height={raster.height}
			aria-label="The tile's heights, {raster.width} by {raster.height}, low dark and high light"
		></canvas>
	{:else}
		<img src={raster.image} alt="The tile's pixels, {raster.width} by {raster.height}" draggable="false" />
	{/if}
</div>

<style>
	.checker {
		aspect-ratio: 1;
		overflow: hidden;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		/* Squares of a sixteenth of the tile: small enough to read as "nothing here", large enough not
		   to shimmer at the sizes this is shown at. */
		background: repeating-conic-gradient(var(--rule) 0 25%, var(--surface) 0 50%) 0 0 / 6.25% 6.25%;
	}

	img,
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
		cursor: crosshair;
	}
</style>
