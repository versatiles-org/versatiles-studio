import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The documentation cross-references itself heavily - around 270 relative links, and hundreds of
 * `Q`, `S` and feature references on top of those. A broken one is invisible in review: it renders
 * as an ordinary link that happens to land in the wrong place, or as an identifier that reads like
 * every other identifier and names nothing.
 *
 * Both failures below have already happened, in a single commit that rewrote forty links at once -
 * which is the shape of change this exists for. Editing prose by hand rarely breaks a reference;
 * rewriting references mechanically breaks them silently and in bulk.
 *
 * **This says nothing about whether the documentation is correct.** A link can resolve perfectly to
 * a statement that is false, and most documentation bugs are exactly that. Hence the name: links
 * and identifiers, not docs.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every markdown file that participates in the cross-reference graph. */
const docs = [
	...readdirSync(join(root, 'docs'))
		.filter((name) => name.endsWith('.md'))
		.map((name) => `docs/${name}`),
	'README.md',
	// Not a planning document, but it links into `docs/` and is linked from the README, so its
	// references decay the same way theirs do.
	'CONTRIBUTING.md'
];

const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Fenced blocks hold examples and diagrams. A link drawn inside one is a picture of a link. */
const withoutFences = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, '');

/**
 * GitHub's heading slug: lowercase, drop everything that is not a word character, space or hyphen,
 * then spaces to hyphens.
 *
 * The subtlety is that a heading may contain a link - Q14's does, naming the decision that
 * superseded it - and GitHub slugs the text a reader *sees*, so the markup has to come off first.
 * Slugging the raw heading instead is what produced `#q14--…-superseded-by-q22decisionsmd`, an
 * anchor four links pointed at and nothing answered to.
 */
const slug = (heading: string) =>
	heading
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s/g, '-');

const anchors = new Map(
	docs.map((path) => [path, new Set([...withoutFences(read(path)).matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1])))])
);

describe('documentation links', () => {
	it('resolve to a file that exists and a heading that exists', () => {
		const broken: string[] = [];
		let checked = 0;

		for (const path of docs) {
			for (const [, text, url] of withoutFences(read(path)).matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
				if (/^(https?:|mailto:)/.test(url)) continue;
				checked++;

				const [target, fragment] = url.split('#');
				// A bare `#fragment` points inside the file it is written in.
				const file = target ? join(dirname(path), target).replaceAll('\\', '/') : path;

				// Not every target is a markdown file we can read headings from - the README links
				// `docs/`, a directory, which GitHub renders as a listing.
				if (!existsSync(join(root, file))) {
					broken.push(`${path}: [${text}](${url}) - no such file`);
				} else if (fragment && anchors.has(file) && !anchors.get(file)?.has(fragment)) {
					// The overwhelmingly likely cause: a same-file `#q32--…` for a heading that lives in
					// another document, or a slug built from a heading's markup rather than its text.
					broken.push(`${path}: [${text}](${url}) - no heading in ${file} slugs to that`);
				}
			}
		}

		// A floor rather than a count: it exists so that a scan finding nothing - a changed layout, a
		// glob that stopped matching - fails instead of passing quietly. It came down from 200 with the
		// documents themselves, and should come down again rather than be met by adding links.
		expect(checked).toBeGreaterThan(150);
		expect(broken, 'fix the link, or the heading it meant to name').toEqual([]);
	});
});

/**
 * Where each scheme is defined. The README calls these out as five schemes that cannot be confused
 * precisely so that a reference can be resolved without context, which only holds if every one of
 * them resolves.
 *
 * Each `refer` pattern ends `(?!\w)(?!\.\d)` rather than `(?![\w.\d])`. The latter also rejects a
 * following full stop, which quietly exempts every identifier that ends a sentence - the bug that
 * let a probe for an undefined `A9.` pass. This form still refuses to match part of something
 * longer: `S0.11` is one identifier, and `v4.8.0` is not one at all.
 */
const schemes = [
	{
		name: 'decision',
		definedIn: ['docs/decisions.md'],
		/** `### Q32 - A project holds several named graphs…` */
		define: /^### (Q\d+) /gm,
		refer: /(?<![\w.])(Q\d+)(?!\w)(?!\.\d)/g
	},
	{
		name: 'work item',
		// **One document, because the releases have shipped.** Each had its own scope document while
		// it was being planned; `history.md` is all three, and the numbering carries straight on
		// through it. A release still in flight would get its own file back, and this list.
		definedIn: ['docs/history.md'],
		/** `| **S3.6** | …` and its stretch form `| **S4.10\*** | …` */
		define: /^\|\s*\*\*(S\d+\.\d+)\\?\*?\*\*/gm,
		refer: /(?<![\w.])(S\d+\.\d+)(?!\w)(?!\.\d)/g
	},
	{
		name: 'feature',
		definedIn: ['docs/features.md'],
		/**
		 * `| **E1** | …`
		 *
		 * `A`-`L`, not `A`-`G`: the README reserves `H` onward for the next cluster and stops before
		 * `M`, which is a milestone. Matching only the letters in use today would mean a new cluster
		 * silently escapes this check on the day it is added - exactly when its references are most
		 * likely to be wrong. Nothing in `H`-`L` is used yet, so the wider range costs nothing.
		 */
		define: /\*\*([A-L]\d{1,2})\*\*/g,
		refer: /(?<![\w.])([A-L]\d{1,2})(?!\w)(?!\.\d)/g
	}
];

/**
 * Retired, never reused, and still discussed wherever the retirement is explained. The README
 * promises they are never reassigned, so listing them here is the whole enforcement of that
 * promise: reusing one means deleting a line from this array, which is not something anyone does
 * by accident.
 */
const retired = new Set(['A3', 'C7', 'E5', 'F1']);

