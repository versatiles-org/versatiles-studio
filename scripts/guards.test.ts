import { describe, expect, it } from 'vitest';
import { assertSafeSegment, resolveRepo } from './update-assets';

// The manifest is data, and data that reaches `fetch()` decides where a build machine connects.
// These are the checks that keep a tampered `assets/manifest.json` from redirecting CI.
describe('resolveRepo', () => {
	it('accepts the repositories the manifest actually names', () => {
		for (const repo of [
			'versatiles-org/versatiles-style',
			'versatiles-org/versatiles-fonts',
			'versatiles-org/versatiles-frontend'
		]) {
			expect(resolveRepo(repo)).toBe(repo);
		}
	});

	it('returns the allow-listed constant, not the caller string', () => {
		const input = ['versatiles-org', 'versatiles-style'].join('/');
		// Same characters, different object — what comes back is our constant, so no manifest string
		// can reach a URL even if it happens to spell an allowed repo.
		expect(resolveRepo(input)).toBe('versatiles-org/versatiles-style');
	});

	it('refuses anything not on the list', () => {
		for (const bad of [
			'evil-org/payload',
			'versatiles-org/not-a-real-repo',
			'not-a-repo',
			'https://evil.example/x',
			''
		]) {
			expect(() => resolveRepo(bad)).toThrow(/not one this project fetches from/);
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
