import { log } from './log';
import { writeFileAtomic } from './atomic';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Profile pictures from the public profile XML (no API key).
 *
 * The same page also says whether the account has a VAC ban or a trade ban, so bans cost no
 * extra request. Gentle by design: one request at a time with a pause between, each account
 * at most every 12 hours when bans are watched (otherwise once a week), and a failure is not
 * retried for an hour. The picture itself is only downloaded when its address changed.
 */
const MAX_AGE_MS = 7 * 24 * 3600_000;
const BANS_AGE_MS = 12 * 3600_000;
const RETRY_MS = 3600_000;
const MAX_BYTES = 1_000_000;
/** Steam's own picture for profiles that have none or were never set up. */
export const DEFAULT_AVATAR = 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';

export function extractAvatarUrl(xml: string): string | undefined {
	const m = /<avatarFull>\s*(?:<!\[CDATA\[)?\s*(https:\/\/[^\s\]<]+)/.exec(xml);
	const url = m?.[1];
	if (!url) return undefined;
	try {
		const u = new URL(url);
		const ok = u.protocol === 'https:' && (u.hostname.endsWith('.steamstatic.com') || u.hostname.endsWith('.akamaihd.net'));
		return ok ? u.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** The profile name ("nickname") from the same public profile XML, cleaned for display. */
export function extractPersonaName(xml: string): string | undefined {
	const m = /<steamID>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/steamID>/.exec(xml);
	// eslint-disable-next-line no-control-regex
	const name = m?.[1]?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
	return name || undefined;
}

const decodeHtml = (t: string): string => t.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * A profile that was never set up has no XML (Steam says "could not be found"), but the normal profile page still shows the name.
 * Name and picture are read from that page instead.
 */
export function extractFromPage(html: string): { name?: string; url?: string } {
	const n = /<span class="actual_persona_name">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? /<title>\s*Steam Community\s*::\s*([\s\S]*?)<\/title>/.exec(html)?.[1];
	// eslint-disable-next-line no-control-regex
	const name = n ? decodeHtml(n).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) : '';
	const img = /<link rel="image_src" href="(https:\/\/[^"]+)"/.exec(html)?.[1];
	let url: string | undefined;
	if (img) url = extractAvatarUrl(`<avatarFull>${img.replace(/(_full)?\.jpg$/, '_full.jpg')}</avatarFull>`);
	return { ...(name && name !== 'Error' ? { name } : {}), ...(url ? { url } : {}) };
}

/** The small hover card Steam shows for any account, set up or not. */
export function extractFromMini(html: string): { name?: string; url?: string } {
	const n = /class="persona[^"]*">([\s\S]*?)<\/span>/.exec(html)?.[1];
	// eslint-disable-next-line no-control-regex
	const name = n ? decodeHtml(n).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) : '';
	const img = /<img src="(https:\/\/[^"]+\.jpg)"/.exec(html)?.[1];
	const url = img ? extractAvatarUrl(`<avatarFull>${img.replace(/(_full|_medium)?\.jpg$/, '_full.jpg')}</avatarFull>`) : undefined;
	return { ...(name ? { name } : {}), ...(url ? { url } : {}) };
}

export interface Bans {
	/** A VAC ban is on record. */
	vac: boolean;
	/** "None", "Probation" or "Banned". */
	trade: string;
	/** Steam marks the account as limited (no spending yet). */
	limited: boolean;
	// The fields below only come from the official API (with a Web API key).
	vacCount?: number;
	gameBans?: number;
	community?: boolean;
	/** Days since the last VAC or game ban. */
	daysSince?: number;
	api?: true;
}

/** The ban fields of the public profile XML. Undefined when the page does not carry them (for example an error page). */
export function extractBans(xml: string): Bans | undefined {
	const vac = /<vacBanned>\s*([01])\s*<\/vacBanned>/.exec(xml)?.[1];
	if (vac === undefined) return undefined;
	const trade = /<tradeBanState>\s*([A-Za-z]{1,20})\s*<\/tradeBanState>/.exec(xml)?.[1] ?? 'None';
	const limited = /<isLimitedAccount>\s*([01])\s*<\/isLimitedAccount>/.exec(xml)?.[1] === '1';
	return { vac: vac === '1', trade, limited };
}

