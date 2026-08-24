import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Writing a project out and reading one back ([Q6], G1, S5.1).
 *
 * The interesting half is what it does *not* do: assign anything. Opening a project changes which
 * graphs exist and which document is on screen, both of which belong to other modules — so `open`
 * returns and the caller sequences the rest, where the order can be read in one place.
 */

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const ipc = vi.hoisted(() => ({
	copyPlan: vi.fn(),
	isProject: vi.fn(),
	openProject: vi.fn(),
	saveProject: vi.fn(),
	saveProjectCopy: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const { project } = await import('./project.svelte');
const { status } = await import('./status.svelte');

const RECIPE = { sources: {}, order: [] };
const style = () => '{"version":8}';

beforeEach(() => {
	vi.clearAllMocks();
	dialog.open.mockResolvedValue('/tmp/project');
	dialog.save.mockResolvedValue('/tmp/project.zip');
	ipc.isProject.mockResolvedValue(true);
	ipc.openProject.mockResolvedValue(RECIPE);
	ipc.saveProject.mockResolvedValue(undefined);
	ipc.saveProjectCopy.mockResolvedValue(undefined);
	ipc.copyPlan.mockResolvedValue({ files: ['project.yaml'] });
	project.cancelCopy();
	status.dismiss();
});

describe('opening a project', () => {
	it('returns the recipe rather than assigning anything', async () => {
		await expect(project.open()).resolves.toEqual(RECIPE);
		expect(ipc.openProject).toHaveBeenCalledWith('/tmp/project');
	});

	// Cancelling a picker is ordinary; nothing should have been said about it.
	it('returns nothing when the picker is cancelled', async () => {
		dialog.open.mockResolvedValue(null);
		await expect(project.open()).resolves.toBeNull();
		expect(ipc.openProject).not.toHaveBeenCalled();
		expect(status.current.kind).toBe('idle');
	});

	// A directory that is not a project is a thing to say by name, not a failure from deeper down.
	it('names the directory when it holds no manifest', async () => {
		ipc.isProject.mockResolvedValue(false);
		await expect(project.open()).resolves.toBeNull();
		expect(status.current).toEqual({ kind: 'error', message: '/tmp/project holds no project.yaml' });
		expect(ipc.openProject).not.toHaveBeenCalled();
	});
});

describe('saving', () => {
	// The style is rendered in the webview, so the core cannot produce the `style.json` it writes —
	// and it is resolved when a directory is chosen rather than when the button was wired up.
	it('hands over the style as it stands when the directory is chosen', async () => {
		await project.saveAs(style);
		expect(ipc.saveProject).toHaveBeenCalledWith('/tmp/project', '{"version":8}');
	});

	it('writes nothing when the picker is cancelled', async () => {
		dialog.open.mockResolvedValue(null);
		await project.saveAs(style);
		expect(ipc.saveProject).not.toHaveBeenCalled();
	});

	it('reports a failure from the core', async () => {
		ipc.saveProject.mockRejectedValue(new Error('read-only volume'));
		await project.saveAs(style);
		expect(status.current).toEqual({ kind: 'error', message: 'read-only volume' });
	});

	it('accepts having no style to write', async () => {
		await project.saveAs(() => null);
		expect(ipc.saveProject).toHaveBeenCalledWith('/tmp/project', null);
	});
});

describe('the copy dialog', () => {
	it('lists what a copy would contain', async () => {
		await project.showCopy();
		expect(project.copying).toEqual({ files: ['project.yaml'] });
	});

	// The dialog is a modal over the file picker that is about to open; leaving it up puts two
	// questions on screen at once.
	it('closes before the picker opens', async () => {
		await project.showCopy();
		await project.writeCopy(true, style);
		expect(project.copying).toBeNull();
	});

	it('asks for a filename for a zip, and a directory otherwise', async () => {
		await project.writeCopy(true, style);
		expect(dialog.save).toHaveBeenCalled();
		expect(ipc.saveProjectCopy).toHaveBeenCalledWith('/tmp/project.zip', true, '{"version":8}');

		vi.clearAllMocks();
		dialog.open.mockResolvedValue('/tmp/elsewhere');
		await project.writeCopy(false, style);
		expect(dialog.open).toHaveBeenCalled();
		expect(ipc.saveProjectCopy).toHaveBeenCalledWith('/tmp/elsewhere', false, '{"version":8}');
	});

	it('stays closed when the picker is cancelled', async () => {
		dialog.save.mockResolvedValue(null);
		await project.showCopy();
		await project.writeCopy(true, style);
		expect(project.copying).toBeNull();
		expect(ipc.saveProjectCopy).not.toHaveBeenCalled();
	});
});
