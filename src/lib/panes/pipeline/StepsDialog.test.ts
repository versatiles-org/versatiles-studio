// @vitest-environment jsdom

/**
 * The per-zoom curve helper (S3.4).
 *
 * **What this file is about is the round trip.** `steps.test.ts` covers the language itself against
 * upstream's own case table; the risk left here is the dialog's two edges - decoding the text it was
 * opened on into rows, and encoding those rows back into text a person will have to live with in
 * their VPL. A helper that reads a value one way and writes it back another is worse than no helper,
 * because the damage is silent and lands in the document.
 *
 * So every case below opens on a written value and asserts on the written value that comes out.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import StepsDialog from './StepsDialog.svelte';
import { resolve } from './steps';

afterEach(cleanup);

// jsdom has no `showModal`, and the dialog's own effect calls it. Stubbed rather than worked around:
// what is being tested is inside the dialog, not the browser's top layer.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

const open = (value: string) => {
	const onUse = vi.fn();
	const onClose = vi.fn();
	render(StepsDialog, { value, min: 0, max: 100, maxZoom: 31, name: 'quality', onUse, onClose });
	return { onUse, onClose };
};

const values = () => screen.getAllByLabelText(/^Value from zoom/) as HTMLInputElement[];
const zooms = () => screen.getAllByLabelText(/^First zoom for value/) as HTMLInputElement[];
const use = () => fireEvent.click(screen.getByText('Use'));

describe('decoding what it was opened on', () => {
	it('draws one row per breakpoint, in zoom order', () => {
		open('80,70,14:50');
		expect(values().map((input) => input.value)).toEqual(['80', '70', '50']);
		expect(zooms().map((input) => input.value)).toEqual(['0', '1', '14']);
	});

	it('understands the positional form, which is the half nobody can read', () => {
		open('80,70');
		expect(values().map((input) => input.value)).toEqual(['80', '70']);
		expect(zooms().map((input) => input.value)).toEqual(['0', '1']);
	});

	it('starts where the curve starts rather than at zoom 0', () => {
		open('10:30');
		expect(zooms().map((input) => input.value)).toEqual(['10']);
	});

	it('draws nothing for a parameter that is unset', () => {
		open('');
		expect(screen.queryAllByLabelText(/^Value from zoom/)).toHaveLength(0);
	});

	// Two rules that overlap are one curve; the rows are the curve, not the rules.
	it('reduces an overlapping value to the curve it means', () => {
		open('14:50,10:30');
		expect(values().map((input) => input.value)).toEqual(['30']);
		expect(zooms().map((input) => input.value)).toEqual(['10']);
	});

	it('says so, and shows the value, when it is not a curve at all', () => {
		open('0-10:80,11-14:90');
		expect(screen.queryAllByLabelText(/^Value from zoom/)).toHaveLength(0);
		expect(screen.getByText(/is not a per-zoom curve/)).toBeTruthy();
		expect(screen.getByText('0-10:80,11-14:90')).toBeTruthy();
	});
});

describe('encoding what it writes back', () => {
	// **The property that matters most.** Open and Use without touching anything, and the parameter
	// must still mean exactly what it meant - for every shape the language has.
	it.each(['80', '80,70', '10:30', '80,70,14:50,15:20', '', ' ,80 , ,  ', '14:50,10:30'])(
		'writes back a curve identical to %o when nothing was edited',
		async (value) => {
			const { onUse } = open(value);
			await use();
			expect(onUse).toHaveBeenCalledTimes(1);
			expect(resolve(onUse.mock.calls[0][0] as string)).toEqual(resolve(value));
		}
	);

	it('writes the plain form for a single curve-wide value', async () => {
		const { onUse } = open('0:80');
		await use();
		expect(onUse).toHaveBeenCalledWith('80');
	});

	it('spells out every zoom when there is more than one step', async () => {
		const { onUse } = open('80,70');
		await use();
		expect(onUse).toHaveBeenCalledWith('0:80,1:70');
	});

	it('carries an edited value through to the text', async () => {
		const { onUse } = open('80,70,14:50');
		await fireEvent.blur(values()[1], { target: { value: '60' } });
		await use();
		expect(onUse).toHaveBeenCalledWith('0:80,1:60,14:50');
	});

	it('re-sorts when a breakpoint is moved past another', async () => {
		const { onUse } = open('0:80,14:50');
		await fireEvent.blur(zooms()[0], { target: { value: '20' } });
		await use();
		expect(onUse).toHaveBeenCalledWith('14:50,20:80');
	});

	it('writes nothing when the last row is removed, which clears the parameter', async () => {
		const { onUse } = open('80');
		await fireEvent.click(screen.getByLabelText('Remove the step at zoom 0'));
		await use();
		expect(onUse).toHaveBeenCalledWith('');
	});

	it('holds a value and a zoom to the ranges the control carries', async () => {
		const { onUse } = open('80');
		await fireEvent.blur(values()[0], { target: { value: '250' } });
		await fireEvent.blur(zooms()[0], { target: { value: '99' } });
		await use();
		expect(onUse).toHaveBeenCalledWith('31:100');
	});

	// Adding a row is not an edit to the curve: it continues it, so the resolved value is unchanged.
	it('adds a row that continues the curve rather than changing it', async () => {
		const { onUse } = open('80');
		await fireEvent.click(screen.getByText('+ step'));
		await use();
		expect(resolve(onUse.mock.calls[0][0] as string)).toEqual(resolve('80'));
	});

	it('starts an empty curve at zoom 0 and the top of the range', async () => {
		const { onUse } = open('');
		await fireEvent.click(screen.getByText('+ step'));
		await use();
		expect(onUse).toHaveBeenCalledWith('100');
	});
});

describe('what it shows before writing', () => {
	it('names which zooms get what', () => {
		open('80,70,14:50');
		expect(screen.getByText('z0: 80 · z1-13: 70 · z14+: 50')).toBeTruthy();
	});

	it('shows the text it is about to write, before it writes it', () => {
		open('80,70');
		expect(screen.getByText('0:80,1:70')).toBeTruthy();
	});

	it('says when Use would clear the parameter', () => {
		open('');
		expect(screen.getByText(/clears the parameter/)).toBeTruthy();
	});
});

describe('leaving without using', () => {
	// A dialog opened to look at a value and closed again must leave the document alone.
	it('writes nothing when it is cancelled, whatever was edited', async () => {
		const { onUse, onClose } = open('80,70');
		await fireEvent.blur(values()[0], { target: { value: '10' } });
		await fireEvent.click(screen.getByText('Cancel'));
		expect(onUse).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});
});
