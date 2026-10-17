<script lang="ts">
	import Modal from './Modal.svelte';
	import Group from './Group.svelte';
	import Note from './Note.svelte';
	import Tabs from './Tabs.svelte';
	import { importOpening, type Opening } from '../ipc/commands';
	import { EXTRA, fetchCatalog, type Shortcut } from './catalog';
	import { bytes } from './format';

	// Opening a remote source: an address, what it can be, and somewhere to start if you have none.
	//
	// **A dialog rather than a field under the door**, because the field could say nothing. What opens
	// from a URL is narrower than what opens from disk - a `.mbtiles` or a GeoJSON fails, but only once
	// a window has opened and a pipeline has been built - and a person arriving with no address had
	// nowhere to get one. The hints say what works, the check says whether *this* address will, before
	// OK does anything, and the shortcuts are addresses that are known to.

	let {
		recents = [],
		onOpen,
		onCancel,
		check = importOpening,
		loadShortcuts = fetchCatalog
	}: {
		/** Remote sources opened before, most recent first. */
		recents?: string[];
		onOpen: (url: string) => void;
		onCancel: () => void;
		/** What the core makes of an address. A parameter so a test needs no core. */
		check?: (url: string) => Promise<Opening>;
		/** The catalogue's shortcuts, `null` when it cannot be had. A parameter so a test needs no network. */
		loadShortcuts?: () => Promise<Shortcut[] | null>;
	} = $props();

	let url = $state('');
	let field = $state<HTMLInputElement>();
	$effect(() => field?.focus());

	/** What the address is, as far as anyone knows yet. */
	type Verdict =
		| { state: 'empty' }
		| { state: 'not-a-url' }
		| { state: 'checking' }
		| { state: 'opens'; label: string }
		| { state: 'refused'; reason: string };

	let verdict = $state<Verdict>({ state: 'empty' });

	/// **Checked after a pause, and only the latest answer kept.** A `.json` is read to find out what
	/// it is, which is a request per check - one per keystroke would be a request per character, and
	/// an answer to an earlier address arriving last would describe something no longer in the field.
	let asked = 0;
	$effect(() => {
		const address = url.trim();
		if (!address) {
			verdict = { state: 'empty' };
			return;
		}
		if (!/^(https?|sftp):\/\/\S+$/i.test(address)) {
			verdict = { state: 'not-a-url' };
			return;
		}
		verdict = { state: 'checking' };
		const mine = ++asked;
		const timer = setTimeout(async () => {
			const opening = await check(address).catch(() => null);
			if (mine !== asked) return;
			if (opening?.kind) verdict = { state: 'opens', label: opening.kind.label };
			else if (opening?.refused) verdict = { state: 'refused', reason: opening.refused };
			else
				verdict = {
					state: 'refused',
					reason:
						'Studio does not know this kind of file. Remote sources are .versatiles and .pmtiles containers, or a TileJSON.'
				};
		}, 300);
		return () => clearTimeout(timer);
	});

	/// `undefined` while loading, `null` when the catalogue could not be had.
	let catalogue = $state<Shortcut[] | null | undefined>(undefined);
	$effect(() => {
		void loadShortcuts().then((found) => (catalogue = found));
	});

	/// Grouped by who publishes them, catalogue first - it is the project's own, and the longest.
	const groups = $derived.by(() => {
		const all = [...(catalogue ?? []), ...EXTRA];
		const publishers = [...new Set(all.map((shortcut) => shortcut.publisher))];
		return publishers.map(
			(publisher) => [publisher, all.filter((shortcut) => shortcut.publisher === publisher)] as const
		);
	});

	/// **Recent first, and open on it when there is anything in it** - what someone opened before is
	/// the likeliest thing they want again. With nothing there, the catalogue is where to start.
	type Tab = 'recent' | 'catalog';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'recent', label: 'Recent' },
		{ id: 'catalog', label: 'Catalog' }
	];
	/// Read once, on opening: a recent arriving while the dialog is open must not switch the tab under
	/// somebody already reading the other one.
	const firstTab = (): Tab => (recents.length > 0 ? 'recent' : 'catalog');
	let tab = $state<Tab>(firstTab());

	function choose(address: string) {
		url = address;
		field?.focus();
	}

	function submit(event?: SubmitEvent) {
		event?.preventDefault();
		if (verdict.state === 'opens') onOpen(url.trim());
	}

	/// What a shortcut is, in the space of one line: kind, size and age, whichever it has.
	const meta = (shortcut: Shortcut) =>
		[shortcut.tileType, shortcut.size === null ? 'tile server' : bytes(shortcut.size), shortcut.date]
			.filter(Boolean)
			.join(' · ');
