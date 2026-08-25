import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The export dialog's own state, and the two things it does.
 *
 * Most of what is worth asserting here is about *refusing* politely: a build that will not build is
 * not a reason to refuse the dialog, a cancelled file picker is not a failure, and a graph that
 * closed under the dialog is not a crash.
 */

const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const ipc = vi.hoisted(() => ({
	estimateExport: vi.fn(),
	exportGraph: vi.fn(),
	mountGraph: vi.fn(),
	writableFormats: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const { exporting } = await import('./export.svelte');
const { status } = await import('./status.svelte');

const CROP = { bbox: null, minZoom: null, maxZoom: null } as never;

beforeEach(async () => {
	vi.clearAllMocks();
	ipc.writableFormats.mockResolvedValue(['versatiles', 'mbtiles', 'pmtiles']);
	ipc.mountGraph.mockResolvedValue({ name: 'berlin' });
	ipc.exportGraph.mockResolvedValue(1);
	dialog.save.mockResolvedValue('/tmp/out.versatiles');
	await exporting.loadFormats();
	exporting.close();
	status.dismiss();
});

describe('opening the dialog', () => {
	it('asks what the graph produces', async () => {
		await exporting.show(3);
		expect(exporting.open).toBe(true);
		expect(exporting.producing).toEqual({ name: 'berlin' });
		expect(ipc.mountGraph).toHaveBeenCalledWith(3);
	});

	// **A build that fails is not a reason to refuse the dialog.** What it must say is what will be
	// written and what that costs, and both come from elsewhere. This is confirmation.
	it('still opens when the graph will not build', async () => {
		ipc.mountGraph.mockRejectedValue(new Error('from_csv: lon_column is not set'));
		await exporting.show(3);
		expect(exporting.open).toBe(true);
		expect(exporting.producing).toBeNull();
	});

	// Asked for by name rather than taken from the last preview, which follows the pin - with a node
	// pinned that describes an intermediate step, and the export writes the graph regardless.
	it('forgets the previous answer while the new one is fetched', async () => {
		await exporting.show(3);
		await exporting.show(null);
		expect(exporting.producing).toBeNull();
		expect(ipc.mountGraph).toHaveBeenCalledTimes(1);
	});
});

describe('the estimate', () => {
	it('asks the core for the graph and the crop it will write', async () => {
		ipc.estimateExport.mockResolvedValue({ tiles: 42 });
		await expect(exporting.estimate(3, CROP)).resolves.toEqual({ tiles: 42 });
		expect(ipc.estimateExport).toHaveBeenCalledWith(3, CROP);
	});

	// The dialog outlives its graph if one is removed under it; a rejection is an answer, a crash is
	// not.
	it('refuses rather than throwing when the graph is gone', async () => {
		await expect(exporting.estimate(null, CROP)).rejects.toThrow(/no longer open/);
	});
});

describe('starting the export', () => {
	it('closes the dialog before the file picker opens', async () => {
		await exporting.show(3);
		await exporting.start(3, 'berlin', CROP);
		expect(exporting.open).toBe(false);
	});

	it('offers the graph’s name and the first writable format', async () => {
		await exporting.start(3, 'berlin', CROP);
		const options = dialog.save.mock.calls[0][0];
		expect(options.defaultPath).toBe('berlin.versatiles');
		expect(options.filters[0].extensions).toEqual(['versatiles', 'mbtiles', 'pmtiles']);
	});

	it('submits the job to the core', async () => {
		await exporting.start(3, 'berlin', CROP);
		expect(ipc.exportGraph).toHaveBeenCalledWith(3, '/tmp/out.versatiles', CROP);
	});

	// Cancelling a file picker is an ordinary thing to do, not a failure to report.
	it('writes nothing and says nothing when the picker is cancelled', async () => {
		dialog.save.mockResolvedValue(null);
		await exporting.start(3, 'berlin', CROP);
		expect(ipc.exportGraph).not.toHaveBeenCalled();
		expect(status.current.kind).toBe('idle');
	});

	// **No status message on success.** The job *is* the status: the bar prefers a running job, so a
	// message set here would be invisible while the export ran and surface once it had stopped.
	it('leaves the bar to the job it just submitted', async () => {
		await exporting.start(3, 'berlin', CROP);
		expect(status.current.kind).toBe('idle');
	});

	it('reports a failure from the core', async () => {
		ipc.exportGraph.mockRejectedValue(new Error('no such directory'));
		await exporting.start(3, 'berlin', CROP);
		expect(status.current).toEqual({ kind: 'error', message: 'no such directory' });
	});
});
