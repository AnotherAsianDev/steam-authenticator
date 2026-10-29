import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFolder, normalizeStoreFolder, readMaFile } from '../src/main/autoimport';
import { MaFileError, parseMaFile, steamIdFromManifest } from '../src/main/mafile';
import { MaFileStore } from '../src/main/store';

const ID = '76561198012345678';
const SEC = Buffer.from('0123456789abcdef0123').toString('base64');
const base = (extra: string) => `{"shared_secret":"${SEC}","identity_secret":"${SEC}","account_name":"olam"${extra}}`;
const tmp = () => mkdtempSync(join(tmpdir(), 'sid-'));
const manifest = `{"encrypted":false,"entries":[{"encryption_iv":null,"encryption_salt":null,"filename":"olam.maFile","steamid":${ID}},{"filename":"other.maFile","steamid":76561198000000009}],"first_run":false}`;

describe('SteamID from somewhere other than Session.SteamID', () => {
	it('reads a lowercase key, a login cookie, and a token subject', () => {
		expect(parseMaFile(base(`,"steamid":"${ID}"`)).steamId).toBe(ID);
		expect(parseMaFile(base(`,"Session":{"SteamLoginSecure":"${ID}%7C%7Cabc"}`)).steamId).toBe(ID);
		const tok = `x.${Buffer.from(JSON.stringify({ sub: ID })).toString('base64url')}.y`;
		expect(parseMaFile(base(`,"Session":{"RefreshToken":"${tok}"}`)).steamId).toBe(ID);
	});
	it('writes the SteamID into the stored text, so the file reads back on its own', () => {
		const m = parseMaFile(base(',"Session":null'), ID);
		expect(m.steamId).toBe(ID);
		expect(m.raw).toContain(`"SteamID": ${ID}`);
		expect(parseMaFile(m.raw).steamId).toBe(ID);
	});
	it('says what to do when nothing tells the account', () => {
		expect(() => parseMaFile(base(',"Session":null'))).toThrow(MaFileError);
		expect(() => parseMaFile(base(''))).toThrow('Import with secrets');
	});
});

describe('SDA manifest.json', () => {
	it('finds the SteamID by file name without rounding it', () => {
		expect(steamIdFromManifest(manifest, 'olam.maFile')).toBe(ID);
		expect(steamIdFromManifest(manifest, 'OLAM.MAFILE')).toBe(ID);
		expect(steamIdFromManifest(manifest, 'nobody.maFile')).toBeUndefined();
	});
	it('imports a login-name file from a folder with a manifest', () => {
		const src = tmp();
		writeFileSync(join(src, 'olam.maFile'), base(',"Session":null'));
		writeFileSync(join(src, 'manifest.json'), manifest);
		expect(readMaFile(join(src, 'olam.maFile')).steamId).toBe(ID);
		const store = new MaFileStore(tmp());
		expect(importFolder(src, store).added).toEqual(['olam']);
		expect(store.has(ID)).toBe(true);
		expect(parseMaFile(readFileSync(join(store.dir, `${ID}.maFile`), 'utf8')).accountName).toBe('olam');
	});
	it('renames a dropped login-name file in the storage folder using the manifest', () => {
		const dir = tmp();
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'olam.maFile'), base(',"Session":null'));
		writeFileSync(join(dir, 'manifest.json'), manifest);
		const store = new MaFileStore(dir);
		const r = normalizeStoreFolder(store);
		expect(r.added).toEqual(['olam']);
		expect(r.failed).toEqual([]);
		expect(store.has(ID)).toBe(true);
	});
	it('a login-name file that already has its SteamID still works without a manifest', () => {
		const dir = tmp();
		writeFileSync(join(dir, 'olam.maFile'), base(`,"Session":{"SteamID":${ID}}`));
		const store = new MaFileStore(dir);
		expect(normalizeStoreFolder(store).added).toEqual(['olam']);
		expect(store.has(ID)).toBe(true);
	});
});
