import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Enrollment, type Http, type Login } from '../src/main/enroll';
import { parseMaFile } from '../src/main/mafile';
import { MaFileStore } from '../src/main/store';

const ID = '76561198000000001';
const secret = (n: number): string => Buffer.alloc(20, n).toString('base64');

function login(needs: 'email' | null = null, fail?: string): Login {
	return {
		async start() {
			if (fail) throw new Error(fail);
			return { needs, ...(needs ? { detail: 'example.com' } : {}) };
		},
		async submit(code) {
			if (code !== '12345') throw new Error('Steam rejected that code');
		},
		async done() {
			return { steamId: ID, refreshToken: 'refresh' };
		},
		cancel() {}
	};
}

function setup(http: Http, needs: 'email' | null = null) {
	const dir = mkdtempSync(join(tmpdir(), 'enroll-'));
	const store = new MaFileStore(join(dir, 'maFiles'));
	const calls: { url: string; body: Record<string, string> }[] = [];
	const events: string[] = [];
	const e = new Enrollment({
		store,
		pendingDir: join(dir, 'pending'),
		steamNow: () => 1_700_000_000,
		newLogin: () => login(needs),
		mint: async () => 'access',
		http: async (url, body) => {
			calls.push({ url, body });
			return http(url, body);
		},
		onTokens: (id) => events.push(`tokens:${id}`),
		onPassword: (id) => events.push(`pw:${id}`),
		onAdded: (id) => events.push(`added:${id}`)
	});
	return { e, store, dir, calls, events };
}

const addOk = {
	response: {
		shared_secret: secret(1),
		identity_secret: secret(2),
		revocation_code: 'R12345',
		serial_number: '999',
		token_gid: 'gid',
		uri: 'otpauth://x',
		secret_1: 'abc',
		server_time: '1700000000',
		account_name: 'alice',
		phone_number_hint: '42',
		status: 1
	}
};
const respond = (o: unknown) => ({ status: 200, text: JSON.stringify(o) });

