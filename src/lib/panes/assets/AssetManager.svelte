<script lang="ts">
	import { fontFamilies, installFont, removeFont, type Family } from '../../ipc/commands';
	import { bytes } from '../../common/format';
	import { jobs } from '../../state/jobs.svelte';

	// Font families, installed on demand (G7, S4.1, [Q9]).
	//
	// Studio bundles sprites and Latin glyphs so the first launch renders offline (S0.6). Everything
	// beyond Latin is 8–48 MB that most projects never need, so it is fetched when asked for — and
	// the size is on the row, because 48 MB is a decision to make before it starts rather than
	// during.

	let families = $state<Family[]>([]);
	let problem = $state<string | null>(null);

	async function refresh() {
		try {
			families = await fontFamilies();
			problem = null;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	$effect(() => void refresh());

	/// The install job for a family, if one is running. The bar shows its progress; this row only
	/// needs to know not to offer the button twice.
	const installing = (id: string) => jobs.active.some((job) => job.label === `Installing ${id}`);

	async function install(id: string) {
		try {
			await installFont(id);
			problem = null;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	async function remove(id: string) {
		try {
			await removeFont(id);
			await refresh();
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	// A finished install changes what is installed, and the list is not told by anything else.
	$effect(() => {
		const running = jobs.active.length;
		void running;
		void refresh();
	});
</script>

<section class="assets">
	<h1>Fonts</h1>
	<p class="lead">
		Studio ships Latin glyphs and the sprite set. A family here covers everything its script has — install one when a
		map needs text Studio cannot draw yet.
	</p>

	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<ul class="list">
		{#each families as family (family.id)}
			<li class="family">
				<span class="name">{family.id}</span>
				<span class="size">{bytes(family.bytes)}</span>
				{#if family.installed}
					<span class="state">installed</span>
					<button type="button" class="button" onclick={() => void remove(family.id)}>Remove</button>
				{:else if installing(family.id)}
					<span class="state">installing…</span>
				{:else}
					<button type="button" class="button" onclick={() => void install(family.id)}>Install</button>
				{/if}
			</li>
		{/each}
	</ul>

	{#if families.length === 0 && !problem}
		<p class="lead">No families in this build's manifest.</p>
	{/if}
</section>

<style>
	.assets {
		max-width: 42rem;
		height: 100%;
		overflow-y: auto;
		padding: var(--space-5);
	}

	h1 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.lead {
		margin: 0 0 var(--space-4);
		max-width: 34rem;
		color: var(--ink-2);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.family {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--rule);

		.name {
			font-family: var(--font-mono);
			font-size: var(--text-sm);
		}

		/* Right-aligned and tabular, so a column of sizes can be compared down rather than read
		   across. */
		.size {
			color: var(--ink-2);
			font-size: var(--text-xs);
			font-variant-numeric: tabular-nums;
			text-align: right;
		}

		.state {
			color: var(--ink-2);
			font-size: var(--text-xs);
		}
	}

	.problem {
		margin: 0 0 var(--space-3);
		color: var(--error);
		font-size: var(--text-sm);
	}
</style>
