import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { checkStyle } from './style-check';
import { renderStyle } from './style';

/**
 * The exported style against the MapLibre style spec (S14.9).
 */

const style = (layers: unknown[]): StyleSpecification =>
	({
		version: 8,
		sources: { berlin: { type: 'vector', tiles: ['studio://tiles/berlin/{z}/{x}/{y}'] } },
		layers
	}) as StyleSpecification;

describe('the style check', () => {
	it('passes a style MapLibre accepts', () => {
		expect(checkStyle(style([{ id: 'water', type: 'fill', source: 'berlin', 'source-layer': 'water' }]))).toEqual([]);
	});

	it('names a layer by its id, not its position', () => {
		const problems = checkStyle(
			style([
				{ id: 'land', type: 'fill', source: 'berlin', 'source-layer': 'land' },
				{ id: 'water', type: 'fill', source: 'berlin', 'source-layer': 'water', paint: { 'fill-color': 12 } }
			])
		);
		expect(problems).toEqual([
			{ message: 'layer "water".paint.fill-color: color expected, number found', severity: 'error' }
		]);
	});

	it('says a duplicate id and a missing source plainly', () => {
		const messages = checkStyle(
			style([
				{ id: 'roads', type: 'line', source: 'berlin', 'source-layer': 'streets' },
				{ id: 'roads', type: 'line', source: 'nowhere' }
			])
		).map((problem) => problem.message);
		expect(messages).toContain('layer "roads": duplicate layer id "roads"');
		expect(messages).toContain('layer "roads": source "nowhere" not found');
	});

	/** What Studio writes by default must not be what the check complains about. */
	it('passes the export of a theme Studio draws', () => {
		const style = renderStyle(
			{ type: 'vector', theme: 'colorful', recolor: {}, overrides: {} } as never,
			[{ name: 'berlin', tileUrl: 'http://127.0.0.1:8080/tiles/berlin/{z}/{x}/{y}' }],
			'http://127.0.0.1:8080'
		);
		expect(checkStyle(style)).toEqual([]);
	});
});
