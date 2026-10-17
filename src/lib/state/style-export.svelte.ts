/**
 * Writing the map's style out (S4.6, D8).
 *
 * Three forms, because they answer different questions: the JSON is what a map consumes, the code is
 * what a build regenerates it from, and the bundle is the JSON with the fonts and sprites it needs
 * beside it - for a machine that will not reach versatiles.org.
 *
 * **Out of the pane, so the pane takes data and actions like the other three** (S8.8). The Style
 * pane was the one component that opened a file dialog and called the export commands itself, and
 * so the one that could not be rendered without a backend. What is here is the half that touches
 * the outside: the dialog, the commands, and the two facts the pane shows about them - whether an
 * export is running, and which fonts the last bundle could not find.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { save } from '@tauri-apps/plugin-dialog';
import { exportStyle, exportStyleBundle } from '../ipc/commands';
import { fontsUsed, forExport } from '../map/style-code';

/** Which export is running, or `null`. Disables the buttons while a dialog is up. */
let exporting = $state<'json' | 'ts' | 'bundle' | null>(null);

/**
 * Fonts the last bundle could not find, said out loud rather than swallowed.
 *
 * Cleared on the next export, because it is about the one that just happened.
 */
let missingFonts = $state<string[]>([]);

export const styleExport = {
	get exporting(): 'json' | 'ts' | 'bundle' | null {
		return exporting;
	},

	get missingFonts(): string[] {
		return missingFonts;
	},

	/**
	 * Writes the style as `style.json`, or as the `@versatiles/style` call that regenerates it.
	 *
	 * The code is the caller's to produce - it depends on what the pane knows about the source - and
	 * `null` code means there is none to write, which the pane already says on the button.
	 *
	 * The tile URL is swapped for a placeholder in both forms: what the map reads from is an
	 * ephemeral local port, and a file carrying it away would work once.
	 */
	async write(kind: 'json' | 'ts', rendered: StyleSpecification, code: string | null): Promise<void> {
		if (kind === 'ts' && code === null) return;
		const contents = kind === 'ts' ? code! : JSON.stringify(forExport(rendered), null, '\t');

		exporting = kind;
		try {
			const target = await save({
				title: 'Export style',
				defaultPath: kind === 'ts' ? 'style.ts' : 'style.json',
				filters: [{ name: kind === 'ts' ? '@versatiles/style code' : 'MapLibre style', extensions: [kind] }]
			});
			if (target) await exportStyle(target, contents);
		} finally {
			exporting = null;
		}
	},

	/**
	 * The style plus everything it names, as a `.zip`.
	 *
	 * A zip rather than a folder: a bundle is a few hundred files, and quietly filling a directory
	 * someone chose is a worse surprise than one file with a name.
	 */
	async bundle(rendered: StyleSpecification): Promise<void> {
		exporting = 'bundle';
		missingFonts = [];
		try {
			const target = await save({
				title: 'Export style bundle',
				defaultPath: 'style.zip',
				filters: [{ name: 'Style bundle', extensions: ['zip'] }]
			});
			if (!target) return;
			// The bundle carries its own copies, so the style has to name them where they will be.
			const contents = JSON.stringify(forExport(rendered, 'bundled'), null, '\t');
			missingFonts = await exportStyleBundle(target, true, contents, fontsUsed(rendered));
		} finally {
			exporting = null;
		}
	}
};
