import { NetworkError, UserError } from './errors';
import { log } from './log';
import { ConfirmationError, type Action, type Confirmation, type ConfirmationsClient } from './confirmations';
import type { CredentialStore } from './credentials';
import { parseMaFile, type ParsedMaFile } from './mafile';
import { SignInRequired, isUsableMobileToken, sessionCookie, tokenExpiry, type TokenStore } from './sessions';
import type { MaFileStore } from './store';
import type { StateCache } from './statecache';
import type { Trash } from './trash';

export interface Status {
	/** `signin`: needs the password once. `error`: temporary problem, message says what. */
	state: 'idle' | 'loading' | 'ok' | 'signin' | 'error';
	message?: string;
	items: Confirmation[];
	unreadable: number;
	fetchedAt: number;
}

const EMPTY: Status = { state: 'idle', items: [], unreadable: 0, fetchedAt: 0 };
/** Confirmation ids and nonces older than this are re-fetched before acting on them. */
const STALE_SECONDS = 90;

export interface AccountsDeps {
	store: MaFileStore;
	tokens: TokenStore;
	credentials: CredentialStore;
	client: ConfirmationsClient;
	steamNow: () => number;
	mint: (refreshToken: string, steamId: string, nowSec: number) => Promise<string>;
	signInWithPassword: (accountName: string, password: string, sharedSecret: string, nowSec: number) => Promise<string>;
	onChange?: () => void;
	/** Pause between accounts in a round. */
	spacingMs?: number;
	/** Remembers results and access tokens across restarts. */
	cache?: StateCache;
	/** Where removed accounts are kept. Without it, removing deletes. */
	trash?: Trash;
}

export class Accounts {
	private parsed = new Map<string, ParsedMaFile>();
	private statuses = new Map<string, Status>();
	private access = new Map<string, { token: string; exp: number }>();
	private inflight = new Map<string, Promise<Status>>();
	/** When a failed automatic sign-in may be tried again. Steam throttles repeated bad logins. */
	private autoSignInRetryAt = new Map<string, number>();

	constructor(private readonly d: AccountsDeps) {
		this.reload();
	}

	/** Re-read every maFile from the store. */
	reload(): void {
		const next = new Map<string, ParsedMaFile>();
		for (const id of this.d.store.list()) {
			try {
				next.set(id, parseMaFile(this.d.store.read(id)));
			} catch {
				/* a damaged file is skipped, not fatal */
			}
		}
		this.parsed = next;
		for (const id of [...this.statuses.keys()]) if (!next.has(id)) this.statuses.delete(id);
		// Last known result from before a restart, shown with its age until a new check replaces it.
		for (const id of next.keys()) {
			const c = this.d.cache?.status(id);
			if (c && !this.statuses.has(id)) this.statuses.set(id, { state: 'ok', items: c.items, unreadable: c.unreadable, fetchedAt: c.fetchedAt });
		}
	}

	ids(): string[] {
		return [...this.parsed.keys()];
	}
	/** Whole days since the authenticator was added, when the maFile says. */
	authenticatorDays(steamId: string): number | undefined {
		const t = this.parsed.get(steamId)?.serverTime;
		return t ? Math.max(0, Math.floor((this.d.steamNow() - t) / 86400)) : undefined;
	}

	get(steamId: string): ParsedMaFile | undefined {
		return this.parsed.get(steamId);
	}
	status(steamId: string): Status {
		return this.statuses.get(steamId) ?? EMPTY;
	}

	private set(steamId: string, status: Status): Status {
		this.statuses.set(steamId, status);
		this.d.onChange?.();
		return status;
	}

	private dropAccess(steamId: string): void {
		this.access.delete(steamId);
		this.d.cache?.dropAccess(steamId);
	}

	/** Move the account to the trash (when there is one). Nothing is deleted if the copy cannot be made. */
	remove(steamId: string): void {
		if (this.d.trash) {
			try {
				this.d.trash.put(steamId, this.d.store.read(steamId), this.d.credentials.get(steamId));
			} catch (err) {
				log.error('trash', `${this.parsed.get(steamId)?.accountName ?? steamId}: could not move to the trash`, err);
				throw new UserError('Could not move the account to the trash. Nothing was removed');
			}
		}
		this.d.cache?.drop(steamId);
		this.d.store.remove(steamId);
		this.d.tokens.delete(steamId);
		this.d.credentials.delete(steamId);
		this.autoSignInRetryAt.delete(steamId);
		this.dropAccess(steamId);
		this.parsed.delete(steamId);
		this.statuses.delete(steamId);
	}

