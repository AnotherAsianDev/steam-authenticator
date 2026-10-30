import { randomBytes } from 'node:crypto';
import { UserError } from './errors';
import { log } from './log';

/**
 * Sending items from one account to another by trade offer.
 *
 * Steam has no official interface for this; the calls below are the ones the
 * Steam website makes for its own "new trade offer" page. They can change.
 */

export interface Game {
	key: string;
	name: string;
	appId: number;
	contextId: string;
}
export const GAMES: Game[] = [
	{ key: 'cs2', name: 'Counter-Strike 2', appId: 730, contextId: '2' },
	{ key: 'dota2', name: 'Dota 2', appId: 570, contextId: '2' },
	{ key: 'tf2', name: 'Team Fortress 2', appId: 440, contextId: '2' },
	{ key: 'rust', name: 'Rust', appId: 252490, contextId: '2' },
	{ key: 'steam', name: 'Steam (cards, emoticons, backgrounds)', appId: 753, contextId: '6' }
];

/** Items per offer. Steam refuses very large ones, and each offer needs its own confirmation. */
export const OFFER_SIZE = 100;
/** Pages of 2000 read per inventory. */
const MAX_PAGES = 10;
const ID64_BASE = 76561197960265728n;

export interface TradeLink {
	steamId: string;
	token: string;
}

/** Reads `https://steamcommunity.com/tradeoffer/new/?partner=…&token=…`. */
export function parseTradeLink(text: string): TradeLink {
	let u: URL;
	try {
		u = new URL(text.trim());
	} catch {
		throw new UserError('That is not a trade link');
	}
	const partner = u.searchParams.get('partner') ?? '';
	const token = u.searchParams.get('token') ?? '';
	if (u.hostname !== 'steamcommunity.com' || !/^\/tradeoffer\/new\/?$/.test(u.pathname) || !/^\d{1,10}$/.test(partner) || partner === '0') {
		throw new UserError('That is not a trade link');
	}
	if (!/^[\w-]{4,16}$/.test(token)) throw new UserError('The trade link has no valid token. Copy it again from the Trade offers page of the receiving account');
	return { steamId: String(ID64_BASE + BigInt(partner)), token };
}

export const accountIdOf = (steamId: string): string => String(BigInt(steamId) - ID64_BASE);

export interface Item {
	assetId: string;
	/** Items that look the same share a group. */
	group: string;
	name: string;
	type: string;
	icon: string;
	color: string;
	amount: number;
}
/** Items that exist but cannot be traded right now, grouped. `until` is Unix seconds when Steam names a date. */
export interface Locked {
	name: string;
	icon: string;
	color: string;
	count: number;
	until: number | null;
}
export interface Inventory {
	items: Item[];
	/** How many items cannot be traded right now. */
	untradable: number;
	locked: Locked[];
}
export interface InventoryRead extends Inventory {
	/** True when the inventory was longer than what was read. */
	cut: boolean;
}

export interface HttpRequest {
	method: 'GET' | 'POST';
	url: string;
	headers: Record<string, string>;
	body?: string;
}
export type Http = (req: HttpRequest) => Promise<{ status: number; text: string; location?: string }>;

export const fetchHttp: Http = async (req) => {
	const res = await fetch(req.url, {
		method: req.method,
		headers: req.headers,
		...(req.body !== undefined ? { body: req.body } : {}),
		redirect: 'manual',
		signal: AbortSignal.timeout(30_000)
	});
	return { status: res.status, text: await res.text(), ...(res.headers.get('location') ? { location: res.headers.get('location')! } : {}) };
};

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const cap = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

function checkStatus(status: number, what: string): void {
	if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
		log.warn('trade', `Steam answered HTTP ${status} for ${what}`);
		throw new UserError(`Steam refused ${what} (HTTP ${status}). Signing in again on the account page can help. If it keeps happening, Steam does not accept this account's session for this step`);
	}
	if (status === 429) throw new UserError('Steam is rate-limiting requests. Wait a few minutes and try again');
	if (status >= 400) throw new UserError(`Steam answered HTTP ${status}`);
}

const word = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** When a trade-protected item becomes tradable: Steam's expiry stamp, or the "Tradable After …" line it shows. */
export function unlockTime(d: Record<string, unknown>): number | null {
	const stamp = typeof d['cache_expiration'] === 'string' ? Date.parse(d['cache_expiration']) : NaN;
	if (Number.isFinite(stamp)) return Math.floor(stamp / 1000);
	for (const o of Array.isArray(d['owner_descriptions']) ? d['owner_descriptions'] : []) {
		const v = (o as Record<string, unknown>)['value'];
		const m = typeof v === 'string' ? /After (\w{3}) (\d{1,2}), (\d{4}) \((\d{1,2}):(\d{2}):(\d{2})\) GMT/.exec(v) : null;
		if (m) {
			const at = Date.parse(`${m[1]} ${m[2]} ${m[3]} ${m[4]}:${m[5]}:${m[6]} GMT`);
			if (Number.isFinite(at)) return Math.floor(at / 1000);
		}
	}
	return null;
}

