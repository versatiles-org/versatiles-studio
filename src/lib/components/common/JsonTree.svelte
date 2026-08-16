<script lang="ts">
	// Svelte 5 recursive components import themselves; `<svelte:self>` is deprecated.
	import JsonTree from './JsonTree.svelte';

	// A collapsible JSON view. Deliberately small — TileJSON is the only thing it shows for now, and
	// A6's edit half needs the pipeline's `meta_update`, which arrives with S2.
	let { value, depth = 0 }: { value: unknown; depth?: number } = $props();

	const isObject = (v: unknown): v is Record<string, unknown> =>
		typeof v === 'object' && v !== null && !Array.isArray(v);
</script>

{#if isObject(value)}
	<ul style="--depth: {depth}">
		{#each Object.entries(value) as [key, child] (key)}
			<li>
				<span class="key">{key}</span>
				{#if isObject(child) || Array.isArray(child)}
					<JsonTree value={child} depth={depth + 1} />
				{:else}
					<span class="val">{JSON.stringify(child)}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else if Array.isArray(value)}
	<ul style="--depth: {depth}">
		{#each value as child, i (i)}
			<li>
				{#if isObject(child) || Array.isArray(child)}
					<JsonTree value={child} depth={depth + 1} />
				{:else}
					<span class="val">{JSON.stringify(child)}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<span class="val">{JSON.stringify(value)}</span>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0.15rem 0 0;
		padding-left: 0.7rem;
		border-left: 1px solid var(--rule);
	}
	li {
		font:
			0.72rem ui-monospace,
			monospace;
		line-height: 1.55;
	}
	.key {
		color: var(--ink-2);
	}
	.key::after {
		content: ':';
		margin-right: 0.3rem;
	}
	.val {
		word-break: break-word;
	}
</style>