	/** Bring a trashed account back, with its saved password. */
	restore(entryId: string): string {
		const trash = this.d.trash;
		if (!trash) throw new UserError('There is no trash');
		let entry;
		try {
			entry = trash.read(entryId);
			parseMaFile(entry.maFile);
		} catch (err) {
			if (err instanceof UserError) throw err;
			throw new UserError('That entry cannot be read any more');
		}
		if (this.d.store.has(entry.steamId)) throw new UserError('This account is already in the app. Remove it first or delete this entry');
		this.d.store.save(entry.steamId, entry.maFile);
		if (entry.password) this.d.credentials.set(entry.steamId, entry.password);
		trash.discard(entryId);
		this.reload();
		return entry.steamId;
	}

	private async accessToken(steamId: string, force = false): Promise<string> {
		const now = this.d.steamNow();
		const cached = this.access.get(steamId) ?? this.d.cache?.access(steamId);
		if (!force && cached && cached.exp - now > 120) return cached.token;

		const candidates = [this.d.tokens.get(steamId), this.parsed.get(steamId)?.refreshToken].filter(
			(t, i, a): t is string => !!t && a.indexOf(t) === i
		);
		for (const refresh of candidates) {
			try {
				const token = await this.d.mint(refresh, steamId, now);
				const entry = { token, exp: tokenExpiry(token) ?? now + 600 };
				this.access.set(steamId, entry);
				this.d.cache?.setAccess(steamId, entry);
				return token;
			} catch (err) {
				if (!(err instanceof SignInRequired)) throw err;
			}
		}
		throw new SignInRequired('Sign in needed');
	}

	refresh(steamId: string): Promise<Status> {
		const running = this.inflight.get(steamId);
		if (running) return running;
		const p = this.doRefresh(steamId).finally(() => this.inflight.delete(steamId));
		this.inflight.set(steamId, p);
		return p;
	}

	private batch = { running: false, done: 0, total: 0 };

	/** How far the current round of checks has got. */
	progress(): { running: boolean; done: number; total: number } {
		return { ...this.batch };
	}

	private fresh(steamId: string, minAgeSeconds: number): boolean {
		const st = this.status(steamId);
		return st.state === 'ok' && this.d.steamNow() - st.fetchedAt < minAgeSeconds;
	}

	/**
	 * Whole days until the saved sign-in runs out, but only for an account that cannot sign in again by itself
	 * (no saved password). Undefined when that does not apply or no sign-in is known.
	 */
	sessionDaysLeft(steamId: string): number | undefined {
		if (this.d.credentials.has(steamId)) return undefined;
		const now = this.d.steamNow();
		const exps = [this.d.tokens.get(steamId), this.parsed.get(steamId)?.refreshToken]
			.filter((t): t is string => !!t && isUsableMobileToken(t, now))
			.map((t) => tokenExpiry(t) ?? 0);
		return exps.length ? Math.max(0, Math.floor((Math.max(...exps) - now) / 86400)) : undefined;
	}

	/** True when there is neither a usable token nor a saved password, so no request can help. */
	private cannotSignIn(steamId: string): boolean {
		if (this.d.credentials.has(steamId)) return false;
		const now = this.d.steamNow();
		const tokens = [this.d.tokens.get(steamId), this.parsed.get(steamId)?.refreshToken];
		return !tokens.some((t) => !!t && isUsableMobileToken(t, now));
	}

	private pausedUntil = 0;
	private lastRoundEnd = 0;

	/** Stop all automatic checks for a while after Steam pushes back. */
	private pause(seconds: number): void {
		this.pausedUntil = Math.max(this.pausedUntil, this.d.steamNow() + seconds);
	}

