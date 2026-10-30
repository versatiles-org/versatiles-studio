import { describe, expect, it } from 'vitest';
import { DEFAULT_RAMP, fromRamp, hasDuplicates, parseRamp, rampGradient } from './ramp';

describe('parseRamp', () => {
	it('reads stops, whatever their spelling', () => {
		expect(parseRamp('-10.5:#F00, 20:00FF00,')).toEqual([
			{ meters: -10.5, color: 'ff0000' },
			{ meters: 20, color: '00ff00' }
		]);
		expect(parseRamp(' 0 : 0000FF80 ')).toEqual([{ meters: 0, color: '0000ff80' }]);
	});

	it('refuses what upstream refuses', () => {
		for (const text of ['', ',', '0', ':ff0000', 'x:ff0000', '0:nope', '0:ff0000,0:00ff00', '5:ff0000,1:00ff00']) {
			expect(parseRamp(text), text).toBeNull();
		}
	});
});

describe('fromRamp', () => {
	it('writes back what it read', () => {
		expect(fromRamp(parseRamp(DEFAULT_RAMP)!)).toBe(DEFAULT_RAMP);
	});
});

describe('hasDuplicates', () => {
	it('notices two stops at one elevation', () => {
		const stop = { meters: 1, color: '000000' };
		expect(hasDuplicates([stop, stop])).toBe(true);
		expect(hasDuplicates([stop, { ...stop, meters: 2 }])).toBe(false);
	});
});

describe('rampGradient', () => {
	it('spaces the colours by elevation', () => {
		const stops = parseRamp('0:000000,100:ffffff,400:ff0000')!;
		expect(rampGradient(stops)).toBe('linear-gradient(to right, #000000 0%, #ffffff 25%, #ff0000 100%)');
	});

	it('draws a single stop and none at all', () => {
		expect(rampGradient(parseRamp('5:ffffff')!)).toBe('linear-gradient(to right, #ffffff 0%, #ffffff 0%)');
		expect(rampGradient([])).toBe('none');
	});
});
