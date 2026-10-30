import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../src/main/accounts';
import { ConfirmationError, ConfirmationsClient, type Transport } from '../src/main/confirmations';
import { SignInRequired, TokenStore } from '../src/main/sessions';
import { MaFileStore } from '../src/main/store';
import { CredentialStore } from '../src/main/credentials';
import { NetworkError, UserError } from '../src/main/errors';
import { normalizeStoreFolder } from '../src/main/autoimport';
import { FolderWatcher } from '../src/main/watcher';
import { importFolder, findMaFileFolders } from '../src/main/autoimport';
import { mkdirSync, writeFileSync } from 'node:fs';

const SEC = Buffer.from('0123456789abcdef0123').toString('base64');
const ID = '76561198000000001';
const maFile = (id = ID, extra = '') => `{"shared_secret":"${SEC}","identity_secret":"${SEC}","account_name":"olam","revocation_code":"R12345","Session":{"SteamID":${id}${extra}}}`;
const trade = (id: string, type = 2) => ({ id, nonce: `n${id}`, type, headline: `Trade ${id}` });

function setup(opts: { mintFails?: boolean; listBody?: unknown; signInFails?: boolean; offline?: boolean } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'acc-'));
	const store = new MaFileStore(join(dir, 'maFiles'));
	store.save(ID, maFile());
	const tokens = new TokenStore(join(dir, 'sessions.json'));
	const calls: string[] = [];
	const transport: Transport = async (req) => {
		calls.push(`${req.method} ${new URL(req.url).pathname}`);
		return { status: 200, text: JSON.stringify(req.method === 'GET' ? (opts.listBody ?? { success: true, conf: [trade('1'), trade('2')] }) : { success: true }) };
	};
	let now = 1_700_000_000;
	const mint = vi.fn(async (_r: string, _id: string, _n: number) => {
		if (opts.mintFails) throw new SignInRequired('x');
		return 'access';
	});
	const credentials = new CredentialStore(join(dir, 'credentials.json'));
	const signInWithPassword = vi.fn(async () => {
		if (opts.offline) throw new NetworkError('Could not reach Steam');
		if (opts.signInFails) throw new UserError('Wrong password');
		return 'refresh-from-signin';
	});
	const accounts = new Accounts({
		spacingMs: 0,
		store, tokens, mint, credentials,
		client: new ConfirmationsClient(transport, () => now),
		steamNow: () => now,
		signInWithPassword
	});
	// After a sign-in the minted token works; before it, minting fails (when mintFails is set).
	if (opts.mintFails) mint.mockImplementation(async (r: string) => { if (r === 'refresh-from-signin') return 'access'; throw new SignInRequired('x'); });
	return { accounts, calls, tokens, mint, credentials, signInWithPassword, dir, advance: (s: number) => (now += s) };
}

describe('accounts', () => {
	it('parses revocation code and keeps the id exact', () => {
		expect(setup().accounts.get(ID)?.revocationCode).toBe('R12345');
	});
	it('reports "sign in needed" when no usable session exists', async () => {
		const { accounts } = setup({ mintFails: true });
		expect((await accounts.refresh(ID)).state).toBe('signin');
	});
	it('lists pending confirmations once a token can be minted', async () => {
		const { accounts, tokens } = setup();
		tokens.set(ID, 'refresh');
		const s = await accounts.refresh(ID);
		expect(s.state).toBe('ok');
		expect(s.items.map((c) => c.id)).toEqual(['1', '2']);
	});
	it('accepts only the chosen confirmations, then refreshes', async () => {
		const { accounts, tokens, calls } = setup();
		tokens.set(ID, 'refresh');
		await accounts.refresh(ID);
		await accounts.act(ID, 'accept', ['2']);
		expect(calls).toEqual(['GET /mobileconf/getlist', 'POST /mobileconf/multiajaxop', 'GET /mobileconf/getlist']);
	});
	it('refuses ids that are not in the current list', async () => {
		const { accounts, tokens } = setup();
		tokens.set(ID, 'refresh');
		await accounts.refresh(ID);
		await expect(accounts.act(ID, 'deny', ['999'])).rejects.toThrow(/changed/);
	});
	it('refetches a stale list before acting', async () => {
		const { accounts, tokens, calls, advance } = setup();
		tokens.set(ID, 'refresh');
		await accounts.refresh(ID);
		advance(200);
		await accounts.act(ID, 'deny', ['1']);
		expect(calls.filter((c) => c.startsWith('GET')).length).toBe(3);
	});
	it('signing in stores only the refresh token', async () => {
		const { accounts, tokens } = setup();
		await accounts.signIn(ID, 'pw');
		expect(tokens.get(ID)).toBe('refresh-from-signin');
	});
	it('surfaces account recovery and blocks batching it', async () => {
		const { accounts, tokens } = setup({ listBody: { success: true, conf: [trade('1'), trade('2', 6)] } });
		tokens.set(ID, 'refresh');
		await accounts.refresh(ID);
		await expect(accounts.act(ID, 'accept', ['1', '2'])).rejects.toBeInstanceOf(ConfirmationError);
	});
});

