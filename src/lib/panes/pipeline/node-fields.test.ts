import { describe, expect, it } from 'vitest';
import {
	addableFields,
	editFor,
	fieldOf,
	isArray,
	missingFields,
	optionsFor,
	parts,
	requiredEdit,
	summarise,
	unsetFields,
	valueText
} from './node-fields';
import type { FieldInfo, VplProperty } from '../../ipc/commands';

function field(over: Partial<FieldInfo> = {}): FieldInfo {
	return {
		name: 'filename',
		doc: '',
		required: false,
		sources: false,
		accepts: [],
		control: { kind: 'text' },
		default: null,
		...over
	} as FieldInfo;
}

const single = (value: string): VplProperty =>
	({ key: 'filename', value: { kind: 'single', value, span: {} }, span: {} }) as unknown as VplProperty;

const array = (...values: string[]): VplProperty =>
	({
		key: 'layer',
		value: { kind: 'array', items: values.map((value) => ({ value })) },
		span: {}
	}) as unknown as VplProperty;

describe('which fields the form shows', () => {
	const fields = [
		field({ name: 'filename', required: true }),
		field({ name: 'bbox' }),
		field({ name: 'sources', sources: true })
	];

	// A source arrives through a `[ … ]` block, not a `key=value` pair - offering one would produce
	// VPL that cannot parse.
	it('never offers a source as a parameter', () => {
		expect(unsetFields(fields, []).map((f) => f.name)).toEqual(['filename', 'bbox']);
	});

	it('drops what the node already sets', () => {
		expect(unsetFields(fields, [{ key: 'bbox' }]).map((f) => f.name)).toEqual(['filename']);
	});

	// Hiding a required field behind `+ parameter…` makes a form that conceals its own required
	// fields. Shown and empty, "required" needs no symbol.
	it('splits required onto the form and optional into the add menu', () => {
		const unset = unsetFields(fields, []);
		expect(missingFields(unset).map((f) => f.name)).toEqual(['filename']);
		expect(addableFields(unset).map((f) => f.name)).toEqual(['bbox']);
	});

	it('finds a field by the name VPL uses', () => {
		expect(fieldOf(fields, 'bbox')?.name).toBe('bbox');
		expect(fieldOf(fields, 'nope')).toBeUndefined();
	});
});

describe('reading a value out of VPL', () => {
	it('shows a single value as itself', () => {
		expect(valueText(single('berlin.mbtiles'))).toBe('berlin.mbtiles');
	});

	it('joins an array into one editable line', () => {
		expect(valueText(array('poi', 'place'))).toBe('poi, place');
		expect(isArray(array('poi'))).toBe(true);
		expect(isArray(single('x'))).toBe(false);
	});

	it('splits a line back into values, ignoring blanks and padding', () => {
		expect(parts(' poi , place ,, ')).toEqual(['poi', 'place']);
		expect(parts('')).toEqual([]);
	});
});

describe('what an edit means', () => {
	it('does nothing when the text has not changed', () => {
		expect(editFor(single('a'), 'a', { kind: 'text' })).toEqual({ kind: 'unchanged' });
	});

	// `key=""` is VPL that parses and then fails when the pipeline builds, which puts the error a
	// long way from the field that caused it.
	it('removes the parameter when it is emptied', () => {
		expect(editFor(single('a'), '   ', { kind: 'text' })).toEqual({ kind: 'remove' });
	});

	it('rewrites the whole property for a list or a fixed-size array', () => {
		expect(editFor(single('a'), 'x, y', { kind: 'list' })).toEqual({ kind: 'parts', values: ['x', 'y'] });
		expect(editFor(single('a'), '1, 2', { kind: 'numbers', count: 2 })).toEqual({
			kind: 'parts',
			values: ['1', '2']
		});
	});

	// Already an array in the text, so it stays one even though the control says otherwise.
	it('rewrites a property VPL is already holding as an array', () => {
		expect(editFor(array('poi'), 'poi, place', { kind: 'text' })).toEqual({
			kind: 'parts',
			values: ['poi', 'place']
		});
	});

	/**
	 * A rectangle is four numbers, and it stopped being written as four the moment `bbox` became a
	 * control of its own so the map could be offered for it ([Q53]). Written as one value, VPL quotes
	 * it - `bbox='13, 52.3, 13.8, 52.7'` parses, and then fails to be a bbox where the pipeline is
	 * built, which is a long way from the field that caused it.
	 */
	it('rewrites the whole property for a rectangle, which is four numbers', () => {
		expect(editFor(single('a'), '13, 52.3, 13.8, 52.7', { kind: 'bbox' })).toEqual({
			kind: 'parts',
			values: ['13', '52.3', '13.8', '52.7']
		});
	});

	it('replaces one value in place otherwise, which keeps the surrounding text', () => {
		expect(editFor(single('a'), 'b', { kind: 'text' })).toEqual({ kind: 'value', value: 'b' });
	});
});