/** Short texts for what is wrong with an account on Steam's side (empty when nothing is). */
export function banLabels(b: Bans | undefined): string[] {
	if (!b) return [];
	const n = (count: number | undefined, label: string): string => ((count ?? 0) > 1 ? `${label} ×${count}` : label);
	return [
		b.vac ? n(b.vacCount, 'VAC ban') : '',
		(b.gameBans ?? 0) > 0 ? n(b.gameBans, 'Game ban') : '',
		b.community ? 'Community ban' : '',
		b.trade === 'Banned' ? 'Trade ban' : b.trade === 'Probation' ? 'Trade probation' : ''
	].filter(Boolean);
}

/** True when something on the account deserves attention. */
export const isBanned = (b: Bans | undefined): boolean => !!b && (b.vac || !!b.community || (b.gameBans ?? 0) > 0 || (b.trade !== 'None' && b.trade !== ''));

interface Profile {
	name?: string;
	/** Address of the picture that is on disk. */
	url?: string;
	/** When the profile page was last read. */
	checked: number;
	bans?: Bans;
	/** What changed about the bans and when, newest last. */
	events?: { at: number; what: string }[];
}
const EVENTS_MAX = 20;

export class AvatarCache {
	private failed = new Map<string, number>();
	private queue: Promise<void> = Promise.resolve();
	private pending = new Set<string>();
	/** The list asks every second; the disk is only looked at every few minutes per account. */
	private checkedAt = new Map<string, number>();
	private onDisk = new Set<string>();
	private profiles: Record<string, Profile> = {};
	private wants = new Map<string, { image: boolean; bans: boolean }>();
	/** Bans come from the official API (a key is set); the profile page then no longer decides them. */
	private apiMode = false;

	constructor(
		private readonly dir: string,
		private readonly onUpdate: () => void = () => undefined,
		private readonly profileBase = 'https://steamcommunity.com/profiles',
		private readonly onNewBan: (steamId: string, what: string) => void = () => undefined,
		private readonly signedPage: (steamId: string) => Promise<string | undefined> = async () => undefined
	) {
		this.load();
	}

	private load(): void {
		try {
			const raw = JSON.parse(readFileSync(join(this.dir, 'profiles.json'), 'utf8')) as Record<string, Partial<Profile>>;
			for (const [id, p] of Object.entries(raw)) {
				if (typeof p !== 'object' || p === null) continue;
				const b = p.bans as Partial<Bans> | undefined;
				this.profiles[id] = {
					...(typeof p.name === 'string' ? { name: p.name } : {}),
					...(typeof p.url === 'string' ? { url: p.url } : {}),
					checked: typeof p.checked === 'number' ? p.checked : 0,
					...(Array.isArray(p.events) ? { events: p.events.filter((e) => typeof e?.at === 'number' && typeof e?.what === 'string').slice(-EVENTS_MAX) } : {}),
					...(b && typeof b.vac === 'boolean' && typeof b.trade === 'string' ? { bans: { vac: b.vac, trade: b.trade, limited: b.limited === true, ...(typeof b.vacCount === 'number' ? { vacCount: b.vacCount } : {}), ...(typeof b.gameBans === 'number' ? { gameBans: b.gameBans } : {}), ...(typeof b.community === 'boolean' ? { community: b.community } : {}), ...(typeof b.daysSince === 'number' ? { daysSince: b.daysSince } : {}), ...(b.api ? { api: true as const } : {}) } } : {})
				};
			}
			return;
		} catch {
			/* no profiles file yet */
		}
		// Older versions kept names.json and urls.json.
		try {
			const names = JSON.parse(readFileSync(join(this.dir, 'names.json'), 'utf8')) as Record<string, unknown>;
			const urls = existsSync(join(this.dir, 'urls.json')) ? (JSON.parse(readFileSync(join(this.dir, 'urls.json'), 'utf8')) as Record<string, unknown>) : {};
			const checked = statSync(join(this.dir, 'names.json')).mtimeMs;
			for (const [id, n] of Object.entries(names)) {
				if (typeof n !== 'string') continue;
				this.profiles[id] = { name: n, checked, ...(typeof urls[id] === 'string' ? { url: urls[id] as string } : {}) };
			}
		} catch {
			/* nothing to carry over */
		}
	}

