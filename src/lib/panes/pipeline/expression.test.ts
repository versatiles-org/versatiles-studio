import { describe, expect, it } from 'vitest';
import { insertAt, keysOf, propertyRef, quoted, tidyMessage, valuePiece } from './expression';

describe('propertyRef', () => {
	it('names a property by itself where it can', () => {
		expect(propertyRef('kind')).toBe('kind');
		expect(propertyRef('name_de')).toBe('name_de');
	});

	it('goes through $props where a bare name would not read it', () => {
		expect(propertyRef('name:de')).toBe("$props['name:de']");
		expect(propertyRef('1st')).toBe("$props['1st']");
		expect(propertyRef("o'clock")).toBe("$props['o\\'clock']");
		// Reserved: upstream compiles `$zoom` as `_zoom`, so a property of that name is refused bare.
		expect(propertyRef('_zoom')).toBe("$props['_zoom']");
		expect(propertyRef('_zoomed')).toBe('_zoomed');
	});
});

describe('insertAt', () => {
	it('replaces the selection, and puts the caret after what was inserted', () => {
		expect(insertAt('a == 1', 5, 6, '2')).toEqual({ text: 'a == 2', caret: 6 });
		expect(insertAt('', 0, 0, '$zoom')).toEqual({ text: '$zoom', caret: 5 });
	});

	it('keeps a picked piece from running into the word before it', () => {
		expect(insertAt('kind', 4, 4, "== 'primary'")).toEqual({ text: "kind == 'primary'", caret: 17 });
		expect(insertAt('(', 1, 1, 'kind')).toEqual({ text: '(kind', caret: 5 });
		expect(insertAt('a ', 2, 2, '&&')).toEqual({ text: 'a &&', caret: 4 });
	});
});

describe('keysOf', () => {
	const layers = [
		{
			layer: 'streets',
			keys: [
				{ key: 'kind', features: 10, more: false, values: [{ literal: "'primary'", count: 6 }] },
				{ key: 'name', features: 4, more: true, values: [] }
			]
		},
		{
			layer: 'pois',
			keys: [{ key: 'kind', features: 5, more: false, values: [{ literal: "'cafe'", count: 7 }] }]
		}
	];

	it('lists one layer’s keys, the commonest first', () => {
		expect(keysOf(layers, 'streets').map((key) => key.key)).toEqual(['kind', 'name']);
	});

	it('adds a key up across layers, values and all', () => {
		const [kind, name] = keysOf(layers, null);
		expect(kind).toEqual({
			key: 'kind',
			features: 15,
			more: false,
			values: [
				{ literal: "'cafe'", count: 7 },
				{ literal: "'primary'", count: 6 }
			]
		});
		expect(name.more).toBe(true);
	});
});

describe('quoted', () => {
	it('writes a layer name as an expression compares it', () => {
		expect(quoted('place_labels')).toBe("'place_labels'");
		expect(quoted("it's")).toBe("'it\\'s'");
	});
});

describe('valuePiece', () => {
	it('compares a value with the name it follows', () => {
		expect(valuePiece('$layer', "'streets'")).toBe("== 'streets'");
		expect(valuePiece("$props['name:de'] ", "'Berlin'")).toBe("== 'Berlin'");
	});

	it('leaves it alone where an operator is already there, or nothing is', () => {
		expect(valuePiece('kind != ', "'primary'")).toBe("'primary'");
		expect(valuePiece('$zoom >= ', '12')).toBe('12');
		expect(valuePiece('kind in [', "'a'")).toBe("'a'");
		expect(valuePiece('', '12')).toBe('12');
	});
});

/** Upstream's messages as `vplCheckValue` returned them for three expressions (versatiles-rs 5.11). */
describe('tidyMessage', () => {
	it('keeps the syntax error and its caret, and drops the rest', () => {
		const message = [
			"does not accept 'expr=(($zoom': Failed to compile CEL expression:",
			'  (($zoom',
			'',
			"ERROR: <input>:1:8: Syntax error: mismatched input '<EOF>' expecting {'==', ')'}",
			'| (($zoom',
			'| .......^'
		].join('\n');
		expect(tidyMessage(message)).toBe(
			["Syntax error: mismatched input '<EOF>' expecting {'==', ')'}", '| (($zoom', '| .......^'].join('\n')
		);
	});

	it('keeps an unknown name’s explanation whole', () => {
		const message = [
			"does not accept 'expr=kind == 'primary' && $zom > 3': Failed to compile CEL expression:",
			"  kind == 'primary' && $zom > 3",
			'',
			'`$zom` is not a name an expression can read. The names starting with `$` are `$zoom` and `$x`.'
		].join('\n');
		expect(tidyMessage(message)).toBe(
			'`$zom` is not a name an expression can read. The names starting with `$` are `$zoom` and `$x`.'
		);
	});

	it('says only that the parser crashed, without its insides or the command-line advice', () => {
		const message = [
			"does not accept 'expr=$layer == ': Failed to compile CEL expression:",
			'  $layer == ',
			'',
			'Parser crashed (likely malformed CEL input): internal error: entered unreachable code: should have been properly implemented by generated context when reachable',
			'',
			'Common causes: unmatched brackets, trailing operators, unsupported tokens. Run `versatiles help pipeline` for the CEL operator cheat-sheet.'
		].join('\n');
		expect(tidyMessage(message)).toBe('Parser crashed (likely malformed CEL input)');
	});

	it('leaves a message it does not recognise to be shown whole', () => {
		expect(tidyMessage("does not accept 'format=xyz'. Values: png, jpg")).toBeNull();
	});
});
