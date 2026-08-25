/**
 * The one help popover, and what it is currently showing.
 *
 * **Why this is app-level state rather than a box inside the thing it explains.** Parameter
 * documentation runs to a median of 95 characters and a p90 of 262; in a 280px sidebar that is
 * three lines typically and seven at the p90, overlaying the form being filled in. Beside the
 * sidebar it is one and a half lines, and four. The sidebar also scrolls and clips, so a child of a
 * node cannot escape it - one fixed-position element driven from here sidesteps both.
 *
 * **Peek and pin are different needs**, so they are different gestures. Hovering or focusing the
 * trigger peeks: read it and move on, nothing to dismiss. Clicking pins: it stays, and the text
 * stays selectable, which is what you want when an example is worth copying.
 */

export interface HelpContent {
	/** What is being explained - a parameter name. */
	title: string;
	/** The machine-readable half: type, bounds, whether it is required. Often the whole answer. */
	summary: string;
	/** The prose, verbatim from `field_meta`. */
	body: string;
}

interface Shown {
	content: HelpContent;
	/** Where the trigger is, in viewport coordinates. */
	anchor: DOMRect;
	/** The sidebar the trigger sits in, so the popover can sit beside it rather than over it. */
	container: DOMRect;
	pinned: boolean;
}

let shown = $state<Shown | null>(null);

export const help = {
	get current() {
		return shown;
	}
};

/** Measures a trigger and the sidebar it lives in. */
function place(element: HTMLElement) {
	return {
		anchor: element.getBoundingClientRect(),
		container: (element.closest('.sidebar') ?? element).getBoundingClientRect()
	};
}

/** Shows help without committing to it. Ignored while something is pinned. */
export function peek(content: HelpContent, element: HTMLElement) {
	if (shown?.pinned) return;
	shown = { content, ...place(element), pinned: false };
}

/** Hides a peek. A pinned popover stays - that is what pinning means. */
export function unpeek() {
	if (!shown?.pinned) shown = null;
}

/** Pins, or unpins when this trigger already owns the pin. */
export function pin(content: HelpContent, element: HTMLElement) {
	if (shown?.pinned && shown.content.title === content.title) {
		shown = null;
		return;
	}
	shown = { content, ...place(element), pinned: true };
}

/** Closes whatever is open, pinned or not. */
export function dismiss() {
	shown = null;
}
