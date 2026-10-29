import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewer, releaseFromReply, UpdateChecker } from '../src/main/updatecheck';

const reply = (tag: string, extra: object = {}) => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: 'https://evil.example/', ...extra }) });
const file = () => join(mkdtempSync(join(tmpdir(), 'upd-')), 'update.json');

describe('versions', () => {
	it('compares numbers, not text', () => {
		expect(isNewer('0.10.0', '0.9.9')).toBe(true);
		expect(isNewer('v0.4.3', '0.4.2')).toBe(true);
		expect(isNewer('0.4.2', '0.4.2')).toBe(false);
		expect(isNewer('0.4.1', '0.4.2')).toBe(false);
		expect(isNewer('garbage', '0.4.2')).toBe(false);
	});
	it('builds the page address itself and skips drafts and prereleases', () => {
		expect(releaseFromReply({ tag_name: 'v0.5.0', html_url: 'https://evil.example/' })).toEqual({ version: '0.5.0', url: 'https://github.com/AnotherAsianDev/steam-authenticator/releases/tag/v0.5.0' });
		expect(releaseFromReply({ tag_name: 'v0.5.0', prerelease: true })).toBeUndefined();
		expect(releaseFromReply({ tag_name: 'v0.5.0', draft: true })).toBeUndefined();
		expect(releaseFromReply({ tag_name: '../../x' })).toBeUndefined();
	});
});

describe('UpdateChecker', () => {
	it('reports a newer release and asks every time', async () => {
		let calls = 0;
		const c = new UpdateChecker(file(), '0.4.2', async () => (calls++, reply('v0.4.3')));
		expect((await c.check())?.version).toBe('0.4.3');
		expect((await c.check())?.version).toBe('0.4.3');
		expect(calls).toBe(2);
	});
	it('falls back to the last answer when offline', async () => {
		const f = file();
		await new UpdateChecker(f, '0.4.2', async () => reply('v0.4.3')).check();
		expect((await new UpdateChecker(f, '0.4.2', async () => { throw new Error('offline'); }).check())?.version).toBe('0.4.3');
	});
	it('says nothing when up to date, offline, or the repository has no release', async () => {
		expect(await new UpdateChecker(file(), '0.4.3', async () => reply('v0.4.3')).check()).toBeUndefined();
		expect(await new UpdateChecker(file(), '0.4.2', async () => { throw new Error('offline'); }).check()).toBeUndefined();
		expect(await new UpdateChecker(file(), '0.4.2', async () => ({ ok: false, status: 404, json: async () => ({}) })).check()).toBeUndefined();
	});
	it('survives a damaged cache file', async () => {
		const f = file();
		writeFileSync(f, '{nope');
		expect((await new UpdateChecker(f, '0.4.2', async () => reply('v0.5.0')).check())?.version).toBe('0.5.0');
	});
});
