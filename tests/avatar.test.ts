import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarCache, extractPersonaName } from '../src/main/avatar';

const ID = '76561198000000001';
const xml = (name: string) => `<profile><steamID64>${ID}</steamID64><steamID><![CDATA[${name}]]></steamID><avatarFull><![CDATA[https://avatars.steamstatic.com/abc_full.jpg]]></avatarFull></profile>`;

afterEach(() => vi.unstubAllGlobals());

describe('profile name', () => {
	it('reads the name from the profile XML, not the SteamID64', () => {
		expect(extractPersonaName(xml('Olam | CS2'))).toBe('Olam | CS2');
		expect(extractPersonaName('<steamID>plain</steamID>')).toBe('plain');
		expect(extractPersonaName('<profile><steamID64>1</steamID64></profile>')).toBeUndefined();
	});
	it('cleans control characters and limits the length', () => {
		expect(extractPersonaName(xml('a\u0000b\nc'))).toBe('abc');
		expect(extractPersonaName(xml('x'.repeat(200)))?.length).toBe(64);
		expect(extractPersonaName(xml('   '))).toBeUndefined();
	});
	it('is fetched with the picture, kept on disk, and fetched again for an account that has a picture but no name yet', async () => {
		let hits = 0;
		vi.stubGlobal('fetch', async (url: string) => {
			hits++;
			return String(url).includes('?xml=1') ? new Response(xml('Olam')) : new Response(Buffer.from([1, 2, 3]));
		});
		const dir = mkdtempSync(join(tmpdir(), 'av-'));
		const cache = new AvatarCache(dir, () => undefined, 'https://example.test/profiles');
		expect(cache.nickname(ID)).toBeUndefined();
		cache.ensure(ID);
		for (let i = 0; i < 50 && !cache.has(ID); i++) await new Promise((r) => setTimeout(r, 20));
		expect(cache.nickname(ID)).toBe('Olam');
		expect(JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8'))).toEqual({ [ID]: 'Olam' });
		expect(new AvatarCache(dir).nickname(ID)).toBe('Olam');
		// Nothing more is asked while everything is fresh.
		const before = hits;
		cache.recheck();
		cache.ensure(ID);
		await new Promise((r) => setTimeout(r, 50));
		expect(hits).toBe(before);
	});
});
