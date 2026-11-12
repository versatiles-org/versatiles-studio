/**
 * The pieces behind [`Control::Expression`] - `vector_branch`'s and `vector_filter_features`'s `expr`.
 *
 * An expression is CEL with a few `$` names beside the feature's own properties; upstream compiles
 * it, and `vplCheckValue` is how the helper asks. What is here is only how the helper writes what
 * is picked into the text - nothing here decides whether an expression is right.
 */

import type { LayerProperties, PropertyValues, ValueCount } from '../../ipc/commands';

/**
 * The `$` names upstream compiles `$zoom` and the rest as. A property written as one of these
 * would read the name instead, so upstream refuses it bare and it has to go through `$props`.
 */
const RESERVED = /^_(zoom|x|y|layer|type|id|props)$/;

/**
 * How an expression reads a property: by its name where that is a CEL identifier, and through
 * `$props` where it is not - `name:de` has a colon, `1st` starts with a digit.
 */
export function propertyRef(key: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !RESERVED.test(key)) return key;
	return `$props['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

/** The text with `piece` in place of the selection, and where the caret goes after it. */
export function insertAt(text: string, start: number, end: number, piece: string): { text: string; caret: number } {
	const before = text.slice(0, start);
	const after = text.slice(end);
	// A space where the piece would otherwise run into a word or a value before it: `a` then `== 1`
	// should read `a == 1`, not `a== 1` - and nothing is added after an opening bracket or a space.
	const gap = before.length > 0 && /[\w'")\]]$/.test(before) ? ' ' : '';
	const written = `${before}${gap}${piece}`;
	return { text: `${written}${after}`, caret: written.length };
}

/**
 * The properties of one layer, or of every layer together when `layer` is `null` - the commonest
 * first.
 *
 * Together, a key is one thing across layers: its features add up and so do its values' counts,
 * and its values are the commonest of what the layers report.
 */
export function keysOf(layers: LayerProperties[], layer: string | null): PropertyValues[] {
	const chosen = layer === null ? layers : layers.filter((candidate) => candidate.layer === layer);
	// No prototype: a property may be called anything, `constructor` included.
	const byKey: Record<string, { features: number; more: boolean; values: Record<string, number> }> =
		Object.create(null);
	for (const { keys } of chosen)
		for (const { key, features, values, more } of keys) {
			const sum = (byKey[key] ??= { features: 0, more: false, values: Object.create(null) });
			sum.features += features;
			sum.more ||= more;
			for (const { literal, count } of values) sum.values[literal] = (sum.values[literal] ?? 0) + count;
		}
	return Object.entries(byKey)
		.map(([key, { features, more, values }]) => ({
			key,
			features,
			more,
			values: Object.entries(values)
				.map(([literal, count]): ValueCount => ({ literal, count }))
				.sort((a, b) => b.count - a.count || a.literal.localeCompare(b.literal))
				.slice(0, 20)
		}))
		.sort((a, b) => b.features - a.features || a.key.localeCompare(b.key));
}

/** A string as an expression writes it, quoted and escaped - for a layer's name after `$layer ==`. */
export const quoted = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** What `$type` can be: MapLibre's names, which are upstream's. */
export const GEOMETRY_TYPES = ["'Point'", "'LineString'", "'Polygon'"] as const;

/**
 * A picked value, as it goes in after `before`: compared with `==` when it follows a name with no
 * operator between them, which is what picking a property and then one of its values means.
 */
export function valuePiece(before: string, literal: string): string {
	const tail = before.trimEnd();
	const operand = /(?:[\w\])$'"])$/.test(tail);
	const operator = /(?:==|!=|<=|>=|<|>|\bin|&&|\|\||!|\(|,|\[)$/.test(tail);
	return operand && !operator ? `== ${literal}` : literal;
}

/**
 * Upstream's message about an expression, without what the dialog already shows or cannot use.
 *
 * Written for the command line, a message says which parameter refused what, repeats the
 * expression, places the error as `<input>:1:8`, and ends with advice to run `versatiles help`.
 * Beside the expression's own box, the first three say again what is in front of you and the last
 * names a command there is none of here. What is left is upstream's words about what is wrong, and
 * the caret lines pointing at the column - kept as they are, since they only line up untouched.
 *
 * **Only what is recognised is removed.** A message in a shape this does not know - another
 * parameter's, or one a later upstream words differently - is shown whole, `null` here.
 */
export function tidyMessage(message: string): string | null {
	const header = /^does not accept '[\s\S]*?': Failed to compile CEL expression:\n/.exec(message);
	if (!header) return null;
	const lines = message.slice(header[0].length).split('\n');
	// The expression, repeated indented under the header, and the blank line after it.
	if (lines[0]?.startsWith('  ')) lines.shift();
	if (lines[0]?.trim() === '') lines.shift();
	const kept = lines
		.join('\n')
		// Advice for the command line, as a paragraph of its own.
		.replace(/\n*Common causes:[\s\S]*$/, '')
		.split('\n')
		.map((line) =>
			line
				// The place, which the caret lines below already show.
				.replace(/^ERROR: <input>:\d+:\d+: /, '')
				// What the parser said about itself when it crashed rather than answered.
				.replace(/: internal error: .*$/, '')
		)
		.join('\n')
		.trim();
	return kept === '' ? null : kept;
}
