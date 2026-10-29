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

export interface Bans {
	/** A VAC ban is on record. */
	vac: boolean;
	/** "None", "Probation" or "Banned". */
	trade: string;
	/** Steam marks the account as limited (no spending yet). */
	limited: boolean;
}

/** The ban fields of the public profile XML. Undefined when the page does not carry them (for example an error page). */
export function extractBans(xml: string): Bans | undefined {
	const vac = /<vacBanned>\s*([01])\s*<\/vacBanned>/.exec(xml)?.[1];
	if (vac === undefined) return undefined;
	const trade = /<tradeBanState>\s*([A-Za-z]{1,20})\s*<\/tradeBanState>/.exec(xml)?.[1] ?? 'None';
	const limited = /<isLimitedAccount>\s*([01])\s*<\/isLimitedAccount>/.exec(xml)?.[1] === '1';
	return { vac: vac === '1', trade, limited };
}

/** True when something on the account deserves attention. */
export const isBanned = (b: Bans | undefined): boolean => !!b && (b.vac || (b.trade !== 'None' && b.trade !== ''));

interface Profile {
	name?: string;
	/** Address of the picture that is on disk. */
	url?: string;
	/** When the profile page was last read. */
	checked: number;
	bans?: Bans;
}

export class AvatarCache {
	private failed = new Map<string, number>();
	private queue: Promise<void> = Promise.resolve();
	private pending = new Set<string>();
	/** The list asks every second; the disk is only looked at every few minutes per account. */
	private checkedAt = new Map<string, number>();
	private onDisk = new Set<string>();
	private profiles: Record<string, Profile> = {};
	private wants = new Map<string, { image: boolean; bans: boolean }>();

	constructor(
		private readonly dir: string,
		private readonly onUpdate: () => void = () => undefined,
		private readonly profileBase = 'https://steamcommunity.com/profiles',
		private readonly onNewBan: (steamId: string, what: string) => void = () => undefined
	) {
		this.load();
	}

	private load(): void {
		try {
			const raw = JSON.parse(readFileSync(join(this.dir, 'profiles.json'), 'utf8')) as Record<string, Partial<Profile>>;
			for (const [id, p] of Object.entries(raw)) {
				if (typeof p !== 'object' || p === null) continue;
				const b = p.bans;
				this.profiles[id] = {
					...(typeof p.name === 'string' ? { name: p.name } : {}),
					...(typeof p.url === 'string' ? { url: p.url } : {}),
					checked: typeof p.checked === 'number' ? p.checked : 0,
					...(b && typeof b.vac === 'boolean' && typeof b.trade === 'string' ? { bans: { vac: b.vac, trade: b.trade, limited: b.limited === true } } : {})
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
		const haveBans = !want.bans || p?.bans !== undefined;
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
			const name = extractPersonaName(xml);
			if (name) next.name = name;
			const bans = extractBans(xml);
			if (bans) next.bans = bans;
			let changed = name !== before?.name || JSON.stringify(bans) !== JSON.stringify(before?.bans);
			this.profiles[steamId] = next;
			if (bans && before?.bans) {
				if (bans.vac && !before.bans.vac) this.onNewBan(steamId, 'a VAC ban');
				else if (bans.trade !== before.bans.trade && bans.trade !== 'None') this.onNewBan(steamId, `a trade ban (${bans.trade})`);
			}
			if (want.image) {
				const url = extractAvatarUrl(xml);
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
			log.info('avatar', `${steamId}: profile not fully loaded: ${err instanceof Error ? err.message : String(err)}`);
			this.failed.set(steamId, Date.now());
		}
	}
}
