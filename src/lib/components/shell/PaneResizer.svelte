<script lang="ts">
	// The draggable edge of a side pane.
	//
	// Extracted because both panes need it and the behaviour is identical — pointer capture, a
	// keyboard equivalent, the same ARIA. What is *not* shared is the panes themselves: the left
	// holds collapsible sections and the right an inspector, and they have no structure in common
	// beyond a border and a width. Wrapping both in one "side pane" component would invent a
	// similarity that is not there; this is the part that genuinely repeats.
	let {
		side,
		width,
		min = 180,
		max = 640,
		onResize
	}: {
		/** Which edge of the window the pane sits on. The handle goes on its inner side. */
		side: 'left' | 'right';
		/** Current width in CSS pixels, for the keyboard step and the ARIA value. */
		width: number;
		min?: number;
		max?: number;
		/** `done` is false while dragging and true on release, so only the last one is persisted. */
		onResize: (width: number, done: boolean) => void;
	} = $props();

	/** Measured against the shell rather than the window, so window chrome cannot skew it. */
	function widthFrom(event: PointerEvent, handle: HTMLElement): number {
		const shell = handle.parentElement?.getBoundingClientRect();
		if (!shell) return width;
		return Math.round(side === 'left' ? event.clientX - shell.left : shell.right - event.clientX);
	}

	// Pointer capture rather than window listeners: the pointer keeps reporting to the handle even
	// when it leaves it, so a fast drag across the map does not silently stop resizing.
	function start(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function drag(event: PointerEvent, done: boolean) {
		const handle = event.currentTarget as HTMLElement;
		if (!handle.hasPointerCapture(event.pointerId)) return;
		if (done) handle.releasePointerCapture(event.pointerId);
		onResize(widthFrom(event, handle), done);
	}

	// A pane that can only be resized by dragging cannot be resized by everyone. Arrow keys move
	// the *edge*, so on the right pane the directions are mirrored — left widens it.
	function nudge(event: KeyboardEvent) {
		const step = event.shiftKey ? 48 : 12;
		const towards = side === 'left' ? 1 : -1;
		if (event.key === 'ArrowLeft') onResize(width - step * towards, true);
		else if (event.key === 'ArrowRight') onResize(width + step * towards, true);
		else return;
		event.preventDefault();
	}
</script>

<!-- A focusable `separator` is the ARIA window-splitter pattern: with a `tabindex` and an
     `aria-valuenow` it is a widget role, not the static divider the linter assumes. The required
     value attributes are all here, and arrow keys move it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="resizer {side}"
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize the {side} pane"
	aria-valuenow={width}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	onpointerdown={start}
	onpointermove={(event) => drag(event, false)}
	onpointerup={(event) => drag(event, true)}
	onkeydown={nudge}
></div>

<style>
	/* Sits over the border between pane and map. Four pixels is invisible but grabbable; the border
	   it covers stays the visible edge. */
	.resizer {
		width: 4px;
		z-index: 5;
		cursor: col-resize;
		touch-action: none;
	}
	.resizer.left {
		grid-area: left;
		justify-self: end;
		margin-right: -2px;
	}
	.resizer.right {
		grid-area: right;
		justify-self: start;
		margin-left: -2px;
	}
	.resizer:hover {
		background: var(--accent);
	}
</style>
