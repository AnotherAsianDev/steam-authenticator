import { log } from './log';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Profile pictures from the public profile XML (no API key).
 *
 * Gentle by design: each account is fetched at most once a week, one request at
 * a time with a pause between, and a failure is not retried for an hour.
 */
const MAX_AGE_MS = 7 * 24 * 3600_000;
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

export class AvatarCache {
	private failed = new Map<string, number>();
	private queue: Promise<void> = Promise.resolve();
	private pending = new Set<string>();
	/** The list asks every second; the disk is only looked at every few minutes per account. */
	private checkedAt = new Map<string, number>();
	private onDisk = new Set<string>();
	private names: Record<string, string> = {};

	constructor(
		private readonly dir: string,
		private readonly onUpdate: () => void = () => undefined,
		private readonly profileBase = 'https://steamcommunity.com/profiles'
	) {
		try {
			const raw = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8')) as Record<string, unknown>;
			for (const [id, n] of Object.entries(raw)) if (typeof n === 'string') this.names[id] = n;
		} catch {
			/* no names yet */
		}
	}

	/** Look again soon, for example after a setting that needs the profile was turned on. */
	recheck(): void {
		this.checkedAt.clear();
	}

	/** The profile name, once it has been fetched. */
	nickname(steamId: string): string | undefined {
		return this.names[steamId];
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

	/** Queue a download if the cached copy is missing or old. Returns immediately. */
	ensure(steamId: string): void {
		if (this.pending.has(steamId)) return;
		const now = Date.now();
		if (now - (this.checkedAt.get(steamId) ?? 0) < 300_000) return;
		this.checkedAt.set(steamId, now);
		const f = this.file(steamId);
		try {
			if (existsSync(f) && this.names[steamId] !== undefined && Date.now() - statSync(f).mtimeMs < MAX_AGE_MS) return;
		} catch {
			/* treat as missing */
		}
		if (Date.now() - (this.failed.get(steamId) ?? 0) < RETRY_MS) return;
		this.pending.add(steamId);
		this.queue = this.queue
			.then(() => this.download(steamId))
			.catch(() => undefined)
			.finally(() => this.pending.delete(steamId))
			.then(() => new Promise<void>((r) => setTimeout(r, 1500)));
	}

	private async download(steamId: string): Promise<void> {
		try {
			const xml = await fetch(`${this.profileBase}/${steamId}/?xml=1`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
			const name = extractPersonaName(xml);
			if (name && name !== this.names[steamId]) {
				this.names[steamId] = name;
				mkdirSync(this.dir, { recursive: true });
				writeFileSync(join(this.dir, 'names.json'), JSON.stringify(this.names));
				this.onUpdate();
			}
			const url = extractAvatarUrl(xml);
			if (!url) throw new Error('no avatar');
			const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			const buf = Buffer.from(await res.arrayBuffer());
			if (!res.ok || buf.length === 0 || buf.length > MAX_BYTES) throw new Error('bad image');
			mkdirSync(this.dir, { recursive: true });
			writeFileSync(this.file(steamId), buf);
			this.onDisk.add(steamId);
			this.onUpdate();
		} catch (err) {
			log.info('avatar', `${steamId}: profile picture not loaded: ${err instanceof Error ? err.message : String(err)}`);
			this.failed.set(steamId, Date.now());
		}
	}
}