	private save(): void {
		try {
			writeFileAtomic(join(this.dir, 'profiles.json'), JSON.stringify(this.profiles));
		} catch (err) {
			log.warn('avatar', `profiles.json could not be saved: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Look again soon, for example after a setting that needs the profile was turned on. */
	recheck(): void {
		this.checkedAt.clear();
	}

	/** Forget when profiles were last read, so every account is read again as soon as it is asked for. */
	refreshAll(): void {
		for (const p of Object.values(this.profiles)) p.checked = 0;
		this.failed.clear();
		this.checkedAt.clear();
	}

	/** The profile name, once it has been fetched. */
	nickname(steamId: string): string | undefined {
		return this.profiles[steamId]?.name;
	}

	setApiMode(on: boolean): void {
		this.apiMode = on;
	}

	/** Bans from the official API. */
	setBans(steamId: string, bans: Bans): void {
		const before = this.profiles[steamId];
		const next: Profile = { ...(before ?? { checked: 0 }), bans };
		this.profiles[steamId] = next;
		this.noteNewBan(steamId, before?.bans, bans);
		this.save();
		if (JSON.stringify(before?.bans) !== JSON.stringify(bans)) this.onUpdate();
	}

	private record(steamId: string, what: string): void {
		const p = this.profiles[steamId];
		if (p) p.events = [...(p.events ?? []), { at: Date.now(), what }].slice(-EVENTS_MAX);
	}

	private noteNewBan(steamId: string, before: Bans | undefined, now: Bans): void {
		if (!before) {
			if (isBanned(now)) this.record(steamId, `Found with ${banLabels(now).join(', ')} when first checked`);
			return;
		}
		if (isBanned(before) && !isBanned(now)) this.record(steamId, 'Bans lifted');
		const gained = banLabels(now).filter((l) => !banLabels(before).includes(l));
		if (gained.length) this.record(steamId, `New: ${gained.join(', ')}`);
		if (now.vac && !before.vac) this.onNewBan(steamId, 'a VAC ban');
		else if ((now.gameBans ?? 0) > (before.gameBans ?? 0)) this.onNewBan(steamId, 'a game ban');
		else if (now.community && !before.community) this.onNewBan(steamId, 'a community ban');
		else if (now.trade !== before.trade && now.trade !== 'None') this.onNewBan(steamId, `a trade ban (${now.trade})`);
	}

	/** Changes to the bans seen so far, oldest first. */
	history(steamId: string): { at: number; what: string }[] {
		return this.profiles[steamId]?.events ?? [];
	}

	/** Ban state as of the last time the profile was read. */
	bans(steamId: string): Bans | undefined {
		return this.profiles[steamId]?.bans;
	}

	private file(steamId: string): string {
		return join(this.dir, `${steamId}.jpg`);
	}

	/** The cached picture as a data URL, if there is one. */
	get(steamId: string): string | undefined {
		try {
			return `data:image/jpeg;base64,${readFileSync(this.file(steamId)).toString('base64')}`;
		} catch {
			return undefined;
		}
	}

	has(steamId: string): boolean {
		if (this.onDisk.has(steamId)) return true;
		const yes = existsSync(this.file(steamId));
		if (yes) this.onDisk.add(steamId);
		return yes;
	}

	/** Queue a read of the profile if what is wanted is missing or old. Returns immediately. */
	ensure(steamId: string, want: { image: boolean; bans: boolean }): void {
		if (this.pending.has(steamId)) return;
		this.wants.set(steamId, want);
		const now = Date.now();
		if (now - (this.checkedAt.get(steamId) ?? 0) < 300_000) return;
		this.checkedAt.set(steamId, now);
		const p = this.profiles[steamId];
		const fresh = p && p.name !== undefined && now - p.checked < (want.bans ? BANS_AGE_MS : MAX_AGE_MS);
		const haveBans = !want.bans || this.apiMode || p?.bans !== undefined;
		// A missing picture is no reason to ask again when the profile has no picture address at all (failed until the retry time).
		const haveImage = !want.image || this.has(steamId);
		if (fresh && haveBans && haveImage) return;
		if (now - (this.failed.get(steamId) ?? 0) < RETRY_MS) return;
		this.pending.add(steamId);
		this.queue = this.queue
			.then(() => this.download(steamId))
			.catch(() => undefined)
			.finally(() => this.pending.delete(steamId))
			.then(() => new Promise<void>((r) => setTimeout(r, 1500)));
	}

	private async download(steamId: string): Promise<void> {
		const want = this.wants.get(steamId) ?? { image: true, bans: true };
		try {
			const xml = await fetch(`${this.profileBase}/${steamId}/?xml=1`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
			const before = this.profiles[steamId];
			const next: Profile = { ...(before ?? { checked: 0 }), checked: Date.now() };
			let name = extractPersonaName(xml);
			let pageUrl: string | undefined;
			if (!name) {
				// Steam gives no profile XML for an account that was never set up. The profile page and the hover card still carry the name.
				const second = async (url: string, read: (h: string) => { name?: string; url?: string }): Promise<void> => {
					if (name) return;
					try {
						const found = read(await fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text()));
						name = found.name;
						pageUrl ??= found.url;
					} catch {
						/* only a second chance */
					}
				};
				// Steam shows a never-set-up profile only to a signed-in viewer, so the account's own session is tried first.
				if (!name) {
					try {
						const html = await this.signedPage(steamId);
						if (html) {
							const found = extractFromPage(html);
							name = found.name;
							pageUrl ??= found.url;
							if (!name) log.info('avatar', `${steamId}: no profile name on the signed-in page (title "${html.replace(/\s+/g, ' ').match(/<title>([^<]{0,80})/)?.[1] ?? 'none'}")`);
						}
					} catch {
						/* only a second chance */
					}
				}
				await second(`${this.profileBase}/${steamId}`, extractFromPage);
				if (this.profileBase.endsWith('/profiles')) await second(`${this.profileBase.slice(0, -9)}/miniprofile/${BigInt(steamId) - 76561197960265728n}`, extractFromMini);
				if (!name) this.failed.set(steamId, Date.now());
			}
			if (name) next.name = name;
			const bans = this.apiMode ? undefined : extractBans(xml);
			if (bans) next.bans = bans;
			let changed = name !== before?.name || JSON.stringify(bans) !== JSON.stringify(before?.bans);
			this.profiles[steamId] = next;
			if (bans) this.noteNewBan(steamId, before?.bans, bans);
			if (want.image) {
				// Steam's default picture only for a profile Steam says does not exist, and never over a picture already saved.
				const url = extractAvatarUrl(xml) ?? pageUrl ?? (name && !existsSync(this.file(steamId)) ? DEFAULT_AVATAR : undefined) ?? (/could not be found/i.test(xml) && !existsSync(this.file(steamId)) ? DEFAULT_AVATAR : undefined);
				if (!url) throw new Error('no avatar');
				if (next.url !== url || !existsSync(this.file(steamId))) {
					const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
					const buf = Buffer.from(await res.arrayBuffer());
					if (!res.ok || buf.length === 0 || buf.length > MAX_BYTES) throw new Error('bad image');
					writeFileAtomic(this.file(steamId), buf);
					next.url = url;
					this.onDisk.add(steamId);
					changed = true;
				}
			}
			this.save();
			if (changed) this.onUpdate();
		} catch (err) {
			// Whatever was read before the failure is kept.
			this.save();
			if (this.profiles[steamId]?.name !== undefined) this.onUpdate();
			log.info('avatar', `${steamId}: profile not fully loaded: ${err instanceof Error ? err.message : String(err)}`);
			this.failed.set(steamId, Date.now());
		}
	}
}
