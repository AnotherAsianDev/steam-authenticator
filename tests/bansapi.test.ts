import { describe, expect, it } from 'vitest';
import { fetchBans, KEY_FORMAT, testKey } from '../src/main/bansapi';

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const KEY = 'A'.repeat(32);

describe('web api key', () => {
	it('checks the format', () => {
		expect(KEY_FORMAT.test(KEY)).toBe(true);
		expect(KEY_FORMAT.test('short')).toBe(false);
		expect(KEY_FORMAT.test('g'.repeat(32))).toBe(false);
	});
	it('tells a rejected key from an unreachable Steam', async () => {
		expect(await testKey(KEY, (async () => json({ players: [] })) as typeof fetch)).toBe('ok');
		expect(await testKey(KEY, (async () => new Response('Forbidden', { status: 403 })) as typeof fetch)).toBe('invalid');
		expect(await testKey(KEY, (async () => new Response('', { status: 503 })) as typeof fetch)).toBe('network');
		expect(await testKey(KEY, (async () => { throw new Error('offline'); }) as typeof fetch)).toBe('network');
	});
	it('reads every kind of ban', async () => {
		let url = '';
		const f = (async (u: string) => {
			url = u;
			return json({ players: [
				{ SteamId: '76561199000000001', CommunityBanned: true, VACBanned: true, NumberOfVACBans: 2, DaysSinceLastBan: 40, NumberOfGameBans: 1, EconomyBan: 'probation' },
				{ SteamId: '76561199000000002', CommunityBanned: false, VACBanned: false, NumberOfVACBans: 0, DaysSinceLastBan: 0, NumberOfGameBans: 0, EconomyBan: 'none' }
			] });
		}) as unknown as typeof fetch;
		const r = await fetchBans(KEY, ['76561199000000001', '76561199000000002'], f);
		expect(url).toContain('steamids=76561199000000001,76561199000000002');
		expect(r['76561199000000001']).toMatchObject({ vac: true, vacCount: 2, gameBans: 1, community: true, trade: 'Probation', daysSince: 40 });
		expect(r['76561199000000002']).toMatchObject({ vac: false, community: false, trade: 'None' });
		expect(r['76561199000000002']?.daysSince).toBeUndefined();
	});
	it('fails loudly when Steam answers with an error', async () => {
		await expect(fetchBans(KEY, ['76561199000000001'], (async () => new Response('', { status: 500 })) as typeof fetch)).rejects.toThrow();
	});
});
