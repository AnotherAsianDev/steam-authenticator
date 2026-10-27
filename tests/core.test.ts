import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error no types
import SteamTotp from 'steam-totp';
import { generateCode } from '../src/main/totp';
import { MaFileStore } from '../src/main/store';
import { parseMaFile, MaFileError } from '../src/main/mafile';

const SECRET = Buffer.from('0123456789abcdef0123').toString('base64');

describe('totp', () => {
	afterEach(() => vi.useRealTimers());
	it('matches steam-totp across many windows', () => {
		vi.useFakeTimers();
		// steam-totp reads the clock itself (its 2nd argument is an offset), so pin it.
		for (let t = 1_700_000_000; t < 1_700_000_000 + 30 * 2000; t += 30) {
			vi.setSystemTime(t * 1000 + 7000);
			expect(generateCode(SECRET, t + 7)).toBe(SteamTotp.generateAuthCode(SECRET));
		}
	});
	it('rejects garbage secrets', () => {
		expect(() => generateCode('not base64 !!', 0)).toThrow();
	});
});

const MAFILE = `{"shared_secret":"${SECRET}","identity_secret":"${SECRET}","account_name":"olam","Session":{"SteamID":76561198000000001}}`;

describe('mafile', () => {
	it('parses and keeps the SteamID exact', () => {
		const p = parseMaFile(MAFILE);
		expect(p.steamId).toBe('76561198000000001');
		expect(p.accountName).toBe('olam');
	});
	it('rejects missing fields', () => {
		expect(() => parseMaFile('{"shared_secret":"x"}')).toThrow(MaFileError);
		expect(() => parseMaFile('nope')).toThrow(MaFileError);
	});
});

describe('store', () => {
	it('keeps the maFile verbatim as a plain file named by SteamID', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mafiles-'));
		const st = new MaFileStore(dir);
		st.save('76561198000000001', MAFILE);
		expect(readdirSync(dir)).toEqual(['76561198000000001.maFile']);
		expect(readFileSync(join(dir, '76561198000000001.maFile'), 'utf8')).toBe(MAFILE);
		expect(st.read('76561198000000001')).toBe(MAFILE);
		expect(st.list()).toEqual(['76561198000000001']);
	});
	it('replaces and removes accounts, ignoring stray files', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mafiles-'));
		const st = new MaFileStore(dir);
		st.save('76561198000000001', MAFILE);
		st.save('76561198000000001', MAFILE + ' ');
		writeFileSync(join(dir, 'manifest.json'), '{}');
		expect(st.list()).toEqual(['76561198000000001']);
		st.remove('76561198000000001');
		expect(st.list()).toEqual([]);
	});
	it('rejects path-like SteamIDs', () => {
		const st = new MaFileStore(mkdtempSync(join(tmpdir(), 'mafiles-')));
		expect(() => st.save('../../etc/passwd', MAFILE)).toThrow();
	});
});
