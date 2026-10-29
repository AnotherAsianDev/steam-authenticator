import type { Bans } from './avatar';

const BASE = 'https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/';
/** A Steam account that always exists (Valve's own), used to test a key. */
const TEST_ID = '76561197960287930';

export const KEY_FORMAT = /^[0-9A-Fa-f]{32}$/;

/** Does Steam accept this Web API key? "network" means Steam could not be asked, which says nothing about the key. */
export async function testKey(key: string, fetchFn: typeof fetch = fetch): Promise<'ok' | 'invalid' | 'network'> {
	try {
		const res = await fetchFn(`${BASE}?key=${encodeURIComponent(key)}&steamids=${TEST_ID}`, { signal: AbortSignal.timeout(10_000) });
		if (res.status === 401 || res.status === 403) return 'invalid';
		if (!res.ok) return 'network';
		const body = (await res.json()) as { players?: unknown };
		return Array.isArray(body.players) ? 'ok' : 'invalid';
	} catch {
		return 'network';
	}
}

/** Ban state for up to 100 accounts per request, as the official API reports it (VAC, community, game and trade bans). */
export async function fetchBans(key: string, steamIds: string[], fetchFn: typeof fetch = fetch): Promise<Record<string, Bans>> {
	const out: Record<string, Bans> = {};
	for (let i = 0; i < steamIds.length; i += 100) {
		const chunk = steamIds.slice(i, i + 100);
		const res = await fetchFn(`${BASE}?key=${encodeURIComponent(key)}&steamids=${chunk.join(',')}`, { signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`Steam answered ${res.status}`);
		const body = (await res.json()) as { players?: Record<string, unknown>[] };
		for (const p of body.players ?? []) {
			const id = String(p['SteamId'] ?? '');
			if (!/^\d{17}$/.test(id)) continue;
			const economy = String(p['EconomyBan'] ?? 'none').toLowerCase();
			out[id] = {
				vac: p['VACBanned'] === true,
				vacCount: Number(p['NumberOfVACBans']) || 0,
				gameBans: Number(p['NumberOfGameBans']) || 0,
				community: p['CommunityBanned'] === true,
				trade: economy === 'banned' ? 'Banned' : economy === 'probation' ? 'Probation' : 'None',
				limited: false,
				...(p['VACBanned'] === true || Number(p['NumberOfGameBans']) > 0 ? { daysSince: Number(p['DaysSinceLastBan']) || 0 } : {}),
				api: true
			};
		}
	}
	return out;
}
