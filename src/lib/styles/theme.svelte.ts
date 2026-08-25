/**
 * Whether the system is in dark mode, as a reactive value.
 *
 * The CSS does not need this - `prefers-color-scheme` in tokens.css handles the chrome on its own.
 * It exists for the map, whose colours are copied into layers rather than referenced, and so has to
 * be told when to re-read them.
 *
 * A single listener for the whole application, registered once at module load. There is no in-app
 * override: see the note in tokens.css.
 */

const query = window.matchMedia('(prefers-color-scheme: dark)');

let dark = $state(query.matches);
query.addEventListener('change', (event) => (dark = event.matches));

export const theme = {
	get dark() {
		return dark;
	}
};
