<script lang="ts">
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { REPOSITORY } from '../common/repository';

	// What state this is in, said once, in the corner (G8-ish: honesty about maturity is cheaper than
	// a support thread). It links to the repository, because "alpha" is only useful next to somewhere
	// to read what that means and file what you found.
	//
	// **Opened in the system browser, not here.** A webview that navigated to GitHub would be a
	// window with the application gone from it and no way back - there is no chrome, no back button
	// and no address bar. `tauri-plugin-opener` hands the URL to the OS instead, and the capability
	// scopes it to this one host so it cannot become a general way out.
	//
	// A `<button>` rather than an `<a>`: it does not navigate, and a link that lies about that is a
	// link a middle-click or a right-click "open in new tab" will break.

	const REPO = REPOSITORY;

	let failed = $state(false);

	async function open() {
		try {
			await openUrl(REPO);
			failed = false;
		} catch {
			// Nothing is worth interrupting for here, and the status bar belongs to the work. The
			// title carries the URL, so it can still be read and typed by hand.
			failed = true;
		}
	}
</script>

<button
	type="button"
	class="ribbon"
	class:failed
	onclick={() => void open()}
	title={failed ? `Could not open a browser - ${REPO}` : `Alpha - read more at ${REPO}`}
>
	alpha
</button>

<style>
	/*
	 * Across the top-right corner, over everything. `fixed` rather than absolute: it belongs to the
	 * window, not to any pane, and the shell's grid has no cell for a thing that sits on a corner.
	 *
	 * The bar underneath keeps its buttons clear of this - see `AppBar`'s padding.
	 */
	.ribbon {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 7;
		/* 8rem across the diagonal puts the band over the corner and its ends off both edges, so
		   neither shows a cut. */
		width: 8rem;
		transform: translate(2.1rem, 1.35rem) rotate(45deg);
		transform-origin: center;
		padding: var(--space-1) 0;
		background: var(--accent);
		color: var(--accent-ink);
		text-align: center;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		box-shadow: var(--shadow);

		&:hover {
			filter: brightness(1.12);
		}

		/* Said in the one place it can be said without taking the screen: the tooltip carries the
		   URL, and the colour says the click did not do what it promised. */
		&.failed {
			background: var(--error);
		}

		/* The rotation is decoration; the ring follows it, so it needs room not to clip. */
		&:focus-visible {
			outline-offset: 2px;
		}
	}
</style>
