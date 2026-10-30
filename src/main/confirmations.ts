import { createHash, createHmac } from 'node:crypto';
import { UserError } from './errors';
import { decodeSecret } from './totp';

/**
 * Steam mobile confirmations (trades and market listings).
 *
 * Every request carries an HMAC over the identity secret, the Steam-corrected
 * time and a tag naming the operation. The tag matters: a key signed for "list"
 * will not authorise "accept". These tag spellings are the ones the current
 * mobile app sends.
 */

export type Tag = 'list' | 'accept' | 'reject';
export type Action = 'accept' | 'deny';

const BASE = 'https://steamcommunity.com/mobileconf';

export const TYPE_NAMES: Record<number, string> = {
	1: 'Unknown',
	2: 'Trade',
	3: 'Market listing',
	4: 'Feature opt-out',
	5: 'Phone number change',
	6: 'Account recovery'
};

/** Types that mean someone may be trying to take the account. Never batched. */
export const isSecurityCritical = (type: number): boolean => type === 5 || type === 6;

export function describeType(type: number): string {
	return TYPE_NAMES[type] ?? `Unrecognised (type ${type})`;
}

/** Steam does not validate this; it only has to look like the app's. */
export function deviceId(steamId: string): string {
	const d = createHash('sha1').update(steamId).digest('hex');
	return `android:${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${d.slice(20, 32)}`;
}

export function confirmationKey(identitySecret: string, unixSeconds: number, tag: Tag): string {
	const key = decodeSecret(identitySecret);
	const tagBytes = Buffer.from(tag, 'utf8');
	const buf = Buffer.alloc(8 + tagBytes.length);
	buf.writeUInt32BE(Math.floor(unixSeconds / 2 ** 32), 0);
	buf.writeUInt32BE(Math.floor(unixSeconds) >>> 0, 4);
	tagBytes.copy(buf, 8);
	return createHmac('sha1', key).update(buf).digest('base64');
}

export interface Confirmation {
	/** Both are strings on the wire and must stay strings (64-bit values). */
	id: string;
	nonce: string;
	type: number;
	typeName: string;
	headline: string;
	summary: string[];
	/** Unix seconds, when Steam sent one. */
	created?: number;
	/** The trade offer (or listing) this confirmation belongs to. */
	creator?: string;
	critical: boolean;
}

export interface ConfirmationList {
	items: Confirmation[];
	/** Entries Steam sent that could not be read. Shown, so "nothing pending" is never a guess. */
	unreadable: number;
}

/** `signin`: the session is gone. `steam`: Steam said no. `unreadable`: we could not understand the reply. */
export class ConfirmationError extends UserError {
	constructor(
		readonly kind: 'signin' | 'steam' | 'unreadable',
		message: string
	) {
		super(message);
	}
}

const cap = (s: string): string => (s.length > 512 ? `${s.slice(0, 512)}…` : s);

function readJson(text: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// Steam answers an expired session with its HTML sign-in page and HTTP 200.
		if (/^\s*<(?:!doctype|html)/i.test(text)) {
			throw new ConfirmationError('signin', 'Steam no longer accepts this session');
		}
		throw new ConfirmationError('unreadable', 'Steam sent something unreadable');
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ConfirmationError('unreadable', 'Steam sent something unreadable');
	}
	return value as Record<string, unknown>;
}

function checkEnvelope(body: Record<string, unknown>): void {
	// needauth wins even when success is true, so a dead session never looks like "nothing pending".
	if (body['needauth']) throw new ConfirmationError('signin', 'Steam no longer accepts this session');
	if (body['success'] !== true) {
		const m = typeof body['message'] === 'string' ? body['message'] : 'Steam refused the request';
		throw new ConfirmationError('steam', cap(m));
	}
}