</script>

<Modal title="Open a remote file" width="40rem" onClose={onCancel}>
	<form class="address" onsubmit={submit}>
		<input
			bind:this={field}
			bind:value={url}
			type="text"
			placeholder="https://… or sftp://…"
			spellcheck="false"
			aria-label="Address of a remote file"
			aria-describedby="remote-verdict"
		/>
		<!-- Live, so a screen reader hears the answer to the check without hunting for it. -->
		<Note id="remote-verdict" live tone={verdict.state === 'refused' ? 'problem' : 'hint'}>
			{#if verdict.state === 'not-a-url'}
				An address starting with https:// or sftp://
			{:else if verdict.state === 'checking'}
				Checking…
			{:else if verdict.state === 'opens'}
				Opens as: {verdict.label}
			{:else if verdict.state === 'refused'}
				{verdict.reason}
			{/if}
		</Note>
	</form>

	<!-- Under the field rather than behind a tab: it is what the field accepts, read while typing. -->
	<Note>
		Tile containers - <code>.versatiles</code>, <code>.pmtiles</code> - over HTTPS or SFTP, read in pieces as the map needs
		them, so nothing is downloaded. Or a tile server, by its TileJSON address. GeoJSON, CSV, MBTiles and TAR open from disk
		only.
	</Note>

	<Tabs
		items={TABS}
		selected={tab}
		onSelect={(id) => (tab = id as Tab)}
		label="Where to start from"
		controls="remote-panel"
	/>

	<!-- The one part that scrolls. Field, hint and buttons stay put, so Open is never below the fold
	     of an 880×580 launcher - which is where it was when this was one long column. -->
	<div class="panel" id="remote-panel" role="tabpanel" aria-label={tab === 'recent' ? 'Recent' : 'Catalog'}>
		{#if tab === 'recent'}
			{#if recents.length}
				<ul class="list">
					{#each recents as address (address)}
						<li>
							<button type="button" class="pick" onclick={() => choose(address)} title={address}>
								<span class="address-text truncate">{address}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<Note tone="empty">Nothing opened from an address yet - the catalog has some to start from.</Note>
			{/if}
		{:else}
			{#each groups as [publisher, shortcuts] (publisher)}
				<Group title={publisher}>
					<ul class="list">
						{#each shortcuts as shortcut (shortcut.url)}
							<li>
								<!-- One line each, so the whole catalogue fits; what a dataset is, and where it is,
								     are a hover away. -->
								<button
									type="button"
									class="pick"
									onclick={() => choose(shortcut.url)}
									title={[...shortcut.description, shortcut.url].join('\n')}
								>
									<span class="title truncate">{shortcut.title}</span>
									<span class="meta">{meta(shortcut)}</span>
								</button>
							</li>
						{/each}
					</ul>
				</Group>
			{/each}

			{#if catalogue === undefined}
				<Note tone="empty">Loading the catalogue of download.versatiles.org…</Note>
			{:else if catalogue === null}
				<Note tone="empty">The catalogue of download.versatiles.org could not be loaded - Studio may be offline.</Note>
			{/if}
		{/if}
	</div>

	{#snippet actions()}
		<button type="button" class="button" onclick={onCancel}>Cancel</button>
		<button type="button" class="button primary" disabled={verdict.state !== 'opens'} onclick={() => submit()}>
			Open
		</button>
	{/snippet}
</Modal>

<style>
	.address {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		input {
			font-family: var(--font-mono);
			padding: var(--space-2) var(--space-4);
		}
	}

	/* A fixed height, so switching tabs does not resize the dialog under the pointer - and allowed to
	   shrink below it, which is what keeps the buttons on screen in a short window: it is the only
	   child of the dialog that can give way. */
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 0 1 16rem;
		min-height: 0;
		overflow-y: auto;
		margin-top: calc(-1 * var(--space-2));
	}

	.list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.pick {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		text-align: left;

		&:hover,
		&:focus-visible {
			background: var(--chrome);
		}
	}

	.title {
		min-width: 0;
	}

	.meta {
		flex: none;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.address-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		max-width: 100%;
	}
</style>