describe('saved passwords', () => {
	it('signs in automatically with the saved password when a session is missing', async () => {
		const { accounts, credentials, signInWithPassword, tokens } = setup({ mintFails: true });
		credentials.set(ID, 'hunter2');
		const s = await accounts.refresh(ID);
		expect(signInWithPassword).toHaveBeenCalledWith('olam', 'hunter2', SEC, expect.any(Number));
		expect(tokens.get(ID)).toBe('refresh-from-signin');
		expect(s.state).toBe('ok');
	});
	it('does not retry a rejected saved password on every poll', async () => {
		const { accounts, credentials, signInWithPassword, advance } = setup({ mintFails: true, signInFails: true });
		credentials.set(ID, 'wrong');
		const first = await accounts.refresh(ID);
		expect(first.state).toBe('signin');
		expect(first.message).toMatch(/Wrong password/);
		await accounts.refresh(ID);
		expect(signInWithPassword).toHaveBeenCalledTimes(1);
		advance(1900);
		await accounts.refresh(ID);
		expect(signInWithPassword).toHaveBeenCalledTimes(2);
	});
	it('does not blame the password or back off when Steam is unreachable', async () => {
		const { accounts, credentials, signInWithPassword } = setup({ mintFails: true, offline: true });
		credentials.set(ID, 'right');
		const first = await accounts.refresh(ID);
		expect(first.state).toBe('error');
		expect(first.message).toBe('Could not reach Steam');
		await accounts.refresh(ID);
		expect(signInWithPassword).toHaveBeenCalledTimes(2);
	});
	it('refuses a wrong password and does not save it', async () => {
		const { accounts, credentials } = setup({ mintFails: true, signInFails: true });
		await expect(accounts.setPassword(ID, 'wrong')).rejects.toThrow('Wrong password');
		expect(credentials.has(ID)).toBe(false);
	});
	it('saves a working password, keeps the session and refreshes', async () => {
		const { accounts, credentials, tokens } = setup({ mintFails: true });
		await expect(accounts.setPassword(ID, 'right')).resolves.toBe('verified');
		expect(credentials.get(ID)).toBe('right');
		expect(tokens.get(ID)).toBe('refresh-from-signin');
	});
	it('saves but reports unchecked when offline', async () => {
		const { accounts, credentials } = setup({ mintFails: true, offline: true });
		await expect(accounts.setPassword(ID, 'maybe')).resolves.toBe('unverified');
		expect(credentials.get(ID)).toBe('maybe');
	});
	it('asks for a password when none is saved, without calling Steam', async () => {
		const { accounts, signInWithPassword } = setup({ mintFails: true });
		expect((await accounts.refresh(ID)).state).toBe('signin');
		expect(signInWithPassword).not.toHaveBeenCalled();
	});
	it('signIn can save the typed password, and remove deletes it', async () => {
		const { accounts, credentials } = setup();
		await accounts.signIn(ID, 'typed', true);
		expect(credentials.get(ID)).toBe('typed');
		accounts.remove(ID);
		expect(credentials.get(ID)).toBeUndefined();
	});
	it('stores nothing unless asked', async () => {
		const { accounts, credentials } = setup();
		await accounts.signIn(ID, 'typed', false);
		expect(credentials.has(ID)).toBe(false);
	});
	it('persists to a plain file the user can inspect', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cred-'));
		const f = join(dir, 'credentials.json');
		new CredentialStore(f).set(ID, 'pw');
		expect(new CredentialStore(f).get(ID)).toBe('pw');
	});
});

