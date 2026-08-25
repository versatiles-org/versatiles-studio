import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Writing a project out and reading one back ([Q6], G1, S5.1).
 *
 * The interesting half is what it does *not* do: assign anything. Opening a project changes which
 * graphs exist and which document is on screen, both of which belong to other modules - so `open`
 * returns and the caller sequences the rest, where the order can be read in one place.
 */

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const ipc = vi.hoisted(() => ({
	copyPlan: vi.fn(),
	isProject: vi.fn(),
	openProject: vi.fn(),
	projectPath: vi.fn(),
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
	ipc.projectPath.mockResolvedValue(null);
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

	/**
	 * The launcher's third door, which never opens a picker of its own here (S7.5).
	 *
	 * It hands a directory to a *new* window, so the window has to be able to open one it was given
	 * rather than one it asked for - and until an end-to-end story saved a project and opened it
	 * again, it could not: everything handed to a window went down the import path, where a
	 * directory has no read node.
	 */
	it('opens a directory it was handed, without asking', async () => {
		await expect(project.at('/tmp/handed')).resolves.toEqual(RECIPE);
		expect(dialog.open).not.toHaveBeenCalled();
		expect(ipc.openProject).toHaveBeenCalledWith('/tmp/handed');
	});

	it('refuses one that holds no manifest, by name', async () => {
		ipc.isProject.mockResolvedValue(false);
		await expect(project.at('/tmp/handed')).resolves.toBeNull();
		expect(status.current).toEqual({ kind: 'error', message: '/tmp/handed holds no project.yaml' });
		expect(ipc.openProject).not.toHaveBeenCalled();
	});
});

/**
 * ⌘S and ⇧⌘S, which the native menu now owns (S0.1).
 *
 * The distinction is the whole point of the pair: a Save that opened a picker every time would be
 * Save As under another name, and a shortcut on it would be a shortcut to a dialog.
 */
describe('saving where it already lives', () => {
	it('writes back without asking once there is somewhere to write', async () => {
		ipc.projectPath.mockResolvedValue('/tmp/berlin');
		await project.save(style);

		expect(dialog.open, 'nothing to ask about').not.toHaveBeenCalled();
		expect(ipc.saveProject).toHaveBeenCalledWith('/tmp/berlin', '{"version":8}');
	});

	// A project that has never been saved has nowhere to be written back to, so the first ⌘S is a
	// Save As - which is what every application does and nobody notices.
	it('asks the first time, because there is nowhere yet', async () => {
		ipc.projectPath.mockResolvedValue(null);
		await project.save(style);

		expect(dialog.open).toHaveBeenCalled();
		expect(ipc.saveProject).toHaveBeenCalledWith('/tmp/project', '{"version":8}');
	});

	it('writes nothing when that first ask is cancelled', async () => {
		ipc.projectPath.mockResolvedValue(null);
		dialog.open.mockResolvedValue(null);
		await project.save(style);
		expect(ipc.saveProject).not.toHaveBeenCalled();
	});

	it('reports a failure from the core rather than throwing at the menu', async () => {
		ipc.projectPath.mockResolvedValue('/tmp/berlin');
		ipc.saveProject.mockRejectedValue(new Error('read-only volume'));
		await project.save(style);
		expect(status.current).toEqual({ kind: 'error', message: 'read-only volume' });
	});

	// Save As means *choose*, whether or not the project has a home already.
	it('always asks, even when it knows where the project lives', async () => {
		ipc.projectPath.mockResolvedValue('/tmp/berlin');
		await project.saveAs(style);
		expect(dialog.open).toHaveBeenCalled();
		expect(ipc.saveProject).toHaveBeenCalledWith('/tmp/project', '{"version":8}');
	});
});

describe('saving', () => {
	// The style is rendered in the webview, so the core cannot produce the `style.json` it writes -
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
