// @vitest-environment jsdom

/**
 * What the Layers pane draws, and what it writes when a control is used.
 *
 * **Prop-driven, so no backend is stubbed.** The pane is handed the composed rows and what each
 * source is; every action goes back out as a call. That is the whole reason the tree and the
 * composition are pure - what is left here is the part only a render can answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { colorful } from '@versatiles/style';
import LayersPane from './LayersPane.svelte';

const own = colorful({}) as unknown as import('maplibre-gl').StyleSpecification;

const rowsOf = (source: string, hidden: (id: string) => string | null = () => null) =>
	own.layers.map((layer) => ({
		id: `${source}/${layer.id}`,
		ownId: layer.id,
		source,
		type: layer.type,
		hidden: hidden(layer.id)
	}));

function draw(over: Partial<Parameters<typeof render>[1]> = {}) {
	const actions = { setHidden: vi.fn(), setOverride: vi.fn(), select: vi.fn(), reorder: vi.fn() };
	render(LayersPane, {
		rows: rowsOf('osm'),
		sources: { osm: { graph: 1, hidden: [], overrides: {}, style: own } },
		actions,
		...(over as object)
	});
	return actions;
}

afterEach(cleanup);

describe('the stack it draws', () => {
	it('starts collapsed: one row per source, with what is under it', () => {
		draw();
		expect(screen.getByText('osm')).toBeTruthy();
		expect(screen.getByText('324')).toBeTruthy();
		// Nothing below it until it is opened - 324 rows on sight is not a pane, it is a wall.
		expect(screen.queryByText('Labels')).toBeNull();
	});

	it('opens onto the categories rather than onto the layers', async () => {
		draw();
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));

		expect(screen.getByText('Labels')).toBeTruthy();
		expect(screen.getByText('Roads & rails')).toBeTruthy();
		expect(screen.getByText('231')).toBeTruthy();
		// Still not the layers themselves.
		expect(screen.queryByText('label-place-city')).toBeNull();
	});

	// The gesture the design exists for, seen from the pane: one source, two rows, because its layers
	// are drawn in two places.
	it('shows a source drawn in two places as two rows', () => {
		const all = rowsOf('osm');
		const isLabel = (id: string) => ['label', 'marking', 'symbol'].includes(id.split(/[-:.]/)[0]);
		draw({
			rows: [
				...all.filter((row) => !isLabel(row.ownId)),
				{ id: 'data/cases', ownId: 'cases', source: 'data', type: 'fill', hidden: null },
				...all.filter((row) => isLabel(row.ownId))
			],
			sources: {
				osm: { graph: 1, hidden: [], overrides: {}, style: own },
				data: { graph: 2, hidden: [], overrides: {}, style: null }
			}
		} as never);

		expect(screen.getAllByText('osm').length).toBe(2);
		expect(screen.getByText('291')).toBeTruthy();
		expect(screen.getByText('33')).toBeTruthy();
	});
});

describe('the eye', () => {
	it('writes the path it was pressed on, for the source that row belongs to', async () => {
		const actions = draw();
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Hide Labels' }));

		expect(actions.setHidden).toHaveBeenCalledWith(1, 'Labels', true);
	});

	// Pressing an eye that is closed *above* the row opens the one that closed it: the row a person
	// is looking at is the row they mean, and there is nothing else this could do.
	it('opens the eye that closed a row, wherever that eye is', async () => {
		const actions = draw({
			sources: { osm: { graph: 1, hidden: ['Labels'], overrides: {}, style: own } }
		} as never);
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Show Labels' }));

		expect(actions.setHidden).toHaveBeenCalledWith(1, 'Labels', false);
	});
});

describe('the nudges', () => {
	/** `osm` under a one-layer source, which is the arrangement the whole design is about. */
	const withData = {
		rows: [...rowsOf('osm'), { id: 'data/cases', ownId: 'cases', source: 'data', type: 'fill', hidden: null }],
		sources: {
			osm: { graph: 1, hidden: [], overrides: {}, style: own },
			data: { graph: 2, hidden: [], overrides: {}, style: null }
		}
	};

	// The headline gesture, as two clicks: open the source, send its labels up past the data.
	it('sends a category past the source above it', async () => {
		const actions = draw(withData as never);
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Move Labels up' }));

		// The 33 label layers are the tail of colorful, and the gap above `data` is the end of the
		// stack - so this is exactly "draw the labels over everything".
		expect(actions.reorder).toHaveBeenCalledWith([291, 324], 325);
	});

	// A source's own layers keep the style's order, so the bottom category has nowhere below it and
	// says so rather than offering a move that would be refused.
	it('offers no move where the invariant forbids one', async () => {
		draw(withData as never);
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));

		const disabled = (label: string) => (screen.getByLabelText(label) as HTMLButtonElement).disabled;
		expect(disabled('Move Background down')).toBe(true);
		expect(disabled('Move Labels down')).toBe(true);
	});

	// One source has nothing to interleave with, and its own order is not the user's to set.
	it('offers nothing at all with a single source', async () => {
		draw();
		await fireEvent.click(screen.getByRole('button', { name: 'Expand osm' }));

		const disabled = (label: string) => (screen.getByLabelText(label) as HTMLButtonElement).disabled;
		expect(disabled('Move Labels up')).toBe(true);
		expect(disabled('Move Labels down')).toBe(true);
	});
});

describe('the one selection', () => {
	it('selects a row’s source, so Pipeline and Style follow what was clicked', async () => {
		const actions = draw();
		await fireEvent.click(screen.getByRole('button', { name: 'osm' }));
		expect(actions.select).toHaveBeenCalledWith(1);
	});
});

describe('the filter box', () => {
	it('hides what does not match without regrouping what does', async () => {
		draw();
		await fireEvent.input(screen.getByLabelText('Filter layers'), { target: { value: 'roads' } });

		expect(screen.getByText('Roads & rails')).toBeTruthy();
		expect(screen.queryByText('Labels')).toBeNull();
		// The source above it survives, or the match would have nothing to hang from.
		expect(screen.getByText('osm')).toBeTruthy();
	});
});
