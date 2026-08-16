import { describe, expect, it } from 'vitest';
import { assertAllowedRepo, assertSafeSegment } from './update-assets';

// The manifest is data, and data that reaches `fetch()` decides where a build machine connects.
// These are the checks that keep a tampered `assets/manifest.json` from redirecting CI.
describe('assertAllowedRepo', () => {
	it('accepts the repositories the manifest actually names', () => {
		for (const repo of [
			'versatiles-org/versatiles-style',
			'versatiles-org/versatiles-fonts',
			'versatiles-org/versatiles-frontend'
		]) {
			expect(() => assertAllowedRepo(repo)).not.toThrow();
		}
	});

	it('refuses another owner', () => {
		expect(() => assertAllowedRepo('evil-org/payload')).toThrow(/outside versatiles-org/);
	});

	it('refuses anything not in owner/name form', () => {
		for (const bad of ['not-a-repo', 'a/b/c', 'https://evil.example/x', '']) {
			expect(() => assertAllowedRepo(bad)).toThrow();
		}
	});
});

describe('assertSafeSegment', () => {
	it('accepts real tags and filenames', () => {
		expect(() => assertSafeSegment('v5.13.1', 'version')).not.toThrow();
		expect(() => assertSafeSegment('frontend-tiny.tar.gz', 'asset filename')).not.toThrow();
	});

	it('refuses path traversal and anything that could escape the URL path', () => {
		for (const bad of ['../../etc/passwd', 'a/b', 'a b', 'x?y=1', 'x#y', '..']) {
			expect(() => assertSafeSegment(bad, 'version')).toThrow();
		}
	});
});
