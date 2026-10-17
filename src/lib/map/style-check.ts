/**
 * The exported style, checked against the MapLibre style spec (S14.9, B3).
 *
 * **What is written, not what is drawn.** The map draws the style with `studio://` tile URLs and
 * local glyphs; the file carries placeholders and public assets instead ([`forExport`]). A check of
 * the map's own style would pass a file it never saw, so the check runs on the export's copy.
 *
 * **MapLibre's own validator**, from the package the map is built on - so "valid" means what the
 * renderer that will read the file means by it, and nothing Studio decided.
 *
 * Its messages name a layer by position - `layers[41]` - which nobody can find in two hundred
 * layers. They name it by id here instead, which is what the Layers pane and the file both show.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { forExport } from './style-code';

export interface StyleProblem {
	message: string;
	/** MapLibre refuses an error; a warning it draws past. */
	severity: 'error' | 'warning';
}

/** What MapLibre's validator says about the style as it would be exported, layers named by id. */
export function checkStyle(style: StyleSpecification): StyleProblem[] {
	const exported = forExport(style);
	const layers = exported.layers ?? [];
	return validateStyleMin(exported).map((error) => ({
		message: error.message
			.replace(/^layers\[(\d+)\]/, (whole, index: string) => {
				const id = layers[Number(index)]?.id;
				return id === undefined ? whole : `layer "${id}"`;
			})
			// A style built in memory has no lines to point at.
			.replace(/, previously used at line undefined$/, ''),
		severity: (error as { severity?: string }).severity === 'warning' ? 'warning' : 'error'
	}));
}
