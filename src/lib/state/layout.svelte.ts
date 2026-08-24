/**
 * Where the window's furniture sits, mirrored from the core ([Q16](../../../docs/decisions.md)).
 *
 * Pane widths, which panes are open and on which side, the camera, and the background map — all
 * durable, because a reloaded window should come back to what you left ([Q31]).
 *
 * **Every write goes through [`change`], which is the whole reason this is a module.** The layout is
 * read-modify-write on a single record: a pane drag reads it, a toggle reads it, the camera timer
 * reads it. Four call sites each spreading `{ ...layout, … }` is four chances to spread a stale one,
 * and the bug that produces — a pane that reopens itself because the camera write carried an old
 * `panes` — is invisible until someone does two things at once.
 *
 * **Written optimistically, then reconciled.** The local copy changes first so the interface does
 * not wait on a disk write, and the core's answer replaces it — the core reconciles the pane list
 * against the catalogue, so what comes back can differ from what went out.
 */

import { getLayout, setLayout, type Camera, type Layout, type PaneState } from '../ipc/commands';
import { isBackgroundId, type BackgroundId } from '../map/background';

let current = $state<Layout | null>(null);

/**
 * Coalesces the camera, for the same reason a pane drag only writes on release.
 *
 * One scroll-zoom settles several times, and each would otherwise be its own atomic write.
 */
let viewTimer: ReturnType<typeof setTimeout> | undefined;

export const layout = {
	/** `null` until the first read — which is what the shell waits on before drawing panes. */
	get current(): Layout | null {
		return current;
	},

	/**
	 * The background map to draw under everything.
	 *
	 * **A value this build does not know falls back to none.** An old layout file must not be able to
	 * open a window onto a background this version cannot build.
	 */
	get background(): BackgroundId {
		return isBackgroundId(current?.background) ? current.background : 'none';
	},

	/** Reads the layout from the core. Called once, at startup. */
	async load(): Promise<void> {
		current = await getLayout();
	},

	/**
	 * Replaces the whole layout.
	 *
	 * Failing to persist is not worth interrupting anyone for: the window is already arranged the way
	 * they asked, and the only loss is that the next one will not be.
	 */
	async change(next: Layout): Promise<void> {
		current = next;
		current = await setLayout(next).catch(() => next);
	},

	/**
	 * A pane being dragged.
	 *
	 * Written locally while the drag runs and persisted once on release — an atomic write per frame
	 * is a lot of disk for a number that is about to change again.
	 */
	resize(side: 'left' | 'right', width: number, done: boolean): void {
		if (!current) return;
		const next = side === 'left' ? { ...current, leftWidth: width } : { ...current, rightWidth: width };
		if (done) void this.change(next);
		else current = next;
	},

	/** Opens or folds one pane. */
	toggle(id: string, open: boolean): void {
		if (!current) return;
		void this.change({
			...current,
			panes: current.panes?.map((pane) => (pane.id === id ? { ...pane, open } : pane))
		});
	},

	/**
	 * Remembers where the camera came to rest.
	 *
	 * The layout is read when the timer *fires* rather than when it is set, so a pane collapsed in
	 * between is not undone by a camera write carrying the older record.
	 */
	rememberView(view: Camera): void {
		clearTimeout(viewTimer);
		viewTimer = setTimeout(() => {
			if (current) void this.change({ ...current, view });
		}, 400);
	},

	/**
	 * The panes belonging to one sidebar, in the order the layout remembers ([Q31]).
	 *
	 * `panes` is optional in the generated type only because `Layout` carries serde's `default` for
	 * the file it is read from — a command always returns the reconciled list.
	 */
	on(side: 'left' | 'right'): PaneState[] {
		return (current?.panes ?? []).filter((pane) => pane.side === side);
	}
};
