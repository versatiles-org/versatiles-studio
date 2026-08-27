/**
 * Reading and writing a layer's filter (S4.5, D3).
 *
 * **This is where the expressions are.** D3 asks for "filter / zoom / paint editing, and an
 * expression editor"; zoom and paint arrived with the tree, and a survey of the five vector presets
 * says the remaining half is this one: of 1,825 colour properties across 1,503 layers, *none* is an
 * expression, while 1,475 of those layers carry a filter and every one of them is. A colour that is
 * an expression cannot currently occur at all - no preset writes one, `deriveStyle` writes plain
 * strings, and there is no style import - so an editor for those would have nothing to open.
 *
 * **Text, not a tree.** A filter is a small program, and the vocabulary the presets actually use is
 * narrow - `get`, `==`, `all`, `!=`, `has`, `!`, `in` and the comparisons. A row-per-clause builder
 * would cover most of them and then have to refuse the rest, which is the worst of both: it cannot
 * open what it cannot draw. JSON is what the value already is.
 *
 * **Validated by the renderer's own code.** `featureFilter` is the function MapLibre calls to turn a
 * filter into a predicate, so what it accepts is exactly what the map will draw - no second opinion
 * to drift. It is lenient about shape, though: a bare string and an empty array both pass, and
 * neither is a filter anyone meant to write, so [`parse`] checks that first.
 */

import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import type { LayerSpecification } from 'maplibre-gl';
import type { LayerOverride } from '../../ipc/commands';

/** A filter as typed, once it is known to be one - or why it is not. */
export type Parsed =
	/** Ready to apply. `undefined` means the field was cleared: the style's own filter comes back. */
	{ ok: true; filter: unknown | undefined } | { ok: false; problem: string };

/**
 * The filter a layer is drawn with: the override's if it has one, otherwise the style's own.
 *
 * `null` for a layer with no filter either way, which is a third state rather than an empty one -
 * "draws everything" is not the same as "draws nothing".
 */
export function filterOf(layer: LayerSpecification | undefined, override: LayerOverride | undefined): unknown | null {
	const patched = override?.filter;
	if (patched !== undefined && patched !== null) return patched;
	const own = (layer as { filter?: unknown } | undefined)?.filter;
	return own === undefined ? null : own;
}

/** Whether this layer's filter is the user's rather than the style's. */
export function isOverridden(override: LayerOverride | undefined): boolean {
	return override?.filter !== undefined && override.filter !== null;
}

/**
 * Turns what was typed into a filter, or says what is wrong with it.
 *
 * Empty is a real answer - it clears the override and gives the style's filter back - so it is not
 * an error. Everything else has to survive both checks below.
 */
export function parse(text: string): Parsed {
	if (text.trim() === '') return { ok: true, filter: undefined };

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		// The parser's message carries the position, which is the useful half.
		return { ok: false, problem: error instanceof Error ? error.message : 'Not valid JSON' };
	}

	// `featureFilter` accepts a bare string, `true` and `[]` without complaint, and none of those is
	// a filter - they are what a half-finished edit looks like, so they are refused here instead.
	if (!Array.isArray(value))
		return { ok: false, problem: 'A filter is an array, e.g. ["==", ["get", "class"], "river"]' };
	if (value.length === 0) return { ok: false, problem: 'An empty array filters nothing - clear the field instead' };
	if (typeof value[0] !== 'string')
		return { ok: false, problem: `A filter starts with an operator, not ${JSON.stringify(value[0])}` };

	try {
		// Cast because the parameter is typed as a *valid* filter, and establishing that is what this
		// call is for - there is no way to ask the question in the type system's terms.
		featureFilter(value as Parameters<typeof featureFilter>[0], 'filter');
	} catch (error) {
		return {
			ok: false,
			problem: error instanceof Error ? error.message.replace(/\n+/g, ' ') : 'MapLibre refused this filter'
		};
	}
	return { ok: true, filter: value };
}

/**
 * A filter as text to edit.
 *
 * Indented, but a clause that fits stays on its line: `JSON.stringify(…, null, '\t')` puts every
 * `["get", "class"]` on three lines of its own, and a filter of four clauses becomes forty lines in
 * a sidebar. Anything short enough to read at a glance is left as one line, which is how these are
 * written by hand.
 */
export function format(filter: unknown, width = 56): string {
	const render = (value: unknown, indent: string): string => {
		const flat = JSON.stringify(value);
		if (!Array.isArray(value) || (flat !== undefined && flat.length + indent.length <= width)) {
			return flat ?? 'null';
		}
		const inner = indent + '\t';
		return `[\n${value.map((child) => inner + render(child, inner)).join(',\n')}\n${indent}]`;
	};
	return render(filter, '');
}