describe('enrollment', () => {
	it('saves secrets before activation and only then adds the account', async () => {
		let pendingAtFinalize = false;
		const ctx = setup(async (url) => {
			if (url.includes('/AddAuthenticator/')) return respond(addOk);
			pendingAtFinalize = existsSync(join(ctx.dir, 'pending', `${ID}.maFile`)) && !ctx.store.has(ID);
			return respond({ response: { success: true } });
		});
		await ctx.e.begin('alice', 'pw', true);
		expect(ctx.e.current().step).toBe('confirm');
		const added = await ctx.e.addAuthenticator();
		expect(added).toMatchObject({ step: 'activate', revocationCode: 'R12345', phoneHint: '42' });
		expect(ctx.store.has(ID)).toBe(false);
		expect(existsSync(join(ctx.dir, 'pending', `${ID}.maFile`))).toBe(true);

		const done = await ctx.e.activate('A1B2C');
		expect(done).toMatchObject({ step: 'done', revocationCode: 'R12345' });
		expect(pendingAtFinalize).toBe(true);
		expect(existsSync(join(ctx.dir, 'pending', `${ID}.maFile`))).toBe(false);

		const parsed = parseMaFile(ctx.store.read(ID));
		expect(parsed).toMatchObject({ steamId: ID, accountName: 'alice', revocationCode: 'R12345', refreshToken: 'refresh' });
		// SDA reads SteamID as a number.
		expect(ctx.store.read(ID)).toMatch(/"SteamID": 76561198000000001/);
		expect(ctx.events).toEqual([`tokens:${ID}`, `pw:${ID}`, `added:${ID}`]);
		const fin = ctx.calls.find((c) => c.url.includes('Finalize'))!;
		expect(fin.body).toMatchObject({ activation_code: 'A1B2C', validate_sms_code: '1', steamid: ID });
		expect(fin.body['authenticator_code']).toMatch(/^[2-9BCDFGHJKMNPQRTVWXY]{5}$/);
	});

	it('does not save the password unless asked', async () => {
		const ctx = setup(async (url) => respond(url.includes('/AddAuthenticator/') ? addOk : { response: { success: true } }));
		await ctx.e.begin('alice', 'pw', false);
		await ctx.e.addAuthenticator();
		await ctx.e.activate('X');
		expect(ctx.events).not.toContain(`pw:${ID}`);
	});

	it('asks for the emailed sign-in code first', async () => {
		const ctx = setup(async () => respond(addOk), 'email');
		expect((await ctx.e.begin('alice', 'pw', false)).step).toBe('loginCode');
		await expect(ctx.e.submitLoginCode('nope')).rejects.toThrow('rejected');
		expect((await ctx.e.submitLoginCode('12345')).step).toBe('confirm');
	});

	it('keeps the pending file when activation is refused, and lets the user retry', async () => {
		let ok = false;
		const ctx = setup(async (url) => (url.includes('/AddAuthenticator/') ? respond(addOk) : respond({ response: { success: ok } })));
		await ctx.e.begin('alice', 'pw', false);
		await ctx.e.addAuthenticator();
		await expect(ctx.e.activate('BAD')).rejects.toThrow('did not accept');
		expect(existsSync(join(ctx.dir, 'pending', `${ID}.maFile`))).toBe(true);
		expect(ctx.store.has(ID)).toBe(false);
		ok = true;
		expect((await ctx.e.activate('GOOD')).step).toBe('done');
	});

	it('resumes an unfinished enrollment without asking Steam to add another', async () => {
		const first = setup(async () => respond(addOk));
		await first.e.begin('alice', 'pw', false);
		await first.e.addAuthenticator();
		// New app run: same folders, fresh object.
		const calls: string[] = [];
		const again = new Enrollment({
			store: first.store,
			pendingDir: join(first.dir, 'pending'),
			steamNow: () => 1_700_000_000,
			newLogin: () => login(),
			mint: async () => 'access',
			http: async (url) => {
				calls.push(url);
				return respond({ response: { success: true } });
			},
			onTokens: () => {},
			onPassword: () => {},
			onAdded: () => {}
		});
		const s = await again.begin('alice', 'pw', false);
		expect(s).toMatchObject({ step: 'activate', resumed: true, revocationCode: 'R12345' });
		await again.activate('CODE');
		expect(calls.every((u) => u.includes('Finalize'))).toBe(true);
		expect(first.store.has(ID)).toBe(true);
	});

	it('reports an existing authenticator clearly and changes nothing', async () => {
		const ctx = setup(async () => respond({ response: { status: 29 } }));
		await ctx.e.begin('alice', 'pw', false);
		await expect(ctx.e.addAuthenticator()).rejects.toThrow('already has an authenticator');
		expect(existsSync(join(ctx.dir, 'pending'))).toBe(false);
	});

	it('keeps the raw reply when Steam sends unusable secrets', async () => {
		const bad = { response: { ...addOk.response, shared_secret: 'short' } };
		const ctx = setup(async () => respond(bad));
		await ctx.e.begin('alice', 'pw', false);
		await expect(ctx.e.addAuthenticator()).rejects.toThrow('incomplete');
		expect(readdirSync(join(ctx.dir, 'pending'))).toEqual([`${ID}.incomplete.json`]);
		expect(ctx.store.has(ID)).toBe(false);
	});

	it('does not claim nothing happened when the add request gets no answer', async () => {
		const ctx = setup(async () => {
			throw new Error('socket hang up');
		});
		await ctx.e.begin('alice', 'pw', false);
		await expect(ctx.e.addAuthenticator()).rejects.toThrow('unknown whether it did');
	});

	it('cancel removes the authenticator with the revocation code', async () => {
		const ctx = setup(async (url) => (url.includes('/AddAuthenticator/') ? respond(addOk) : respond({ response: { success: true } })));
		await ctx.e.begin('alice', 'pw', false);
		await ctx.e.addAuthenticator();
		await ctx.e.cancelPending();
		const rm = ctx.calls.find((c) => c.url.includes('RemoveAuthenticator'))!;
		expect(rm.body).toMatchObject({ revocation_code: 'R12345', steamguard_scheme: '1' });
		expect(existsSync(join(ctx.dir, 'pending', `${ID}.maFile`))).toBe(false);
	});

	it('refuses an account that is already in the app', async () => {
		const ctx = setup(async () => respond(addOk));
		ctx.store.save(ID, readFileSync(new URL('./fixture.json', import.meta.url), 'utf8').replace('ID', ID));
		await expect(ctx.e.begin('alice', 'pw', false)).rejects.toThrow('already in the app');
	});
});