describe('documentation identifiers', () => {
	for (const { name, definedIn, define, refer } of schemes) {
		it(`name a ${name} that exists`, () => {
			// No unescaping: every capture group above is letters, digits and dots, so a backslash
			// cannot reach one. There used to be a `.replace('\\', '')` here, defending against the
			// `\*` that marks a stretch item - which the pattern already excludes from the group.
			const defined = new Set(definedIn.flatMap((file) => [...read(file).matchAll(define)].map((match) => match[1])));
			expect(defined.size, `no ${name} definitions matched in ${definedIn.join(', ')}`).toBeGreaterThan(20);

			const unknown = new Set<string>();
			for (const path of docs) {
				for (const [, id] of withoutFences(read(path)).matchAll(refer)) {
					if (!defined.has(id) && !retired.has(id)) unknown.add(`${path}: ${id}`);
				}
			}

			expect([...unknown].sort(), `define it in ${definedIn.join(' or ')}, or fix the reference`).toEqual([]);
		});
	}
});

/**
 * The repository layout in `architecture.md` is a map, and a map missing a third of its streets is
 * worse than none: a reader who finds `export.rs` there and not `estimate.rs` concludes the second
 * does not exist.
 *
 * It drifted furthest of anything in these documents, because every other claim has either a link
 * to resolve or an identifier to find and this had neither. `lib.rs` is a module root and
 * `testing.rs` is only reachable from tests, so neither earns a line; everything else does.
 */
describe('the repository layout', () => {
	const LAYOUT = read('docs/architecture.md');
	const EXEMPT = new Set(['lib.rs', 'testing.rs', 'main.rs', 'tsconfig.json', 'docs-pdf.head.html']);

	const listed = (dir: string) =>
		readdirSync(join(root, dir))
			.filter((name) => /\.(rs|ts|sh)$/.test(name) && !EXEMPT.has(name))
			.filter((name) => !LAYOUT.includes(name));

	it('names every module of the core', () => {
		expect(listed('crates/studio-core/src'), 'add it to the tree in docs/architecture.md').toEqual([]);
	});

	it('names every module of the Tauri layer', () => {
		expect(listed('src-tauri/src'), 'add it to the tree in docs/architecture.md').toEqual([]);
	});

	it('names every script', () => {
		expect(listed('scripts'), 'add it to the tree in docs/architecture.md').toEqual([]);
	});
});

/**
 * A size budget, so the documentation does not grow back.
 *
 * **Written after cutting it in half**, when the reason each document was long turned out to be the
 * same one: a fact explained here as well as beside the code that implements it, and a log entry
 * kept in full long after the thing it argued about had shipped. The budgets are a little above what
 * each file now needs, so ordinary editing is free and a document doubling is not.
 *
 * Raise a number deliberately when a document has more to say. That is a different act from not
 * noticing it grew, which is what this exists to make impossible.
 */
describe('documentation size', () => {
	/** Words per file, generous by roughly a fifth. */
	const budget: Record<string, number> = {
		'docs/decisions.md': 5000,
		'docs/history.md': 4450,
		'docs/features.md': 2700,
		'docs/ui.md': 2350,
		'docs/ecosystem.md': 2000,
		'docs/architecture.md': 1950,
		'docs/styling.md': 1800,
		'docs/components.md': 1100,
		'docs/scope-e2e.md': 750,
		'docs/roadmap.md': 650,
		'docs/vision.md': 400,
		'docs/audiences.md': 350
	};

	/** Every document has a budget, or a new one could grow without one. */
	it('covers every document', () => {
		expect(docs.filter((path) => path.startsWith('docs/') && !(path in budget))).toEqual([]);
	});

	it('keeps each document within it', () => {
		const over = docs
			.filter((path) => path in budget)
			.map((path) => ({ path, words: read(path).split(/\s+/).filter(Boolean).length }))
			.filter(({ path, words }) => words > budget[path])
			.map(({ path, words }) => `${path}: ${words} words, budget ${budget[path]}`);

		expect(over, 'shorten it, or raise the budget on purpose').toEqual([]);
	});
});

/**
 * Links from the code into `docs/`.
 *
 * **The half that was never checked.** Around a hundred module comments point at a planning
 * document, and merging three scope documents into `history.md` moved every one of them at once -
 * which is exactly the shape of change the link test above exists for, happening on the side of the
 * boundary it could not see. A rotted link here is invisible: the comment still reads as a
 * reference, and the file it names is simply gone.
 *
 * Anchors are not checked, only files. The comments name documents rather than headings, and a
 * heading is a great deal more likely to be reworded than a filename is to move.
 */
describe('links from the source into the documentation', () => {
	const roots = ['src', 'crates', 'src-tauri', 'scripts', 'e2e'];
	const code = /\.(ts|svelte|rs)$/;

	/** Every source file under `roots`, recursively. */
	function sources(dir: string, found: string[] = []): string[] {
		for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) {
				if (entry.name !== 'node_modules' && entry.name !== 'target') sources(path, found);
			} else if (code.test(entry.name)) found.push(path);
		}
		return found;
	}

	it('name a document that exists', () => {
		const missing: string[] = [];
		let checked = 0;

		for (const path of roots.flatMap((dir) => sources(dir))) {
			for (const [, name] of readFileSync(join(root, path), 'utf8').matchAll(/docs\/([\w.-]+\.md)/g)) {
				checked += 1;
				if (!existsSync(join(root, 'docs', name))) missing.push(`${path}: docs/${name}`);
			}
		}

		expect(checked, 'no references found - has the pattern or the layout changed?').toBeGreaterThan(50);
		expect([...new Set(missing)].sort(), 'the document moved or was renamed').toEqual([]);
	});
});
