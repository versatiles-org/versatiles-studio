<script lang="ts">
	import type { ContainerInfo } from '../../ipc/commands';
	import JsonTree from '../../common/JsonTree.svelte';

	// A6 - the right pane shows what things turn out to be, never global settings and never a way in.
	//
	// It used to carry its own "Open a tile container…" button and remote-URL form, from S1 when
	// opening a container was all Studio did. [Q32] made a graph *a* source, so a file opens by
	// becoming a graph: the one door is "＋ new graph…" next to where graphs live, the same door the
	// landing screen, drag & drop and the recents list go through. Two doors to the same room is
	// what `PipelinePane` already removed once; this is the other half of it.
	//
	// Named views left too ([Q38]): they move the camera, so they belong on the map, and holding
	// them here was what made this pane need a `map` at all.
	// **Both sides of the pipeline, in the order they are read.** A pipeline exists to change the
	// format, the zoom range and the extent (S2.7), so the file that went in and the tiles that came
	// out are two different answers - and showing only the inputs made this a file browser for
	// questions nobody was asking. The result is what the map draws, so it is read first; the inputs
	// below it are what explain it.
	//
	// **Where in the chain is chosen with the eyes** ([Q49]). A node eye means "this runs", and a
	// graph is built from the nodes still running - so closing the eye after the third node makes
	// this the result *at* the third node. That is node-level inspection for nothing: no partial
	// build, no second selection, and no way for the two to disagree.
	let {
		containers,
		/** The selected graph's own output, or `null` when it has not built. */
		result = null,
		/** Which graph is selected. `null` when none is, which is what tells "not built" apart. */
		graph = null
	}: {
		containers: ContainerInfo[];
		result?: ContainerInfo | null;
		graph?: string | null;
	} = $props();

	function extent(bbox: ContainerInfo['bbox']): string {
		if (!bbox) return '-';
		return bbox.map((n) => n.toFixed(3)).join(', ');
	}
</script>

<!-- The same figures on both sides, which is what makes them comparable at a glance: a
     `0-12` above a `0-14` answers "did the zoom_extend work" without reading either label twice. -->
{#snippet facts(item: ContainerInfo)}
	<dl>
		<dt>container</dt>
		<dd>{item.container}</dd>
		<dt>tiles</dt>
		<dd>{item.tileFormat}{item.tileCompression === 'none' ? '' : ` · ${item.tileCompression}`}</dd>
		<!-- The real range, from which levels hold tiles - containers routinely overstate it. -->
		<dt>zoom</dt>
		<dd>{item.minZoom}-{item.maxZoom}</dd>
		<dt>extent</dt>
		<dd class="wrap">{extent(item.bbox)}</dd>
	</dl>

	<JsonTree value={item.tileJson} name="TileJSON" open={false} />
{/snippet}

<div class="inspector">
	{#if !graph && containers.length === 0}
		<p class="hint">Nothing open.</p>
	{/if}

	{#if graph}
		<section>
			<p class="role">Result</p>
			<!-- The graph's name, not `info.source`: `describe` labels a pipeline's output `preview`,
			     which names the mount rather than the thing anyone is looking at. -->
			<h2 class="truncate" title={graph}>{graph}</h2>
			{#if result}
				{@render facts(result)}
			{:else}
				<!-- Stated rather than hidden. A pipeline that will not build is exactly when someone
				     opens this pane, and a section that disappears reads as "nothing to say". -->
				<p class="hint">Not built.</p>
			{/if}
		</section>
	{/if}

	{#each containers as info (info.source)}
		<section>
			<p class="role">Input</p>
			<h2 class="truncate" title={info.source}>{info.source.split('/').pop()}</h2>
			{@render facts(info)}
		</section>
	{/each}
</div>

<style>
	.inspector {
		height: 100%;
		min-width: 0;
		overflow-y: auto;
		/* Reaching the end must not chain the scroll up to the window, which would rubber-band it. */
		overscroll-behavior: contain;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.hint {
		margin: 0;
		color: var(--ink-2);
		line-height: 1.5;
	}

	section {
		border-top: 1px solid var(--rule);
		padding-top: var(--space-4);
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-weight: 600;
	}

	/* Which side of the pipeline this section is. Quiet, because the name below it is what someone
	   is looking for - this only says where to file it. */
	.role {
		margin: 0 0 var(--space-1);
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-5);
		margin: 0 0 var(--space-4);
	}

	dt {
		color: var(--ink-2);
	}

	dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);

		&.wrap {
			white-space: normal;
			word-break: break-word;
		}
	}
</style>
