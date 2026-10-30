// @vitest-environment jsdom

/** The colour ramp helper. As with `StepsDialog`, what matters is the text that goes in and comes out. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import RampDialog from './RampDialog.svelte';
import { DEFAULT_RAMP } from './ramp';

afterEach(cleanup);

// jsdom has no `showModal`, and the dialog's own effect calls it.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

const open = (value: string) => {
	const onUse = vi.fn();
	render(RampDialog, { value, name: 'ramp', onUse, onClose: vi.fn() });
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
		expect(onUse).toHaveBeenCalledWith(DEFAULT_RAMP);
	});

	it('says so when the value is not a ramp', () => {
		open('nonsense');
		expect(screen.getByText('nonsense')).toBeTruthy();
		expect(screen.queryByLabelText('Elevation of stop 1, in metres')).toBeNull();
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
