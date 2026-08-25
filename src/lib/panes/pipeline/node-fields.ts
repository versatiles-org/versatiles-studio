/**
 * What a node's form shows, apart from the component that draws it (S2.6, C2, [Q33]).
 *
 * Which parameters appear and which hide behind `＋ parameter…`, how a value is read out of VPL and
 * written back, and how a field's type is described in words. All decisions with right answers, and
 * the same split `layer-tree.ts` makes next door.
 *
 * [Q33]: ../../../docs/decisions.md
 */

import type { FieldInfo, VplProperty } from '../../ipc/commands';

/** The field an operation calls `key`, if it has one. */
export function fieldOf(fields: FieldInfo[], key: string): FieldInfo | undefined {
	return fields.find((field) => field.name === key);
}

/**
 * Parameters the operation accepts and this node has not set.
 *
 * **Sources are not parameters.** They arrive through a `[ … ]` block rather than a `key=value`
 * pair, so offering one in a parameter list would produce VPL that cannot parse.
 */
export function unsetFields(fields: FieldInfo[], properties: { key: string }[]): FieldInfo[] {
	return fields.filter((field) => !field.sources && !properties.some((property) => property.key === field.name));
}

/**
 * Required parameters with no value yet - **always shown, empty** ([Q33]).
 *
 * Hiding them behind `＋ parameter…` made a form that conceals its own required fields and sends you
 * hunting. Shown and empty, "required" needs no symbol: the field is simply there, and waiting.
 */
export const missingFields = (unset: FieldInfo[]): FieldInfo[] => unset.filter((field) => field.required);

/** What `＋ parameter…` offers: the optional ones, since the required are already on screen. */
export const addableFields = (unset: FieldInfo[]): FieldInfo[] => unset.filter((field) => !field.required);

/** A property's value as one editable string, whichever shape VPL stored it in. */
export function valueText(property: VplProperty): string {
	return property.value.kind === 'single'
		? property.value.value
		: property.value.items.map((item) => item.value).join(', ');
}

/** A comma-separated field, split into the values it means. Blanks are not values. */
export function parts(raw: string): string[] {
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

/** Whether VPL is holding this property as an array rather than a single value. */
export const isArray = (property: VplProperty): boolean => property.value.kind === 'array';

/**
 * What this field could be set to - whichever end of the pipeline can answer.
 *
 * A suggestion read from the data beats the generic list: `lon_column` has a handful of real answers
 * and every layer name is a poor guess at one.
 */
export function optionsFor(
	suggestions: Record<string, string[]>,
	properties: string[],
	key: string,
	control: FieldInfo['control'] | undefined
): string[] {
	return suggestions[key] ?? (control?.kind === 'list' ? properties : []);
}

/** What an edit to a property means: remove it, replace its parts, or replace its one value. */
export type Edit =
	| { kind: 'unchanged' }
	/** Emptied - the parameter goes, rather than being written as an empty string. */
	| { kind: 'remove' }
	/** A list or fixed-size array: the whole property is rewritten. */
	| { kind: 'parts'; values: string[] }
	/** One value in place, which keeps the surrounding text exactly as it was. */
	| { kind: 'value'; value: string };

/**
 * Reads a typed edit out of what someone left in the box.
 *
 * **Empty removes rather than writing `key=""`.** That spelling parses and then fails when the
 * pipeline builds, which puts the error a long way from the field that caused it.
 */
export function editFor(property: VplProperty, raw: string, control: FieldInfo['control'] | undefined): Edit {
	if (raw === valueText(property)) return { kind: 'unchanged' };
	if (raw.trim() === '') return { kind: 'remove' };
	if (control?.kind === 'list' || control?.kind === 'numbers' || isArray(property)) {
		return { kind: 'parts', values: parts(raw) };
	}
	return { kind: 'value', value: raw };
}

/**
 * What to write for a required parameter that has just been filled in, or `null` for nothing.
 *
 * Empty stays empty for the same reason: `lon_column=''` is VPL that parses and then fails.
 */
export function requiredEdit(raw: string, control: FieldInfo['control'] | undefined): string[] | null {
	const value = raw.trim();
	if (!value) return null;
	return control?.kind === 'list' ? parts(value) : [value];
}

/**
 * What a parameter *is*, from `field_meta` - type, bounds, and whether it is required.
 *
 * Assembled here rather than in the popover, which stays ignorant of VPL: this is the one place
 * that knows a `Control` from a `FieldInfo`.
 */
export function summarise(field: FieldInfo): string {
	const control = field.control;
	let type: string;
	switch (control.kind) {
		case 'number':
			type = control.integer ? 'whole number' : 'number';
			if (control.min !== null && control.max !== null) type += ` ${control.min}-${control.max}`;
			else if (control.min !== null) type += ` from ${control.min}`;
			else if (control.max !== null) type += ` up to ${control.max}`;
			break;
		case 'boolean':
			type = 'true or false';
			break;
		case 'choice':
			type = `one of ${control.options.join(', ')}`;
			break;
		case 'list':
			type = 'a list, comma separated';
			break;
		case 'numbers':
			type = `${control.count} numbers`;
			break;
		case 'path':
			type = 'a file path';
			break;
		default:
			type = 'text';
	}
	return `${type} · ${field.required ? 'required' : 'optional'}`;
}