	/** `minAgeSeconds`: accounts checked more recently than this are left alone. */
	async refreshAll(minAgeSeconds = 60): Promise<void> {
		if (this.batch.running) return;
		// A button pressed repeatedly must not turn into repeated rounds.
		if (this.d.steamNow() - this.lastRoundEnd < 20) return;
		const ids = this.ids();
		// Accounts that need a password are known at once, without waiting in the queue.
		const queue: string[] = [];
		for (const id of ids) {
			if (this.cannotSignIn(id)) {
				this.set(id, { state: 'signin', items: [], unreadable: 0, fetchedAt: this.d.steamNow() });
			} else if (this.fresh(id, minAgeSeconds)) {
				continue;
			} else {
				queue.push(id);
				this.set(id, { ...this.status(id), state: 'loading' });
			}
		}
		this.batch = { running: true, done: 0, total: queue.length };
		this.d.onChange?.();
		try {
			for (let i = 0; i < queue.length; i++) {
				const id = queue[i]!;
				if (this.d.steamNow() < this.pausedUntil) {
					// Steam said slow down: leave the rest as they were instead of asking again.
					for (const rest of queue.slice(i)) {
						this.set(rest, { ...this.status(rest), state: 'error', message: 'Paused, Steam is rate-limiting. Try again in a few minutes' });
					}
					break;
				}
				if (i > 0) await new Promise((r) => setTimeout(r, this.d.spacingMs ?? 1500));
				await this.refresh(id);
				this.batch.done++;
				this.d.onChange?.();
			}
		} finally {
			this.batch = { running: false, done: this.batch.total, total: this.batch.total };
			this.lastRoundEnd = this.d.steamNow();
			this.d.onChange?.();
		}
	}

	private async fetchList(steamId: string, identitySecret: string): Promise<Status> {
		for (let attempt = 0; ; attempt++) {
			try {
				const token = await this.accessToken(steamId, attempt > 0);
				const list = await this.d.client.list({ steamId, identitySecret }, sessionCookie(steamId, token));
				if (list.unreadable) log.warn('confirmations', `${this.parsed.get(steamId)?.accountName}: ${list.unreadable} confirmation(s) could not be read`);
				const ok: Status = { state: 'ok', items: list.items, unreadable: list.unreadable, fetchedAt: this.d.steamNow() };
				this.d.cache?.setStatus(steamId, { fetchedAt: ok.fetchedAt, items: ok.items, unreadable: ok.unreadable });
				return ok;
			} catch (err) {
				// An access token Steam just rejected gets one fresh attempt before giving up.
				if (err instanceof ConfirmationError && err.kind === 'signin' && attempt === 0) continue;
				throw err;
			}
		}
	}

	private static needsSignIn(err: unknown): boolean {
		return err instanceof SignInRequired || (err instanceof ConfirmationError && err.kind === 'signin');
	}

	/**
	 * Sign in with the saved password, if there is one and it has not just failed.
	 * Returns an error message when the attempt was made and failed.
	 */
	private async autoSignIn(steamId: string): Promise<'ok' | 'none' | string> {
		const password = this.d.credentials.get(steamId);
		const account = this.parsed.get(steamId);
		if (!password || !account) return 'none';
		if (this.d.steamNow() < (this.autoSignInRetryAt.get(steamId) ?? 0)) return 'none';
		try {
			const refresh = await this.d.signInWithPassword(account.accountName, password, account.sharedSecret, this.d.steamNow());
			this.d.tokens.set(steamId, refresh);
			this.dropAccess(steamId);
			this.autoSignInRetryAt.delete(steamId);
			return 'ok';
		} catch (err) {
			// No connection says nothing about the password: no backoff, and not reported as a rejection.
			if (err instanceof NetworkError) throw err;
			log.warn('sign-in', `${account.accountName}: saved password sign-in failed: ${err instanceof Error ? err.message : String(err)}`, err);
			// A rejected saved password is not retried for half an hour, or until it is changed.
			this.autoSignInRetryAt.set(steamId, this.d.steamNow() + 1800);
			if (err instanceof UserError && /too many attempts/i.test(err.message)) this.pause(1800);
			return err instanceof UserError ? err.message : 'Sign-in failed';
		}
	}

	private async doRefresh(steamId: string): Promise<Status> {
		const account = this.parsed.get(steamId);
		if (!account) return EMPTY;
		const prev = this.status(steamId);
		this.set(steamId, { ...prev, state: 'loading' });
		let signInMessage: string | undefined;
		try {
			try {
				return this.set(steamId, await this.fetchList(steamId, account.identitySecret));
			} catch (err) {
				if (!Accounts.needsSignIn(err)) throw err;
				this.dropAccess(steamId);
				const outcome = await this.autoSignIn(steamId);
				if (outcome !== 'ok') {
					if (outcome !== 'none') signInMessage = `Saved password failed: ${outcome}`;
					throw err;
				}
				return this.set(steamId, await this.fetchList(steamId, account.identitySecret));
			}
		} catch (err) {
			const who = this.parsed.get(steamId)?.accountName ?? steamId;
			if (Accounts.needsSignIn(err)) log.info('confirmations', `${who}: sign-in needed${signInMessage ? ` (${signInMessage})` : ''}`);
			else log.warn('confirmations', `${who}: check failed: ${err instanceof Error ? err.message : String(err)}`, err);
			if (Accounts.needsSignIn(err)) {
				this.dropAccess(steamId);
				return this.set(steamId, { state: 'signin', ...(signInMessage ? { message: signInMessage } : {}), items: [], unreadable: 0, fetchedAt: this.d.steamNow() });
			}
			const message = err instanceof ConfirmationError ? err.message : 'Could not reach Steam';
			if (err instanceof ConfirmationError && /rate-limit/i.test(err.message)) this.pause(600);
			return this.set(steamId, { ...prev, state: 'error', message, fetchedAt: this.d.steamNow() });
		}
	}

