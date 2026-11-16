/**
 * Studio's own file dialog, asked for from wherever a file is wanted (`common/import.ts`).
 *
 * **One request at a time, answered once.** A caller awaits `ask` and gets a path, an `sftp://` URL
 * or `null`; the dialog the window mounts for `request` calls `answer`. A second `ask` while one is
 * open answers the first with `null` rather than leaving it waiting forever.
 */

export interface FileRequest {
	/** What the dialog is called - "Open a source", or the field's own name. */
	title: string;
	/** What may be chosen, without the dot and lowercase. Empty for anything. */
	extensions: string[];
	/** Why a chosen file cannot be used, or `null` when it can - asked before the dialog closes. */
	check?: (location: string) => Promise<string | null>;
	/** Whether an `https://` or `sftp://` address may be typed in, on a Web address tab. */
	addresses?: boolean;
}

class FileDialog {
	request = $state<FileRequest | null>(null);
	#answer: ((location: string | null) => void) | null = null;

	ask(request: FileRequest): Promise<string | null> {
		this.#answer?.(null);
		this.request = request;
		return new Promise((resolve) => (this.#answer = resolve));
	}

	answer(location: string | null): void {
		const answer = this.#answer;
		this.#answer = null;
		this.request = null;
		answer?.(location);
	}
}

export const fileDialog = new FileDialog();
