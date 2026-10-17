/**
 * The panes this webview knows: what each is called, and what it is about (Q31, S10.9).
 *
 * The core owns *where* a pane sits, whether it is open, and in what order - that is durable state
 * and lives with the rest of it (Q16). This owns what the webview adds to an id: its title, because a
 * title is presentation and would arrive in the wrong language the day Studio has more than one; and
 * its scope, because the chain alternates between panes about the project and panes about the
 * selected graph, and the header has to say which (S10.4).
 *
 * **One list, typed.** The ids used to be bare strings agreed between a Rust array, a title table and
 * a chain of `if id === …` arms in `App.svelte`, and a typo in any of them rendered nothing. `PaneId`
 * is the union the other two sides are checked against: `registry.test.ts` reads the core's catalogue
 * and fails when the two lists differ, and the content snippet switches on the type.
 *
 * An id the core sends that is not here falls back to the id itself as a title, which is ugly but
 * visible - the failure mode of a half-added pane should be a heading that looks wrong, not a box
 * that silently is not there.
 */

import type { Component } from 'svelte';
import AnalysisSection from './analysis/AnalysisSection.svelte';
import InspectorSection from './inspector/InspectorSection.svelte';
import LayersSection from './layers/LayersSection.svelte';
import PipelineSection from './pipeline/PipelineSection.svelte';
import SourcesSection from './sources/SourcesSection.svelte';
import StyleSection from './style/StyleSection.svelte';

/** What a pane is about: every graph in the project, or the one that is selected. */
export type PaneScope = 'project' | 'selection';

export interface PaneEntry {
	title: string;
	scope: PaneScope;
	/**
	 * The pane, connected: a `*Section` that reads the state modules and hands its pane data and
	 * actions (S10.10). Takes no props - everything it needs is module state - which is what lets the
	 * sidebar render any id the same way.
	 */
	component: Component;
}

export const PANES = {
	// Named for what it holds rather than for the file format behind it: each row is a source of
	// tiles, and the style pane names the same things (S6.5).
	sources: { title: 'Sources', scope: 'project', component: SourcesSection },
	// The selected graph itself. It was the bottom half of Sources until [Q50], which is why the
	// id and the title no longer match - the id is durable and appears in `layout.json`.
	pipeline: { title: 'Pipeline', scope: 'selection', component: PipelineSection },
	style: { title: 'Style', scope: 'selection', component: StyleSection },
	// What the map paints, over every source at once. It was the bottom of the Style pane until the
	// stack became project-wide, which is why the two are adjacent and why the id is new.
	layers: { title: 'Layers', scope: 'project', component: LayersSection },
	// Both sides of the selected graph: what it reads and what it produced.
	inspector: { title: 'Inspector', scope: 'selection', component: InspectorSection },
	analysis: { title: 'Analysis', scope: 'selection', component: AnalysisSection }
} as const satisfies Record<string, PaneEntry>;

export type PaneId = keyof typeof PANES;

export const isPaneId = (id: string): id is PaneId => id in PANES;

export const paneTitle = (id: string): string => (isPaneId(id) ? PANES[id].title : id);

/**
 * What a pane's header says beside its title: the word "project", or the selected graph's name.
 *
 * `null` for an id this build does not know, and for a selection-scoped pane while nothing is
 * selected - a header that said "Pipeline · null" would be worse than one that said nothing.
 */
export function paneDetail(id: string, selected: string | null): string | null {
	if (!isPaneId(id)) return null;
	return PANES[id].scope === 'project' ? 'project' : selected;
}
