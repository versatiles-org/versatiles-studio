import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../ipc/commands';

/**
 * The style the pane edits, and the gesture rule that makes it usable.
 *
 * **A colour or a slider changes sixty times a second while it is being dragged**, and each commit
 * is an undo entry — so a gesture previews locally and commits once when it ends. Everything below
 * is about that: what a consumer sees mid-drag, what reaches the core, and what happens when the
 * gesture is abandoned or the selection moves out from under it.
 */

const ipc = vi.hoisted(() => ({
	style: vi.fn(),
	setStylePreset: vi.fn(),
	setStyleRecolor: vi.fn(),
	setStyleKind: vi.fn(),
	setStyleRaster: vi.fn(),
	setStyleHillshade: vi.fn(),
	setStyleOrder: vi.fn(),
	setLayerOverride: vi.fn(),
	pruneStyleOverrides: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const { style } = await import('./style.svelte');

const VECTOR = { type: 'vector', preset: 'colorful', recolor: {}, overrides: {} };
const RASTER = { type: 'raster', adjust: {} };

const recipe = (appearance: object = VECTOR, name = 'berlin'): Recipe =>
	({ sources: { [name]: { kind: null, appearance } }, order: [name] }) as unknown as Recipe;

/** Every mutator answers with a recipe, which is what the module assigns from. */
function answersWith(next: Recipe) {
	for (const key of [
		'setStylePreset',
		'setStyleRecolor',
		'setStyleKind',
		'setStyleRaster',
		'setStyleHillshade',
		'setStyleOrder',
		'setLayerOverride',
		'pruneStyleOverrides'
	] as const) {
		ipc[key].mockResolvedValue(next);
	}
}

beforeEach(async () => {
	vi.clearAllMocks();
	ipc.style.mockResolvedValue(recipe());
	answersWith(recipe());
	await style.load();
	style.focus({ id: 1, name: 'berlin' });
	style.cancelRecolor();
	style.cancelRaster();
});

describe('which source the pane is editing', () => {
	it('reads the focused source out of the recipe', () => {
		expect(style.source.appearance).toEqual(VECTOR);
	});

	// The webview draws before it has asked the core anything, so a source with no entry must draw as
	// a preset rather than as nothing.
	it('gives an unstyled source a preset rather than nothing', () => {
		style.focus({ id: 2, name: 'not-in-the-recipe' });
		expect(style.source.appearance).toMatchObject({ type: 'vector', preset: 'colorful' });
	});

	it('edits nothing at all when no graph is focused', async () => {
		style.focus(null);
		await style.setPreset('graybeard');
		expect(ipc.setStylePreset).not.toHaveBeenCalled();
	});
});

describe('a gesture in flight', () => {
	it('shows the preview without recording it', () => {
		style.previewRecolor({ rotate: 40 });
		expect(style.previewing).toBe(true);
		expect(style.source.appearance).toMatchObject({ recolor: { rotate: 40 } });
		expect(ipc.setStyleRecolor).not.toHaveBeenCalled();
	});

	// The committed recipe is what the undo stack agrees with; a consumer that needs the real answer
	// mid-drag has to be able to ask for it.
	it('leaves the committed recipe alone until the gesture ends', () => {
		style.previewRecolor({ rotate: 40 });
		expect(style.committed?.sources['berlin'].appearance).toEqual(VECTOR);
	});

	it('records once when the gesture ends', async () => {
		style.previewRecolor({ rotate: 40 });
		await style.commitRecolor();
		expect(ipc.setStyleRecolor).toHaveBeenCalledTimes(1);
		expect(ipc.setStyleRecolor).toHaveBeenCalledWith(1, { rotate: 40 });
		expect(style.previewing).toBe(false);
	});

	it('records nothing when the gesture is abandoned', async () => {
		style.previewRecolor({ rotate: 40 });
		style.cancelRecolor();
		await style.commitRecolor();
		expect(ipc.setStyleRecolor).not.toHaveBeenCalled();
		expect(style.source.appearance).toEqual(VECTOR);
	});

	it('does the same for a raster adjustment', async () => {
		ipc.style.mockResolvedValue(recipe(RASTER));
		await style.load();
		style.previewRaster({ opacity: 0.5 });
		expect(style.source.appearance).toMatchObject({ adjust: { opacity: 0.5 } });
		expect(ipc.setStyleRaster).not.toHaveBeenCalled();

		await style.setRaster({ opacity: 0.5 });
		expect(ipc.setStyleRaster).toHaveBeenCalledWith(1, { opacity: 0.5 });
	});

	// A recolour preview belongs to a vector appearance and a raster one to an image; neither should
	// show through on the other.
	it('does not show a recolour preview over a raster source', async () => {
		ipc.style.mockResolvedValue(recipe(RASTER));
		await style.load();
		style.previewRecolor({ rotate: 40 });
		expect(style.source.appearance).toEqual(RASTER);
	});
});

describe('when the selection moves', () => {
	// **A slider half-dragged on one source must not commit onto another.** Without this the preview
	// outlives the selection and the next commit writes it to whatever is now focused.
	it('abandons an in-flight gesture', () => {
		style.previewRecolor({ rotate: 40 });
		style.focus({ id: 2, name: 'places' });
		expect(style.previewing).toBe(false);
	});

	it('stays put when the same graph is focused again', () => {
		style.previewRecolor({ rotate: 40 });
		style.focus({ id: 1, name: 'berlin' });
		expect(style.previewing).toBe(true);
	});
});

describe('undo', () => {
	// Assigned, never merged: the core is the one that stepped, and a merge would leave the two with
	// different ideas of what the style is.
	it('drops any preview and takes what was restored', () => {
		style.previewRecolor({ rotate: 40 });
		style.restored(recipe({ type: 'vector', preset: 'shadow', recolor: {}, overrides: {} }));
		expect(style.previewing).toBe(false);
		expect(style.source.appearance).toMatchObject({ preset: 'shadow' });
	});
});

describe('the rest of the edits', () => {
	it('passes the focused graph to every one of them', async () => {
		await style.setPreset('graybeard');
		await style.setKind('rasterImage');
		await style.setHillshade({ exaggeration: 0.5 });
		await style.setLayer('water', { visible: false });
		await style.pruneOverrides(['water']);

		expect(ipc.setStylePreset).toHaveBeenCalledWith(1, 'graybeard');
		expect(ipc.setStyleKind).toHaveBeenCalledWith(1, 'rasterImage');
		expect(ipc.setStyleHillshade).toHaveBeenCalledWith(1, { exaggeration: 0.5 });
		expect(ipc.setLayerOverride).toHaveBeenCalledWith(1, 'water', { visible: false });
		expect(ipc.pruneStyleOverrides).toHaveBeenCalledWith(1, ['water']);
	});

	// The order is the project's, not a source's, so it needs no graph.
	it('sets the draw order without one', async () => {
		await style.setOrder(['places', 'berlin']);
		expect(ipc.setStyleOrder).toHaveBeenCalledWith(['places', 'berlin']);
	});
});
