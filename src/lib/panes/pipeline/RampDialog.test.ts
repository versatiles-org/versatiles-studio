// @vitest-environment jsdom

/** The colour ramp helper. As with `StepsDialog`, what matters is the text that goes in and comes out. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import RampDialog from './RampDialog.svelte';

/** What `default` stands for here - the shape of upstream's, so the tests do not follow its colours. */
const DEFAULT_RAMP = '-11000:24507e,-200:8cb4d8,0:bcd8ec,0.01:a8c896,300:cad6a2';
/** The field's presets, as `Control::Ramp` carries them: `default` first, and more than one. */
const PRESETS = [
	{ name: 'default', stops: DEFAULT_RAMP },
	{ name: 'alpine', stops: '0:a9c39a,500:c6d4a4,4500:ffffff' }
];

afterEach(cleanup);

// jsdom has no `showModal`, and the dialog's own effect calls it.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

const open = (value: string) => {
	const onUse = vi.fn();
	render(RampDialog, { value, name: 'ramp', presets: PRESETS, onUse, onClose: vi.fn() });
	return onUse;
};

const use = () => fireEvent.click(screen.getByText('Use'));
const elevation = (stop: number) => screen.getByLabelText(`Elevation of stop ${stop}, in metres`) as HTMLInputElement;

async function move(stop: number, meters: number) {
	const input = elevation(stop);
	await fireEvent.input(input, { target: { value: String(meters) } });
	await fireEvent.blur(input);
}

describe('the round trip', () => {
	it('writes back what it was opened on', async () => {
		const onUse = open('0:00a000,1000:c8b464');
		await use();
		expect(onUse).toHaveBeenCalledWith('0:00a000,1000:c8b464');
	});

	it('opens an unset parameter on the default, and writes nothing until Use', async () => {
		const onUse = open('');
		expect(onUse).not.toHaveBeenCalled();
		await use();
		expect(onUse).toHaveBeenCalledWith('default');
	});

	it('shows a named ramp’s stops and writes its name back', async () => {
		const onUse = open('default');
		expect(elevation(1).valueAsNumber).toBe(-11000);
		await use();
		expect(onUse).toHaveBeenCalledWith('default');
	});

	it('says so when the value is not a ramp', () => {
		open('nonsense');
		expect(screen.getByText('nonsense')).toBeTruthy();
		expect(screen.queryByLabelText('Elevation of stop 1, in metres')).toBeNull();
	});
});

describe('named ramps', () => {
	const pick = (name: string) => fireEvent.change(screen.getByLabelText('Colours'), { target: { value: name } });

	it('writes the stops once one of a named ramp’s stops is edited', async () => {
		const onUse = open('default');
		await move(1, -12000);
		await use();
		expect(onUse).toHaveBeenCalledWith(DEFAULT_RAMP.replace('-11000', '-12000'));
	});

	it('replaces custom stops with a named ramp when one is picked', async () => {
		const onUse = open('0:000000');
		await pick('default');
		await use();
		expect(onUse).toHaveBeenCalledWith('default');
	});

	// The names are the field's, so one added upstream is offered with nothing to change here.
	it('offers every name the field carries, and writes the one picked', async () => {
		const onUse = open('0:000000');
		const offered = [...(screen.getByLabelText('Colours') as HTMLSelectElement).options].map((o) => o.value);
		expect(offered).toEqual(['default', 'alpine', '']);
		await pick('alpine');
		expect(elevation(3).valueAsNumber).toBe(4500);
		await use();
		expect(onUse).toHaveBeenCalledWith('alpine');
	});

	it('spells a named ramp out when custom is picked, to edit from', async () => {
		const onUse = open('default');
		await pick('');
		await use();
		expect(onUse).toHaveBeenCalledWith(DEFAULT_RAMP);
	});
});

describe('editing', () => {
	it('sorts a stop moved past its neighbour', async () => {
		const onUse = open('0:000000,100:ffffff');
		await move(1, 500);
		await use();
		expect(onUse).toHaveBeenCalledWith('100:ffffff,500:000000');
	});

	it('refuses two stops at one elevation', async () => {
		open('0:000000,100:ffffff');
		await move(2, 0);
		expect((screen.getByText('Use') as HTMLButtonElement).disabled).toBe(true);
	});

	it('adds a stop above the last without changing its colour', async () => {
		const onUse = open('0:000000');
		await fireEvent.click(screen.getByText('+ stop'));
		await use();
		expect(onUse).toHaveBeenCalledWith('0:000000,1000:000000');
	});

	it('clears the parameter when every stop is removed', async () => {
		const onUse = open('0:000000');
		await fireEvent.click(screen.getByLabelText('Remove the stop at 0 m'));
		await use();
		expect(onUse).toHaveBeenCalledWith('');
	});

	it('keeps the alpha when a colour is picked', async () => {
		const onUse = open('0:00000080');
		await fireEvent.input(screen.getByLabelText('Colour at 0 m'), { target: { value: '#ff0000' } });
		await use();
		expect(onUse).toHaveBeenCalledWith('0:ff000080');
	});
});

describe('the generator (#17)', () => {
	const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
	const generate = () => fireEvent.click(screen.getByText('Replace the stops'));

	it('replaces the stops with a gradient over the range, and writes them on Use', async () => {
		const onUse = open('default');
		await fireEvent.change(field('Gradient'), { target: { value: 'greys' } });
		await fireEvent.input(field('From'), { target: { value: '100' } });
		await fireEvent.input(field('To'), { target: { value: '900' } });
		await generate();
		expect(onUse).not.toHaveBeenCalled();
		await use();
		expect(onUse).toHaveBeenCalledWith('100:000000,900:ffffff');
	});

	// Highlighting a band: everything outside it left empty, and the tiles' cost said out loud.
	it('leaves the outside transparent, and says what that costs', async () => {
		const onUse = open('');
		await fireEvent.change(field('Gradient'), { target: { value: 'greys' } });
		await fireEvent.change(field('Outside'), { target: { value: 'transparent' } });
		await fireEvent.click(screen.getByLabelText('Reverse'));
		await generate();
		expect(screen.getByText(/Transparent colours make RGBA tiles/)).toBeTruthy();
		await use();
		expect(onUse).toHaveBeenCalledWith('-0.01:ffffff00,0:ffffff,3000:000000,3000.01:00000000');
	});

	it('will not generate over a range that is not one', async () => {
		open('default');
		await fireEvent.input(field('From'), { target: { value: '500' } });
		await fireEvent.input(field('To'), { target: { value: '100' } });
		expect((screen.getByText('Replace the stops') as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText('The highest elevation has to be above the lowest.')).toBeTruthy();
	});
});
