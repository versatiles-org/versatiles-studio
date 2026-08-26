/**
 * The one line of an error worth putting in the status bar ([Q59]).
 *
 * **The core's errors arrive as chains.** Rust's `anyhow` formats a context stack with `{:#}`, which
 * joins every layer with `": "` - so a failed build reads
 *
 * > Failed to build pipeline from VPL: Failed to create read operation from VPL node: Failed to build
 * > from_tilejson operation in VPL node "from_tilejson": error sending request for url (…): client
 * > error (SendRequest): connection error: Connection reset by peer (os error 54)
 *
 * That is 250 characters in a bar that fits about eighty, and the eighty it keeps are the layers every
 * failure has in common. The part that differs - and the only part anyone can act on - is at the far
 * end, where it is cut off.
 *
 * So the bar gets the root cause and the whole chain goes to the problems panel, which is the surface
 * built for the long version. Nothing is lost: the bar's `title` still carries all of it.
 */

/** How many layers make something a chain rather than a sentence with a colon in it. */
const LAYERS = 3;

/**
 * The most specific layer of an error chain, or the message unchanged.
 *
 * **Three layers, not two.** `no such file: /home/anna/berlin.mbtiles` is one sentence naming a thing,
 * and reducing it to the path would throw away the half that says what went wrong. A context stack
 * deep enough to bury its own cause is three or more, and that is the case this exists for.
 *
 * Split on `": "` rather than `":"`, so a URL, a Windows path and a `z/x/y` coordinate all survive.
 */
export function headline(message: string): string {
	const layers = message.split(': ');
	if (layers.length < LAYERS) return message;

	// The last layer that says something. A chain ending in an empty fragment is malformed rather
	// than informative, and walking back is cheaper than showing nothing.
	for (let at = layers.length - 1; at >= 0; at--) {
		const layer = layers[at]?.trim();
		if (layer) return layer;
	}
	return message;
}
