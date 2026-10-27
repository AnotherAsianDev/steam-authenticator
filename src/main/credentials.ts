import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Saved passwords, one per account, in plain text.
 *
 * Kept in their own file (not inside the maFiles) so the maFiles stay in the
 * standard format. Readable by the current user only.
 */
export class CredentialStore {
	private data: Record<string, string> = {};
	constructor(private readonly file: string) {
		try {
			if (existsSync(file)) {
				const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
				for (const [id, pw] of Object.entries(raw)) if (typeof pw === 'string') this.data[id] = pw;
			}
		} catch {
			this.data = {};
		}
	}
	get(steamId: string): string | undefined {
		return this.data[steamId];
	}
	has(steamId: string): boolean {
		return this.data[steamId] !== undefined;
	}
	set(steamId: string, password: string): void {
		this.data[steamId] = password;
		this.save();
	}
	delete(steamId: string): void {
		if (this.data[steamId] === undefined) return;
		delete this.data[steamId];
		this.save();
	}
	private save(): void {
		const tmp = `${this.file}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
		renameSync(tmp, this.file);
	}
}
