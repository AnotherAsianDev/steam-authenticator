import { describe, expect, it } from 'vitest';
import { UserError } from '../src/main/errors';
import { buildMaFile, importLines, parseLines, steamIdFromToken } from '../src/main/lineimport';
import { parseMaFile } from '../src/main/mafile';

const SS = Buffer.from('0123456789abcdef0123').toString('base64');
const IS = Buffer.from('abcdef01234567890123').toString('base64');
const ID = '76561198000000001';
const token = (sub: string) => `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`;

describe('parseLines', () => {
	it('reads four values, and a password that contains the separator', () => {
		const r = parseLines(`olam:pa:ss:word:${SS}:${IS}\r\n\n  bob : x : ${SS} : ${IS}`, ':');
		expect(r.errors).toEqual([]);
		expect(r.entries[0]!.entry).toMatchObject({ username: 'olam', password: 'pa:ss:word', sharedSecret: SS, identitySecret: IS });
		expect(r.entries[1]!.entry.username).toBe('bob');
	});
	it('names the problem per line', () => {
		const r = parseLines(`a:b:c\nc:pw:!!!:${IS}\n:pw:${SS}:${IS}`, ':');
		expect(r.entries).toHaveLength(0);
		expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining('4 values'), expect.stringContaining('not valid'), expect.stringContaining('username is empty')]);
	});
});

describe('maFile and SteamID', () => {
	it('builds a file the app can read back, with a numeric SteamID', () => {
		const text = buildMaFile({ username: 'olam', password: 'p', sharedSecret: SS, identitySecret: IS }, ID, 'rt');
		expect(text).toContain(`"SteamID": ${ID}`);
		expect(parseMaFile(text)).toMatchObject({ steamId: ID, accountName: 'olam', refreshToken: 'rt' });
	});
	it('takes the SteamID from the token subject only', () => {
		expect(steamIdFromToken(token(ID))).toBe(ID);
		expect(steamIdFromToken(token('abc'))).toBeUndefined();
		expect(steamIdFromToken('nonsense')).toBeUndefined();
	});
});

describe('importLines', () => {
	const run = async (text: string, signIn: (u: string) => Promise<string>, have = new Set<string>()) => {
		const saved: string[] = [];
		const r = await importLines(text, ':', { signIn: (u) => signIn(u), steamNow: () => 1, exists: (id) => have.has(id), save: (id) => void saved.push(id), pause: async () => undefined });
		return { r, saved };
	};
	it('adds good lines, reports bad ones, keeps going after a failure', async () => {
		const { r, saved } = await run(`a:pw:${SS}:${IS}\nb:pw:${SS}:${IS}\nbroken`, async (u) => {
			if (u === 'b') throw new UserError('Wrong username or password');
			return token(ID);
		});
		expect(saved).toEqual([ID]);
		expect(r.map((x) => [x.label, x.ok])).toEqual([['a', true], ['b', false], ['broken', false]]);
		expect(r[1]!.message).toBe('Wrong username or password');
	});
	it('does not overwrite an account that is already there', async () => {
		const { r, saved } = await run(`a:pw:${SS}:${IS}`, async () => token(ID), new Set([ID]));
		expect(saved).toEqual([]);
		expect(r[0]!.message).toContain('Already');
	});
	it('never puts the password or secrets into a message', async () => {
		const { r } = await run(`a:hunter2:${SS}:${IS}`, async () => { throw new Error(`boom hunter2 ${SS}`); });
		expect(JSON.stringify(r)).not.toMatch(/hunter2|MDEyMzQ/);
	});
});
