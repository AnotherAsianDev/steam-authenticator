import { SecretFile, type Vault } from './vault';

/**
 * Saved passwords, one per account.
 *
 * Plain text in `credentials.json` by default (kept apart from the maFiles so
 * those stay in the standard format). With a master password the file is
 * encrypted. While it is locked nothing is known about it: `has` says yes, so
 * the app does not nag about "missing" passwords, `get` says nothing, and any
 * change is refused.
 */
export class CredentialStore {
	private data: Record<string, string> = {};
	private readonly f: SecretFile;
	constructor(file: string, vault?: Vault) {
		this.f = new SecretFile(file, 'credentials', vault);
		this.reload();
	}

	/** Read the file again, for example after unlocking. */
	reload(): void {
		this.data = {};
		try {
			const text = this.f.read();
			if (text) {
				const raw = JSON.parse(text) as Record<string, unknown>;
				for (const [id, pw] of Object.entries(raw)) if (typeof pw === 'string') this.data[id] = pw;
			}
		} catch {
			this.data = {};
		}
	}
	get locked(): boolean {
		return this.f.locked;
	}
	get(steamId: string): string | undefined {
		return this.data[steamId];
	}
	has(steamId: string): boolean {
		return this.f.locked || this.data[steamId] !== undefined;
	}
	set(steamId: string, password: string): void {
		this.save({ ...this.data, [steamId]: password });
	}
	delete(steamId: string): void {
		if (this.data[steamId] === undefined) return;
		const next = { ...this.data };
		delete next[steamId];
		this.save(next);
	}
	/** Write what is in memory again, sealed or (with `plain`) as plain text. */
	rewrite(plain = false): void {
		this.f.write(JSON.stringify(this.data), plain);
	}
	private save(next: Record<string, string>): void {
		this.f.write(JSON.stringify(next));
		this.data = next;
	}
}
