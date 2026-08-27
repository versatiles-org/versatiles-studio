/**
 * The two rules in [Svelte Components](../../docs/components.md), enforced rather than remembered.
 *
 * A component lives with what owns it, and its **name is unique across the application** - the
 * folder scopes it when you are reading a path, and does nothing for you when you are fuzzy-finding
 * by filename or reading the inventory, which is how components are actually looked up.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
	///
	/// **Two roots at the top**, one per page: `App` is the workbench and `Launcher` is the window
	/// that opens projects ([Q48](../../docs/decisions.md), S7.5). A third would be a third window
	/// with a page of its own, which is worth stopping to justify.
	///
	/// **The panes are named rather than matched.** `panes/[a-z]+` accepted any folder at all, so a
	/// whole pane could arrive without the inventory hearing about it - which is exactly what
	/// happened: `panes/sources/` existed for two releases and `components.md` listed the other five.
	/// Adding a pane is now a line here and a line there, which is the point.
	it('keeps components in the folders the scheme names', () => {
		const panes = 'inspector|layers|pipeline|project|sources|style';
		const allowed = new RegExp(
			`^src/((App|Launcher)\\.svelte|lib/(shell|common|map|panes/(${panes}))/[A-Za-z]+\\.svelte)$`
		);
		const stray = components('src')
			.map(([, path]) => path)
			.filter((path) => !allowed.test(path));
		expect(stray, 'a component outside the documented folders - see docs/components.md').toEqual([]);
	});

	/// Every pane this names is a pane the inventory describes.
	///
	/// The other half of the rule above: that one stops a component appearing in a folder nobody
	/// documented, and this stops the folder list here drifting from the document it points at.
	it('names the panes the inventory documents', () => {
		// Relative, like `components('src')` above: both run from the repository root.
		const inventory = readFileSync('docs/components.md', 'utf8');
		const folders = [...new Set(components('src').map(([, path]) => /lib\/panes\/([a-z]+)\//.exec(path)?.[1]))];
		const missing = folders.filter((pane): pane is string => !!pane && !inventory.includes(`lib/panes/${pane}/`));
		expect(missing, 'add it to the inventory in docs/components.md').toEqual([]);
	});
});
