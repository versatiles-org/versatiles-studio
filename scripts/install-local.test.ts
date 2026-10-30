import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installApp } from './install-local';

describe('installApp', () => {
	const NAME = 'Studio.app';
	let root: string;
	let built: string;
	let applications: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'install-local-'));
		built = join(root, 'bundle', NAME);
		applications = join(root, 'Applications');
		mkdirSync(join(built, 'Contents'), { recursive: true });
		mkdirSync(applications);
		writeFileSync(join(built, 'Contents', 'new'), 'new');
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it('replaces what was there rather than merging into it', () => {
		mkdirSync(join(applications, NAME, 'Contents'), { recursive: true });
		writeFileSync(join(applications, NAME, 'Contents', 'old'), 'old');

		const target = installApp(built, applications, NAME);

		expect(target).toBe(join(applications, NAME));
		expect(readFileSync(join(target, 'Contents', 'new'), 'utf8')).toBe('new');
		expect(existsSync(join(target, 'Contents', 'old'))).toBe(false);
		expect(existsSync(join(applications, `.${NAME}.installing`))).toBe(false);
	});

	it('keeps symlinks as links, which is what keeps a framework signed', () => {
		symlinkSync('new', join(built, 'Contents', 'link'));

		const target = installApp(built, applications, NAME);

		expect(readlinkSync(join(target, 'Contents', 'link'))).toBe('new');
	});

	it('leaves the installed app alone when the build produced nothing', () => {
		mkdirSync(join(applications, NAME));
		writeFileSync(join(applications, NAME, 'old'), 'old');

		expect(() => installApp(join(root, 'absent.app'), applications, NAME)).toThrow(/did not produce/);

		expect(existsSync(join(applications, NAME, 'old'))).toBe(true);
	});
});