	/** Accept or deny the chosen confirmations. Throws with a readable message on failure. */
	async act(steamId: string, action: Action, ids: string[]): Promise<Status> {
		const account = this.parsed.get(steamId);
		if (!account) throw new UserError('Unknown account');
		if (ids.length === 0) throw new UserError('Nothing selected');

		// Ids and nonces go stale; never act on an old list.
		if (this.d.steamNow() - this.status(steamId).fetchedAt > STALE_SECONDS) await this.refresh(steamId);
		const current = this.status(steamId);
		const chosen = current.items.filter((c) => ids.includes(c.id));
		if (chosen.length !== new Set(ids).size) {
			await this.refresh(steamId);
			throw new UserError('The list changed, please review it again');
		}
		try {
			const token = await this.accessToken(steamId);
			await this.d.client.act({ steamId, identitySecret: account.identitySecret }, sessionCookie(steamId, token), action, chosen);
		} catch (err) {
			if (err instanceof SignInRequired || (err instanceof ConfirmationError && err.kind === 'signin')) {
				this.dropAccess(steamId);
				this.set(steamId, { ...current, state: 'signin' });
				throw new UserError('Sign in needed');
			}
			throw err instanceof ConfirmationError ? err : new UserError('Could not reach Steam');
		}
		return this.refresh(steamId);
	}

	/** A valid access token for opening the website as this account. */
	async webToken(steamId: string): Promise<string> {
		if (!this.parsed.has(steamId)) throw new UserError('Unknown account');
		try {
			return await this.accessToken(steamId);
		} catch (err) {
			if (err instanceof SignInRequired) {
				const outcome = await this.autoSignIn(steamId);
				if (outcome === 'ok') return this.accessToken(steamId);
				throw new UserError('Sign in first, on this account\'s page');
			}
			throw err instanceof UserError ? err : new NetworkError('Could not reach Steam');
		}
	}

	hasPassword(steamId: string): boolean {
		return this.d.credentials.has(steamId);
	}

	/**
	 * Check the password with a real sign-in before keeping it. A wrong password is
	 * refused (and not saved). With no connection it is saved but reported as unchecked.
	 */
	async setPassword(steamId: string, password: string): Promise<'verified' | 'unverified'> {
		const account = this.parsed.get(steamId);
		if (!account) throw new UserError('Unknown account');
		let refresh: string;
		try {
			refresh = await this.d.signInWithPassword(account.accountName, password, account.sharedSecret, this.d.steamNow());
		} catch (err) {
			if (err instanceof NetworkError) {
				this.d.credentials.set(steamId, password);
				this.autoSignInRetryAt.delete(steamId);
				return 'unverified';
			}
			if (err instanceof UserError && /too many attempts/i.test(err.message)) this.pause(1800);
			throw err;
		}
		this.d.credentials.set(steamId, password);
		this.d.tokens.set(steamId, refresh);
		this.dropAccess(steamId);
		this.autoSignInRetryAt.delete(steamId);
		void this.refresh(steamId);
		return 'verified';
	}

	clearPassword(steamId: string): void {
		this.d.credentials.delete(steamId);
		this.autoSignInRetryAt.delete(steamId);
	}

	/** Sign in with the given password, or the saved one. `save` keeps the given password for next time. */
	async signIn(steamId: string, password?: string, save = false): Promise<Status> {
		const account = this.parsed.get(steamId);
		if (!account) throw new UserError('Unknown account');
		const pw = password ?? this.d.credentials.get(steamId);
		if (!pw) throw new UserError('No password saved for this account');
		const refresh = await this.d.signInWithPassword(account.accountName, pw, account.sharedSecret, this.d.steamNow());
		this.d.tokens.set(steamId, refresh);
		if (save && password) this.d.credentials.set(steamId, password);
		this.autoSignInRetryAt.delete(steamId);
		this.dropAccess(steamId);
		return this.refresh(steamId);
	}
}
