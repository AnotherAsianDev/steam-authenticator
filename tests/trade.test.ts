import { describe, expect, it } from 'vitest';
import { GAMES, accountIdOf, chunk, fetchInventory, fetchOwnTradeLink, parseInventory, parseTradeLink, unlockTime, sendOffer, type Http, type Item } from '../src/main/trade';

const LINK = 'https://steamcommunity.com/tradeoffer/new/?partner=1039734271&token=AbCd_-12';
const item = (n: number): Item => ({ assetId: String(n), group: 'g', name: 'Case', type: 'Container', icon: 'x', color: '', amount: 1 });

describe('trade links', () => {
	it('reads partner and token', () => {
		const l = parseTradeLink(LINK);
		expect(l.token).toBe('AbCd_-12');
		expect(l.steamId).toBe('76561198999999999');
		expect(accountIdOf(l.steamId)).toBe('1039734271');
	});
	it('refuses anything else', () => {
		expect(() => parseTradeLink('hello')).toThrow();
		expect(() => parseTradeLink('https://evil.example/tradeoffer/new/?partner=1&token=abcdef')).toThrow();
		expect(() => parseTradeLink('https://steamcommunity.com/tradeoffer/new/?partner=1039734271')).toThrow(/token/);
		expect(() => parseTradeLink('https://steamcommunity.com/tradeoffer/new/?partner=abc&token=abcdef')).toThrow();
	});
});

describe('inventory', () => {
	const body = {
		assets: [
			{ assetid: '1', classid: 'a', instanceid: '0', amount: '1' },
			{ assetid: '2', classid: 'b', instanceid: '0', amount: '1' },
			{ assetid: '3', classid: 'zz', instanceid: '0', amount: '1' }
		],
		descriptions: [
			{ classid: 'a', instanceid: '0', market_name: 'AK-47', type: 'Rifle', icon_url: 'abc-DEF_1', name_color: 'D2D2D2', tradable: 1 },
			{ classid: 'b', instanceid: '0', name: 'Locked', tradable: 0 }
		]
	};
	it('keeps tradable items and counts the rest', () => {
		const inv = parseInventory([body]);
		expect(inv.items).toHaveLength(1);
		expect(inv.items[0]).toMatchObject({ assetId: '1', name: 'AK-47', icon: 'abc-DEF_1', color: 'D2D2D2' });
		expect(inv.untradable).toBe(1);
	});
	it('drops icon values that are not plain', () => {
		const inv = parseInventory([{ assets: body.assets.slice(0, 1), descriptions: [{ ...body.descriptions[0], icon_url: '../x"' }] }]);
		expect(inv.items[0]!.icon).toBe('');
	});
	it('follows pages', async () => {
		const urls: string[] = [];
		const http: Http = async (r) => {
			urls.push(r.url);
			return { status: 200, text: JSON.stringify(urls.length === 1 ? { ...body, more_items: 1, last_assetid: '3' } : { assets: [], descriptions: [] }) };
		};
		const inv = await fetchInventory(http, '76561199000000001', GAMES[0]!, 'c');
		expect(inv.items).toHaveLength(1);
		expect(urls[1]).toContain('start_assetid=3');
		expect(inv.cut).toBe(false);
	});
	it('maps a dead session to a clear message', async () => {
		await expect(fetchInventory(async () => ({ status: 302, text: '' }), '76561199000000001', GAMES[0]!, 'c')).rejects.toThrow(/sign in/i);
	});
});

describe('locked items', () => {
	it('reads the unlock time from the expiry stamp or the shown line', () => {
		expect(unlockTime({ cache_expiration: '2026-11-06T07:00:00Z' })).toBe(Date.parse('2026-11-06T07:00:00Z') / 1000);
		expect(unlockTime({ owner_descriptions: [{ value: 'Tradable After Nov 6, 2026 (7:00:00) GMT' }] })).toBe(Date.parse('2026-11-06T07:00:00Z') / 1000);
		expect(unlockTime({})).toBeNull();
	});
	it('lists locked items grouped, soonest first', () => {
		const d = (c: string, extra: object) => ({ classid: c, instanceid: '0', market_name: c, tradable: 0, ...extra });
		const inv = parseInventory([{
			assets: [1, 2, 3, 4].map((n) => ({ assetid: String(n), classid: n < 3 ? 'late' : 'soon', instanceid: '0' })),
			descriptions: [d('late', { cache_expiration: '2026-12-01T00:00:00Z' }), d('soon', { cache_expiration: '2026-11-01T00:00:00Z' })]
		}]);
		expect(inv.items).toHaveLength(0);
		expect(inv.locked.map((l) => [l.name, l.count])).toEqual([['soon', 2], ['late', 2]]);
	});
});

describe('sending', () => {
	it('splits into offers of 100', () => {
		expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
	});
	it('posts the offer the way the website does', async () => {
		let seen: { url: string; body: URLSearchParams; cookie: string } | undefined;
		const http: Http = async (r) => {
			seen = { url: r.url, body: new URLSearchParams(r.body), cookie: r.headers['Cookie']! };
			return { status: 200, text: JSON.stringify({ tradeofferid: '555', needs_mobile_confirmation: true }) };
		};
		const sent = await sendOffer(http, 'steamLoginSecure=x', parseTradeLink(LINK), GAMES[0]!, [item(7), item(8)]);
		expect(sent).toEqual({ offerId: '555', needsMobile: true, needsEmail: false });
		expect(seen!.url).toBe('https://steamcommunity.com/tradeoffer/new/send');
		expect(seen!.body.get('partner')).toBe('76561198999999999');
		expect(seen!.cookie).toContain(`sessionid=${seen!.body.get('sessionid')}`);
		const offer = JSON.parse(seen!.body.get('json_tradeoffer')!);
		expect(offer.me.assets.map((a: { assetid: string }) => a.assetid)).toEqual(['7', '8']);
		expect(offer.them.assets).toEqual([]);
		expect(JSON.parse(seen!.body.get('trade_offer_create_params')!)).toEqual({ trade_offer_access_token: 'AbCd_-12' });
	});
	it('passes Steam\'s own error on', async () => {
		const http: Http = async () => ({ status: 200, text: JSON.stringify({ strError: 'There was an error sending your trade offer.  Please try again later. (26)' }) });
		await expect(sendOffer(http, 'c', parseTradeLink(LINK), GAMES[0]!, [item(1)])).rejects.toThrow(/\(26\)/);
	});
	it('reads an account\'s own trade link', async () => {
		const html = `<input value="https://steamcommunity.com/tradeoffer/new/?partner=1039734271&amp;token=AbCd_-12">`;
		const l = await fetchOwnTradeLink(async () => ({ status: 200, text: html }), '76561198999999999', 'c');
		expect(l?.token).toBe('AbCd_-12');
		expect(await fetchOwnTradeLink(async () => ({ status: 200, text: '<html></html>' }), '76561198999999999', 'c')).toBeUndefined();
	});
});
