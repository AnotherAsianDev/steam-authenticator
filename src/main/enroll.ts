import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NetworkError, UserError } from './errors';
import { log } from './log';
import { parseMaFile } from './mafile';
import { deviceId } from './confirmations';
import type { MaFileStore } from './store';
import { generateCode } from './totp';

/**
 * Adding a Steam Guard Mobile Authenticator to an account that has none, and
 * writing the maFile for it.
 *
 * Two Steam calls, and the account changes at the FIRST one: from then on Steam
 * holds a new authenticator whose secrets it will never send again. So the
 * secrets are written to disk (`pending/`) before anything else happens, and the
 * revocation code is put in front of the user before activation. The maFile
 * moves into the real store only once Steam has accepted the activation.
 */

export type Step = 'credentials' | 'loginCode' | 'confirm' | 'activate' | 'done';

export interface EnrollState {
	step: Step;
	accountName?: string;
	steamId?: string;
	/** Where the sign-in code was sent, for the loginCode step. */
	codeFrom?: 'email';
	detail?: string;
	/** Masked phone number Steam texted, when it did. Otherwise the code arrives by email. */
	phoneHint?: string;
	revocationCode?: string;
	/** The pending authenticator already existed from an earlier attempt. */
	resumed?: boolean;
}

/** A sign-in in progress. Abstracted so it can be replaced in tests. */
export interface Login {
	start(accountName: string, password: string): Promise<{ needs: 'email' | 'device' | 'other' | null; detail?: string }>;
	submit(code: string): Promise<void>;
	done(): Promise<{ steamId: string; refreshToken: string }>;
	cancel(): void;
}

export interface Http {
	(url: string, body: Record<string, string>): Promise<{ status: number; text: string }>;
}

export interface EnrollDeps {
	store: MaFileStore;
	pendingDir: string;
	steamNow: () => number;
	newLogin: () => Login;
	mint: (refreshToken: string, steamId: string, nowSec: number) => Promise<string>;
	http: Http;
	onTokens: (steamId: string, refreshToken: string) => void;
	onPassword: (steamId: string, password: string) => void;
	onAdded: (steamId: string) => void;
}

const BASE = 'https://api.steampowered.com/ITwoFactorService';
const EResult = { ok: 1, noMatch: 9, duplicate: 29, rateLimited: 84 } as const;

const UNCERTAIN_ADD =
	'Steam was asked to add an authenticator and did not answer, so it is unknown whether it did. ' +
	'Check Steam Guard for this account in the Steam mobile app or on the account page before trying again. ' +
	'If an authenticator was added, Steam did not give its secrets to this app.';

export const httpPost: Http = async (url, body) => {
	const res = await fetch(url, {
		method: 'POST',
		body: new URLSearchParams(body),
		headers: { 'User-Agent': 'okhttp/3.12.12' },
		signal: AbortSignal.timeout(20_000)
	});
	return { status: res.status, text: await res.text() };
};

