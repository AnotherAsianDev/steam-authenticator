import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarCache, banLabels, extractBans, extractPersonaName, isBanned } from '../src/main/avatar';

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
		cache.ensure(ID, { image: true, bans: true });
		for (let i = 0; i < 50 && !cache.has(ID); i++) await new Promise((r) => setTimeout(r, 20));
		expect(cache.nickname(ID)).toBe('Olam');
		expect(JSON.parse(readFileSync(join(dir, 'profiles.json'), 'utf8'))[ID].name).toBe('Olam');
		expect(new AvatarCache(dir).nickname(ID)).toBe('Olam');
		// Nothing more is asked while everything is fresh.
		const before = hits;
		cache.recheck();
		cache.ensure(ID, { image: true, bans: true });
		await new Promise((r) => setTimeout(r, 50));
		expect(hits).toBe(before);
	});
});

describe('bans', () => {
	const withBans = (vac: number, trade: string, limited = 0) => `${xml('Olam')}<vacBanned>${vac}</vacBanned><tradeBanState>${trade}</tradeBanState><isLimitedAccount>${limited}</isLimitedAccount>`;
	it('reads VAC, trade and limited state from the profile XML', () => {
		expect(extractBans(withBans(1, 'Banned', 1))).toEqual({ vac: true, trade: 'Banned', limited: true });
		expect(extractBans(withBans(0, 'None'))).toEqual({ vac: false, trade: 'None', limited: false });
		expect(extractBans('<response><error>not found</error></response>')).toBeUndefined();
	});
	it('only a VAC ban or an active trade ban counts', () => {
		expect(isBanned(extractBans(withBans(0, 'None', 1)))).toBe(false);
		expect(isBanned(extractBans(withBans(1, 'None')))).toBe(true);
		expect(isBanned(extractBans(withBans(0, 'Probation')))).toBe(true);
		expect(isBanned(undefined)).toBe(false);
	});
	it('reports a ban that appears later, without a second request for the picture', async () => {
		let state = withBans(0, 'None');
		let images = 0;
		vi.stubGlobal('fetch', async (url: string) => {
			if (String(url).includes('?xml=1')) return new Response(state);
			images++;
			return new Response(Buffer.from([1, 2, 3]));
		});
		const news: string[] = [];
		const dir = mkdtempSync(join(tmpdir(), 'av-'));
		const cache = new AvatarCache(dir, () => undefined, 'https://example.test/profiles', (_id, what) => news.push(what));
		const want = { image: true, bans: true };
		cache.ensure(ID, want);
		for (let i = 0; i < 100 && !cache.has(ID); i++) await new Promise((r) => setTimeout(r, 20));
		expect(cache.bans(ID)?.vac).toBe(false);
		state = withBans(1, 'None');
		cache.refreshAll();
		cache.ensure(ID, want);
		for (let i = 0; i < 200 && !cache.bans(ID)?.vac; i++) await new Promise((r) => setTimeout(r, 20));
		expect(news).toEqual(['a VAC ban']);
		expect(images).toBe(1);
	});
	it('labels every kind of ban and keeps a history of what appeared', () => {
		expect(banLabels({ vac: true, vacCount: 2, gameBans: 1, community: true, trade: 'Probation', limited: false })).toEqual(['VAC ban ×2', 'Game ban', 'Community ban', 'Trade probation']);
		expect(banLabels({ vac: false, trade: 'None', limited: true })).toEqual([]);
		const cache = new AvatarCache(mkdtempSync(join(tmpdir(), 'av-')), () => undefined, 'https://example.test/profiles', () => undefined);
		cache.setBans(ID, { vac: false, trade: 'None', limited: false });
		cache.setBans(ID, { vac: true, vacCount: 1, trade: 'None', limited: false });
		cache.setBans(ID, { vac: false, trade: 'None', limited: false });
		expect(cache.history(ID).map((e) => e.what)).toEqual(['New: VAC ban', 'Bans lifted']);
	});
});

