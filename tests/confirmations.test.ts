import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error no types
import SteamTotp from 'steam-totp';
import {
	ConfirmationError,
	ConfirmationsClient,
	confirmationKey,
	deviceId,
	fetchTransport,
	parseList
} from '../src/main/confirmations';

const SECRET = Buffer.from('abcdefghij0123456789').toString('base64');
const ACCOUNT = { steamId: '76561198000000001', identitySecret: SECRET };
const NOW = 1_700_000_123;

const trade = { id: '9007199254740993', nonce: '1234567890123456789', type: 2, headline: 'Trade with Bob', summary: ['Give: AK-47', 'Get: Knife'], creation_time: 1_700_000_000 };

describe('confirmation keys', () => {
	it('match steam-totp for every tag', () => {
		for (const tag of ['list', 'accept', 'reject'] as const) {
			expect(confirmationKey(SECRET, NOW, tag)).toBe(SteamTotp.getConfirmationKey(SECRET, NOW, tag));
		}
	});
	it('derives a stable android device id', () => {
		expect(deviceId('76561198000000001')).toMatch(/^android:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
	});
});

describe('parseList', () => {
	it('reads entries and keeps 64-bit ids as strings', () => {
		const text = `{"success":true,"conf":[{"id":"9007199254740993","nonce":"1234567890123456789","type":3,"headline":"x","summary":["a"]}]}`;
		const { items } = parseList(text);
		expect(items[0]?.id).toBe('9007199254740993');
		expect(items[0]?.typeName).toBe('Market listing');
	});
	it('treats success without conf as nothing pending', () => {
		expect(parseList('{"success":true}')).toEqual({ items: [], unreadable: 0 });
	});
	it('never hides a good entry behind a bad one, and counts the bad one', () => {
		const text = JSON.stringify({ success: true, conf: [{ id: 5, nonce: 'n', type: 2 }, trade] });
		const r = parseList(text);
		expect(r.items).toHaveLength(1);
		expect(r.unreadable).toBe(1);
	});
	it('flags account recovery as security critical', () => {
		const r = parseList(JSON.stringify({ success: true, conf: [{ ...trade, type: 6 }] }));
		expect(r.items[0]?.critical).toBe(true);
	});
	it('reports a dead session instead of an empty list', () => {
		expect(() => parseList('{"success":true,"needauth":true}')).toThrowError(ConfirmationError);
		try { parseList('<html>Sign in</html>'); } catch (e) { expect((e as ConfirmationError).kind).toBe('signin'); }
	});
});

describe('client against a mock Steam', () => {
	let server: Server;
	let base = '';
	const seen: { method: string; path: string; query: URLSearchParams; body: URLSearchParams; cookie: string }[] = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				const url = new URL(req.url!, 'http://x');
				seen.push({ method: req.method!, path: url.pathname, query: url.searchParams, body: new URLSearchParams(Buffer.concat(chunks).toString()), cookie: String(req.headers.cookie) });
				res.setHeader('content-type', 'application/json');
				if (url.pathname.endsWith('getlist')) res.end(JSON.stringify({ success: true, conf: [trade] }));
				else res.end(JSON.stringify({ success: true }));
			});
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mobileconf`;
	});
	afterAll(() => server.close());

	const client = () => new ConfirmationsClient(fetchTransport, () => NOW, base);

	it('lists with a correctly signed request and the session cookie', async () => {
		const r = await client().list(ACCOUNT, 'steamLoginSecure=abc');
		expect(r.items[0]?.headline).toBe('Trade with Bob');
		const q = seen.at(-1)!;
		expect(q.method).toBe('GET');
		expect(q.cookie).toBe('steamLoginSecure=abc');
		expect(q.query.get('k')).toBe(SteamTotp.getConfirmationKey(SECRET, NOW, 'list'));
		expect(q.query.get('t')).toBe(String(NOW));
		expect(q.query.get('a')).toBe(ACCOUNT.steamId);
		expect(q.query.get('tag')).toBe('list');
	});

	it('accepts several confirmations in one signed batch', async () => {
		const items = [parseList(JSON.stringify({ success: true, conf: [trade, { ...trade, id: '2', nonce: 'n2' }] })).items][0]!;
		await client().act(ACCOUNT, 'c=1', 'accept', items);
		const q = seen.at(-1)!;
		expect(q.method).toBe('POST');
		expect(q.path).toMatch(/multiajaxop$/);
		expect(q.body.get('op')).toBe('allow');
		expect(q.body.get('tag')).toBe('accept');
		expect(q.body.get('k')).toBe(SteamTotp.getConfirmationKey(SECRET, NOW, 'accept'));
		expect(q.body.getAll('cid[]')).toEqual(['9007199254740993', '2']);
		expect(q.body.getAll('ck[]')).toEqual(['1234567890123456789', 'n2']);
	});

	it('denies with the reject tag and cancel op', async () => {
		const items = parseList(JSON.stringify({ success: true, conf: [trade] })).items;
		await client().act(ACCOUNT, 'c=1', 'deny', items);
		const q = seen.at(-1)!;
		expect(q.body.get('op')).toBe('cancel');
		expect(q.body.get('k')).toBe(SteamTotp.getConfirmationKey(SECRET, NOW, 'reject'));
	});

	it('refuses to batch security-critical confirmations', async () => {
		const items = parseList(JSON.stringify({ success: true, conf: [trade, { ...trade, id: '3', nonce: 'n3', type: 6 }] })).items;
		const before = seen.length;
		await expect(client().act(ACCOUNT, 'c=1', 'accept', items)).rejects.toThrow(/one at a time/);
		expect(seen.length).toBe(before);
	});

	it('allows a single security-critical confirmation', async () => {
		const items = parseList(JSON.stringify({ success: true, conf: [{ ...trade, type: 6 }] })).items;
		await client().act(ACCOUNT, 'c=1', 'accept', items);
	});
});
