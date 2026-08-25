<script lang="ts">
	// Svelte 5 recursive components import themselves; `<svelte:self>` is deprecated.
	import JsonTree from './JsonTree.svelte';

	// A foldable JSON view. Every object and array is a `<details>`, so a large TileJSON - where
	// `vector_layers` alone can run to dozens of entries - collapses to something scannable.
	// `<details>` also gets keyboard support and disclosure semantics for free.
	let { value, name, depth = 0, open }: { value: unknown; name?: string; depth?: number; open?: boolean } = $props();

	const isObject = (v: unknown): v is Record<string, unknown> =>
		typeof v === 'object' && v !== null && !Array.isArray(v);

	const isBranch = (v: unknown): boolean => isObject(v) || Array.isArray(v);

	/** What a folded node says about itself: enough to decide whether to open it. */
	function summarise(v: unknown): string {
		if (Array.isArray(v)) return `[${v.length}]`;
		if (isObject(v)) {
			const keys = Object.keys(v);
			return `{${keys.length}}`;
		}
		return '';
	}

	const entries = (v: unknown): [string, unknown][] =>
		Array.isArray(v) ? v.map((child, i) => [String(i), child]) : Object.entries(v as object);

	// `$derived`, not a plain const: `depth` is a prop, and a const would capture only its first
	// value. Callers can override - the inspector starts TileJSON folded, since a side panel should
	// not open with a wall of metadata.
	const isOpen = $derived(open ?? depth < 1);
</script>

{#if isBranch(value)}
	<details open={isOpen}>
		<summary>
			{#if name !== undefined}<span class="key">{name}</span>{/if}
			<span class="count">{summarise(value)}</span>
		</summary>
		<ul>
			{#each entries(value) as [key, child] (key)}
				<li>
					{#if isBranch(child)}
						<JsonTree value={child} name={key} depth={depth + 1} />
					{:else}
						<span class="key">{key}</span><span class="val">{JSON.stringify(child)}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</details>
{:else}
	<span class="val">{JSON.stringify(value)}</span>
{/if}

<style>
	details {
		font-size: var(--text-sm);
		font-family: var(--font-mono);
	}

	summary {
		/* Not a <button>, so base.css's button cursor does not reach it. */
		cursor: pointer;
		line-height: 1.55;
		list-style-position: outside;

		&:hover {
			background: var(--chrome);
		}
	}

	ul {
		padding-left: var(--space-5);
		border-left: 1px solid var(--rule);
	}

	li {
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		line-height: 1.55;
	}

	.key {
		color: var(--ink-2);

		&::after {
			content: ':';
			margin-right: var(--space-3);
		}
	}

	.count {
		color: var(--accent);
	}

	.val {
		word-break: break-word;
	}
</style>