/** One page of an inventory reply, reduced to what the screen needs. */
export function parseInventory(pages: unknown[]): Inventory {
	const items: Item[] = [];
	let untradable = 0;
	const locked = new Map<string, Locked>();
	for (const body of pages) {
		const b = (body ?? {}) as Record<string, unknown>;
		const assets = Array.isArray(b['assets']) ? b['assets'] : [];
		const descriptions = new Map<string, Record<string, unknown>>();
		for (const d of Array.isArray(b['descriptions']) ? b['descriptions'] : []) {
			const o = d as Record<string, unknown>;
			descriptions.set(`${String(o['classid'])}_${String(o['instanceid'])}`, o);
		}
		for (const a of assets) {
			const o = a as Record<string, unknown>;
			const d = descriptions.get(`${String(o['classid'])}_${String(o['instanceid'])}`);
			if (!d) continue;
			if (d['tradable'] !== 1) {
				untradable++;
				const until = unlockTime(d);
				const key = `${String(o['classid'])}_${String(o['instanceid'])}_${until ?? ''}`;
				const icon = word(d['icon_url'], 400);
				const color = word(d['name_color'], 6);
				const seen = locked.get(key);
				if (seen) seen.count++;
				else if (locked.size < 500) locked.set(key, { name: word(d['market_name'] ?? d['name']) || word(d['name']), icon: /^[\w-]+$/.test(icon) ? icon : '', color: /^[0-9a-fA-F]{6}$/.test(color) ? color : '', count: 1, until });
				continue;
			}
			const assetId = String(o['assetid'] ?? '');
			if (!/^\d{1,20}$/.test(assetId)) continue;
			const icon = word(d['icon_url'], 400);
			const color = word(d['name_color'], 6);
			const amount = Number(o['amount'] ?? 1);
			items.push({
				assetId,
				group: `${String(d['classid'])}_${String(d['instanceid'])}`,
				name: word(d['market_name'] ?? d['name']) || word(d['name']),
				type: word(d['type']),
				icon: /^[\w-]+$/.test(icon) ? icon : '',
				color: /^[0-9a-fA-F]{6}$/.test(color) ? color : '',
				amount: Number.isInteger(amount) && amount > 0 ? amount : 1
			});
		}
	}
	return { items, untradable, locked: [...locked.values()].sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity)) };
}

export async function fetchInventory(http: Http, steamId: string, game: Game, cookie: string): Promise<InventoryRead> {
	const pages: unknown[] = [];
	let start = '';
	let cut = false;
	for (let i = 0; i < MAX_PAGES; i++) {
		const url = `https://steamcommunity.com/inventory/${steamId}/${game.appId}/${game.contextId}?l=english&count=2000${start ? `&start_assetid=${start}` : ''}`;
		const res = await http({ method: 'GET', url, headers: { 'User-Agent': BROWSER, Cookie: cookie } });
		if (res.status === 500 || res.status === 404) return { items: [], untradable: 0, locked: [], cut: false };
		checkStatus(res.status, 'reading the inventory');
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(res.text) as Record<string, unknown>;
		} catch {
			throw new UserError('Steam sent an inventory that could not be read');
		}
		if (body['success'] === 0 || body['success'] === false) throw new UserError('Steam did not give this inventory');
		pages.push(body);
		if (!body['more_items']) break;
		start = String(body['last_assetid'] ?? '');
		if (!/^\d+$/.test(start)) break;
		if (i === MAX_PAGES - 1) cut = true;
	}
	return { ...parseInventory(pages), cut };
}

/** An account's own trade link, read from its trade-offer privacy page. */
export async function fetchOwnTradeLink(http: Http, steamId: string, cookie: string): Promise<TradeLink | undefined> {
	// Steam sends /profiles/<id>/… on to /id/<custom name>/… for accounts with a custom address, so follow that, but only on steamcommunity.com and never to the login page.
	let url = `https://steamcommunity.com/profiles/${steamId}/tradeoffers/privacy`;
	const headers = { 'User-Agent': BROWSER, Cookie: `${cookie}; sessionid=${randomBytes(12).toString('hex')}` };
	let res = await http({ method: 'GET', url, headers });
	for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400 && res.location; hop++) {
		let next: URL;
		try {
			next = new URL(res.location, url);
		} catch {
			break;
		}
		if (next.protocol !== 'https:' || next.hostname !== 'steamcommunity.com' || /\/login/i.test(next.pathname)) break;
		url = next.toString();
		res = await http({ method: 'GET', url, headers });
	}
	if (res.status >= 300 && res.status < 400) {
		// Steam sent us somewhere we will not follow (usually its sign-in page). The link cannot be read this way, which is not the same as a dead session: the inventory still works.
		log.warn('trade', `Trade link page answered HTTP ${res.status} to ${(res.location ?? '').replace(/[?#].*$/, '')}`);
		return undefined;
	}
	checkStatus(res.status, 'reading the trade link');
	const m = /https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=(\d+)(?:&amp;|&)token=([\w-]+)/.exec(res.text);
	if (!m) return undefined;
	try {
		return parseTradeLink(`https://steamcommunity.com/tradeoffer/new/?partner=${m[1]}&token=${m[2]}`);
	} catch {
		return undefined;
	}
}

