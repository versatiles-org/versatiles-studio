<script lang="ts">
	import type { Map as MaplibreMap, GeoJSONSource, MapMouseEvent, LngLat } from 'maplibre-gl';
	import { token } from '../styles/tokens';
	import { role } from './theme';

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

	/// The rectangle being dragged right now, which is what gets drawn while a drag is in flight.
	let dragged = $state<[number, number, number, number] | null>(null);

	const shown = $derived(dragged ?? bbox);

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

	$effect(() => {
		if (!map) return;
		const m = map;

		// Attached before the layers are added, for the reason `TileActivity` learned the hard way:
		// `addSource` throws when the style is not loaded, and a listener registered after it would
		// never run — leaving the overlay permanently absent instead of merely late.
		const ensure = () => {
			if (m.getSource(SOURCE)) return;
			m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
			m.addLayer({
				id: `${SOURCE}:dim`,
				type: 'fill',
				source: SOURCE,
				metadata: role('crop-dim'),
				paint: { 'fill-color': token('--map-crop-dim'), 'fill-opacity': 0.45 }
			});
			m.addLayer({
				id: `${SOURCE}:edge`,
				type: 'line',
				source: SOURCE,
				metadata: role('crop-edge'),
				// The hole is a ring of this polygon, so one line layer traces the crop's edge — and
				// the world ring with it, which is off screen at every zoom that shows a crop.
				paint: { 'line-color': token('--map-crop-edge'), 'line-width': 1.5 }
			});
		};

		const restore = () => {
			if (m.isStyleLoaded()) ensure();
		};
		m.on('styledata', restore);
		m.on('load', restore);
		restore();

		return () => {
			m.off('styledata', restore);
			m.off('load', restore);
			for (const id of [`${SOURCE}:edge`, `${SOURCE}:dim`]) {
				if (m.getLayer(id)) m.removeLayer(id);
			}
			if (m.getSource(SOURCE)) m.removeSource(SOURCE);
		};
	});

	// Redrawn whenever the crop changes, including on every frame of a drag.
	$effect(() => {
		const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
		source?.setData(shown ? outside(shown) : { type: 'FeatureCollection', features: [] });
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

		m.dragPan.disable();
		m.getCanvas().style.cursor = 'crosshair';
		m.on('mousedown', down);
		m.on('mousemove', move);
		m.on('mouseup', up);

		return () => {
			m.off('mousedown', down);
			m.off('mousemove', move);
			m.off('mouseup', up);
			m.dragPan.enable();
			m.getCanvas().style.cursor = '';
			dragged = null;
		};
	});
</script>
