import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobEvent } from '../ipc/commands';

/**
 * The job list, and the reducer that keeps it in step with the core.
 *
 * **A reducer over a channel is the shape that rots quietly.** Every event arrives while something
 * else is on screen, so a case handled wrongly shows up as a progress bar stuck at 70% or a row that
 * never leaves - not as an error anybody sees.
 */

const ipc = vi.hoisted(() => ({
	subscribeJobs: vi.fn(),
	cancelJob: vi.fn(),
	jobLog: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

// `Channel` comes straight from Tauri's core rather than through `ipc/commands`, and its constructor
// reaches for `window`. A stand-in is enough: this module only ever assigns `onmessage`.
vi.mock('@tauri-apps/api/core', () => ({
	Channel: class {
		onmessage: ((event: JobEvent) => void) | undefined;
	}
}));

const { jobs, connectJobs, cancelJob, jobLog } = await import('./jobs.svelte');

const job = (id: number, over: Partial<Job> = {}): Job =>
	({ id, name: `job ${id}`, state: { kind: 'queued' }, fraction: 0, logLines: [], ...over }) as Job;

/** The channel the core was handed, so a test can push events down it. */
let channel: { onmessage?: (event: JobEvent) => void };

/** Connects with a starting list, and returns a function that feeds events in. */
async function connect(initial: Job[] = []) {
	ipc.subscribeJobs.mockImplementation((given: typeof channel) => {
		channel = given;
		return Promise.resolve(initial);
	});
	await connectJobs();
	return (event: JobEvent) => channel.onmessage?.(event);
}

beforeEach(async () => {
	vi.clearAllMocks();
	await connect([]);
});

describe('what the bar counts and shows', () => {
	it('counts only what could still do something', async () => {
		await connect([
			job(1, { state: { kind: 'finished' } }),
			job(2, { state: { kind: 'running' } }),
			job(3, { state: { kind: 'queued' } }),
			job(4, { state: { kind: 'failed', error: 'no' } })
		]);
		expect(jobs.active.map((j) => j.id)).toEqual([2, 3]);
	});

	// **The newest running job, not the oldest.** An export started an hour ago is background; a
	// preview asked for a second ago is what the person is looking at.
	it('shows the newest running job', async () => {
		await connect([
			job(1, { state: { kind: 'running' } }),
			job(2, { state: { kind: 'running' } }),
			job(3, { state: { kind: 'queued' } })
		]);
		expect(jobs.current?.id).toBe(2);
	});

	it('shows nothing when nothing is running', async () => {
		await connect([job(1, { state: { kind: 'queued' } }), job(2, { state: { kind: 'finished' } })]);
		expect(jobs.current).toBeUndefined();
	});
});

describe('folding events in', () => {
	it('appends a job it has not seen', async () => {
		const send = await connect([]);
		send({ kind: 'added', job: job(1) } as JobEvent);
		expect(jobs.all.map((j) => j.id)).toEqual([1]);
	});

	it('moves a job to running', async () => {
		const send = await connect([job(1)]);
		send({ kind: 'started', id: 1 } as JobEvent);
		expect(jobs.all[0].state).toEqual({ kind: 'running' });
	});

	it('carries progress and its message', async () => {
		const send = await connect([job(1)]);
		send({ kind: 'progress', id: 1, fraction: 0.42, message: 'writing tiles' } as JobEvent);
		expect(jobs.all[0]).toMatchObject({ fraction: 0.42, message: 'writing tiles' });
	});

	/**
	 * The bug this exists for: only `fraction` and `message` were taken off the event, so the bar
	 * showed a moving bar and "processing tiles" and never a speed. The counts, the rate and the ETA
	 * were all on the event already - the runner works them out and sends them back on it.
	 */
	it('carries the counts and the pace with it, not only the fraction', async () => {
		const send = await connect([job(1)]);
		send({
			kind: 'progress',
			id: 1,
			fraction: 0.42,
			done: 42_000,
			total: 100_000,
			rate: 6100,
			etaSeconds: 9.5,
			message: 'processing tiles'
		} as JobEvent);

		expect(jobs.all[0]).toMatchObject({
			fraction: 0.42,
			done: 42_000,
			total: 100_000,
			rate: 6100,
			etaSeconds: 9.5
		});
	});

	/** A job that cannot count must not keep the last pace it had from a job that could. */
	it('clears the pace when an update stops being able to say', async () => {
		const send = await connect([job(1)]);
		send({
			kind: 'progress',
			id: 1,
			fraction: 0.4,
			done: 4,
			total: 10,
			rate: 2,
			etaSeconds: 3,
			message: 'x'
		} as JobEvent);
		send({
			kind: 'progress',
			id: 1,
			fraction: null,
			done: null,
			total: null,
			rate: null,
			etaSeconds: null,
			message: 'tidying up'
		} as JobEvent);

		expect(jobs.all[0]).toMatchObject({ rate: null, etaSeconds: null, done: null, message: 'tidying up' });
	});

	// Leaving the last fraction at 0.7 would draw a bar that stops short of the end for as long as
	// the row is on screen.
	it('finishes a job all the way to the end of its bar', async () => {
		const send = await connect([job(1, { fraction: 0.7, state: { kind: 'running' } })]);
		send({ kind: 'finished', id: 1 } as JobEvent);
		expect(jobs.all[0]).toMatchObject({ state: { kind: 'finished' }, fraction: 1 });
	});

	it('carries the reason a job failed', async () => {
		const send = await connect([job(1)]);
		send({ kind: 'failed', id: 1, error: 'no such directory' } as JobEvent);
		expect(jobs.all[0].state).toEqual({ kind: 'failed', error: 'no such directory' });
	});

	it('records a cancellation', async () => {
		const send = await connect([job(1)]);
		send({ kind: 'cancelled', id: 1 } as JobEvent);
		expect(jobs.all[0].state).toEqual({ kind: 'cancelled' });
	});

	// The core decides what is worth remembering; this follows it rather than resurrecting a row
	// from an event about a job that has aged out.
	it('ignores an event about a job it does not have', async () => {
		const send = await connect([job(1)]);
		send({ kind: 'finished', id: 99 } as JobEvent);
		expect(jobs.all).toHaveLength(1);
		expect(jobs.all[0].state).toEqual({ kind: 'queued' });
	});

	it('leaves the other jobs alone', async () => {
		const send = await connect([job(1), job(2)]);
		send({ kind: 'started', id: 2 } as JobEvent);
		expect(jobs.all[0].state).toEqual({ kind: 'queued' });
		expect(jobs.all[1].state).toEqual({ kind: 'running' });
	});
});

describe('reaching the core', () => {
	it('asks it to stop a job', async () => {
		await cancelJob(7);
		expect(ipc.cancelJob).toHaveBeenCalledWith(7);
	});

	it('fetches a job’s log on demand rather than holding it', async () => {
		ipc.jobLog.mockResolvedValue(['line one']);
		await expect(jobLog(7)).resolves.toEqual(['line one']);
	});
});
