/**
 * The two rules in [Svelte Components](../../docs/components.md), enforced rather than remembered.
 *
 * A component lives with what owns it, and its **name is unique across the application** — the
 * folder scopes it when you are reading a path, and does nothing for you when you are fuzzy-finding
 * by filename or reading the inventory, which is how components are actually looked up.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every `.svelte` file under `src`, as `[name, path]`. */
function components(dir: string, found: [string, string][] = []): [string, string][] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) components(path, found);
		else if (entry.endsWith('.svelte')) found.push([entry.slice(0, -'.svelte'.length), path]);
	}
	return found;
}

describe('component organisation', () => {
	it('gives every component a name unique across the application', () => {
		const seen = new Map<string, string>();
		const clashes: string[] = [];
		for (const [name, path] of components('src')) {
			const first = seen.get(name);
			if (first) clashes.push(`${name}: ${first} and ${path}`);
			else seen.set(name, path);
		}
		expect(clashes, 'two components share a filename, so neither can be found by name').toEqual([]);
	});

	/// Not a rule so much as the shape the rules produce: a component belongs to a pane, the shell,
	/// the map, or more than one owner. A new top-level folder is a decision worth making on
	/// purpose, so this fails until `docs/components.md` says what it is for.
	it('keeps components in the folders the scheme names', () => {
		const allowed = /^src\/(App\.svelte|lib\/(shell|common|map|panes\/[a-z]+)\/[A-Za-z]+\.svelte)$/;
		const stray = components('src')
			.map(([, path]) => path)
			.filter((path) => !allowed.test(path));
		expect(stray, 'a component outside the documented folders — see docs/components.md').toEqual([]);
	});
});
