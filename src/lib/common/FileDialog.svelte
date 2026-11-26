<script lang="ts" module>
	import {
		browseLocal,
		browsePlaces,
		browseRemote,
		browsing,
		forgetServer,
		importOpening,
		recentSources,
		rememberBrowsing,
		type BrowseEntry,
		type BrowseListing,
		type BrowsePlace,
		type Opening,
		type Browsing,
		type SavedServer,
		type Server
	} from '../ipc/commands';
	import { fetchCatalog, type Shortcut } from './catalog';

	/** What the dialog asks the core. A parameter so a test needs no core. */
	export interface BrowseApi {
		places: () => Promise<BrowsePlace[]>;
		local: (path: string | null) => Promise<BrowseListing>;
		/** `password` and `remember` are a WebDAV server's; `null` signs in with the one kept. */
		remote: (server: Server, path: string | null, password: string | null, remember: boolean) => Promise<BrowseListing>;
		browsing: () => Promise<Browsing>;
		remember: (tab: string, folder: string | null, server: SavedServer | null) => Promise<null>;
		forget: (server: Server) => Promise<null>;
		/** Addresses opened before, most recent first, for the Web address tab. */
		addresses: () => Promise<string[]>;
		/** What an address opens as, for the Web address tab's check. */
		opening: (url: string) => Promise<Opening>;
		/** The download catalogue's shortcuts, `null` when it cannot be had. */
		shortcuts: () => Promise<Shortcut[] | null>;
	}

	const CORE: BrowseApi = {
		places: browsePlaces,
		local: browseLocal,
		remote: browseRemote,
		browsing,
		remember: rememberBrowsing,
		forget: forgetServer,
		opening: importOpening,
		shortcuts: fetchCatalog,
		addresses: async () =>
			(await recentSources()).map((entry) => entry.source).filter((source) => /^(https?|sftp):\/\//i.test(source))
	};

	/**
	 * How a server is named in a list: `anna@box.example.org`, with the port when it is not 22 - and a
	 * WebDAV server by its address, without the `https://` every one of them has.
	 */
	export const login = (server: Server) =>
		server.protocol === 'sftp'
			? `${server.user}@${server.host}${server.port === 22 ? '' : `:${server.port}`}`
			: `${server.user}@${server.address
					.trim()
					.replace(/^https:\/\//i, '')
					.replace(/\/+$/, '')}`;

	/** What tells two servers apart in the list: an SFTP and a WebDAV login may read the same. */
	const key = (server: Server) => `${server.protocol}:${login(server)}`;
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import Note from './Note.svelte';
	import Tabs from './Tabs.svelte';
	import Field from './Field.svelte';
	import Icon from './Icon.svelte';
	import FolderList from './FolderList.svelte';
	import AddressPanel from './AddressPanel.svelte';
	import type { FileRequest } from '../state/file-dialog.svelte';

	// Studio's own file dialog: a file on this computer or on an SFTP or WebDAV server, in one look.
	//
	// **Not the system's**, because the system's cannot reach a server, and a dialog for each would put
	// "where is the file" and "which file" in two different places that look nothing alike. Both tabs
	// list the same way - folders first, the path above, Up beside it - so a server is walked exactly
	// as a disk is. **One Server tab for both protocols**, and one list of the servers used before.
	//
	// **No password in any URL** (Q73): SFTP signs in through the SSH agent, `~/.ssh` or a key file,
	// and WebDAV with a password the core keeps for the session, and in the keychain when asked
	// (`webdav.rs`). The field is emptied once it has signed in, so the webview does not hold it.
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

	type Where = 'local' | 'remote' | 'address';
	/// The Web address tab only where an address is something to open: a source can be one, a node's
	/// clip polygon or key file cannot.
	const TABS = $derived([
		{ id: 'local', label: 'This computer' },
		{ id: 'remote', label: 'Server' },
		...(request.addresses ? [{ id: 'address', label: 'Web address' }] : [])
	]);

	let tab = $state<Where>('local');
	let places = $state<BrowsePlace[]>([]);
	let servers = $state<SavedServer[]>([]);
	let local = $state<BrowseListing | null>(null);
	let remote = $state<BrowseListing | null>(null);
	/// The server the remote tab is browsing, once a connection has listed something.
	let server = $state<Server | null>(null);
	type Protocol = Server['protocol'];
	let draft = $state({
		protocol: 'sftp' as Protocol,
		host: '',
		port: '22',
		user: '',
		identity: '',
		address: '',
		password: '',
		remember: true
	});
	/// Whether the drafted WebDAV server came from the list, so its password may already be kept and
	/// an empty field signs in with that one rather than with none.
	let fromList = $state(false);
	let selected = $state<BrowseEntry | null>(null);
	/// What each tab is doing, in one line: nothing, working, or why not. **One per tab**, so a local
	/// folder arriving late cannot wipe out why a server refused, on the tab being looked at.
	type Status = { busy: boolean; problem: boolean; text: string };
	const IDLE: Status = { busy: false, problem: false, text: '' };
	let statuses = $state<Record<Where, Status>>({ local: IDLE, remote: IDLE, address: IDLE });
	const status = $derived(statuses[tab]);
	// A block, not an expression: the value of an assignment to state is not the state, and Svelte
	// warns about every call that returns it.
	function say(where: Where, busy: boolean, problem: boolean, text: string): void {
		statuses[where] = { busy, problem, text };
	}

	const listing = $derived(tab === 'local' ? local : tab === 'remote' ? remote : null);
	const connected = $derived(tab === 'local' || (tab === 'remote' && server !== null));
	/// On the Web address tab: the address Open would open, once the check says it will.
	let address = $state<string | null>(null);
	let addresses = $state<string[]>([]);

	// The path field shows the folder listed, and is typed into to go somewhere else.
	let typed = $derived(listing?.path ?? '');

	/// Only the latest answer is kept, per tab: a slow folder arriving after a quick one is a folder
	/// left - but a server connecting is no reason to drop the local folder on its way.
	const asked: Record<Where, number> = { local: 0, remote: 0, address: 0 };
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

	async function goRemote(
		to: Server,
		path: string | null,
		password: string | null = null,
		remember = false
	): Promise<void> {
		const listed = await load(
			'remote',
			() => api.remote(to, path, password, remember),
			path ? `Reading ${path}…` : `Connecting to ${login(to)}…`
		);
		if (!listed) return;
		server = to;
		// The core has it now, for this session and the keychain; the webview has no use for it.
		draft.password = '';
		// **Kept as soon as it works**, not only once a file is chosen: a server that signed in is
		// one worth offering next time, even if this visit was to look around. With the folder, so
		// the next visit starts where this one got to.
		const saved: SavedServer = { server: to, folder: remote?.path ?? null };
		servers = [saved, ...servers.filter((each) => key(each.server) !== key(to))];
		await api.remember('remote', null, saved).catch(() => null);
	}

	const go = (path: string | null) => (tab === 'local' ? goLocal(path) : server && goRemote(server, path));

	onMount(async () => {
		const [known, found] = await Promise.all([api.browsing().catch(() => null), api.places().catch(() => [])]);
		places = found;
		servers = known?.servers ?? [];
		if (known?.tab === 'remote' || (known?.tab === 'address' && request.addresses)) tab = known.tab;
		if (request.addresses) addresses = await api.addresses().catch(() => []);
		// The last server, filled in rather than connected to: signing in is the person's to start.
		const last = servers[0]?.server;
		if (last) fill(last);
		await goLocal(null);
	});

	function fill(from: Server): void {
		const blank = { ...draft, host: '', port: '22', identity: '', address: '', password: '', remember: true };
		draft =
			from.protocol === 'sftp'
				? {
						...blank,
						protocol: 'sftp',
						host: from.host,
						port: String(from.port),
						user: from.user,
						identity: from.identity ?? ''
					}
				: { ...blank, protocol: 'webdav', address: from.address, user: from.user };
		fromList = from.protocol === 'webdav';
	}

	function connect(event: SubmitEvent): void {
		event.preventDefault();
		if (draft.protocol === 'webdav') {
			if (!draft.address.trim() || !draft.user.trim()) {
				say('remote', false, true, 'A WebDAV server needs an address and a user name.');
				return;
			}
			void goRemote(
				{ protocol: 'webdav', address: draft.address.trim(), user: draft.user.trim() },
				null,
				draft.password || null,
				draft.remember
			);
			return;
		}
		const port = Number(draft.port.trim() || '22');
		if (!draft.host.trim() || !draft.user.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
			say('remote', false, true, 'A server needs a host, a user name and a port from 1 to 65535.');
			return;
		}
		void goRemote(
			{
				protocol: 'sftp',
				host: draft.host.trim(),
				port,
				user: draft.user.trim(),
				identity: draft.identity.trim() || null
			},
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

	/// An address the panel has already checked, kept like a file is: the tab is remembered too.
	async function chooseAddress(url: string): Promise<void> {
		await api.remember('address', local?.path ?? null, null).catch(() => null);
		onAnswer(url);
	}

	const choosable = $derived(selected !== null && (selected.folder || accepts(selected)));
</script>

<Modal title={request.title} width="46rem" height="34rem" onClose={() => onAnswer(null)}>
	<Tabs
		items={TABS}
		selected={tab}
		onSelect={(id) => {
			tab = id === 'remote' || id === 'address' ? id : 'local';
			selected = null;
		}}
		label="Where the file is"
	/>

	{#if tab === 'address'}
		<AddressPanel
			recents={addresses}
			check={api.opening}
			loadShortcuts={api.shortcuts}
			onChange={(url) => (address = url)}
			onOpen={(url) => void chooseAddress(url)}
		/>
	{:else if connected}
		<div class="where">
			<button
				type="button"
				class="icon"
				aria-label="Up one folder"
				title="Up one folder"
				disabled={!listing?.parent}
				onclick={() => listing?.parent && void go(listing.parent)}
			>
				<Icon name="up" />
			</button>
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
							onclick={() => void goLocal(place.path)}
						>
							{place.label}
						</button>
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
		<div class="sign-in" class:with-servers={servers.length > 0}>
			{#if servers.length > 0}
				<section aria-label="Servers used before">
					<ul class="servers">
						{#each servers as saved (key(saved.server))}
							<li>
								<button type="button" class="server" onclick={() => fill(saved.server)}>
									<Icon name="server" />
									<span class="truncate">{login(saved.server)}</span>
								</button>
								<button
									type="button"
									class="icon"
									aria-label="Forget {login(saved.server)}"
									title="Forget this server"
									onclick={() => void forget(saved)}
								>
									<Icon name="remove" />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			<form class="server-form" onsubmit={connect}>
				<Field label="Protocol" as="group">
					<span class="choices" role="radiogroup" aria-label="Protocol">
						<label class="choice">
							<input type="radio" bind:group={draft.protocol} value="sftp" onchange={() => (fromList = false)} />
							SFTP
						</label>
						<label class="choice">
							<input type="radio" bind:group={draft.protocol} value="webdav" onchange={() => (fromList = false)} />
							WebDAV
						</label>
					</span>
				</Field>
				{#if draft.protocol === 'sftp'}
					<Field label="Host">
						<input bind:value={draft.host} placeholder="storage.example.org" spellcheck="false" autocomplete="off" />
					</Field>
					<Field label="Port"><input bind:value={draft.port} inputmode="numeric" autocomplete="off" /></Field>
					<Field label="User"><input bind:value={draft.user} spellcheck="false" autocomplete="off" /></Field>
					<Field label="Key file">
						<input
							bind:value={draft.identity}
							placeholder="optional, such as ~/.ssh/id_ed25519"
							spellcheck="false"
							autocomplete="off"
						/>
					</Field>
					<Note>
						The SSH agent, <code>~/.ssh/config</code> and your default keys are tried first. SFTP takes no password.
					</Note>
				{:else}
					<Field label="Address">
						<input
							bind:value={draft.address}
							placeholder="cloud.example.org/remote.php/dav/files/anna"
							spellcheck="false"
							autocomplete="off"
						/>
					</Field>
					<Field label="User"><input bind:value={draft.user} spellcheck="false" autocomplete="off" /></Field>
					<Field label="Password">
						<input
							type="password"
							bind:value={draft.password}
							placeholder={fromList ? 'the one kept, if there is one' : ''}
							autocomplete="off"
						/>
					</Field>
					<Field label="Remember">
						<input
							type="checkbox"
							bind:checked={draft.remember}
							title="Keep the password in this computer's keychain for next time"
						/>
					</Field>
					<Note>
						Over https only. The password is kept in this computer's keychain if you ask - never in a pipeline or a
						project, which name only the user.
					</Note>
				{/if}
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
			disabled={tab === 'address' ? address === null : !choosable || status.busy}
			onclick={() => {
				if (tab === 'address') {
					if (address) void chooseAddress(address);
				} else if (selected) open(selected);
			}}
		>
			{tab !== 'address' && selected?.folder ? 'Open Folder' : 'Open'}
		</button>
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

	/* The servers used before beside the form, when there are any - and the form alone across the
	   dialog when there are none, rather than a column kept empty for a list that is not there. */
	.sign-in {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		flex: 1 1 auto;
		gap: var(--space-5);
		min-height: 0;

		&.with-servers {
			grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
		}
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
	}

	.choices {
		display: flex;
		gap: var(--space-4);
	}

	.choice {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
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
