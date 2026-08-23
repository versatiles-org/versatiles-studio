<script lang="ts">
	import { fontFamilies, installFont, removeFont, type Family } from '../ipc/commands';
	import { megabytes } from '../common/format';
	import { jobs } from '../state/jobs.svelte';
	import Modal from '../common/Modal.svelte';

	// Font families, installed on demand (G7, S4.1, [Q9]).
	//
	// Studio bundles sprites and Latin glyphs so the first launch renders offline (S0.6). Everything
	// beyond Latin is 8–48 MB that most projects never need, so it is fetched when asked for — and
	// the size is on the row, because 48 MB is a decision to make before it starts rather than
	// during.
	//
	// **A dialog, not a mode** ([Q39]). This is an errand: you leave the map to fetch something you
	// will bring back to it, and come back to the window exactly as you left it. As a mode it never
	// actually replaced the map region, so the map's own controls floated over the font list.
	//
	// Closing it does not stop anything: an install is a job, the bar reports it, and the list
	// catches up when it lands.

	let { onClose }: { onClose: () => void } = $props();

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

	/// What "download all" would actually fetch — the ones neither installed nor already running.
	const missing = $derived(families.filter((family) => !family.installed && !installing(family.id)));
	const missingBytes = $derived(missing.reduce((total, family) => total + family.bytes, 0));

	async function install(id: string) {
		try {
			await installFont(id);
			problem = null;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	/// Starts every missing family at once.
	///
	/// Submitted together rather than chained, because each is a job the runner already queues and
	/// reports; serialising them here would duplicate that and make the last one's arrival depend on
	/// this dialog still being open. The total is on the button, so a third of a gigabyte is a
	/// decision made before it starts rather than during — the same rule as the per-row size.
	async function installAll() {
		const wanted = missing.map((family) => family.id);
		for (const id of wanted) await install(id);
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

<Modal title="Fonts" width="34rem" {onClose}>
	<p class="lead">
		Studio ships Latin glyphs and the sprite set. A family here covers everything its script has — install one when a
		map needs text Studio cannot draw yet.
	</p>

	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<ul class="list">
		{#each families as family (family.id)}
			<li class="family">
				<span class="name truncate">{family.id}</span>
				<span class="size">{megabytes(family.bytes)}</span>
				{#if family.installed}
					<span class="state">installed</span>
					<button type="button" class="button" onclick={() => void remove(family.id)}>Remove</button>
				{:else if installing(family.id)}
					<span class="state">installing…</span>
					<span></span>
				{:else}
					<span class="state"></span>
					<button type="button" class="button" onclick={() => void install(family.id)}>Install</button>
				{/if}
			</li>
		{/each}
	</ul>

	{#if families.length === 0 && !problem}
		<p class="lead">No families in this build's manifest.</p>
	{/if}

	{#snippet actions()}
		<!-- Disabled rather than hidden once everything is here: a button that vanishes leaves you
		     wondering whether you imagined it, and "nothing left to fetch" is worth saying. -->
		<button type="button" class="button bulk" disabled={missing.length === 0} onclick={() => void installAll()}>
			{missing.length === 0 ? 'Everything installed' : `Download all — ${megabytes(missingBytes)}`}
		</button>
		<button type="button" class="button primary" onclick={onClose}>Done</button>
	{/snippet}
</Modal>

<style>
	/* No margins: the modal body is a flex column with its own gap. */
	.lead {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		/* The manifest can outgrow the window; the actions must not be pushed off the bottom. */
		max-height: 50vh;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.family {
		display: grid;
		/* Every row the same four tracks, and the sizes given a track of their own — each `li` is its
		   own grid, so a column only lines up if its width does not depend on the row. */
		grid-template-columns: 1fr 5rem 5rem 5.5rem;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--rule);

		.name {
			font-family: var(--font-mono);
			font-size: var(--text-sm);
		}

		/* Right-aligned and tabular, so a column of sizes can be compared down rather than read
		   across. One unit for the whole column is the other half of that — see `megabytes`. */
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
		margin: 0;
		color: var(--error);
		font-size: var(--text-sm);
	}

	/* Away from `Done`: one fetches, the other leaves, and they should not be neighbours. */
	.bulk {
		margin-right: auto;
	}
</style>
