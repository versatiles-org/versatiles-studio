<script lang="ts">
	import { grouped, matching, pickable, type PickerItem } from './picker';
	// The "add something" picker, in place of a `<select>`.
	//
	// Both places that offer a list of things to insert — `＋ operation…` on the chain's rail and
	// `＋ parameter…` inside a node — were native selects. A select can hold a list and nothing
	// else: its options cannot carry a description, a disabled option's reason is a `title` the
	// platform may or may not show, and there is no way to type and narrow. With thirty transforms
	// that last one is the difference between reading a list and finding a name.
	//
	// **Positioned like `Help`, and for the same reason.** The sidebar scrolls and clips, so a list
	// drawn inside a node cannot escape it; `position: fixed` from the trigger's measured rectangle
	// sidesteps that without portals. Not the Popover API — Studio already decided against it for
	// `Help` because WebKitGTK versions vary on Linux, and one popup mechanism is enough.
	//
	// A scroll invalidates the measured rectangle, so it closes rather than chases — again `Help`'s
	// answer, and the honest one.

	let {
		label,
		items,
		onPick,
		/** Shown in the filter box. */
		placeholder = 'Type to filter…'
	}: {
		label: string;
		items: PickerItem[];
		onPick: (value: string) => void;
		placeholder?: string;
	} = $props();

	/// Breathing room between the list, the tip and the window's edges.
	const GAP = 8;

	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let trigger = $state<HTMLButtonElement>();
	let list = $state<HTMLElement>();
	let rect = $state<DOMRect | null>(null);
	/// The row being examined — pointed at, or walked to with the arrows. `null` when neither.
	///
	/// Not the same as `active`, which is the row Enter would pick and therefore always a pickable
	/// one. A refused operation can be examined and cannot be picked, and the reason it is refused
	/// is exactly what examining it should show.
	let examined = $state<PickerItem | null>(null);
	/// Top of the row the tip points at, in viewport coordinates.
	let anchor = $state<number | null>(null);

	const id = $props.id();

	const matches = $derived(matching(items, query));
	const groups = $derived(grouped(matches));
	/// Only rows that can be chosen, in display order — what the arrow keys walk.
	const walkable = $derived(pickable(matches));

	function show() {
		rect = trigger?.getBoundingClientRect() ?? null;
		open = true;
		query = '';
		active = 0;
		examined = null;
	}

	function hide() {
		open = false;
		rect = null;
	}

	function choose(item: PickerItem) {
		if (item.unavailable) return;
		hide();
		onPick(item.value);
		trigger?.focus();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			hide();
			trigger?.focus();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (walkable.length === 0) return;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + walkable.length) % walkable.length;
			// Walking to a row is examining it, so the tip follows the arrows as well as the pointer.
			examined = walkable[active] ?? null;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const item = walkable[active];
			if (item) choose(item);
		}
	}

	/// Keeps the highlighted row in view when the arrows walk past the edge of the box.
	$effect(() => {
		if (!open) return;
		const row = walkable[active];
		if (!row) return;
		list?.querySelector(`[data-value="${CSS.escape(row.value)}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	/// Where the row the tip belongs to currently sits.
	///
	/// Measured from the DOM rather than computed: rows differ in height, the list scrolls inside
	/// the box, and arithmetic over both would be a second, wronger idea of where a row is.
	function measure() {
		if (!open || !current) {
			anchor = null;
			return;
		}
		const element = list?.querySelector(`[data-value="${CSS.escape(current.value)}"]`);
		anchor = element ? element.getBoundingClientRect().top : null;
	}

	$effect(measure);

	/// Where the list goes: under the trigger, pulled inside the window, and above it instead when
	/// there is more room there — a node near the bottom of a long chain is the ordinary case, not
	/// the exceptional one.
	const position = $derived.by(() => {
		if (!rect) return null;
		const width = Math.max(rect.width, 240);
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - width));
		const below = window.innerHeight - rect.bottom;
		const flip = below < 220 && rect.top > below;
		return {
			left,
			width,
			top: flip ? undefined : rect.bottom + 4,
			bottom: flip ? window.innerHeight - rect.top + 4 : undefined
		};
	});

	const isActive = (item: PickerItem) => walkable[active]?.value === item.value;

	/// What the tip says, or nothing when no row is being examined.
	///
	/// **Nothing is the ordinary state.** The tip belongs to a row, so between rows, over a heading,
	/// or once the pointer has left the list there is no row for it to belong to and it goes. It
	/// does not fall back to the keyboard's row: a box left floating beside a list nobody is
	/// pointing at reads as stuck rather than as informative.
	const current = $derived(examined);
	const detail = $derived(current?.unavailable ?? current?.description ?? '');

	/// Where the full text goes: beside the row it belongs to.
	///
	/// **Beside, not below.** Measured across the operations, a field's documentation runs to a
	/// median of 110 characters and as far as 604, so each row keeps one line and the rest is read
	/// here. Putting it inside the box — under the list, or by growing the row — would move the
	/// rows while the pointer was travelling down them, which is the reflow `Help` already refuses
	/// for the same reason. Out here it overlays the map and disturbs nothing.
	///
	/// Flips to the left of the list when there is no room on the right: panes have sides
	/// ([Q31](../../../docs/decisions.md)), so a picker near the right edge is a real case.
	const tip = $derived.by(() => {
		if (!position || anchor === null || !detail) return null;
		const width = Math.min(22 * 16, window.innerWidth * 0.3);
		const right = position.left + position.width + GAP;
		const left = right + width <= window.innerWidth - GAP ? right : Math.max(GAP, position.left - GAP - width);
		// Level with its row, then pulled back inside the window.
		const top = Math.max(GAP, Math.min(anchor, window.innerHeight - GAP - 120));
		return { left, top, width };
	});
</script>

<!-- Same answer as `Help`: a measured rectangle is wrong the moment anything moves. -->
<svelte:window onscroll={() => open && hide()} onresize={() => open && hide()} />

<button
	bind:this={trigger}
	type="button"
	class="trigger"
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls={open ? id : undefined}
	onclick={() => (open ? hide() : show())}
>
	{label}
</button>

{#if open && position}
	<!-- Closes when focus leaves the whole popup, which covers clicking away and tabbing away in
	     one rule. `onfocusout` fires before the new focus lands, hence the `relatedTarget` check. -->
	<div
		class="popup"
		{id}
		style:left="{position.left}px"
		style:width="{position.width}px"
		style:top={position.top === undefined ? undefined : `${position.top}px`}
		style:bottom={position.bottom === undefined ? undefined : `${position.bottom}px`}
		onfocusout={(event) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
		}}
	>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="text"
			class="filter"
			{placeholder}
			autofocus
			bind:value={query}
			oninput={() => {
				// Filtering moves the rows out from under both the highlight and the pointer: the
				// highlight goes back to the top, where it can be seen, and the tip goes, because
				// whatever it was describing is no longer where it was.
				active = 0;
				examined = null;
			}}
			onkeydown={onKey}
			aria-label={label}
			aria-controls={id}
		/>

		<div
			class="list"
			bind:this={list}
			role="listbox"
			aria-label={label}
			tabindex="-1"
			onmouseleave={() => (examined = null)}
			onscroll={measure}
		>
			{#each groups as group (group.name ?? '')}
				{#if group.name}
					<p class="group section-label">{group.name}</p>
				{/if}
				{#each group.items as item (item.value)}
					<button
						type="button"
						class="row"
						class:active={isActive(item)}
						class:unavailable={Boolean(item.unavailable)}
						data-value={item.value}
						role="option"
						aria-selected={isActive(item)}
						aria-disabled={Boolean(item.unavailable)}
						tabindex="-1"
						onclick={() => choose(item)}
						onmousemove={() => {
							examined = item;
							// The highlight stays on a row that can be chosen: moving it onto a refused
							// one would promise an Enter that does nothing.
							const index = walkable.findIndex((candidate) => candidate.value === item.value);
							if (index >= 0) active = index;
						}}
					>
						{item.label ?? item.value}
					</button>
				{/each}
			{/each}

			{#if matches.length === 0}
				<p class="empty">Nothing matches “{query}”.</p>
			{/if}
		</div>
	</div>

	{#if tip}
		<!-- A sibling of the list, not a child: it has to escape the box's own bounds. `role="tooltip"`
		     and no pointer events, because it describes the row rather than being something to use —
		     and a box that swallowed the pointer would sit between it and the rows on the way past. -->
		<p
			class="tip"
			role="tooltip"
			aria-live="polite"
			style:left="{tip.left}px"
			style:top="{tip.top}px"
			style:width="{tip.width}px"
		>
			{detail}
		</p>
	{/if}
{/if}

<style>
	.trigger {
		padding: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
		text-align: left;

		&:hover {
			color: var(--ink);
		}
	}

	.popup {
		position: fixed;
		z-index: 40;
		display: flex;
		flex-direction: column;
		max-height: min(22rem, 60vh);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--float-bg);
		backdrop-filter: blur(6px);
		box-shadow: var(--shadow);
	}

	.filter {
		border: 0;
		border-bottom: 1px solid var(--rule);
		border-radius: 0;
		background: none;
		font-size: var(--text-sm);
	}

	.list {
		overflow-y: auto;
		padding: var(--space-1);
	}

	.group {
		margin: var(--space-2) 0 var(--space-1);
		padding: 0 var(--space-2);
	}

	/* One line each. What a row *means* is in the tip beside it — repeating a clipped half of it
	   here bought a hint at the cost of halving how many rows fit, and the clipped half is the part
	   that reads as noise. */
	.row {
		display: block;
		width: 100%;
		overflow: hidden;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;

		/* The highlight follows the keyboard *and* the pointer, so there is only ever one — a hover
		   style of its own would let the mouse show one row while Enter picked another. */
		&.active {
			background: var(--chrome);
		}

		&.unavailable {
			color: var(--ink-2);
			cursor: default;
		}
	}

	/* The same face as `Help`, which is the other thing on screen that explains something beside the
	   pane rather than inside it. Two floating explanations that looked different would read as two
	   kinds of thing. */
	.tip {
		position: fixed;
		z-index: 41;
		max-height: 60vh;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--float-bg);
		backdrop-filter: blur(6px);
		box-shadow: var(--shadow);
		color: var(--ink-2);
		font-size: var(--text-xs);
		line-height: 1.45;
		overflow: hidden;
		pointer-events: none;
	}

	.empty {
		margin: 0;
		padding: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
</style>