function parseEntry(raw: unknown): Confirmation | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const e = raw as Record<string, unknown>;
	const { id, nonce, type } = e;
	if (typeof id !== 'string' || !id || typeof nonce !== 'string' || !nonce) return null;
	if (typeof type !== 'number' || !Number.isInteger(type)) return null;
	const created = Number(e['creation_time']);
	return {
		id,
		nonce,
		type,
		typeName: describeType(type),
		headline: typeof e['headline'] === 'string' ? cap(e['headline']) : '',
		summary: Array.isArray(e['summary'])
			? e['summary'].filter((x): x is string => typeof x === 'string').slice(0, 20).map(cap)
			: [],
		...(Number.isFinite(created) && created > 0 ? { created } : {}),
		...(typeof e['creator_id'] === 'string' || typeof e['creator_id'] === 'number' ? { creator: String(e['creator_id']) } : {}),
		critical: isSecurityCritical(type)
	};
}

export function parseList(text: string): ConfirmationList {
	const body = readJson(text);
	checkEnvelope(body);
	const conf = Array.isArray(body['conf']) ? body['conf'] : [];
	const items: Confirmation[] = [];
	let unreadable = 0;
	// One odd entry must not hide the others: an account-recovery request could be among them.
	for (const raw of conf) {
		const entry = parseEntry(raw);
		if (entry) items.push(entry);
		else unreadable++;
	}
	return { items, unreadable };
}

export interface HttpRequest {
	method: 'GET' | 'POST';
	url: string;
	body?: URLSearchParams;
	cookie: string;
}
export type Transport = (req: HttpRequest) => Promise<{ status: number; text: string }>;

export const fetchTransport: Transport = async (req) => {
	const res = await fetch(req.url, {
		method: req.method,
		...(req.body ? { body: req.body } : {}),
		headers: { 'User-Agent': 'okhttp/3.12.12', Cookie: req.cookie },
		redirect: 'manual',
		signal: AbortSignal.timeout(15_000)
	});
	return { status: res.status, text: await res.text() };
};

export interface Account {
	steamId: string;
	identitySecret: string;
}

export class ConfirmationsClient {
	constructor(
		private readonly transport: Transport,
		/** Steam-corrected Unix seconds. */
		private readonly now: () => number,
		private readonly base = BASE
	) {}

	private params(account: Account, tag: Tag): URLSearchParams {
		const t = this.now();
		return new URLSearchParams({
			p: deviceId(account.steamId),
			a: account.steamId,
			k: confirmationKey(account.identitySecret, t, tag),
			t: String(t),
			m: 'react',
			tag
		});
	}

	private check(res: { status: number; text: string }): string {
		// Redirects (to the sign-in page) and 401/403 all mean the session is gone.
		if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
			throw new ConfirmationError('signin', 'Steam no longer accepts this session');
		}
		if (res.status === 429) throw new ConfirmationError('steam', 'Steam is rate-limiting requests. Wait a few minutes');
		if (res.status >= 300) throw new ConfirmationError('unreadable', `Steam answered HTTP ${res.status}`);
		return res.text;
	}

	async list(account: Account, cookie: string): Promise<ConfirmationList> {
		const url = `${this.base}/getlist?${this.params(account, 'list')}`;
		return parseList(this.check(await this.transport({ method: 'GET', url, cookie })));
	}

	async act(
		account: Account,
		cookie: string,
		action: Action,
		confirmations: readonly Confirmation[]
	): Promise<void> {
		if (confirmations.length === 0) throw new ConfirmationError('unreadable', 'Nothing selected');
		if (confirmations.length > 1 && confirmations.some((c) => c.critical)) {
			throw new ConfirmationError(
				'steam',
				'Security-related confirmations must be handled one at a time'
			);
		}
		const body = this.params(account, action === 'accept' ? 'accept' : 'reject');
		body.set('op', action === 'accept' ? 'allow' : 'cancel');
		// cid[] and ck[] are built from the same list so they cannot drift apart.
		for (const c of confirmations) {
			body.append('cid[]', c.id);
			body.append('ck[]', c.nonce);
		}
		const text = this.check(
			await this.transport({ method: 'POST', url: `${this.base}/multiajaxop`, body, cookie })
		);
		checkEnvelope(readJson(text));
	}
}
