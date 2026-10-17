// @vitest-environment jsdom

/**
 * The pane registry against the core's catalogue (S10.9).
 *
 * A pane is an id agreed between two sides: the core says where it sits and whether it is open, and
 * the webview says what it is called and renders it. Each side ignores an id the other does not know
 * - by design, so the two halves of a new pane can land in either order - which also means the two
 * lists can drift apart with nothing failing. This is what fails.
 *
 * Read from the Rust source rather than through IPC, in the spirit of `bindings_are_up_to_date`: a
 * unit test has no core to ask, and the catalogue is a literal.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PANES, paneDetail, paneTitle } from './registry';

/** The ids in `PANES` in `store.rs`, in the order a fresh install shows them. */
function coreCatalogue(): string[] {
	// Relative, like `components('src')`: the tests run from the repository root.
	const source = readFileSync('crates/studio-core/src/store.rs', 'utf8');
	const start = source.indexOf('const PANES: &[(&str, Side, bool)] = &[');
	const end = source.indexOf('];', start);
	expect(start, 'the core catalogue moved - update this test').toBeGreaterThan(-1);
	return [...source.slice(start, end).matchAll(/\("([a-z]+)", Side::/g)].map((found) => found[1]);
}

describe('the registry against the core', () => {
	it('names exactly the panes the core has', () => {
		expect(Object.keys(PANES).sort()).toEqual(coreCatalogue().sort());
	});
});

describe('what a header says', () => {
	it('gives every known pane a title, and an unknown one its id', () => {
		expect(paneTitle('layers')).toBe('Layers');
		expect(paneTitle('bytes')).toBe('bytes');
	});

	it('says "project" for a project-wide pane and the graph for a selection-bound one', () => {
		expect(paneDetail('sources', 'osm')).toBe('project');
		expect(paneDetail('layers', null)).toBe('project');
		expect(paneDetail('pipeline', 'osm')).toBe('osm');
		expect(paneDetail('style', null)).toBeNull();
		expect(paneDetail('bytes', 'osm')).toBeNull();
	});
});
