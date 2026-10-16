// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import RemoteDialog from './RemoteDialog.svelte';
import type { Opening } from '../ipc/commands';
import type { Shortcut } from './catalog';

// jsdom has no `showModal`, and `Modal` calls it on mount.
beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
});
afterEach(cleanup);

const OSM: Shortcut = {
	title: 'OpenStreetMap',
	description: ['Full planet tileset.'],
	tileType: 'vector',
	url: 'https://download.versatiles.org/osm.versatiles',
	size: 66534652244,
	date: '2026-06-08',
	publisher: 'download.versatiles.org'
};

const opens = (label = 'Tile container'): Opening => ({ kind: { label } as Opening['kind'], refused: null });

function show(over: Record<string, unknown> = {}) {
	const calls = { onOpen: vi.fn(), onCancel: vi.fn() };
	const check = vi.fn(async (url: string): Promise<Opening> =>
		url.endsWith('.mbtiles') ? { kind: null, refused: 'MBTiles … can only be opened from disk' } : opens()
	);
	render(RemoteDialog, { check, loadShortcuts: async () => [OSM], ...calls, ...over });
	return { ...calls, check };
}

async function type(text: string) {
	const field = (await screen.findByLabelText('Address of a remote file')) as HTMLInputElement;
	await fireEvent.input(field, { target: { value: text } });
	return field;
}

const openButton = () => screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement;

describe('the address', () => {
	it('starts with the caret in the field', async () => {
		show();
		const field = await screen.findByLabelText('Address of a remote file');
		await vi.waitFor(() => expect(document.activeElement).toBe(field));
	});

	// The check is what OK waits for: an address that would fail in the reader fails here instead.
	it('opens only what the check says will open', async () => {
		const { onOpen } = show();
		expect(openButton().disabled, 'nothing typed').toBe(true);

		await type('https://example.org/planet.versatiles');
		await vi.waitFor(() => expect(screen.getByText('Opens as: Tile container')).toBeTruthy());
		openButton().click();
		expect(onOpen).toHaveBeenCalledWith('https://example.org/planet.versatiles');
	});

	it('says why an address will not open, and does not offer to', async () => {
		show();
		await type('https://example.org/berlin.mbtiles');
		await vi.waitFor(() => expect(screen.getByText(/can only be opened from disk/)).toBeTruthy());
		expect(openButton().disabled).toBe(true);
	});

	it('asks nothing of the core for something that is not an address', async () => {
		const { check } = show();
		await type('/Users/me/berlin.versatiles');
		expect(screen.getByText(/starting with https:\/\/ or sftp:\/\//)).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(check).not.toHaveBeenCalled();
	});

	// One request per pause, not per keystroke - a `.json` is read to be identified.
	it('checks once the typing stops, not on every key', async () => {
		const { check } = show();
		await type('https://example.org/a');
		await type('https://example.org/ab');
		await type('https://example.org/abc.versatiles');
		await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
		expect(check).toHaveBeenCalledWith('https://example.org/abc.versatiles');
	});
});

describe('the shortcuts', () => {
	it('fills the field from the catalogue, under who publishes it', async () => {
		show();
		expect(await screen.findByText('download.versatiles.org')).toBeTruthy();
		(await screen.findByRole('button', { name: /OpenStreetMap/ })).click();
		const field = (await screen.findByLabelText('Address of a remote file')) as HTMLInputElement;
		await vi.waitFor(() => expect(field.value).toBe(OSM.url));
	});

	it('offers what was opened before', async () => {
		show({ recents: ['https://example.org/mine.pmtiles'] });
		(await screen.findByTitle('https://example.org/mine.pmtiles')).click();
		const field = (await screen.findByLabelText('Address of a remote file')) as HTMLInputElement;
		await vi.waitFor(() => expect(field.value).toBe('https://example.org/mine.pmtiles'));
	});

	// What was opened before is the likeliest thing to want again - but an empty tab is nowhere to
	// start, so with no recents the catalogue is what shows.
	it('opens on Recent when there is anything in it, and on Catalog when there is not', async () => {
		show({ recents: ['https://example.org/mine.pmtiles'] });
		const recent = await screen.findByRole('tab', { name: 'Recent' });
		expect(recent.getAttribute('aria-selected')).toBe('true');
		expect(screen.queryByRole('button', { name: /OpenStreetMap/ })).toBeNull();
		cleanup();

		show();
		expect((await screen.findByRole('tab', { name: 'Catalog' })).getAttribute('aria-selected')).toBe('true');
	});

	it('switches tabs by click and by arrow key', async () => {
		show({ recents: ['https://example.org/mine.pmtiles'] });
		const recent = await screen.findByRole('tab', { name: 'Recent' });
		const catalog = screen.getByRole('tab', { name: 'Catalog' });

		await fireEvent.click(catalog);
		expect(await screen.findByRole('button', { name: /OpenStreetMap/ })).toBeTruthy();

		await fireEvent.keyDown(catalog, { key: 'ArrowRight' });
		expect(recent.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(recent);
	});

	// The help is not a tab: it is what the field accepts, and it is read while typing.
	it('says what opens from an address, under the field, whichever tab is open', async () => {
		show({ recents: ['https://example.org/mine.pmtiles'] });
		expect(await screen.findByText(/open\s+from disk only/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));
		expect(screen.getByText(/open\s+from disk only/)).toBeTruthy();
	});

	// Offline is a state Studio works in. The extras still show; the catalogue says why it is missing.
	it('says so when the catalogue cannot be had', async () => {
		show({ loadShortcuts: async () => null });
		expect(await screen.findByText(/could not be loaded - Studio may be offline/)).toBeTruthy();
		expect(screen.getByText('OpenFreeMap')).toBeTruthy();
	});
});

it('cancels', async () => {
	const { onCancel } = show();
	(await screen.findByRole('button', { name: 'Cancel' })).click();
	expect(onCancel).toHaveBeenCalled();
});