function parseResponse(text: string): Record<string, unknown> | undefined {
	try {
		const r = (JSON.parse(text) as { response?: unknown }).response;
		return typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}
const str = (o: Record<string, unknown>, k: string): string | undefined =>
	typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined;

/** A 20-byte base64 key, which is what Steam's secrets are. */
const validSecret = (s: string | undefined): s is string => !!s && Buffer.from(s, 'base64').length === 20;

export class Enrollment {
	private login: Login | undefined;
	private accountName = '';
	private steamId = '';
	private password = '';
	private savePassword = false;
	private refreshToken = '';
	private state: EnrollState = { step: 'credentials' };
	private busy = false;

	constructor(private readonly d: EnrollDeps) {}

	current(): EnrollState {
		return this.state;
	}

	private pendingPath(steamId: string): string {
		if (!/^\d{17}$/.test(steamId)) throw new UserError('Invalid SteamID');
		return join(this.d.pendingDir, `${steamId}.maFile`);
	}

	/** Run one step at a time; a double click must never send a Steam request twice. */
	private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
		if (this.busy) throw new UserError('Please wait, still working');
		this.busy = true;
		try {
			return await fn();
		} finally {
			this.busy = false;
		}
	}

	/** Forget an unfinished sign-in. Nothing on Steam has changed before the "confirm" step. */
	reset(): EnrollState {
		this.login?.cancel();
		this.login = undefined;
		this.password = '';
		this.refreshToken = '';
		this.state = { step: 'credentials' };
		return this.state;
	}

	async begin(accountName: string, password: string, savePassword: boolean): Promise<EnrollState> {
		return this.exclusive(async () => {
			this.reset();
			this.accountName = accountName.trim();
			if (!this.accountName || !password) throw new UserError('Enter the username and password');
			this.password = password;
			this.savePassword = savePassword;
			this.login = this.d.newLogin();
			const r = await this.login.start(this.accountName, password).catch((e) => this.failLogin(e));
			if (r.needs === 'device') {
				this.reset();
				throw new UserError('This account already has an authenticator. Import its maFile instead of adding a new one');
			}
			if (r.needs === 'other') {
				this.reset();
				throw new UserError('Steam wants a confirmation this app cannot do (for example approval in the Steam app)');
			}
			if (r.needs === 'email') {
				this.state = { step: 'loginCode', codeFrom: 'email', ...(r.detail ? { detail: r.detail } : {}) };
				return this.state;
			}
			return this.signedIn();
		});
	}

	async submitLoginCode(code: string): Promise<EnrollState> {
		return this.exclusive(async () => {
			if (this.state.step !== 'loginCode' || !this.login) throw new UserError('Nothing is waiting for a code');
			const c = code.trim();
			if (!c) throw new UserError('Enter the code');
			await this.login.submit(c).catch((e) => this.failLogin(e, false));
			return this.signedIn();
		});
	}

	private failLogin(err: unknown, reset = true): never {
		if (reset) this.reset();
		throw err instanceof UserError ? err : new UserError(err instanceof Error && err.message ? err.message : 'Sign-in failed');
	}

	private async signedIn(): Promise<EnrollState> {
		const { steamId, refreshToken } = await this.login!.done().catch((e) => this.failLogin(e));
		this.login = undefined;
		this.steamId = steamId;
		this.refreshToken = refreshToken;
		if (this.d.store.has(steamId)) {
			this.reset();
			throw new UserError('This account is already in the app');
		}
		const resumed = existsSync(this.pendingPath(steamId));
		let revocationCode: string | undefined;
		if (resumed) {
			try {
				revocationCode = parseMaFile(readFileSync(this.pendingPath(steamId), 'utf8')).revocationCode;
			} catch {
				/* unreadable pending file: shown without a code, the file itself is untouched */
			}
		}
		this.state = {
			step: resumed ? 'activate' : 'confirm',
			accountName: this.accountName,
			steamId,
			...(resumed ? { resumed: true } : {}),
			...(revocationCode ? { revocationCode } : {})
		};
		return this.state;
	}

	/** Ask Steam to attach the authenticator, and save the secrets before returning. */
	async addAuthenticator(): Promise<EnrollState> {
		return this.exclusive(async () => {
			if (this.state.step !== 'confirm') throw new UserError('Sign in first');
			const nowSec = this.d.steamNow();
			const token = await this.accessToken(nowSec);

			let res;
			try {
				res = await this.d.http(`${BASE}/AddAuthenticator/v1/?access_token=${encodeURIComponent(token)}`, {
					steamid: this.steamId,
					authenticator_time: String(nowSec),
					authenticator_type: '1',
					device_identifier: deviceId(this.steamId),
					sms_phone_id: '1'
				});
			} catch {
				// The request may have gone out: never suggest that nothing happened.
				this.reset();
				throw new UserError(UNCERTAIN_ADD);
			}
			const body = parseResponse(res.text);
			log.info('enroll', `AddAuthenticator for ${this.accountName}: HTTP ${res.status}, status=${String(body?.['status'])}, fields=${body ? Object.keys(body).join(',') : 'unreadable'}`);
			if (!body) {
				this.reset();
				throw new UserError(UNCERTAIN_ADD);
			}

			const shared = str(body, 'shared_secret');
			const identity = str(body, 'identity_secret');
			const revocation = str(body, 'revocation_code');
			const status = typeof body['status'] === 'number' ? (body['status'] as number) : undefined;

			if (!shared && !identity && !revocation) {
				this.reset();
				if (status === EResult.duplicate) {
					throw new UserError('This account already has an authenticator. Import its maFile instead');
				}
				if (status === EResult.noMatch) {
					throw new UserError(
						'Steam refused (EResult 9). The usual cause is an account without a confirmed phone number or email. Check that in Steam first'
					);
				}
				if (status === EResult.rateLimited) throw new UserError('Steam is rate-limiting this account. Wait a while');
				if (status === EResult.ok) {
					throw new UserError(
						'Steam said OK but sent no secrets. The account may now carry an authenticator nobody can use. Contact Steam Support before trying again'
					);
				}
				throw new UserError(status === undefined ? UNCERTAIN_ADD : `Steam refused (EResult ${status}). Nothing was added`);
			}
			if (!validSecret(shared) || !validSecret(identity)) {
				// Keep whatever arrived: it is the only copy there will ever be.
				this.keepRaw(res.text);
				this.reset();
				throw new UserError(
					`Steam sent an incomplete authenticator. The raw reply was kept in ${this.d.pendingDir}. Do not retry; contact Steam Support${revocation ? ` and quote revocation code ${revocation}` : ''}`
				);
			}

			const maFile = this.buildMaFile(body, shared, identity, revocation);
			try {
				this.writePending(maFile);
			} catch {
				this.reset();
				throw new UserError(
					`The authenticator was added but this app could not save it. Revocation code: ${revocation ?? 'unknown'}. Write it down and remove the authenticator in Steam`
				);
			}

			const phoneHint = str(body, 'phone_number_hint');
			this.state = {
				step: 'activate',
				accountName: this.accountName,
				steamId: this.steamId,
				...(phoneHint ? { phoneHint } : {}),
				...(revocation ? { revocationCode: revocation } : {})
			};
			return this.state;
		});
	}

	/** Confirm with the code Steam texted or emailed. Moves the maFile into the store on success. */
	async activate(code: string): Promise<EnrollState> {
		return this.exclusive(async () => {
			if (this.state.step !== 'activate') throw new UserError('Nothing is waiting for activation');
			const activation = code.trim();
			if (!activation) throw new UserError('Enter the code from Steam');
			const pending = parseMaFile(readFileSync(this.pendingPath(this.steamId), 'utf8'));
			const token = await this.accessToken(this.d.steamNow());
			const hadPhone = !!this.state.phoneHint || /phone_number_hint"\s*:\s*"[^"]/.test(pending.raw);

			for (let attempt = 0; attempt < 3; attempt++) {
				const t = this.d.steamNow();
				let res;
				try {
					res = await this.d.http(`${BASE}/FinalizeAddAuthenticator/v1/?access_token=${encodeURIComponent(token)}`, {
						steamid: this.steamId,
						authenticator_code: generateCode(pending.sharedSecret, t),
						authenticator_time: String(t),
						activation_code: activation,
						...(hadPhone ? { validate_sms_code: '1' } : {})
					});
				} catch {
					throw new NetworkError(
						'No answer from Steam. It may or may not have activated: check Steam Guard in the Steam app before retrying. The secrets are safe in the pending folder'
					);
				}
				const body = parseResponse(res.text);
				log.info('enroll', `FinalizeAddAuthenticator for ${this.accountName}: HTTP ${res.status}, success=${String(body?.['success'])}, status=${String(body?.['status'])}, want_more=${String(body?.['want_more'])}`);
				if (!body) throw new UserError('Steam sent an unreadable answer. Check Steam Guard in the Steam app before retrying');
				if (body['want_more'] === true) {
					// Steam wants a code from the next window as well.
					await new Promise((r) => setTimeout(r, 31_000));
					continue;
				}
				if (body['success'] === true) return this.finish(pending.raw);
				const status = typeof body['status'] === 'number' ? (body['status'] as number) : undefined;
				if (status === EResult.rateLimited) throw new UserError('Steam is rate-limiting this account. Wait a few minutes, then use the newest code');
				throw new UserError(
					'Steam did not accept the code. Check for typos, use the newest one (they expire quickly), then try again'
				);
			}
			throw new UserError('Steam kept asking for more codes. Try again in a minute');
		});
	}

	private finish(raw: string): EnrollState {
		const parsed = parseMaFile(raw);
		// Active on Steam from here on, so mark it so and move it into the real store.
		this.d.store.save(this.steamId, raw);
		rmSync(this.pendingPath(this.steamId), { force: true });
		this.d.onTokens(this.steamId, this.refreshToken);
		if (this.savePassword && this.password) this.d.onPassword(this.steamId, this.password);
		this.d.onAdded(this.steamId);
		this.password = '';
		this.state = {
			step: 'done',
			accountName: this.accountName,
			steamId: this.steamId,
			...(parsed.revocationCode ? { revocationCode: parsed.revocationCode } : {})
		};
		return this.state;
	}

	/** Remove the not-yet-activated authenticator again, using its revocation code. */
	async cancelPending(): Promise<EnrollState> {
		return this.exclusive(async () => {
			if (this.state.step !== 'activate') throw new UserError('Nothing to cancel');
			const pending = parseMaFile(readFileSync(this.pendingPath(this.steamId), 'utf8'));
			if (!pending.revocationCode) throw new UserError('No revocation code saved, cannot remove it from here');
			const token = await this.accessToken(this.d.steamNow());
			let res;
			try {
				res = await this.d.http(`${BASE}/RemoveAuthenticator/v1/?access_token=${encodeURIComponent(token)}`, {
					steamid: this.steamId,
					revocation_code: pending.revocationCode,
					steamguard_scheme: '1'
				});
			} catch {
				throw new NetworkError('Could not reach Steam. Nothing was changed on this side');
			}
			if (parseResponse(res.text)?.['success'] !== true) {
				throw new UserError(
					`Steam did not remove it. Revocation code: ${pending.revocationCode}. It stays saved in the pending folder`
				);
			}
			rmSync(this.pendingPath(this.steamId), { force: true });
			return this.reset();
		});
	}

	private async accessToken(nowSec: number): Promise<string> {
		try {
			return await this.d.mint(this.refreshToken, this.steamId, nowSec);
		} catch {
			this.reset();
			throw new UserError('Sign-in expired, start again');
		}
	}

	private buildMaFile(body: Record<string, unknown>, shared: string, identity: string, revocation?: string): string {
		const keep = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
		const obj = {
			shared_secret: shared,
			serial_number: keep('serial_number'),
			revocation_code: revocation ?? '',
			uri: keep('uri'),
			server_time: String(body['server_time'] ?? this.d.steamNow()),
			account_name: keep('account_name') || this.accountName,
			token_gid: keep('token_gid'),
			identity_secret: identity,
			secret_1: keep('secret_1'),
			status: typeof body['status'] === 'number' ? body['status'] : 1,
			device_id: deviceId(this.steamId),
			phone_number_hint: keep('phone_number_hint'),
			confirm_type: 1,
			fully_enrolled: true,
			Session: { SteamID: this.steamId, RefreshToken: this.refreshToken }
		};
		// SDA reads SteamID as a number; write it as one without losing precision.
		return JSON.stringify(obj, null, 2).replace(/"SteamID": "(\d{17})"/, '"SteamID": $1');
	}

	private writePending(text: string): void {
		mkdirSync(this.d.pendingDir, { recursive: true });
		const target = this.pendingPath(this.steamId);
		const tmp = `${target}.tmp`;
		writeFileSync(tmp, text, { mode: 0o600 });
		renameSync(tmp, target);
		try {
			chmodSync(target, 0o600);
		} catch {
			/* best effort on Windows */
		}
	}

	private keepRaw(text: string): void {
		try {
			mkdirSync(this.d.pendingDir, { recursive: true });
			writeFileSync(join(this.d.pendingDir, `${this.steamId}.incomplete.json`), text, { mode: 0o600 });
		} catch {
			/* nothing more can be done */
		}
	}
}

/** Real sign-in through steam-session, using the mobile platform so the token works for the authenticator calls. */
export function steamLogin(): Login {
	let session: import('steam-session').LoginSession | undefined;
	let authenticated: Promise<void> | undefined;
	const NETWORK = /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|network/i;
	const friendly = (err: unknown): UserError => {
		const m = err instanceof Error ? err.message : String(err);
		if (NETWORK.test(m)) return new NetworkError('Could not reach Steam');
		if (/InvalidPassword/i.test(m)) return new UserError('Wrong username or password');
		if (/RateLimit|AccountLoginDeniedThrottle/i.test(m)) return new UserError('Too many attempts. Try again later');
		if (/TwoFactorCodeMismatch|InvalidLoginAuthCode|ExpiredLoginAuthCode/i.test(m)) return new UserError('Steam rejected that code');
		return new UserError(m || 'Sign-in failed');
	};
	return {
		async start(accountName, password) {
			const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } = await import('steam-session');
			const s = new LoginSession(EAuthTokenPlatformType.MobileApp);
			session = s;
			authenticated = new Promise<void>((resolve, reject) => {
				s.on('authenticated', () => resolve());
				s.on('timeout', () => reject(new UserError('Steam did not finish the sign-in in time')));
				s.on('error', (e: Error) => reject(e));
			});
			authenticated.catch(() => undefined);
			try {
				const r = await s.startWithCredentials({ accountName, password });
				if (!r.actionRequired) return { needs: null };
				const types = (r.validActions ?? []).map((a) => a.type);
				const email = (r.validActions ?? []).find((a) => a.type === EAuthSessionGuardType.EmailCode);
				if (email) return { needs: 'email', ...(email.detail ? { detail: email.detail } : {}) };
				if (types.includes(EAuthSessionGuardType.DeviceCode) || types.includes(EAuthSessionGuardType.DeviceConfirmation)) {
					return { needs: 'device' };
				}
				return { needs: 'other' };
			} catch (e) {
				throw friendly(e);
			}
		},
		async submit(code) {
			try {
				await session!.submitSteamGuardCode(code);
			} catch (e) {
				throw friendly(e);
			}
		},
		async done() {
			try {
				await Promise.race([
					authenticated!,
					new Promise<never>((_, rej) => setTimeout(() => rej(new UserError('Steam did not finish the sign-in in time')), 60_000).unref())
				]);
			} catch (e) {
				throw friendly(e);
			}
			return { steamId: session!.steamID.getSteamID64(), refreshToken: session!.refreshToken };
		},
		cancel() {
			try {
				session?.cancelLoginAttempt();
			} catch {
				/* already finished */
			}
		}
	};
}