describe('dropping maFiles into the app folder', () => {
	const fresh = () => new MaFileStore(join(mkdtempSync(join(tmpdir(), 'drop-')), 'maFiles'));
	it('renames any valid dropped file to <steamid>.maFile', () => {
		const store = fresh();
		mkdirSync(store.dir, { recursive: true });
		writeFileSync(join(store.dir, 'my account (1).maFile'), maFile());
		const r = normalizeStoreFolder(store);
		expect(r.added).toEqual(['olam']);
		expect(store.list()).toEqual([ID]);
		expect(require('node:fs').readdirSync(store.dir)).toEqual([`${ID}.maFile`]);
	});
	it('ignores the manifest and temp files, reports broken files, never overwrites', () => {
		const store = fresh();
		mkdirSync(store.dir, { recursive: true });
		store.save(ID, maFile(ID, ',"X":1'));
		writeFileSync(join(store.dir, 'manifest.json'), '{"entries":[]}');
		writeFileSync(join(store.dir, `${ID}.maFile.tmp`), 'partial');
		writeFileSync(join(store.dir, 'broken.maFile'), 'nope');
		writeFileSync(join(store.dir, 'copy-of-it.maFile'), maFile());
		const r = normalizeStoreFolder(store);
		expect(r.added).toEqual([]);
		expect(r.duplicates).toEqual(['copy-of-it.maFile']);
		expect(r.failed.map((f) => f.file)).toEqual(['broken.maFile']);
		expect(store.read(ID)).toContain('"X":1');
	});
	it('the watcher reports a new file once things settle', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'watch-'));
		const seen: string[] = [];
		const w = new FolderWatcher((d) => seen.push(d), 150);
		w.setFolders([dir]);
		writeFileSync(join(dir, 'a.maFile'), '1');
		writeFileSync(join(dir, 'a.maFile'), '12');
		await new Promise((r) => setTimeout(r, 900));
		w.close();
		expect(seen).toEqual([dir]);
	});
});

describe('auto-import', () => {
	it('copies new accounts, skips existing ones and the manifest, never overwrites', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sda-'));
		const src = join(dir, 'Downloads', 'SDA', 'maFiles');
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, `${ID}.maFile`), maFile());
		writeFileSync(join(src, 'manifest.json'), '{"entries":[]}');
		writeFileSync(join(src, 'broken.maFile'), 'nope');
		expect(findMaFileFolders([join(dir, 'Downloads')])).toEqual([src]);

		const store = new MaFileStore(join(dir, 'app'));
		const first = importFolder(src, store);
		expect(first.added).toEqual(['olam']);
		expect(first.failed).toHaveLength(1);
		store.save(ID, maFile(ID, ',"X":1'));
		const second = importFolder(src, store);
		expect(second.added).toEqual([]);
		expect(second.skipped).toBe(1);
		expect(store.read(ID)).toContain('"X":1');
	});
});

