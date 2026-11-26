import { describe, expect, it } from 'vitest';
import { insertAt, keysOf, operatorChip, paint, propertyRef, quoted, readsLine, valuePiece } from './expression';
import type { ExpressionOperatorKind } from '../../ipc/commands';

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

	it('joins an attached piece to the word before it, and puts the caret where it is told', () => {
		expect(insertAt('name', 4, 4, '.contains()', { attach: true, caret: 10 })).toEqual({
			text: 'name.contains()',
			caret: 14
		});
		expect(insertAt('a', 1, 1, 'size()', { caret: 5 })).toEqual({ text: 'a size()', caret: 7 });
		expect(insertAt('size() x', 5, 5, 'name')).toEqual({ text: 'size(name) x', caret: 9 });
	});
});

describe('operatorChip', () => {
	const chipOf = (written: string, kind: ExpressionOperatorKind, example = '') =>
		operatorChip({ written, kind, doc: '', example });

	it('writes what goes between operands with room after it', () => {
		expect(chipOf('==', 'comparison')).toEqual({ label: '==', piece: '== ', attach: false, caret: 3 });
		expect(chipOf('in', 'comparison')).toEqual({ label: 'in', piece: 'in ', attach: false, caret: 3 });
		expect(chipOf('&&', 'logic')).toEqual({ label: '&&', piece: '&& ', attach: false, caret: 3 });
		expect(chipOf('%', 'arithmetic')).toEqual({ label: '%', piece: '% ', attach: false, caret: 2 });
	});

	it('writes a negation before its operand, and the conditional around two', () => {
		expect(chipOf('!', 'logic')).toEqual({ label: '!', piece: '!', attach: false, caret: 1 });
		expect(chipOf('? :', 'logic')).toEqual({ label: '? :', piece: '?  : ', attach: false, caret: 2 });
	});

	it('writes a function and a method with the caret between the brackets', () => {
		expect(chipOf('size', 'function')).toEqual({ label: 'size()', piece: 'size()', attach: false, caret: 5 });
		expect(chipOf('startsWith', 'method')).toEqual({
			label: '.startsWith()',
			piece: '.startsWith()',
			attach: true,
			caret: 12
		});
	});

	// Upstream's one kind for both shapes; its example says which a macro is.
	it('writes a macro the way its example does', () => {
		expect(chipOf('has', 'macro', "has({'a': 1}.a)")).toEqual({
			label: 'has()',
			piece: 'has()',
			attach: false,
			caret: 4
		});
		expect(chipOf('exists_one', 'macro', '[1, 2].exists_one(x, x > 1)')).toEqual({
			label: '.exists_one()',
			piece: '.exists_one(x, )',
			attach: true,
			caret: 15
		});
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

const token = (kind: string, start: number, end: number) => ({ kind, start, end });
const problem = (start: number, end: number) => ({ message: 'wrong', start, end });

describe('paint', () => {
	it('colours each token and leaves the white space between them bare', () => {
		const text = '$zoom >= 12';
		const pieces = paint(text, [token('special', 0, 5), token('operator', 6, 8), token('number', 9, 11)], []);
		expect(pieces.map(({ text, kind }) => [text, kind])).toEqual([
			['$zoom', 'special'],
			[' ', null],
			['>=', 'operator'],
			[' ', null],
			['12', 'number']
		]);
		expect(pieces.map(({ text }) => text).join('')).toBe(text);
	});

	it('marks what a problem covers, cutting a token where the problem starts', () => {
		const pieces = paint(
			'kind == $zom',
			[token('property', 0, 4), token('operator', 5, 7), token('special', 8, 12)],
			[problem(9, 12)]
		);
		expect(pieces.filter(({ bad }) => bad).map(({ text, kind }) => [text, kind])).toEqual([['zom', 'special']]);
		expect(pieces.find(({ text }) => text === '$')?.kind).toBe('special');
	});

	// After a trailing `==` the value is missing, which covers no text.
	it('marks where something is missing, even at the end', () => {
		const pieces = paint('$layer ==', [token('special', 0, 6), token('operator', 7, 9)], [problem(9, 9)]);
		expect(pieces.at(-1)).toEqual({ text: '', kind: null, bad: true, missing: true });
		expect(pieces.map(({ text }) => text).join('')).toBe('$layer ==');
	});

	it('never reaches past the text, whatever the offsets say', () => {
		const pieces = paint('ab', [token('property', 0, 9)], [problem(5, 7)]);
		expect(pieces.map(({ text }) => text).join('')).toBe('ab');
	});
});

describe('readsLine', () => {
	it('names what is read and how often it is answered', () => {
		expect(readsLine({ names: ['$layer'], properties: [], scope: 'layer' })).toBe(
			'Reads $layer: one answer per layer, without decoding its features.'
		);
		expect(readsLine({ names: ['$zoom', '$layer'], properties: ['kind'], scope: 'feature' })).toBe(
			'Reads $zoom, $layer and kind: an answer per feature.'
		);
		expect(readsLine({ names: [], properties: [], scope: 'tile' })).toBe('Reads nothing: one answer for every tile.');
	});
});
