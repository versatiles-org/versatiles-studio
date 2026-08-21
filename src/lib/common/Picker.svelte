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

	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let trigger = $state<HTMLButtonElement>();
	let list = $state<HTMLElement>();
	let rect = $state<DOMRect | null>(null);

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
		const current = walkable[active];
		if (!current) return;
		list?.querySelector(`[data-value="${CSS.escape(current.value)}"]`)?.scrollIntoView({ block: 'nearest' });
	});

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
			onkeydown={onKey}
			aria-label={label}
			aria-controls={id}
		/>

		<div class="list" bind:this={list} role="listbox" aria-label={label} tabindex="-1">
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
							const index = walkable.findIndex((candidate) => candidate.value === item.value);
							if (index >= 0) active = index;
						}}
					>
						<span class="name">{item.label ?? item.value}</span>
						{#if item.unavailable}
							<span class="why">{item.unavailable}</span>
						{:else if item.description}
							<span class="why">{item.description}</span>
						{/if}
					</button>
				{/each}
			{/each}

			{#if matches.length === 0}
				<p class="empty">Nothing matches “{query}”.</p>
			{/if}
		</div>
	</div>
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

	.row {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		color: var(--ink);
		font-size: var(--text-sm);
		text-align: left;

		/* The highlight follows the keyboard *and* the pointer, so there is only ever one — a hover
		   style of its own would let the mouse show one row while Enter picked another. */
		&.active {
			background: var(--chrome);
		}

		&.unavailable {
			color: var(--ink-2);
			cursor: default;
		}

		.name {
			font-family: var(--font-mono);
		}

		.why {
			color: var(--ink-2);
			font-size: var(--text-xs);
			line-height: 1.35;
		}
	}

	.empty {
		margin: 0;
		padding: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
</style>
