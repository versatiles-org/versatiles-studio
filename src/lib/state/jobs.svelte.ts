/**
 * The job list, as the status bar draws it (S3.1, E7).
 *
 * The core owns the jobs; this is a mirror of them, kept up to date by the event stream rather than
 * by polling. Two rules make that mirror trustworthy:
 *
 * * **One subscription, taken at startup**, whose reply is the list as it stood at that instant.
 *   Subscribing and listing as two calls leaves a gap where an event lands between them — counted
 *   twice if the list came second, missed if it came first.
 * * **Every field the bar shows arrives in an event.** Nothing here is computed from a previous
 *   value, so a listener that reconnects mid-job is never subtly behind.
 *
 * Jobs outlive the window that started them: a reload while a conversion runs gets a new channel
 * and the same list back. That is the point of keeping them in the core ([Q16]).
 *
 * [Q16]: ../../../docs/decisions.md
 */

import { Channel } from '@tauri-apps/api/core';
import { subscribeJobs, jobLog as fetchLog, cancelJob as stopJob, type Job, type JobEvent } from '../ipc/commands';

/** Oldest first, the order the core keeps them in. */
let all = $state<Job[]>([]);

export const jobs = {
	get all() {
		return all;
	},

	/** Jobs that could still do something — what the bar counts. */
	get active() {
		return all.filter((job) => job.state.kind === 'queued' || job.state.kind === 'running');
	},

	/**
	 * The one job the bar shows when it has room for one.
	 *
	 * The newest running job, not the oldest: an export started an hour ago is background, and a
	 * preview asked for a second ago is what the person is looking at.
	 */
	get current(): Job | undefined {
		// A reverse scan rather than `findLast`, which the project's ES2022 target does not have.
		for (let index = all.length - 1; index >= 0; index -= 1) {
			if (all[index].state.kind === 'running') return all[index];
		}
		return undefined;
	}
};

/**
 * Starts listening. Called once, from the shell's startup.
 *
 * Safe to call again after a reload — the core replaces the sink rather than adding one.
 */
export async function connectJobs(): Promise<void> {
	const channel = new Channel<JobEvent>();
	channel.onmessage = apply;
	all = await subscribeJobs(channel);
}

/** Asks a job to stop. The bar updates when the core says it did, not when this returns. */
export async function cancelJob(id: number): Promise<void> {
	await stopJob(id);
}

/** A job's log lines, fetched when a row is expanded. */
export async function jobLog(id: number): Promise<string[]> {
	return fetchLog(id);
}

/**
 * Folds one event into the list.
 *
 * Events about a job that has aged out of the core's history are ignored rather than resurrecting
 * a partial row — the core decides what is worth remembering, and this follows it.
 */
function apply(event: JobEvent): void {
	if (event.kind === 'added') {
		all = [...all, event.job];
		return;
	}
	all = all.map((job) => (job.id === event.id ? update(job, event) : job));
}

function update(job: Job, event: JobEvent): Job {
	switch (event.kind) {
		case 'started':
			return { ...job, state: { kind: 'running' } };
		case 'progress':
			return { ...job, fraction: event.fraction, message: event.message };
		case 'log':
			return { ...job, logLines: event.logLines };
		case 'finished':
			// A finished job is finished all the way: leaving the last fraction at 0.7 would draw a
			// bar that stops short of the end for as long as the row is on screen.
			return { ...job, state: { kind: 'finished' }, fraction: 1 };
		case 'cancelled':
			return { ...job, state: { kind: 'cancelled' } };
		case 'failed':
			return { ...job, state: { kind: 'failed', error: event.error } };
		default:
			return job;
	}
}
