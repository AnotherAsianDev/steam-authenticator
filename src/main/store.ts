import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Plain maFiles in one folder the app owns:
 *
 *   <dir>/<steamid>.maFile
 *
 * Same format SDA uses, stored verbatim, so the folder can be opened, backed up
 * or copied back into SDA directly. Nothing is encrypted.
 */
export class MaFileStore {
	constructor(readonly dir: string) {}

	private path(steamId: string): string {
		if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid SteamID');
		return join(this.dir, `${steamId}.maFile`);
	}

	/** Atomic write (temp file, then rename), readable by the current user only. */
	save(steamId: string, text: string): void {
		mkdirSync(this.dir, { recursive: true });
		const target = this.path(steamId);
		const tmp = `${target}.tmp`;
		writeFileSync(tmp, text, { mode: 0o600 });
		renameSync(tmp, target);
	}

	has(steamId: string): boolean {
		return existsSync(this.path(steamId));
	}

	read(steamId: string): string {
		return readFileSync(this.path(steamId), 'utf8');
	}

	remove(steamId: string): void {
		rmSync(this.path(steamId), { force: true });
	}

	list(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((f) => /^\d{17}\.maFile$/.test(f))
			.map((f) => f.slice(0, 17))
			.sort();
	}
}
