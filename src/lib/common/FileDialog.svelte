<script lang="ts" module>
	import {
		browseLocal,
		browsePlaces,
		browseRemote,
		browsing,
		forgetServer,
		rememberBrowsing,
		type BrowseEntry,
		type BrowseListing,
		type BrowsePlace,
		type Browsing,
		type SavedServer,
		type SftpServer
	} from '../ipc/commands';

	/** What the dialog asks the core. A parameter so a test needs no core. */
	export interface BrowseApi {
		places: () => Promise<BrowsePlace[]>;
		local: (path: string | null) => Promise<BrowseListing>;
		remote: (server: SftpServer, path: string | null) => Promise<BrowseListing>;
		browsing: () => Promise<Browsing>;
		remember: (tab: string, folder: string | null, server: SavedServer | null) => Promise<null>;
		forget: (server: SftpServer) => Promise<null>;
	}

	const CORE: BrowseApi = {
		places: browsePlaces,
		local: browseLocal,
		remote: browseRemote,
		browsing,
		remember: rememberBrowsing,
		forget: forgetServer
	};

	/** How a server is named in a list: `anna@box.example.org`, with the port when it is not 22. */
	export const login = (server: SftpServer) =>
		`${server.user}@${server.host}${server.port === 22 ? '' : `:${server.port}`}`;
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import Note from './Note.svelte';
	import Tabs from './Tabs.svelte';
	import Field from './Field.svelte';
	import Icon from './Icon.svelte';
	import FolderList from './FolderList.svelte';
	import type { FileRequest } from '../state/file-dialog.svelte';

	// Studio's own file dialog: a file on this computer or on an SFTP server, in one look.
	//
	// **Not the system's**, because the system's cannot reach a server, and a dialog for each would put
	// "where is the file" and "which file" in two different places that look nothing alike. Both tabs
	// list the same way - folders first, the path above, Up beside it - so a server is walked exactly
	// as a disk is.
	//
	// **Signing in is the SSH agent's, `~/.ssh`'s, or a key file's** - never a password, which would
	// have to be written into the pipeline's text to be used again (see `browse.rs`).
	//
	// **Nothing moves while it works**: the list is a fixed height and scrolls, and what the dialog
	// is doing - reading, connecting, why a file was refused - is one line of its own under it.

	let {
		request,
		onAnswer,
		api = CORE
	}: {
		request: FileRequest;
		onAnswer: (location: string | null) => void;
		api?: BrowseApi;
	} = $props();

	type Where = 'local' | 'remote';
	const TABS = [
		{ id: 'local', label: 'This computer' },
		{ id: 'remote', label: 'SFTP server' }
	];

	let tab = $state<Where>('local');
	let places = $state<BrowsePlace[]>([]);
	let servers = $state<SavedServer[]>([]);
	let local = $state<BrowseListing | null>(null);
	let remote = $state<BrowseListing | null>(null);
	/// The server the remote tab is browsing, once a connection has listed something.
	let server = $state<SftpServer | null>(null);
	let draft = $state({ host: '', port: '22', user: '', identity: '' });
	let selected = $state<BrowseEntry | null>(null);
	/// What each tab is doing, in one line: nothing, working, or why not. **One per tab**, so a local
	/// folder arriving late cannot wipe out why a server refused, on the tab being looked at.
	type Status = { busy: boolean; problem: boolean; text: string };
	const IDLE: Status = { busy: false, problem: false, text: '' };
	let statuses = $state<Record<Where, Status>>({ local: IDLE, remote: IDLE });
	const status = $derived(statuses[tab]);
	const say = (where: Where, busy: boolean, problem: boolean, text: string) =>
		(statuses[where] = { busy, problem, text });

	const listing = $derived(tab === 'local' ? local : remote);
	const connected = $derived(tab === 'local' || server !== null);

	// The path field shows the folder listed, and is typed into to go somewhere else.
	let typed = $derived(listing?.path ?? '');

	/// Only the latest answer is kept, per tab: a slow folder arriving after a quick one is a folder
	/// left - but a server connecting is no reason to drop the local folder on its way.
	const asked: Record<Where, number> = { local: 0, remote: 0 };
	async function load(where: Where, read: () => Promise<BrowseListing>, saying: string): Promise<boolean> {
		const mine = ++asked[where];
		say(where, true, false, saying);
		try {
			const listed = await read();
			if (mine !== asked[where]) return false;
			if (where === 'local') local = listed;
			else remote = listed;
			if (where === tab) selected = null;
			say(where, false, false, '');
			return true;
		} catch (error) {
			if (mine !== asked[where]) return false;
			say(where, false, true, String(error));
			return false;
		}
	}

	const goLocal = (path: string | null) => load('local', () => api.local(path), path ? `Reading ${path}…` : 'Reading…');

	async function goRemote(to: SftpServer, path: string | null): Promise<void> {
		const listed = await load(
			'remote',
			() => api.remote(to, path),
			path ? `Reading ${path}…` : `Connecting to ${login(to)}…`
		);
		if (listed) server = to;
	}

	const go = (path: string | null) => (tab === 'local' ? goLocal(path) : server && goRemote(server, path));

	onMount(async () => {
		const [known, found] = await Promise.all([api.browsing().catch(() => null), api.places().catch(() => [])]);
		places = found;
		servers = known?.servers ?? [];
		if (known?.tab === 'remote') tab = 'remote';
		// The last server, filled in rather than connected to: signing in is the person's to start.
		const last = servers[0]?.server;
		if (last) fill(last);
		await goLocal(null);
	});

	function fill(from: SftpServer): void {
		draft = { host: from.host, port: String(from.port), user: from.user, identity: from.identity ?? '' };
	}

	function connect(event: SubmitEvent): void {
		event.preventDefault();
		const port = Number(draft.port.trim() || '22');
		if (!draft.host.trim() || !draft.user.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
			say('remote', false, true, 'A server needs a host, a user name and a port from 1 to 65535.');
			return;
		}
		void goRemote(
			{ host: draft.host.trim(), port, user: draft.user.trim(), identity: draft.identity.trim() || null },
			null
		);
	}

	function disconnect(): void {
		server = null;
		remote = null;
		selected = null;
		say('remote', false, false, '');
	}

	async function forget(saved: SavedServer): Promise<void> {
		await api.forget(saved.server).catch(() => null);
		servers = servers.filter((each) => each !== saved);
	}

	/// Whether a file is a kind this request takes: by its last extension, and anything for an empty list.
	function accepts(entry: BrowseEntry): boolean {
		if (request.extensions.length === 0) return true;
		const dot = entry.name.lastIndexOf('.');
		return dot > 0 && request.extensions.includes(entry.name.slice(dot + 1).toLowerCase());
	}

	function open(entry: BrowseEntry): void {
		if (entry.folder) void go(entry.location);
		else void choose(entry);
	}

	async function choose(entry: BrowseEntry): Promise<void> {
		const where = tab;
		if (request.check) {
			say(where, true, false, `Checking ${entry.name}…`);
			const refusal = await request.check(entry.location).catch(() => null);
			if (refusal) {
				say(where, false, true, refusal);
				return;
			}
			say(where, false, false, '');
		}
		// Kept for next time: the tab, the local folder, and the server with the folder it was in.
		await api
			.remember(tab, local?.path ?? null, tab === 'remote' && server ? { server, folder: remote?.path ?? null } : null)
			.catch(() => null);
		onAnswer(entry.location);
	}

	const choosable = $derived(selected !== null && (selected.folder || accepts(selected)));
