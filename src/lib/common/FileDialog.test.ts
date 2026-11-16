// @vitest-environment jsdom

/**
 * Studio's own file dialog: a file on this computer or on an SFTP server, walked the same way.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import FileDialog, { type BrowseApi } from './FileDialog.svelte';
import { fileDialog, type FileRequest } from '../state/file-dialog.svelte';
import type { BrowseEntry, BrowseListing, SftpServer } from '../ipc/commands';

// jsdom has no `showModal`, and `Modal` calls it on mount.
beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const file = (name: string, location: string, size = 2048): BrowseEntry => ({
	name,
	folder: false,
	size,
	modified: 1_790_000_000,
	location
});
const folder = (name: string, location: string): BrowseEntry => ({
	name,
	folder: true,
	size: null,
	modified: null,
	location
});

const HOME: BrowseListing = {
	path: '/home/anna',
	parent: '/home',
	entries: [
		folder('maps', '/home/anna/maps'),
		file('berlin.versatiles', '/home/anna/berlin.versatiles'),
		file('notes.txt', '/home/anna/notes.txt')
	]
};
const MAPS: BrowseListing = {
	path: '/home/anna/maps',
	parent: '/home/anna',
	entries: [file('alps.pmtiles', '/home/anna/maps/alps.pmtiles')]
};
const BOX: SftpServer = { host: 'box.example.org', port: 23, user: 'anna', identity: null };
const ON_BOX: BrowseListing = {
	path: '/home',
	parent: '/',
	entries: [file('reunion.versatiles', 'sftp://anna@box.example.org:23/home/reunion.versatiles')]
};

function show(over: { request?: Partial<FileRequest>; api?: Partial<BrowseApi> } = {}) {
	const api: BrowseApi = {
		places: vi.fn().mockResolvedValue([{ label: 'Home', path: '/home/anna' }]),
		local: vi.fn(async (path: string | null) => (path === '/home/anna/maps' ? MAPS : HOME)),
		remote: vi.fn().mockResolvedValue(ON_BOX),
		browsing: vi.fn().mockResolvedValue({ tab: '', folder: null, servers: [] }),
		remember: vi.fn().mockResolvedValue(null),
		forget: vi.fn().mockResolvedValue(null),
		...over.api
	};
	const onAnswer = vi.fn();
	const request: FileRequest = { title: 'Open a Source', extensions: ['versatiles', 'pmtiles'], ...over.request };
	render(FileDialog, { request, onAnswer, api });
	return { api, onAnswer };
}

const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
const openButton = () => screen.getByRole('button', { name: /^Open/ });

describe('the file dialog on this computer', () => {
	it('starts in the folder it was last in, folders first, with the places beside it', async () => {
		const { api } = show();
		await vi.waitFor(() => expect(row('berlin.versatiles')).toBeTruthy());
		expect(api.local).toHaveBeenCalledWith(null);
		const names = screen.getAllByRole('option').map((option) => option.textContent?.trim().split(/\s+/)[0]);
		expect(names).toEqual(['maps', 'berlin.versatiles', 'notes.txt']);
		expect(
			within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: 'Home' })
		).toBeTruthy();
		expect((screen.getByLabelText('Folder') as HTMLInputElement).value).toBe('/home/anna');
	});

	// Shown rather than left out: a folder that seems empty reads as the wrong folder.
	it('shows a file of another kind, dimmed, and will not choose it', async () => {
		const { onAnswer } = show();
		await vi.waitFor(() => expect(row('notes.txt')).toBeTruthy());
		expect(row('notes.txt').getAttribute('aria-disabled')).toBe('true');
		await fireEvent.dblClick(row('notes.txt'));
		expect(onAnswer).not.toHaveBeenCalled();
		expect((openButton() as HTMLButtonElement).disabled).toBe(true);
	});

	it('goes into a folder, and back up', async () => {
		const { api } = show();
		await vi.waitFor(() => expect(row('maps')).toBeTruthy());
		await fireEvent.dblClick(row('maps'));
		await vi.waitFor(() => expect(row('alps.pmtiles')).toBeTruthy());
		expect(api.local).toHaveBeenLastCalledWith('/home/anna/maps');

		await fireEvent.click(screen.getByRole('button', { name: 'Up one folder' }));
		await vi.waitFor(() => expect(api.local).toHaveBeenLastCalledWith('/home/anna'));
	});

	it('goes to a folder typed into the path', async () => {
		const { api } = show();
		await vi.waitFor(() => expect(row('maps')).toBeTruthy());
		const path = screen.getByLabelText('Folder');
		await fireEvent.input(path, { target: { value: '/home/anna/maps' } });
		await fireEvent.submit(path.closest('form')!);
		await vi.waitFor(() => expect(api.local).toHaveBeenLastCalledWith('/home/anna/maps'));
	});

	it('hands back the file chosen, and keeps the folder for next time', async () => {
		const { api, onAnswer } = show();
		await vi.waitFor(() => expect(row('berlin.versatiles')).toBeTruthy());
		await fireEvent.click(row('berlin.versatiles'));
		await fireEvent.click(openButton());
		await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith('/home/anna/berlin.versatiles'));
		expect(api.remember).toHaveBeenCalledWith('local', '/home/anna', null);
	});

	it('walks the list from the keyboard', async () => {
		const { onAnswer } = show();
		await vi.waitFor(() => expect(row('berlin.versatiles')).toBeTruthy());
		const list = screen.getByRole('listbox');
		await fireEvent.keyDown(list, { key: 'ArrowDown' });
		await fireEvent.keyDown(list, { key: 'ArrowDown' });
		// The third row is a kind the request does not take, so the arrows stop at the second.
		await fireEvent.keyDown(list, { key: 'ArrowDown' });
		expect(row('berlin.versatiles').getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(list, { key: 'Enter' });
		await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith('/home/anna/berlin.versatiles'));
	});

	it('says why a folder cannot be read, where it says everything else', async () => {
		show({ api: { local: vi.fn().mockRejectedValue('/home/anna cannot be read') } });
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('/home/anna cannot be read'));
	});

	it('answers nothing when cancelled', async () => {
		const { onAnswer } = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onAnswer).toHaveBeenCalledWith(null);
	});
});

describe('the file dialog on an SFTP server', () => {
	const remembered = { tab: 'remote', folder: null, servers: [{ server: BOX, folder: '/home' }] };

	it('opens on the tab it was last on, the last server filled in but not yet connected to', async () => {
		const { api } = show({ api: { browsing: vi.fn().mockResolvedValue(remembered) } });
		await vi.waitFor(() => expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('box.example.org'));
		expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('23');
		expect((screen.getByLabelText('User') as HTMLInputElement).value).toBe('anna');
		expect(api.remote).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'anna@box.example.org:23' })).toBeTruthy();
	});

	it('connects, lists the server, and hands back the URL of the file chosen', async () => {
		const { api, onAnswer } = show({ api: { browsing: vi.fn().mockResolvedValue(remembered) } });
		await vi.waitFor(() => expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('box.example.org'));
		await fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await vi.waitFor(() => expect(row('reunion.versatiles')).toBeTruthy());
		expect(api.remote).toHaveBeenCalledWith(BOX, null);
		expect(screen.getByText('anna@box.example.org:23')).toBeTruthy();

		await fireEvent.dblClick(row('reunion.versatiles'));
		await vi.waitFor(() =>
			expect(onAnswer).toHaveBeenCalledWith('sftp://anna@box.example.org:23/home/reunion.versatiles')
		);
		expect(api.remember).toHaveBeenCalledWith('remote', '/home/anna', { server: BOX, folder: '/home' });
	});

	it('takes a key file, and says why a connection failed without leaving the form', async () => {
		const remote = vi.fn().mockRejectedValue('SSH handshake with box.example.org:22 failed');
		show({ api: { remote } });
		await fireEvent.click(await screen.findByRole('tab', { name: 'SFTP server' }));
		await fireEvent.input(screen.getByLabelText('Host'), { target: { value: 'box.example.org' } });
		await fireEvent.input(screen.getByLabelText('User'), { target: { value: 'anna' } });
		await fireEvent.input(screen.getByLabelText('Key file'), { target: { value: '~/.ssh/box' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('status').textContent).toBe('SSH handshake with box.example.org:22 failed')
		);
		expect(remote).toHaveBeenCalledWith(
			{ host: 'box.example.org', port: 22, user: 'anna', identity: '~/.ssh/box' },
			null
		);
		expect(screen.getByLabelText('Host')).toBeTruthy();
	});

	it('asks for a host and a user before connecting', async () => {
		const { api } = show();
		await fireEvent.click(await screen.findByRole('tab', { name: 'SFTP server' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		expect(screen.getByRole('status').textContent).toMatch(/needs a host, a user name/);
		expect(api.remote).not.toHaveBeenCalled();
	});

	// An .mbtiles has no reader over the network: said here, rather than by a window that fails.
	it('keeps the dialog open on a file the caller refuses, saying why', async () => {
		const check = vi.fn().mockResolvedValue('MBTiles and TAR containers can only be opened from disk.');
		const { onAnswer } = show({
			request: { check },
			api: { browsing: vi.fn().mockResolvedValue(remembered) }
		});
		await vi.waitFor(() => expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('box.example.org'));
		await fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await vi.waitFor(() => expect(row('reunion.versatiles')).toBeTruthy());
		await fireEvent.dblClick(row('reunion.versatiles'));
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/only be opened from disk/));
		expect(onAnswer).not.toHaveBeenCalled();
	});

	it('forgets a server', async () => {
		const { api } = show({ api: { browsing: vi.fn().mockResolvedValue(remembered) } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Forget anna@box.example.org:23' }));
		expect(api.forget).toHaveBeenCalledWith(BOX);
		await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'anna@box.example.org:23' })).toBeNull());
	});
});

describe('asking for a file', () => {
	// A second ask while one is open must not leave the first caller waiting for ever.
	it('answers an earlier request with nothing when a new one is made', async () => {
		const first = fileDialog.ask({ title: 'A', extensions: [] });
		const second = fileDialog.ask({ title: 'B', extensions: [] });
		await expect(first).resolves.toBeNull();
		expect(fileDialog.request?.title).toBe('B');
		fileDialog.answer('/x.versatiles');
		await expect(second).resolves.toBe('/x.versatiles');
		expect(fileDialog.request).toBeNull();
	});
});
