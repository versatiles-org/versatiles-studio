/**
 * What the status bar says when the core hands back a context stack ([Q59]).
 *
 * The bar fits about eighty characters and truncates the rest. A chain's first eighty are the layers
 * every failure has in common, so what it showed was the part that never differs.
 */

import { describe, expect, it } from 'vitest';
import { headline } from './message';

/** The real thing, from a `from_tilejson` build against a server that dropped the connection. */
const CHAIN = [
	'Failed to build pipeline from VPL',
	'Failed to create read operation from VPL node',
	'Failed to build from_tilejson operation in VPL node "from_tilejson"',
	'error sending request for url (https://sgx.geodatenzentrum.de/tiles/bm.json)',
	'client error (SendRequest)',
	'connection error',
	'Connection reset by peer (os error 54)'
].join(': ');

describe('the line a status bar gets', () => {
	it('is the cause, not the scaffolding around it', () => {
		expect(headline(CHAIN)).toBe('Connection reset by peer (os error 54)');
	});

	it('is short enough to read in a bar', () => {
		expect(CHAIN.length).toBeGreaterThan(200);
		expect(headline(CHAIN).length).toBeLessThan(80);
	});

	// A parse error is already one short sentence, and there is nothing to take off it.
	it('leaves a message that is already one thing alone', () => {
		for (const message of [
			"expected '=', got end of input",
			'unexpected character',
			"unknown operation 'nonsense_operation'"
		]) {
			expect(headline(message)).toBe(message);
		}
	});

	/**
	 * **Two layers is a sentence, not a stack.** Reducing `no such file: /home/anna/berlin.mbtiles`
	 * to the path would throw away the half that says what went wrong.
	 */
	it('keeps a sentence that merely contains a colon', () => {
		expect(headline('no such file: /home/anna/berlin.mbtiles')).toBe('no such file: /home/anna/berlin.mbtiles');
	});

	// Split on `": "`, so the colons inside these are not layer boundaries.
	it('does not cut a URL, a Windows path or a tile coordinate in half', () => {
		expect(headline('cannot read https://example.org/tiles.json')).toBe('cannot read https://example.org/tiles.json');
		expect(headline('cannot read C:\\maps\\berlin.mbtiles')).toBe('cannot read C:\\maps\\berlin.mbtiles');
		expect(headline('HTTP 404 for tile 12/2200/1343')).toBe('HTTP 404 for tile 12/2200/1343');
	});

	// A chain that ends in nothing is malformed rather than informative.
	it('walks back past an empty last layer', () => {
		expect(headline('outer: middle: the cause: ')).toBe('the cause');
	});

	it('has something to say about an empty message', () => {
		expect(headline('')).toBe('');
	});
});
