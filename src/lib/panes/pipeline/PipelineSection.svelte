<script lang="ts">
	import PipelinePane from './PipelinePane.svelte';
	import { composition } from '../../map/composition.svelte';
	import { document } from '../../state/document.svelte';
	import { exporting } from '../../state/export.svelte';
	import { workbench } from '../../state/workbench.svelte';
	import { fieldSuggestions, vplRemoveProperty, vplSetProperty, vplSetValue } from '../../ipc/commands';

	// The Pipeline pane, connected (S8.10).
	//
	// **The wiring that used to be one arm of `App.svelte`**, plus the two things only this pane asks
	// for: what each node's fields could be set to, and which property names the pipeline produces.
	// Neither is state anything else reads, so they live with the one reader.

	/// What each node's fields could be set to, by the node's path (S3.4).
	///
	/// **Per node, because every node is a form.** This used to be one node's answer, fetched for
	/// whichever was selected - which was right while only the selected node had fields to fill in,
	/// and became "one file's columns offered for another file's node" the moment they all did.
	///
	/// Refetched whenever the document changes: the answer depends on each node's `filename`.
	let suggestions = $state<Record<string, Record<string, string[]>>>({});
	$effect(() => {
		// Depend on the text too - editing `filename` changes which file is being asked about.
		void document.current?.text;
		const graph = document.current?.graph;
		if (graph === undefined) {
			suggestions = {};
			return;
		}
		void fieldSuggestions(graph).then((found) => {
			suggestions = Object.fromEntries(
				found.map((node) => [node.path, Object.fromEntries(node.fields.map((f) => [f.field, f.values]))])
			);
		});
	});

	/// Property names the pipeline is producing, for the form's list fields (S3.3, E1).
	///
	/// Flattened across layers and de-duplicated: a node's `properties_include` applies to the
	/// features passing through it, not to one layer, so splitting them by layer here would be a
	/// distinction the parameter does not make.
	const producedProperties = $derived([
		...new Set((composition.editedBuild?.layers ?? []).flatMap((layer) => layer.propertyKeys))
	]);

	const selected = $derived(workbench.selected);
</script>

<PipelinePane
	operations={workbench.operations}
	graph={composition.stacked.find((entry) => entry.id === selected?.id) ?? null}
	pipeline={document.current}
	pipelineRevision={document.revision}
	properties={producedProperties}
	fits={composition.editedBuild?.fits ?? []}
	{suggestions}
	crop={document.current ? { bounds: workbench.crop, drawing: workbench.drawing } : null}
	cropActions={{
		set: (bounds) => void workbench.setCrop(bounds),
		draw: () => (workbench.drawing = !workbench.drawing),
		useView: () => workbench.cropToView()
	}}
	nodeActions={{
		setEnabled: (path, enabled) => void workbench.toggleNode(path, enabled),
		addOperation: (afterNameSpan, operation) => void workbench.addOperation(afterNameSpan, operation),
		remove: (span) => void workbench.removeNode(span),
		commitValue: (span, value) => void workbench.editText((text) => vplSetValue(text, span, value)),
		removeProperty: (span) => void workbench.editText((text) => vplRemoveProperty(text, span)),
		setProperty: (nameSpan, key, values) =>
			void workbench.editText((text) => vplSetProperty(text, nameSpan, key, values))
	}}
	documentActions={{
		change: (text) => void workbench.typing(text),
		undo: () => void workbench.stepHistory(true),
		redo: () => void workbench.stepHistory(false),
		format: () => void workbench.format(),
		save: (chooseFile) => void workbench.save(chooseFile),
		export: () => void exporting.show(selected?.id ?? null)
	}}
/>
