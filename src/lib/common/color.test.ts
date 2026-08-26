/**
 * Between an operation's spelling of a colour and the one dialect a colour input speaks ([Q57]).
 *
 * A native `<input type="color">` understands `#rrggbb` and nothing else - six digits, lower case, no
 * alpha - and no operation writes one that way. What is asserted here is the translation, and the two
 * things it must not do: claim a colour for a field that has none, and drop an alpha nobody touched.
 */

import { describe, expect, it } from 'vitest';
import { fromSwatch, toSwatch } from './color';

describe('showing a colour in a swatch', () => {
	it('reads the hex an operation writes, which carries no #', () => {
		expect(toSwatch('ff8800', 'hex')).toBe('#ff8800');
		expect(toSwatch('FF8800', 'hex')).toBe('#ff8800');
	});

	// Pasting one from anywhere else is the likeliest way this field gets filled in.
	it('tolerates a # nobody should have typed', () => {
		expect(toSwatch('#ff8800', 'hex')).toBe('#ff8800');
	});

	// The input has no alpha, so it shows the colour and leaves the rest to `fromSwatch`.
	it('shows the colour of a value that carries alpha', () => {
		expect(toSwatch('ff8800cc', 'hex')).toBe('#ff8800');
	});

	it('reads the three numbers the other operations write', () => {
		expect(toSwatch('255, 136, 0', 'rgb')).toBe('#ff8800');
		expect(toSwatch('[255,136,0]', 'rgb')).toBe('#ff8800');
		expect(toSwatch('0, 0, 0', 'rgb')).toBe('#000000');
	});

	/**
	 * `null`, not black. A swatch defaulting to black would say the parameter is set to black, which
	 * is a different fact from "not set" - and the field it sits beside is where the difference shows.
	 */
	it('says it has nothing to show rather than showing black', () => {
		expect(toSwatch('', 'hex')).toBeNull();
		expect(toSwatch('   ', 'hex')).toBeNull();
		expect(toSwatch('ff88', 'hex')).toBeNull();
		expect(toSwatch('nonsense', 'hex')).toBeNull();
		expect(toSwatch('255, 136', 'rgb')).toBeNull();
		expect(toSwatch('300, 0, 0', 'rgb')).toBeNull();
	});
});

describe('writing a picked colour back', () => {
	it('writes hex without the # the operation does not want', () => {
		expect(fromSwatch('#ff8800', '000000', 'hex')).toBe('ff8800');
	});

	/**
	 * **Alpha survives a pick.** The input has none, so picking a new colour on `ff0000cc` would
	 * otherwise silently make it opaque - a change to a property nobody touched, which is the kind of
	 * edit that is only noticed much later.
	 */
	it('keeps an alpha the picker cannot express', () => {
		expect(fromSwatch('#00ff00', 'ff0000cc', 'hex')).toBe('00ff00cc');
	});

	it('adds no alpha where there was none', () => {
		expect(fromSwatch('#00ff00', 'ff0000', 'hex')).toBe('00ff00');
		expect(fromSwatch('#00ff00', '', 'hex')).toBe('00ff00');
	});

	it('writes three numbers for the operations that take them', () => {
		expect(fromSwatch('#ff8800', '', 'rgb')).toBe('255, 136, 0');
		expect(fromSwatch('#000000', '1, 2, 3', 'rgb')).toBe('0, 0, 0');
	});

	// What comes out has to go back in, or a picked colour stops being pickable a second time.
	it('round-trips through the swatch', () => {
		for (const [value, spelling] of [
			['ff8800', 'hex'],
			['ff8800cc', 'hex'],
			['255, 136, 0', 'rgb']
		] as const) {
			const swatch = toSwatch(value, spelling)!;
			expect(fromSwatch(swatch, value, spelling)).toBe(value);
		}
	});
});
