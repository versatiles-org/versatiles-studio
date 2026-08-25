<script lang="ts">
	import { tick } from 'svelte';
	import type { ImportKind, RecentEntry } from '../ipc/commands';
	import logo from '../../../src-tauri/icons/128x128.png';

	// The launcher's contents (Q13, [Q48]). A **launcher, not a wizard**: everything on it is also
	// reachable from inside the workbench, and nothing here gates anything.
	//
	// **Two columns: the ways in, and the ways back.** They serve different people - the doors are
	// for a first run, the recent list is for every run after it - and stacking them made the second
	// wait behind the first. On an 880×580 window the list is a list rather than a preview of one,
	// and it scrolls without moving anything else.
	//
	// **Four doors, by where the thing is** - a local file, a remote one, a project folder, and
	// nothing at all. It was seven: one card per import kind, plus a project card, plus a URL form.
	// Those five differed only in which extensions the file dialog would show, which is not a
	// decision anyone arrives wanting to make - `importKindFor` reads the kind off the extension
	// anyway. What is left differ in mechanism: a file dialog, a text field, a directory dialog, and
	// a window with nothing in it. The last is under a rule because it is the only one that opens
	// nothing, and it is last because it is the rarest way to start.
	//
	// **The catalogue did not go away, it changed job.** It still decides which extensions the
	// dialog offers, and it names them under the first door - so a build without GDAL neither
	// offers a GeoTIFF nor claims to. Choosing a kind up front is still a real decision *inside* the
	// workbench, where it becomes a `from_*` node; that is `ImportCards`, and it stayed there.
	//
	// [Q48]: ../../../docs/decisions.md

	let {
		kinds,
		recents,
		version,
		onOpenFile,
		onOpenUrl,
		onOpenProject,
		onNewProject,
		onForget,
		onOpenRepository
	}: {
		/** Every way in this build has - named under the first door, and the dialog's filters. */
		kinds: ImportKind[];
		recents: RecentEntry[];
		/** What the footer says, from the core rather than from `package.json` (S0.5). */
		version: string;
		onOpenFile: () => void;
		onOpenUrl: (url: string) => void;
		onOpenProject: () => void;
		onNewProject: () => void;
		onForget: (source: string) => void;
		onOpenRepository: () => void;
	} = $props();

	let url = $state('');
	/// Whether the remote field is showing. A door that opens rather than a form always standing
	/// open: four rows of the same shape read as four choices, and one of them being a text box
	/// makes it read as a form with three buttons beside it.
	let asking = $state(false);
	let field = $state<HTMLInputElement>();

	async function askForUrl() {
		asking = true;
		// After the field exists - it is what the press was for, and a door that opens without
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
	<!-- `alt=""`, because the name is right beside it: a screen reader announcing "VersaTiles
	     logo, VersaTiles Studio" says it twice. The mark is the one committed as the application
	     icon, imported rather than copied so the two cannot drift apart. -->
	<h1><img src={logo} alt="" width="40" height="40" />VersaTiles Studio</h1>

	<div class="columns">
		<section class="start">
			<h2 class="section-label">Start</h2>

			<div class="doors">
				<!-- The hint is grouped with the door rather than placed after it, so the row gap does not
				     leave it floating exactly between two doors and belonging to neither. -->
				<div class="local">
					<button type="button" class="door" onclick={onOpenFile}>
						<strong>Open a local file</strong>
						<span>Tiles you have, or data to build them from</span>
						<!-- From the core's catalogue, so this cannot name something the build lacks (S3.2). -->
						{#if kinds.length}
							<span class="kinds">{kinds.map((kind) => kind.label).join(' · ')}</span>
						{/if}
					</button>

					<!-- Under the door it is another way of pressing, rather than under the list of what has
					     been opened before: dropping a file *is* opening a local one, and it was filed with
					     the recent list only because that is where the window happened to end. -->
					<p class="drop">…or drop a file anywhere in this window.</p>
				</div>

				<button type="button" class="door" aria-expanded={asking} onclick={() => void askForUrl()}>
					<strong>Open a remote file</strong>
					<span>HTTPS or SFTP - a planet file opens from its index</span>
				</button>

				<!-- Under the door it belongs to rather than under all of them, so what it is for is
				     where the eye already is. -->
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

				<button type="button" class="door" onclick={onOpenProject}>
					<strong>Open a project folder</strong>
					<span>A folder Studio saved: its pipelines, style and manifest</span>
				</button>

				<hr />

				<button type="button" class="door" onclick={onNewProject}>
					<strong>New empty project</strong>
					<span>A window with nothing in it yet</span>
				</button>
			</div>
		</section>

		<section class="recent">
			<h2 class="section-label">Recent</h2>

			{#if recents.length}
				<ul>
					{#each recents as entry (entry.source)}
						<li>
							<button class="reopen" onclick={() => onOpenUrl(entry.source)} title={entry.source}>
								<span class="name truncate">{filename(entry.source)}</span>
								<span class="meta">{when(entry.openedAt)}</span>
							</button>
							<button class="forget" onclick={() => onForget(entry.source)} aria-label="Forget">×</button>
						</li>
					{/each}
				</ul>
			{:else}
				<!-- The empty half of the window is where a first-timer is already looking, so it says
				     what the column is for rather than leaving them to work it out from a heading. -->
				<p class="nothing">Nothing yet - what you open will be listed here.</p>
			{/if}
		</section>
	</div>

	<footer>
		VersaTiles Studio {version} · alpha ·
		<button type="button" class="repository" onclick={onOpenRepository}>github</button>
	</footer>
</div>

<style>
	.name {
		font-family: var(--font-mono);
	}

	/* Three rows: the heading, the two columns, the footer. The middle one takes what is left, which
	   is what lets the recent list scroll instead of the window growing. */
	.landing {
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: var(--space-5);
		padding: var(--space-6);
		background: var(--chrome);
	}

	h1 {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
	}

	/* Beside the name rather than over it: the window is 580px tall and the recent list is what has
	   to fit, so the header takes one line rather than three. */
	img {
		display: block;
		width: 2.5rem;
		height: 2.5rem;
	}

	/* Half each. The doors were given only what they needed at first, which left the window looking
	   like a narrow panel with a large empty area beside it - the two halves are equally the point,
	   so they are equally wide. Stacked on a narrow window rather than squeezed into two columns too
	   thin for either. */
	.columns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-6);
		min-height: 0;
	}

	@media (max-width: 46rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
			overflow-y: auto;
		}
	}

	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	h2 {
		margin: 0 0 var(--space-3);
	}

	.doors {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* Rows rather than cards. Four cards would fill the column with borders and leave the list, which
	   is the other half of the window, looking like the empty part. */
	.door {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		text-align: left;
		padding: var(--space-4) var(--space-5);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);

		&:hover,
		&[aria-expanded='true'] {
			border-color: var(--rule);
			background: var(--surface);
		}

		strong {
			font-weight: 600;
		}

		span {
			color: var(--ink-2);
			font-size: var(--text-sm);
		}
	}

	/* What this build can actually read, from the core. Quiet: it answers a question rather than
	   asking one. */
	.kinds {
		padding-top: var(--space-2);
	}

	/* Above the one door that opens nothing. */
	hr {
		width: 100%;
		margin: var(--space-2) 0;
		border: none;
		border-top: 1px solid var(--rule);
	}

	.ask {
		display: flex;
		gap: var(--space-3);
		padding: 0 var(--space-5) var(--space-3);

		input {
			flex: 1;
			min-width: 0;
			font-family: var(--font-mono);
		}

		button {
			padding: var(--space-2) var(--space-4);
		}
	}

	/* The half that grows. Its own scroller, so a long history moves nothing else on the window.
	   Capped, because the row puts the name at one end and when it was opened at the other: across
	   the full width of a wide window those two are a second apart to read. */
	.recent ul {
		overflow-y: auto;
		min-height: 0;
		max-width: 34rem;
	}

	li {
		display: flex;
		align-items: center;
	}

	.reopen {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		text-align: left;
		padding: var(--space-3);
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

	/* No gap between the two: what separates the hint from the door is the door's own padding, which
	   is less than the space to the next one - which is what makes it read as part of this one. */
	.local {
		display: flex;
		flex-direction: column;
	}

	/* Aligned with the door's text above it, so it reads as a line of that door rather than as the
	   next item in the list. */
	.drop {
		margin: 0;
		padding: 0 var(--space-5);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	/* A panel rather than a line, because with no history this is most of the window and an empty
	   half with one grey sentence in the corner reads as something that failed to load. */
	.nothing {
		flex: 1;
		display: grid;
		place-items: center;
		margin: 0;
		padding: var(--space-6);
		border: 1px dashed var(--rule);
		border-radius: var(--radius-lg);
		color: var(--ink-2);
		text-align: center;
	}

	footer {
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	/* A word, not a button: it goes somewhere, and the underline is what says so. `openUrl` needs a
	   press to send it to the browser, so it is a `button` that reads as a link rather than an
	   `<a href>` that would try to navigate this window. */
	.repository {
		color: inherit;
		font: inherit;
		text-decoration: underline;

		&:hover {
			color: var(--ink);
		}
	}
</style>