describe('check rounds are gentle', () => {
	const multi = (statusFor: (n: number) => number) => {
		const dir = mkdtempSync(join(tmpdir(), 'acc-'));
		const store = new MaFileStore(join(dir, 'maFiles'));
		const ids = ['76561198000000001', '76561198000000002', '76561198000000003'];
		const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
		const jwt = `${b64({ alg: 'none' })}.${b64({ aud: ['mobile'], exp: 4_000_000_000 })}.x`;
		const tokens = new TokenStore(join(dir, 's.json'));
		for (const id of ids) {
			store.save(id, maFile(id));
			tokens.set(id, jwt);
		}
		let n = 0;
		const calls: string[] = [];
		const transport: Transport = async (req) => {
			if (req.method === 'GET') calls.push(req.url);
			n++;
			return { status: statusFor(n), text: JSON.stringify({ success: true, conf: [] }) };
		};
		let now = 1_700_000_000;
		const accounts = new Accounts({
			spacingMs: 0,
			store,
			tokens,
			credentials: new CredentialStore(join(dir, 'c.json')),
			client: new ConfirmationsClient(transport, () => now),
			steamNow: () => now,
			mint: async () => 'access',
			signInWithPassword: async () => 'x'
		});
		return { accounts, calls, advance: (s: number) => (now += s) };
	};

	it('stops the whole round when Steam rate-limits', async () => {
		const { accounts, calls } = multi((n) => (n >= 2 ? 429 : 200));
		await accounts.refreshAll();
		expect(calls.length).toBe(2);
		expect(accounts.status('76561198000000003').message).toMatch(/Paused/);
	});

	it('ignores a second round started right after the first', async () => {
		const { accounts, calls, advance } = multi(() => 200);
		await accounts.refreshAll();
		await accounts.refreshAll();
		expect(calls.length).toBe(3);
		advance(90);
		await accounts.refreshAll();
		expect(calls.length).toBe(6);
	});
});

describe('restarts do not repeat requests', () => {
	it('reuses the last result and the access token after a restart', async () => {
		const { StateCache } = await import('../src/main/statecache');
		const dir = mkdtempSync(join(tmpdir(), 'acc-'));
		const store = new MaFileStore(join(dir, 'maFiles'));
		store.save(ID, maFile());
		const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
		const jwt = (exp: number) => `${b64({ alg: 'none' })}.${b64({ aud: ['mobile'], exp })}.x`;
		const tokens = new TokenStore(join(dir, 's.json'));
		tokens.set(ID, jwt(4_000_000_000));
		let now = 1_700_000_000;
		const calls: string[] = [];
		const mint = vi.fn(async () => jwt(now + 3600));
		const make = () =>
			new Accounts({
				spacingMs: 0,
				store,
				tokens,
				credentials: new CredentialStore(join(dir, 'c.json')),
				cache: new StateCache(join(dir, 'cache.json')),
				client: new ConfirmationsClient(async (req) => {
					calls.push(req.method);
					return { status: 200, text: JSON.stringify({ success: true, conf: [trade('1')] }) };
				}, () => now),
				steamNow: () => now,
				mint,
				signInWithPassword: async () => 'x'
			});
		await make().refreshAll(600);
		expect(calls).toEqual(['GET']);
		expect(mint).toHaveBeenCalledTimes(1);

		now += 120; // restart two minutes later
		const again = make();
		expect(again.status(ID)).toMatchObject({ state: 'ok', items: [{ id: '1' }] });
		await again.refreshAll(600);
		expect(calls).toEqual(['GET']); // recent enough: nothing asked

		now += 700; // much later: asks again, but reuses the saved access token
		await make().refreshAll(600);
		expect(calls).toEqual(['GET', 'GET']);
		expect(mint).toHaveBeenCalledTimes(1);
	});

	it('counts the days left on a saved sign-in, but only without a saved password', () => {
		const { accounts, tokens, credentials, advance } = setup();
		const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ aud: ['mobile'], exp })).toString('base64url')}.y`;
		expect(accounts.sessionDaysLeft(ID)).toBeUndefined();
		tokens.set(ID, jwt(1_700_000_000 + 5 * 86400 + 100));
		expect(accounts.sessionDaysLeft(ID)).toBe(5);
		advance(2 * 86400);
		expect(accounts.sessionDaysLeft(ID)).toBe(3);
		credentials.set(ID, 'pw');
		expect(accounts.sessionDaysLeft(ID)).toBeUndefined();
	});
});