</script>

<Modal title={request.title} width="46rem" height="34rem" onClose={() => onAnswer(null)}>
	<Tabs
		items={TABS}
		selected={tab}
		onSelect={(id) => {
			tab = id === 'remote' ? 'remote' : 'local';
			selected = null;
		}}
		label="Where the file is"
	/>

	{#if connected}
		<div class="where">
			<button
				type="button"
				class="icon"
				aria-label="Up one folder"
				title="Up one folder"
				disabled={!listing?.parent}
				onclick={() => listing?.parent && void go(listing.parent)}><Icon name="up" /></button
			>
			<form
				class="path"
				onsubmit={(event) => {
					event.preventDefault();
					if (typed.trim()) void go(typed.trim());
				}}
			>
				<input aria-label="Folder" bind:value={typed} spellcheck="false" autocomplete="off" />
			</form>
			{#if tab === 'remote' && server}
				<span class="login truncate" title={login(server)}>{login(server)}</span>
				<button type="button" class="link" onclick={disconnect}>Disconnect</button>
			{/if}
		</div>

		<div class="browser" class:with-places={tab === 'local'}>
			{#if tab === 'local'}
				<nav class="places" aria-label="Places">
					{#each places as place (place.path)}
						<button
							type="button"
							class="place"
							class:here={local?.path === place.path}
							onclick={() => void goLocal(place.path)}>{place.label}</button
						>
					{/each}
				</nav>
			{/if}
			<FolderList
				{listing}
				selected={selected?.location ?? null}
				{accepts}
				label={tab === 'local' ? 'Files on this computer' : 'Files on the server'}
				onSelect={(entry) => (selected = entry)}
				onOpen={open}
				onUp={() => listing?.parent && void go(listing.parent)}
			/>
		</div>
	{:else}
		<div class="sign-in">
			{#if servers.length > 0}
				<section aria-label="Servers used before">
					<ul class="servers">
						{#each servers as saved (login(saved.server))}
							<li>
								<button type="button" class="server" onclick={() => fill(saved.server)}>
									<Icon name="folder" />
									<span class="truncate">{login(saved.server)}</span>
								</button>
								<button
									type="button"
									class="icon"
									aria-label="Forget {login(saved.server)}"
									title="Forget this server"
									onclick={() => void forget(saved)}><Icon name="remove" /></button
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			<form class="server-form" onsubmit={connect}>
				<Field label="Host"
					><input
						bind:value={draft.host}
						placeholder="storage.example.org"
						spellcheck="false"
						autocomplete="off"
					/></Field
				>
				<Field label="Port"><input bind:value={draft.port} inputmode="numeric" autocomplete="off" /></Field>
				<Field label="User"><input bind:value={draft.user} spellcheck="false" autocomplete="off" /></Field>
				<Field label="Key file"
					><input
						bind:value={draft.identity}
						placeholder="optional, such as ~/.ssh/id_ed25519"
						spellcheck="false"
						autocomplete="off"
					/></Field
				>
				<Note>
					The SSH agent, <code>~/.ssh/config</code> and your default keys are tried first. Passwords are not supported.
				</Note>
				<div class="toolbar"><button type="submit" class="button" disabled={status.busy}>Connect</button></div>
			</form>
		</div>
	{/if}

	<p class="readout status" class:problem={status.problem} role="status" title={status.text}>{status.text}</p>

	{#snippet actions()}
		<button type="button" class="button" onclick={() => onAnswer(null)}>Cancel</button>
		<button
			type="button"
			class="button primary"
			disabled={!choosable || status.busy}
			onclick={() => selected && open(selected)}>{selected?.folder ? 'Open Folder' : 'Open'}</button
		>
	{/snippet}
</Modal>

<style>
	.where {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.path {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;

		input {
			flex: 1 1 auto;
			min-width: 0;
			font-family: var(--font-mono);
			font-size: var(--text-sm);
		}
	}

	.login {
		max-width: 14rem;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	/* The list takes what the dialog has left, beside the places on this computer. */
	.browser {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		flex: 1 1 auto;
		gap: var(--space-4);
		min-height: 0;

		&.with-places {
			grid-template-columns: max-content minmax(0, 1fr);
		}
	}

	.places {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.place {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		text-align: left;
		font-size: var(--text-sm);

		&:hover {
			background: var(--chrome);
		}

		&.here {
			background: color-mix(in srgb, var(--accent) 18%, var(--surface));
		}
	}

	.sign-in {
		display: grid;
		grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
		flex: 1 1 auto;
		gap: var(--space-5);
		min-height: 0;
	}

	.servers {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			align-items: center;
			gap: var(--space-1);
			min-width: 0;
		}
	}

	.server {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		font-size: var(--text-sm);

		&:hover {
			background: var(--chrome);
		}
	}

	.server-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		grid-column: 2;
	}

	.status {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);

		&.problem {
			color: var(--error);
		}
	}
</style>
