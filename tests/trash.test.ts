import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Accounts } from '../src/main/accounts';
import { importFolder } from '../src/main/autoimport';
import { ConfirmationsClient } from '../src/main/confirmations';
import { CredentialStore } from '../src/main/credentials';
import { TokenStore } from '../src/main/sessions';
import { MaFileStore } from '../src/main/store';
import { Trash } from '../src/main/trash';
import { fitWindowState, loadWindowState, saveWindowState } from '../src/main/windowstate';

const SEC = Buffer.from('0123456789abcdef0123').toString('base64');
const ID = '76561198000000001';
const maFile = (id = ID) => `{"shared_secret":"${SEC}","identity_secret":"${SEC}","account_name":"olam","revocation_code":"R12345","Session":{"SteamID":${id}}}`;

function setup(withTrash = true) {
	const dir = mkdtempSync(join(tmpdir(), 'trash-'));
	const store = new MaFileStore(join(dir, 'maFiles'));
	store.save(ID, maFile());
	const credentials = new CredentialStore(join(dir, 'credentials.json'));
	credentials.set(ID, 'hunter2');
	const tokens = new TokenStore(join(dir, 'sessions.json'));
	tokens.set(ID, 'refresh');
	const trash = new Trash(join(dir, 'trash'));
	const accounts = new Accounts({
		spacingMs: 0,
		store,
		tokens,
		credentials,
		...(withTrash ? { trash } : {}),
		client: new ConfirmationsClient(async () => ({ status: 200, text: '{}' }), () => 1_700_000_000),
		steamNow: () => 1_700_000_000,
		mint: vi.fn(async () => 'access'),
		signInWithPassword: vi.fn(async () => 'refresh')
	});
	return { dir, store, credentials, tokens, trash, accounts };
}

describe('trash', () => {
	it('removing keeps the maFile and the password instead of deleting them', () => {
		const { accounts, store, credentials, trash } = setup();
		accounts.remove(ID);
		expect(store.has(ID)).toBe(false);
		expect(credentials.has(ID)).toBe(false);
		expect(accounts.get(ID)).toBeUndefined();
		const [entry] = trash.list();
		expect(entry).toMatchObject({ steamId: ID, name: 'olam', hasPassword: true });
		expect(trash.read(entry!.id)).toMatchObject({ steamId: ID, maFile: maFile(), password: 'hunter2' });
	});

	it('restoring puts the account and its password back and empties the entry', () => {
		const { accounts, store, credentials, trash } = setup();
		accounts.remove(ID);
		const id = trash.list()[0]!.id;
		expect(accounts.restore(id)).toBe(ID);
		expect(store.read(ID)).toBe(maFile());
		expect(credentials.get(ID)).toBe('hunter2');
		expect(accounts.get(ID)?.accountName).toBe('olam');
		expect(trash.list()).toEqual([]);
	});

	it('will not restore over an account that is already there', () => {
		const { accounts, store, trash } = setup();
		accounts.remove(ID);
		store.save(ID, maFile());
		accounts.reload();
		expect(() => accounts.restore(trash.list()[0]!.id)).toThrow('already in the app');
		expect(trash.list()).toHaveLength(1);
	});

	it('removes nothing when the copy cannot be made', () => {
		const { accounts, store, dir } = setup();
		// A file where the folder should be makes the copy fail.
		writeFileSync(join(dir, 'trash'), 'not a folder');
		expect(() => accounts.remove(ID)).toThrow('Nothing was removed');
		expect(store.has(ID)).toBe(true);
		expect(accounts.get(ID)).toBeDefined();
	});

	it('keeps several removals of the same account apart', () => {
		const { accounts, store, trash } = setup();
		accounts.remove(ID);
		store.save(ID, maFile());
		accounts.reload();
		accounts.remove(ID);
		expect(trash.list()).toHaveLength(2);
		expect(new Set(trash.list().map((e) => e.id)).size).toBe(2);
	});

	it('delete and empty only touch the trash', () => {
		const { accounts, trash, dir } = setup();
		accounts.remove(ID);
		const id = trash.list()[0]!.id;
		trash.discard(id);
		expect(trash.list()).toEqual([]);
		expect(readdirSync(join(dir, 'trash'))).toEqual([]);
		expect(trash.empty()).toBe(0);
	});

	it('refuses ids that are not entries', () => {
		const { trash } = setup();
		expect(() => trash.read('../../etc/passwd')).toThrow();
		expect(() => trash.discard('..\\..\\x')).toThrow();
	});

	it('without a trash, removing deletes as before', () => {
		const { accounts, store } = setup(false);
		accounts.remove(ID);
		expect(store.has(ID)).toBe(false);
	});

	it('an automatic import does not bring a trashed account back', () => {
		const { accounts, trash, dir } = setup();
		const src = join(dir, 'Downloads', 'maFiles');
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, `${ID}.maFile`), maFile());
		accounts.remove(ID);
		const store = new MaFileStore(join(dir, 'maFiles'));
		expect(importFolder(src, store, trash.steamIds()).added).toEqual([]);
		expect(store.has(ID)).toBe(false);
		expect(importFolder(src, store).added).toEqual(['olam']);
		expect(existsSync(join(dir, 'trash'))).toBe(true);
	});
});

describe('window position', () => {
	const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
	const min = { width: 640, height: 520 };

	it('keeps a sensible saved window as it was', () => {
		expect(fitWindowState({ x: 100, y: 80, width: 1000, height: 700, maximized: false }, screen, min)).toEqual({ x: 100, y: 80, width: 1000, height: 700, maximized: false });
	});
	it('drops the position when its screen is gone', () => {
		const r = fitWindowState({ x: 3000, y: 100, width: 1000, height: 700, maximized: true }, screen, min);
		expect(r).toEqual({ width: 1000, height: 700, maximized: true });
	});
	it('limits the size to the screen and the minimum', () => {
		expect(fitWindowState({ width: 9000, height: 100, maximized: false }, screen, min)).toMatchObject({ width: 1920, height: 520 });
	});
	it('starts at the default size with nothing saved', () => {
		expect(fitWindowState(undefined, screen, min)).toEqual({ width: 1040, height: 760, maximized: false });
	});
	it('survives a broken file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'win-'));
		const f = join(dir, 'window.json');
		expect(loadWindowState(f)).toBeUndefined();
		writeFileSync(f, '{nope');
		expect(loadWindowState(f)).toBeUndefined();
		saveWindowState(f, { x: 1, y: 2, width: 800, height: 600, maximized: false });
		expect(loadWindowState(f)).toEqual({ x: 1, y: 2, width: 800, height: 600, maximized: false });
	});
});
