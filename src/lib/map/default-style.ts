/**
 * The default render style (S1.4).
 *
 * "Preview" only means something if vector tiles render legibly, which is why M1 silently pulls in
 * the bundled asset tier — sprites plus Latin glyphs (Q9). Both are served by the embedded server
 * straight out of their archives, so the URLs below point at it rather than at any remote host:
 * Studio works offline from first launch.
 *
 * A placeholder shape until S1.2 has a container whose layers a style can be derived from.
 */
import { token } from '../styles/tokens';

import type { StyleSpecification } from 'maplibre-gl';

export function defaultStyle(serverBaseUrl: string): StyleSpecification {
	return {
		version: 8,
		glyphs: `${serverBaseUrl}/assets/glyphs/{fontstack}/{range}.pbf`,
		sprite: `${serverBaseUrl}/assets/sprites/basics/sprites`,
		sources: {},
		layers: [{ id: 'background', type: 'background', paint: { 'background-color': token('--map-bg') } }]
	};
}
