<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap, MapMouseEvent, LngLat } from 'maplibre-gl';
	import { token } from '../styles/tokens';
	import { role } from './theme';
	import { mapOverlay, NOTHING, type Overlay } from './overlay';

	// The crop, on the map (F2, S5.2, S5.4).
	//
	// **The area is shown by dimming everything else**, which is what a crop is: not a rectangle
	// drawn on the world, but the part of the world that survives. One polygon with a hole in it does
	// both jobs — the fill dims the outside, the line traces the edge — so the two can never be drawn
	// out of step with each other.
	//
	// **Drawing takes the map's drag.** A rectangle and a pan are the same gesture, so while drawing
	// is on, `dragPan` is off and the cursor says so; both are restored the moment a rectangle is
	// finished or the mode is left.
	//
	// **A rectangle in flight is drawn as a rectangle, not as a hole.** The dim treatment is right
	// for a crop that exists — it says which part of the world survives — and wrong for one being
	// dragged: starting a small box turned the whole map dark and grew a hole in it, which reads as
	// the map breaking rather than as a rectangle being drawn. So the draft is its own thing, an
	// outlined and lightly filled box in the crop's colour, and the dim arrives when the rectangle
	// is finished. Only one of the two is ever on screen.

	let {
		map,
		bbox,
		drawing,
		onDrawn
	}: {
		map: MaplibreMap | undefined;
		/** West, south, east, north — or `null` for no crop, when this draws nothing at all. */
		bbox: [number, number, number, number] | null;
		/** Whether a drag on the map draws a new rectangle. */
		drawing: boolean;
		/** A rectangle was finished. The caller decides whether to leave drawing mode. */
		onDrawn: (bbox: [number, number, number, number]) => void;
	} = $props();

	const SOURCE = 'studio:crop';
	const DRAFT = 'studio:crop-draft';

	/// The rectangle being dragged right now, which is what gets drawn while a drag is in flight.
	let dragged = $state<[number, number, number, number] | null>(null);

	/// The rectangle itself, for the draft. The committed crop wants the opposite of this.
	function rectangle(box: [number, number, number, number]) {
		const [west, south, east, north] = box;
		return {
			type: 'FeatureCollection' as const,
			features: [
				{
					type: 'Feature' as const,
					properties: {},
					geometry: {
						type: 'Polygon' as const,
						coordinates: [
							[
								[west, south],
								[east, south],
								[east, north],
								[west, north],
								[west, south]
							]
						]
					}
				}
			]
		};
	}

	/// The world, with the crop punched out of it — or nothing, when there is no crop.
	///
	/// The outer ring stops at the Web Mercator limit rather than at the pole: beyond it there is no
	/// map to dim, and a polygon reaching ±90 projects to infinity.
	function outside(box: [number, number, number, number]) {
		const [west, south, east, north] = box;
		return {
			type: 'FeatureCollection' as const,
			features: [
				{
					type: 'Feature' as const,
					properties: {},
					geometry: {
						type: 'Polygon' as const,
						coordinates: [
							[
								[-180, -85.05],
								[180, -85.05],
								[180, 85.05],
								[-180, 85.05],
								[-180, -85.05]
							],
							[
								[west, south],
								[east, south],
								[east, north],
								[west, north],
								[west, south]
							]
						]
					}
				}
			]
		};
	}

	/// The two overlays, once the map exists. Held so the effect below redraws rather than rebuilds.
	let committed = $state<Overlay | null>(null);
	let draft = $state<Overlay | null>(null);

	$effect(() => {
		if (!map) return;
		const m = map;

		// Everything about keeping these on the map — surviving a restyle, staying above the tiles,
		// refilling a rebuilt source, retrying a layer that was refused, and saying so when it stays
		// refused — is `mapOverlay`'s ([Q46]). Three rounds of an invisible bug lived in this file's
		// own copy of it.
		const crop = mapOverlay(m, {
			source: SOURCE,
			label: 'crop overlay',
			layers: () => [
				{
					id: `${SOURCE}:dim`,
					type: 'fill',
					source: SOURCE,
					metadata: role('crop-dim'),
					paint: { 'fill-color': token('--map-crop-dim'), 'fill-opacity': 0.45 }
				},
				{
					id: `${SOURCE}:edge`,
					type: 'line',
					source: SOURCE,
					metadata: role('crop-edge'),
					// The hole is a ring of this polygon, so one line layer traces the crop's edge —
					// and the world ring with it, which is off screen at every zoom that shows a crop.
					paint: { 'line-color': token('--map-crop-edge'), 'line-width': 1.5 }
				}
			],
			// `untrack`, because this is read from map events as well as from the effect below.
			data: () => {
				const box = untrack(() => bbox);
				return box && !untrack(() => dragged) ? outside(box) : NOTHING;
			}
		});

		// Mounted second, so the draft sits above the crop it is about to replace.
		const inFlight = mapOverlay(m, {
			source: DRAFT,
			label: 'crop draft',
			layers: () => [
				{
					id: `${DRAFT}:fill`,
					type: 'fill',
					source: DRAFT,
					metadata: role('crop-draft-fill'),
					// Faint: enough to read as a filled shape over any tiles, not enough to hide what
					// is under it — the point of dragging here is to see what you are enclosing.
					paint: { 'fill-color': token('--map-crop-edge'), 'fill-opacity': 0.12 }
				},
				{
					id: `${DRAFT}:line`,
					type: 'line',
					source: DRAFT,
					metadata: role('crop-draft-line'),
					// Dashed, because it is not a crop yet. The committed one is solid, and the
					// difference is visible without a legend.
					paint: {
						'line-color': token('--map-crop-edge'),
						'line-width': 1.5,
						'line-dasharray': [2, 2]
					}
				}
			],
			data: () => {
				const box = untrack(() => dragged);
				return box ? rectangle(box) : NOTHING;
			}
		});

		committed = crop;
		draft = inFlight;
		return () => {
			inFlight.dispose();
			crop.dispose();
			committed = null;
			draft = null;
		};
	});

	// Redrawn whenever the crop changes, including on every frame of a drag.
	//
	// **One or the other, never both.** While a rectangle is in flight the crop it will replace is
	// not the subject any more, and two overlapping treatments is one too many to aim through — which
	// each overlay's `data` says for itself.
	$effect(() => {
		void bbox;
		void dragged;
		committed?.draw();
		draft?.draw();
	});

	$effect(() => {
		if (!map || !drawing) return;
		const m = map;

		let from: LngLat | null = null;

		const box = (a: LngLat, b: LngLat): [number, number, number, number] => [
			Math.min(a.lng, b.lng),
			Math.min(a.lat, b.lat),
			Math.max(a.lng, b.lng),
			Math.max(a.lat, b.lat)
		];

		const down = (event: MapMouseEvent) => {
			from = event.lngLat;
			dragged = null;
		};
		const move = (event: MapMouseEvent) => {
			if (from) dragged = box(from, event.lngLat);
		};
		const up = (event: MapMouseEvent) => {
			if (!from) return;
			const finished = box(from, event.lngLat);
			from = null;
			dragged = null;
			// A click rather than a drag: two identical corners are not a crop, and treating one as
			// an empty selection would clear the crop someone was only trying to look at.
			if (finished[0] === finished[2] || finished[1] === finished[3]) return;
			onDrawn(finished);
		};

		// **Released off the map, the drag is abandoned rather than left hanging.** MapLibre's own
		// `mouseup` fires only over the canvas, so a drag that ends on a pane or outside the window
		// never reached `up` — which used to be invisible and is not any more: the draft rectangle
		// would stay on screen until the next click. This runs after the canvas event has bubbled, so
		// on an ordinary release `from` is already null and there is nothing to do.
		const abandon = () => {
			if (!from) return;
			from = null;
			dragged = null;
		};

		m.dragPan.disable();
		m.getCanvas().style.cursor = 'crosshair';
		m.on('mousedown', down);
		m.on('mousemove', move);
		m.on('mouseup', up);
		window.addEventListener('mouseup', abandon);

		return () => {
			m.off('mousedown', down);
			m.off('mousemove', move);
			m.off('mouseup', up);
			window.removeEventListener('mouseup', abandon);
			m.dragPan.enable();
			m.getCanvas().style.cursor = '';
			dragged = null;
		};
	});
</script>
