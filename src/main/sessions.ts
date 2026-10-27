import { NetworkError, UserError } from './errors';
import { log } from './log';
import { generateCode } from './totp';
import { SecretFile, type Vault } from './vault';

/**
 * Web sessions for confirmations.
 *
 * Only a long-lived MobileApp refresh token is kept, never the password. A
 * short-lived access token is minted from it on demand. The token is either
 * taken from the maFile's own Session block (no sign-in needed) or obtained by
 * signing in once; sign-in codes are generated from the shared secret.
 */

export class SignInRequired extends Error {}

function payload(token: string): { aud?: unknown; exp?: unknown } | undefined {
	const seg = token.split('.')[1];
	if (!seg) return undefined;
	try {
		return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
	} catch {
		return undefined;
	}
}

export function tokenExpiry(token: string): number | undefined {
	const exp = payload(token)?.exp;
	return typeof exp === 'number' ? exp : undefined;
}

/** Usable = decodable, not expired, and scoped for the mobile app. */
export function isUsableMobileToken(token: string, nowSec: number): boolean {
	const p = payload(token);
	if (!p || typeof p.exp !== 'number' || p.exp <= nowSec) return false;
	const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
	// A web-scoped token looks valid but silently cannot drive confirmations.
	return aud.includes('mobile');
}

export function sessionCookie(steamId: string, accessToken: string): string {
	return `steamLoginSecure=${steamId}%7C%7C${encodeURIComponent(accessToken)}`;
}

/** Refresh tokens in one file, kept out of the maFiles so those stay untouched. Encrypted with the master password when there is one. */
export class TokenStore {
	private tokens: Record<string, string> = {};
	private readonly f: SecretFile;
	constructor(file: string, vault?: Vault) {
		this.f = new SecretFile(file, 'sessions', vault);
		this.reload();
	}
	get locked(): boolean {
		return this.f.locked;
	}
	reload(): void {
		this.tokens = {};
		try {
			const text = this.f.read();
			if (text) this.tokens = JSON.parse(text);
		} catch {
			this.tokens = {};
		}
	}
	get(steamId: string): string | undefined {
		const t = this.tokens[steamId];
		return typeof t === 'string' ? t : undefined;
	}
	set(steamId: string, token: string): void {
		this.save({ ...this.tokens, [steamId]: token });
	}
	delete(steamId: string): void {
		if (this.tokens[steamId] === undefined) return;
		const next = { ...this.tokens };
		delete next[steamId];
		this.save(next);
	}
	rewrite(plain = false): void {
		this.f.write(JSON.stringify(this.tokens), plain);
	}
	private save(next: Record<string, string>): void {
		this.f.write(JSON.stringify(next));
		this.tokens = next;
	}
}

const MINT_URL = 'https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/';

/** Exchange a refresh token for a short-lived access token. */
export async function mintAccessToken(
	refreshToken: string,
	steamId: string,
	nowSec: number,
	url = MINT_URL
): Promise<string> {
	if (!isUsableMobileToken(refreshToken, nowSec)) throw new SignInRequired('Session expired');
	const res = await fetch(url, {
		method: 'POST',
		body: new URLSearchParams({ refresh_token: refreshToken, steamid: steamId }),
		headers: { 'User-Agent': 'okhttp/3.12.12' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 401 || res.status === 403) throw new SignInRequired('Session rejected');
	if (!res.ok) throw new Error(`Steam answered HTTP ${res.status}`);
	let body: { response?: { access_token?: unknown } };
	try {
		body = (await res.json()) as typeof body;
	} catch {
		throw new Error('Steam returned something unreadable');
	}
	const token = body.response?.access_token;
	// A spent refresh token is answered with an empty response object and HTTP 200.
	if (typeof token !== 'string' || !isUsableMobileToken(token, nowSec)) {
		throw new SignInRequired('Session expired');
	}
	return token;
}

/**
 * Sign in once with the password and the generated guard code; returns the
 * refresh token. The password is used for this call only and never stored.
 */
export async function signIn(
	accountName: string,
	password: string,
	sharedSecret: string,
	steamNowSec: number
): Promise<string> {
	const { LoginSession, EAuthTokenPlatformType } = await import('steam-session');
	const session = new LoginSession(EAuthTokenPlatformType.MobileApp);
	return new Promise<string>((resolve, reject) => {
		let done = false;
		const finish = (fn: () => void): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			fn();
		};
		const fail = (message: string): void =>
			finish(() => {
				try {
					session.cancelLoginAttempt();
				} catch {
					/* already finished */
				}
				reject(new UserError(message));
			});
		const failNetwork = (): void =>
			finish(() => {
				try {
					session.cancelLoginAttempt();
				} catch {
					/* already finished */
				}
				reject(new NetworkError('Could not reach Steam'));
			});
		const timer = setTimeout(() => fail('Steam did not finish the sign-in in time'), 60_000);
		session.on('authenticated', () => finish(() => resolve(session.refreshToken)));
		session.on('timeout', () => fail('Steam did not finish the sign-in in time'));
		session.on('error', (err: Error) => {
			log.warn('sign-in', `${accountName}: steam-session error: ${err.message}`, err);
			NETWORK.test(err.message) ? failNetwork() : fail(err.message || 'Sign-in failed');
		});
		session
			.startWithCredentials({
				accountName,
				password,
				steamGuardCode: generateCode(sharedSecret, steamNowSec)
			})
			.then((r) => {
				if (r.actionRequired) fail('Steam wants an extra confirmation this app cannot do');
			})
			.catch((err: Error) => {
				log.warn('sign-in', `${accountName}: sign-in failed: ${err.message}`, err);
				NETWORK.test(err.message) ? failNetwork() : fail(friendly(err));
			});
	});
}

const NETWORK = /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|network/i;

function friendly(err: Error): string {
	const m = err.message || '';
	if (/InvalidPassword/i.test(m)) return 'Wrong password';
	if (/RateLimit|AccountLoginDeniedThrottle/i.test(m)) return 'Too many attempts. Try again later';
	if (/TwoFactorCodeMismatch/i.test(m)) return 'Steam rejected the generated code. Check your PC clock';
	return m || 'Sign-in failed';
}