export function chunk<T>(list: readonly T[], size = OFFER_SIZE): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

export interface Sent {
	offerId: string;
	needsMobile: boolean;
	needsEmail: boolean;
}

export async function sendOffer(http: Http, cookieBase: string, to: TradeLink, game: Game, items: readonly Item[]): Promise<Sent> {
	if (items.length === 0) throw new UserError('Nothing selected');
	const sessionId = randomBytes(12).toString('hex');
	const offer = {
		newversion: true,
		version: items.length + 1,
		me: { assets: items.map((i) => ({ appid: game.appId, contextid: game.contextId, amount: i.amount, assetid: i.assetId })), currency: [], ready: false },
		them: { assets: [], currency: [], ready: false }
	};
	const body = new URLSearchParams({
		sessionid: sessionId,
		serverid: '1',
		partner: to.steamId,
		tradeoffermessage: '',
		json_tradeoffer: JSON.stringify(offer),
		captcha: '',
		trade_offer_create_params: JSON.stringify({ trade_offer_access_token: to.token })
	}).toString();
	const res = await http({
		method: 'POST',
		url: 'https://steamcommunity.com/tradeoffer/new/send',
		headers: {
			'User-Agent': BROWSER,
			Cookie: `${cookieBase}; sessionid=${sessionId}`,
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			Origin: 'https://steamcommunity.com',
			Referer: `https://steamcommunity.com/tradeoffer/new/?partner=${accountIdOf(to.steamId)}&token=${to.token}`
		},
		body
	});
	checkStatus(res.status, 'sending the offer');
	let reply: Record<string, unknown>;
	try {
		reply = JSON.parse(res.text) as Record<string, unknown>;
	} catch {
		throw new UserError('Steam sent an answer that could not be read. Check the Trade offers page before trying again');
	}
	if (typeof reply['strError'] === 'string') throw new UserError(cap(reply['strError']));
	const offerId = String(reply['tradeofferid'] ?? '');
	if (!/^\d+$/.test(offerId)) throw new UserError('Steam did not confirm the offer. Check the Trade offers page before trying again');
	return { offerId, needsMobile: reply['needs_mobile_confirmation'] === true, needsEmail: reply['needs_email_confirmation'] === true };
}

export interface OpenOffer {
	id: string;
	/** Waiting for the other side, or still waiting for your confirmation. */
	state: 'waiting' | 'confirm';
	items: number;
	/** The other account's number, as Steam names it. */
	partner: string;
	created: number;
}

/** Offers this account sent that are still open, from Steam's trade offer service. */
export function parseOpenOffers(body: unknown): OpenOffer[] {
	const list = ((body as { response?: { trade_offers_sent?: unknown } } | null)?.response?.trade_offers_sent ?? []) as Record<string, unknown>[];
	const out: OpenOffer[] = [];
	for (const o of Array.isArray(list) ? list : []) {
		const state = Number(o['trade_offer_state']);
		const id = String(o['tradeofferid'] ?? '');
		if ((state !== 2 && state !== 9) || !/^\d+$/.test(id)) continue;
		const give = Array.isArray(o['items_to_give']) ? o['items_to_give'].length : 0;
		out.push({ id, state: state === 9 ? 'confirm' : 'waiting', items: give, partner: String(o['accountid_other'] ?? ''), created: Number(o['time_created']) || 0 });
	}
	return out.sort((a, b) => b.created - a.created);
}

export async function fetchOpenOffers(http: Http, accessToken: string): Promise<OpenOffer[]> {
	const url = `https://api.steampowered.com/IEconService/GetTradeOffers/v1/?${new URLSearchParams({ access_token: accessToken, get_sent_offers: '1', get_received_offers: '0', active_only: '1', get_descriptions: '0' })}`;
	const res = await http({ method: 'GET', url, headers: { 'User-Agent': BROWSER } });
	checkStatus(res.status, 'reading the open offers');
	try {
		return parseOpenOffers(JSON.parse(res.text));
	} catch {
		throw new UserError('Steam sent an answer that could not be read');
	}
}

export async function cancelOffer(http: Http, accessToken: string, offerId: string): Promise<void> {
	if (!/^\d+$/.test(offerId)) throw new UserError('Unknown offer');
	const res = await http({
		method: 'POST',
		url: 'https://api.steampowered.com/IEconService/CancelTradeOffer/v1/',
		headers: { 'User-Agent': BROWSER, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
		body: new URLSearchParams({ access_token: accessToken, tradeofferid: offerId }).toString()
	});
	checkStatus(res.status, 'cancelling the offer');
}
