/**
 * Between how an operation spells a colour and what a colour input understands.
 *
 * **A native `<input type="color">` speaks one dialect and nothing else**: `#rrggbb`, lower case,
 * six digits, no alpha. Every colour Studio edits is spelled some other way - `from_color` takes
 * `RRGGBB` or `RRGGBBAA` with no `#`, `raster_flatten` takes `[r, g, b]` - so something has to
 * translate, and it is worth being one tested thing rather than a conversion written twice.
 */

/** How an operation writes a colour. */
export type Spelling = 'hex' | 'rgb';

/**
 * What the swatch should show for a value, or `null` when it is not a colour it can show.
 *
 * `null` rather than a guess: a half-typed `ff00` and a parameter left empty are both "nothing to
 * show", and a swatch defaulting to black would claim the field is set to black.
 */
export function toSwatch(value: string, spelling: Spelling): string | null {
	const text = value.trim();
	if (!text) return null;

	if (spelling === 'rgb') {
		const numbers = text.match(/\d+/g)?.map(Number);
		if (!numbers || numbers.length < 3 || numbers.slice(0, 3).some((part) => part > 255)) return null;
		return `#${numbers
			.slice(0, 3)
			.map((part) => part.toString(16).padStart(2, '0'))
			.join('')}`;
	}

	// Tolerant of a `#` nobody should have typed: pasting one from anywhere else is the likeliest way
	// this field gets filled in, and refusing to show it would be pedantry about a leading character.
	const digits = text.replace(/^#/, '');
	if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(digits)) return null;
	return `#${digits.slice(0, 6).toLowerCase()}`;
}

/**
 * What to write back when a colour is picked.
 *
 * **Alpha survives.** A native colour input has none, so picking a new colour on `ff0000cc` would
 * otherwise silently make it opaque - a change to a property nobody touched, which is the kind of
 * edit that is only noticed much later.
 */
export function fromSwatch(swatch: string, previous: string, spelling: Spelling): string {
	const digits = swatch.replace(/^#/, '').toLowerCase();

	if (spelling === 'rgb') {
		const [r, g, b] = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
		return `${r}, ${g}, ${b}`;
	}

	const alpha = previous.trim().replace(/^#/, '').slice(6, 8);
	return `${digits}${/^[0-9a-f]{2}$/i.test(alpha) ? alpha.toLowerCase() : ''}`;
}
