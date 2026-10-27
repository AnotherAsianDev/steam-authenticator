import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MaFileError, parseMaFile } from './mafile';

export interface TrashEntry {
	/** `<steamid>.<milliseconds>`, unique per removal. */
	id: string;
	steamId: string;
	name: string;
	/** Unix seconds. */
	removedAt: number;
	hasPassword: boolean;
}

const ID = /^\d{17}\.\d{10,14}$/;

/**
 * Removed accounts wait here instead of being deleted.
 *
 *   <dir>/<steamid>.<time>.maFile   the maFile exactly as it was (SDA format)
 *   <dir>/<steamid>.<time>.json     when it was removed, and the saved password if there was one
 *
 * Nothing leaves this folder unless the user empties it.
 */
export class Trash {
	constructor(readonly dir: string) {}

	private file(id: string, ext: 'maFile' | 'json'): string {
		if (!ID.test(id)) throw new Error('Invalid trash entry');
		return join(this.dir, `${id}.${ext}`);
	}

	private write(path: string, text: string): void {
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, text, { mode: 0o600 });
		renameSync(tmp, path);
	}

	/** Keep a copy. The details go first, so an entry that is listed always has its password. */
	put(steamId: string, maFile: string, password?: string, now = Date.now()): string {
		if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid SteamID');
		mkdirSync(this.dir, { recursive: true });
		let id = `${steamId}.${now}`;
		while (existsSync(this.file(id, 'maFile'))) id = `${steamId}.${++now}`;
		this.write(this.file(id, 'json'), JSON.stringify({ removedAt: Math.floor(now / 1000), ...(password ? { password } : {}) }));
		this.write(this.file(id, 'maFile'), maFile);
		return id;
	}

	list(): TrashEntry[] {
		if (!existsSync(this.dir)) return [];
		const out: TrashEntry[] = [];
		for (const f of readdirSync(this.dir)) {
			const m = /^(\d{17}\.\d{10,14})\.maFile$/.exec(f);
			if (!m) continue;
			const id = m[1]!;
			const steamId = id.slice(0, 17);
			let name = steamId;
			try {
				name = parseMaFile(readFileSync(this.file(id, 'maFile'), 'utf8')).accountName;
			} catch (err) {
				if (!(err instanceof MaFileError)) throw err;
			}
			const meta = this.meta(id);
			out.push({ id, steamId, name, removedAt: meta.removedAt ?? Math.floor(Number(id.slice(18)) / 1000), hasPassword: !!meta.password });
		}
		return out.sort((a, b) => b.removedAt - a.removedAt);
	}

	private meta(id: string): { removedAt?: number; password?: string } {
		try {
			const raw = JSON.parse(readFileSync(this.file(id, 'json'), 'utf8')) as Record<string, unknown>;
			return {
				...(typeof raw['removedAt'] === 'number' ? { removedAt: raw['removedAt'] } : {}),
				...(typeof raw['password'] === 'string' ? { password: raw['password'] } : {})
			};
		} catch {
			return {};
		}
	}

	/** SteamIDs that are in the trash. */
	steamIds(): Set<string> {
		return new Set(this.list().map((e) => e.steamId));
	}

	read(id: string): { steamId: string; maFile: string; password?: string } {
		const maFile = readFileSync(this.file(id, 'maFile'), 'utf8');
		const password = this.meta(id).password;
		return { steamId: id.slice(0, 17), maFile, ...(password ? { password } : {}) };
	}

	discard(id: string): void {
		rmSync(this.file(id, 'maFile'), { force: true });
		rmSync(this.file(id, 'json'), { force: true });
	}

	empty(): number {
		const all = this.list();
		for (const e of all) this.discard(e.id);
		return all.length;
	}
}
