<script lang="ts">
	import { tick } from 'svelte';
	import type { ImportKind, RecentEntry } from '../ipc/commands';
	import logo from '../../../src-tauri/icons/128x128.png';

	// The launcher's contents (Q13, [Q48]). A **launcher, not a wizard**: everything on it is also
	// reachable from inside the workbench, and nothing here gates anything.
	//
	// **Three doors, by where the thing is** — a local file, a remote one, a project folder. It was
	// seven: one card per import kind, plus a project card, plus a URL form. Those five cards
	// differed only in which extensions the file dialog would show, which is not a decision anyone
	// arrives wanting to make — `importKindFor` reads the kind off the extension anyway. What is
	// left are the three that genuinely differ, and they differ in mechanism: a file dialog, a text
	// field, a directory dialog.
	//
	// **The catalogue did not go away, it changed job.** It still decides which extensions the
	// dialog offers, and it names them under the first card — so a build without GDAL neither
	// offers a GeoTIFF nor claims to. Choosing a kind up front is still a real decision *inside* the
	// workbench, where it becomes a `from_*` node; that is `ImportCards`, and it stayed there.
	//
	// [Q48]: ../../../docs/decisions.md

	let {
		kinds,
		recents,
		onOpenFile,
		onOpenUrl,
		onOpenProject,
		onForget
	}: {
		/** Every way in this build has — named under the first card, and the dialog's filters. */
		kinds: ImportKind[];
		recents: RecentEntry[];
		onOpenFile: () => void;
		onOpenUrl: (url: string) => void;
		onOpenProject: () => void;
		onForget: (source: string) => void;
	} = $props();

	let url = $state('');
	/// Whether the remote field is showing. A door that opens rather than a form always standing
	/// open: three cards of the same height read as three choices, and one of them being a text box
	/// makes it read as a form with two buttons beside it.
	let asking = $state(false);
	let field = $state<HTMLInputElement>();

	async function askForUrl() {
		asking = true;
		// After the field exists — it is what the press was for, and a door that opens without
		// putting the caret in it asks for a second click to do nothing with.
		await tick();
		field?.focus();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = url.trim();
		if (trimmed) onOpenUrl(trimmed);
	}

	const filename = (source: string) => source.split(/[/\\]/).pop() || source;

	function when(seconds: number): string {
		const elapsed = Date.now() / 1000 - seconds;
		if (elapsed < 60) return 'just now';
		if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
		if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)} h ago`;
		return `${Math.floor(elapsed / 86_400)} d ago`;
	}
</script>

<div class="landing">
	<div class="sheet">
		<!-- `alt=""`, because the name is right beside it: a screen reader announcing "VersaTiles
		     logo, VersaTiles Studio" says it twice. The mark is the one committed as the application
		     icon, imported rather than copied so the two cannot drift apart. -->
		<h1><img src={logo} alt="" width="40" height="40" />VersaTiles Studio</h1>

		<div class="doors">
			<button type="button" class="card" onclick={onOpenFile}>
				<strong>Open a local file</strong>
				<span>Tiles you have, or data to build them from</span>
				<!-- From the core's catalogue, so this cannot name something the build lacks (S3.2). -->
				{#if kinds.length}
					<span class="kinds">{kinds.map((kind) => kind.label).join(' · ')}</span>
				{/if}
			</button>

			<button type="button" class="card" aria-expanded={asking} onclick={() => void askForUrl()}>
				<strong>Open a remote file</strong>
				<span>HTTPS or SFTP — a planet file opens from its index</span>
			</button>

			<button type="button" class="card" onclick={onOpenProject}>
				<strong>Open a project folder</strong>
				<span>A folder Studio saved: its pipelines, style and manifest</span>
			</button>
		</div>

		{#if asking}
			<form class="ask" onsubmit={submit}>
				<input
					bind:this={field}
					bind:value={url}
					type="text"
					placeholder="https://…"
					spellcheck="false"
					aria-label="Address of a remote file"
				/>
				<button type="submit" class="button" disabled={!url.trim()}>Open</button>
			</form>
		{/if}

		{#if recents.length}
			<section class="recents">
				<h2 class="section-label">Recent</h2>
				<ul>
					{#each recents as entry (entry.source)}
						<li>
							<button class="recent" onclick={() => onOpenUrl(entry.source)} title={entry.source}>
								<span class="name truncate">{filename(entry.source)}</span>
								<span class="meta">{when(entry.openedAt)}</span>
							</button>
							<button class="forget" onclick={() => onForget(entry.source)} aria-label="Forget">×</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<p class="drop">…or drop a file anywhere in this window.</p>
	</div>
</div>

<style>
	.name {
		font-family: var(--font-mono);
	}

	/* The scroller. `justify-content: center` used to do the centring here, which reads well until
	   the content is taller than the window: centred overflow spills past *both* edges, so the
	   heading goes off the top where no scrollbar can reach it. Centring moved to the sheet's auto
	   margins, which collapse to zero the moment there is nothing to spare. */
	.landing {
		height: 100%;
		display: flex;
		overflow-y: auto;
		padding: var(--space-6);
		background: var(--chrome);
	}

	.sheet {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		width: min(42rem, 100%);
	}

	h1 {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
	}

	/* Beside the name rather than over it: the window is 620px tall and the recent list is what has
	   to fit, so the header takes one line rather than three. */
	img {
		display: block;
		width: 2.5rem;
		height: 2.5rem;
	}

	/* Three of a row where there is room, stacking on a narrow window rather than shrinking into
	   three columns too thin to read. */
	.doors {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-4);
		width: 100%;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		text-align: left;
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);

		&:hover,
		&[aria-expanded='true'] {
			border-color: var(--accent);
		}

		strong {
			font-weight: 600;
		}

		span {
			color: var(--ink-2);
		}
	}

	/* What this build can actually read, from the core. Quiet: it answers a question rather than
	   asking one. */
	.kinds {
		margin-top: auto;
		padding-top: var(--space-2);
		font-size: var(--text-sm);
	}

	.ask {
		display: flex;
		gap: var(--space-3);
		width: 100%;

		input {
			flex: 1;
			min-width: 0;
			font-family: var(--font-mono);
		}

		button {
			padding: var(--space-2) var(--space-4);
		}
	}

	.recents {
		width: min(38rem, 100%);
	}

	h2 {
		margin: 0 0 var(--space-3);
	}

	li {
		display: flex;
		align-items: center;
	}

	.recent {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		text-align: left;
		padding: var(--space-3) var(--space-3);
		border-radius: var(--radius);

		&:hover {
			background: var(--surface);
		}
	}

	.meta {
		color: var(--ink-2);
		font-size: var(--text-sm);
		flex: none;
	}

	.forget {
		color: var(--ink-2);
		padding: 0 var(--space-3);
	}

	.drop {
		margin: 0;
		color: var(--ink-2);
	}
</style>
