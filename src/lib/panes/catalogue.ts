/**
 * What each pane is called, and nothing else (Q31).
 *
 * The core owns *where* a pane sits, whether it is open, and in what order - that is durable state
 * and lives with the rest of it (Q16). This owns what a pane is *called*, because a title is
 * presentation: storing it would be one more thing to keep in step across the boundary for no gain,
 * and it would arrive in the wrong language the day Studio has more than one.
 *
 * An id here with no entry in the core's catalogue is never rendered; an id in the core's catalogue
 * with no entry here falls back to the id itself, which is ugly but visible - the failure mode of a
 * half-added pane should be a heading that looks wrong, not a box that silently is not there.
 */
export const PANE_TITLES: Record<string, string> = {
	// Named for what it holds rather than for the file format behind it: each row is a source of
	// tiles, and the style pane names the same things (S6.5).
	pipeline: 'Sources',
	style: 'Style',
	inspector: 'Inspector'
};

export const paneTitle = (id: string): string => PANE_TITLES[id] ?? id;