describe('filling in a required parameter', () => {
	it('writes nothing until there is something to write', () => {
		expect(requiredEdit('', { kind: 'text' })).toBeNull();
		expect(requiredEdit('   ', { kind: 'text' })).toBeNull();
	});

	it('writes one value, or several for a list', () => {
		expect(requiredEdit(' berlin.csv ', { kind: 'text' })).toEqual(['berlin.csv']);
		expect(requiredEdit('poi, place', { kind: 'list' })).toEqual(['poi', 'place']);
	});

	/**
	 * **The route a drawn rectangle actually takes.** A node rarely has a `bbox=` already, so the
	 * first thing a drag does is fill a parameter in for the first time - and this is that path. It
	 * handled `list` and nothing else, so a rectangle arrived here as one string.
	 */
	it('writes several for anything that is a list of values, including a rectangle', () => {
		expect(requiredEdit('13, 52.3, 13.8, 52.7', { kind: 'bbox' })).toEqual(['13', '52.3', '13.8', '52.7']);
		expect(requiredEdit('1, 2, 3', { kind: 'numbers', count: 3 })).toEqual(['1', '2', '3']);
	});
});

describe('suggestions', () => {
	// A suggestion read from the data beats the generic list: `lon_column` has a handful of real
	// answers and every layer name is a poor guess at one.
	it('prefers what the data suggests', () => {
		expect(optionsFor({ lon_column: ['lng'] }, ['a', 'b'], 'lon_column', { kind: 'text' })).toEqual(['lng']);
	});

	it('offers the pipeline properties to a list field with nothing suggested', () => {
		expect(optionsFor({}, ['a', 'b'], 'layer', { kind: 'list' })).toEqual(['a', 'b']);
	});

	it('offers nothing to a plain field with nothing suggested', () => {
		expect(optionsFor({}, ['a', 'b'], 'filename', { kind: 'text' })).toEqual([]);
	});
});

describe('summarise', () => {
	it('says the range when the type has one', () => {
		expect(
			summarise(
				field({ control: { kind: 'number', integer: true, min: 0, max: 15, minExclusive: false, maxExclusive: false } })
			)
		).toBe('whole number 0-15 · optional');
	});

	it('says one-sided bounds one-sidedly', () => {
		expect(
			summarise(
				field({
					control: { kind: 'number', integer: false, min: 0, max: null, minExclusive: false, maxExclusive: false }
				})
			)
		).toContain('number from 0');
		expect(
			summarise(
				field({
					control: { kind: 'number', integer: false, min: null, max: 1, minExclusive: false, maxExclusive: false }
				})
			)
		).toContain('number up to 1');
	});

	it('names every control kind in words', () => {
		expect(summarise(field({ control: { kind: 'boolean' } }))).toContain('true or false');
		expect(summarise(field({ control: { kind: 'choice', options: ['png', 'jpg'] } }))).toContain('one of png, jpg');
		expect(summarise(field({ control: { kind: 'list' } }))).toContain('comma separated');
		expect(summarise(field({ control: { kind: 'numbers', count: 4 } }))).toContain('4 numbers');
		expect(summarise(field({ control: { kind: 'text' } }))).toContain('text');
		expect(summarise(field({ control: { kind: 'path' } }))).toContain('a file path');
		// "4 numbers" said nothing about which four, and the order is the one thing a person writing
		// one by hand gets wrong.
		expect(summarise(field({ control: { kind: 'bbox' } }))).toContain('west, south, east, north');
		// Two spellings, so the popover says which this operation wants.
		expect(summarise(field({ control: { kind: 'color', hex: true } }))).toContain('RRGGBB');
		expect(summarise(field({ control: { kind: 'color', hex: false } }))).toContain('r, g, b');
	});

	it('always ends by saying whether it is required', () => {
		expect(summarise(field({ required: true }))).toMatch(/· required$/);
		expect(summarise(field({ required: false }))).toMatch(/· optional$/);
	});
});
