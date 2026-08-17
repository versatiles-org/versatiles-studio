<script lang="ts">
	import type { Snippet } from 'svelte';

	// One surface, not four modes (Q22): the left pane holds the chain from data to pixels, the map
	// sits in the middle, the right pane reports on the selection. Each region is optional and the
	// grid rebuilds around whichever are present — with nothing open, that leaves the map full
	// width, which is what Explore used to be.
	//
	// There is no in-app title bar. The window has native decorations, so one would have repeated
	// the OS title verbatim; which document a window holds is said in the window title instead, the
	// way a document application says it. The strip at the top comes back at S4 with the mode bar,
	// which has something to put there.
	//
	// The job bar arrives at S3 and the mode bar at S4 (it waits for a second entry); both slot into
	// this grid without moving anything.
	let {
		leftPane,
		leftWidth = 264,
		onLeftResize,
		mapPane,
		rightPane,
		commandBar
	}: {
		leftPane?: Snippet;
		/** CSS pixels. The core clamps it, so this is already in range. */
		leftWidth?: number;
		/** `done` is false while dragging and true on release, so only the last one is persisted. */
		onLeftResize?: (width: number, done: boolean) => void;
		mapPane: Snippet;
		rightPane?: Snippet;
		commandBar?: Snippet;
	} = $props();

	let shell = $state<HTMLDivElement>();

	// Pointer capture rather than window listeners: the pointer keeps reporting to the handle even
	// when it leaves it, so a fast drag over the map does not silently stop resizing.
	function startResize(event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
	}

	function resize(event: PointerEvent, done: boolean) {
		const handle = event.currentTarget as HTMLElement;
		if (!handle.hasPointerCapture(event.pointerId)) return;
		if (done) handle.releasePointerCapture(event.pointerId);
		const left = shell?.getBoundingClientRect().left ?? 0;
		onLeftResize?.(Math.round(event.clientX - left), done);
	}

	// The keyboard equivalent, because a pane that can only be resized by dragging cannot be
	// resized by everyone.
	function nudge(event: KeyboardEvent) {
		const step = event.shiftKey ? 48 : 12;
		if (event.key === 'ArrowLeft') onLeftResize?.(leftWidth - step, true);
		else if (event.key === 'ArrowRight') onLeftResize?.(leftWidth + step, true);
		else return;
		event.preventDefault();
	}
</script>

<div class="shell" class:has-left={leftPane} class:has-right={rightPane} style:--left-width="{leftWidth}px">
	{#if leftPane}
		<aside class="left">{@render leftPane()}</aside>
		<!-- A focusable `separator` is the ARIA window-splitter pattern: with a `tabindex` and an
		     `aria-valuenow` it is a widget role, not the static divider the linter assumes. The
		     required value attributes are all here, and arrow keys move it. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="resizer"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the left pane"
			aria-valuenow={leftWidth}
			aria-valuemin={180}
			aria-valuemax={640}
			tabindex="0"
			onpointerdown={startResize}
			onpointermove={(event) => resize(event, false)}
			onpointerup={(event) => resize(event, true)}
			onkeydown={nudge}
		></div>
	{/if}
	<div class="map">{@render mapPane()}</div>
	{#if rightPane}<aside class="right">{@render rightPane()}</aside>{/if}
	{#if commandBar}<footer class="command">{@render commandBar()}</footer>{/if}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr auto;
		grid-template-areas: 'map' 'command';
		height: 100vh;
		font-family: var(--font-ui);
		font-size: var(--text-md);
		color: var(--ink);
		background: var(--chrome);
	}
	.shell.has-right {
		grid-template-columns: 1fr var(--right-width);
		grid-template-areas: 'map right' 'command command';
	}
	/* `clamp` mirrors the range the core enforces on save (`store::Layout`), which stays the
	   authority — this only keeps a live drag from overshooting before it is stored. */
	.shell.has-left {
		grid-template-columns: clamp(180px, var(--left-width), 640px) 1fr;
		grid-template-areas: 'left map' 'command command';
	}
	.shell.has-left.has-right {
		grid-template-columns: clamp(180px, var(--left-width), 640px) 1fr var(--right-width);
		grid-template-areas: 'left map right' 'command command command';
	}
	.left {
		grid-area: left;
		border-right: 1px solid var(--rule);
		min-width: 0;
		overflow: hidden;
	}
	/* Sits over the border between pane and map. Four pixels is invisible but grabbable; the
	   border it covers stays the visible edge. */
	.resizer {
		grid-area: left;
		justify-self: end;
		width: 4px;
		margin-right: -2px;
		z-index: 5;
		cursor: col-resize;
		touch-action: none;
	}
	.resizer:hover {
		background: var(--accent);
	}
	.map {
		grid-area: map;
		position: relative;
		min-width: 0;
	}
	.right {
		grid-area: right;
		border-left: 1px solid var(--rule);
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--surface);
	}
	.command {
		grid-area: command;
		border-top: 1px solid var(--rule);
		background: var(--surface);
	}

	:global(:root) {
		--ink: var(--ink);
		--ink-2: var(--ink-2);
		--rule: var(--rule);
		--surface: var(--surface);
		--chrome: var(--chrome);
		--accent: var(--accent);
	}
</style>
