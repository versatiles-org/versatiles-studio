import { describe, expect, it } from 'vitest';
import {
	GRADIENTS,
	fromRamp,
	generateRamp,
	hasDuplicates,
	isTranslucent,
	parseRamp,
	rampGradient,
	rampName,
	rangeProblem
} from './ramp';

/** The field's presets, as `Control::Ramp` carries them from upstream. */
const DEFAULT_RAMP = '-11000:24507e,-200:8cb4d8,0:bcd8ec,0.01:a8c896,300:cad6a2';
const PRESETS = [
	{ name: 'default', stops: DEFAULT_RAMP },
	{ name: 'bathymetry', stops: '-11000:0b2545,0:cfe3f3,0.01:cfe3f300' }
];

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

	it('reads a named ramp as the stops it stands for', () => {
		expect(parseRamp(' default ', PRESETS)).toEqual(parseRamp(DEFAULT_RAMP));
		expect(parseRamp('bathymetry', PRESETS)).toEqual(parseRamp(PRESETS[1].stops));
		expect(parseRamp('Default', PRESETS)).toBeNull();
		// A name is only a name among the presets it is read with.
		expect(parseRamp('default')).toBeNull();
	});
});

describe('rampName', () => {
	it('knows the names upstream knows, and nothing else', () => {
		expect(rampName('default', PRESETS)).toBe('default');
		expect(rampName(' bathymetry ', PRESETS)).toBe('bathymetry');
		expect(rampName(DEFAULT_RAMP, PRESETS)).toBeNull();
		expect(rampName('toString', PRESETS)).toBeNull();
		expect(rampName('', PRESETS)).toBeNull();
		expect(rampName('default', [])).toBeNull();
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

describe('generateRamp (#17)', () => {
	const rainbow = GRADIENTS.find((gradient) => gradient.id === 'rainbow')!;

	it('spaces one stop per colour evenly over the range', () => {
		const stops = generateRamp({ gradient: rainbow, low: 0, high: 3000, reverse: false, outside: 'hold' });
		expect(stops.map((stop) => stop.meters)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
		expect(stops.map((stop) => stop.color)).toEqual(rainbow.colors);
	});

	it('runs backwards when reversed', () => {
		const stops = generateRamp({ gradient: rainbow, low: 0, high: 3000, reverse: true, outside: 'hold' });
		expect(stops.map((stop) => stop.color)).toEqual([...rainbow.colors].reverse());
		expect(stops[0].meters).toBe(0);
	});

	// Upstream holds the end colours outside the stops, so highlighting a range takes stops of its
	// own just outside it, and fully transparent ones.
	it('leaves the outside empty with transparent stops just past each end', () => {
		const stops = generateRamp({ gradient: rainbow, low: 1000, high: 1500, reverse: false, outside: 'transparent' });
		expect(stops[0]).toEqual({ meters: 999.99, color: '30123b00' });
		expect(stops[1]).toEqual({ meters: 1000, color: '30123b' });
		expect(stops.at(-2)).toEqual({ meters: 1500, color: '7a0403' });
		expect(stops.at(-1)).toEqual({ meters: 1500.01, color: '7a040300' });
		expect(isTranslucent(stops)).toBe(true);
	});

	// The promise in #17: whatever the generator writes, upstream reads back as the same stops.
	it('writes only what upstream accepts, for every gradient and either outside', () => {
		const ranges = [
			[0, 3000],
			[-11000, 9000],
			[-0.3, 0.2],
			[1234.567, 1234.9]
		];
		for (const gradient of GRADIENTS) {
			for (const [low, high] of ranges) {
				for (const outside of ['hold', 'transparent'] as const) {
					for (const reverse of [false, true]) {
						const stops = generateRamp({ gradient, low, high, reverse, outside });
						const written = fromRamp(stops);
						// Elevations as plain decimals: `1e-7` is a number to JavaScript, not to every parser.
						for (const part of written.split(',')) expect(part, written).toMatch(/^-?\d+(\.\d+)?:[0-9a-f]+$/);
						expect(parseRamp(written), written).toEqual(stops);
					}
				}
			}
		}
	});

	it('refuses a range that is not one', () => {
		expect(rangeProblem(0, 3000)).toBeNull();
		expect(rangeProblem(3000, 0)).not.toBeNull();
		expect(rangeProblem(5, 5)).not.toBeNull();
		expect(rangeProblem(5, 5.05)).not.toBeNull();
		expect(rangeProblem(Number.NaN, 5)).not.toBeNull();
	});
});

describe('isTranslucent', () => {
	it('counts any stop with less than full alpha', () => {
		expect(isTranslucent(parseRamp('0:ff0000,10:00ff00ff')!)).toBe(false);
		expect(isTranslucent(parseRamp('0:ff0000,10:00ff0080')!)).toBe(true);
	});
});
