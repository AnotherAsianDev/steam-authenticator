import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic';
import { log } from './log';

/**
 * Tells the user that a newer release exists. It never downloads or installs anything:
 * the user opens the release page and replaces the folder themselves.
 * One request to the GitHub API each time the app starts (and on "Check now"), only when the setting is on.
 */

export const REPO = 'AnotherAsianDev/steam-authenticator';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface Update {
	version: string;
	/** Built here from the tag, never taken from the reply, so it can only ever point at this repository's release page. */
	url: string;
}

const parts = (v: string): number[] | undefined => {
	const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v.trim());
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

export function isNewer(latest: string, current: string): boolean {
	const a = parts(latest);
	const b = parts(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
	return false;
}

export function releaseFromReply(body: unknown): Update | undefined {
	const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const tag = o['tag_name'];
	if (typeof tag !== 'string' || !parts(tag) || o['draft'] === true || o['prerelease'] === true) return undefined;
	return { version: tag.replace(/^v/, ''), url: `https://github.com/${REPO}/releases/tag/${tag}` };
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class UpdateChecker {
	constructor(
		private readonly file: string,
		private readonly current: string,
		private readonly fetcher: Fetch = fetch as unknown as Fetch,
		private readonly now: () => number = Date.now
	) {}

	private load(): { checkedAt: number; latest?: Update } {
		try {
			if (existsSync(this.file)) {
				const o = JSON.parse(readFileSync(this.file, 'utf8')) as { checkedAt?: unknown; latest?: unknown };
				const latest = o.latest && typeof o.latest === 'object' ? releaseFromReply({ tag_name: `v${(o.latest as Update).version}` }) : undefined;
				return { checkedAt: typeof o.checkedAt === 'number' ? o.checkedAt : 0, ...(latest ? { latest } : {}) };
			}
		} catch {
			/* treated as never checked */
		}
		return { checkedAt: 0 };
	}

	private save(state: { checkedAt: number; latest?: Update }): void {
		try {
			writeFileAtomic(this.file, JSON.stringify(state));
		} catch {
			/* only a cache */
		}
	}

	/** The newer release, if there is one. Always asks GitHub; when that fails the last known answer is used. Network trouble is not an error. */
	async check(): Promise<Update | undefined> {
		let state = this.load();
		try {
			const res = await this.fetcher(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'steam-authenticator-update-check' }, signal: AbortSignal.timeout(8000) });
			if (res.ok) {
				const latest = releaseFromReply(await res.json());
				state = { checkedAt: this.now(), ...(latest ? { latest } : {}) };
				this.save(state);
			} else if (res.status === 404) {
				// No release published (yet): nothing to offer.
				state = { checkedAt: this.now() };
				this.save(state);
			}
		} catch (err) {
			log.info('update', `Could not check for updates: ${err instanceof Error ? err.message : 'unknown error'}`);
		}
		return state.latest && isNewer(state.latest.version, this.current) ? state.latest : undefined;
	}
}
