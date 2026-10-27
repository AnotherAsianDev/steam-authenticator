import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Confirmation } from './confirmations';

export interface CachedStatus {
	fetchedAt: number;
	items: Confirmation[];
	unreadable: number;
}
export interface CachedAccess {
	token: string;
	exp: number;
}

/**
 * What the last check found, and the short-lived access tokens, kept on disk so
 * that restarting the app does not mean asking Steam everything again.
 */
export class StateCache {
	private data: { status: Record<string, CachedStatus>; access: Record<string, CachedAccess> } = { status: {}, access: {} };
	constructor(private readonly file: string) {
		try {
			if (existsSync(file)) {
				const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<typeof this.data>;
				if (raw.status && typeof raw.status === 'object') this.data.status = raw.status;
				if (raw.access && typeof raw.access === 'object') this.data.access = raw.access;
			}
		} catch {
			/* an unreadable cache is just an empty one */
		}
	}
	status(id: string): CachedStatus | undefined {
		const s = this.data.status[id];
		return s && Array.isArray(s.items) && typeof s.fetchedAt === 'number' ? s : undefined;
	}
	access(id: string): CachedAccess | undefined {
		const a = this.data.access[id];
		return a && typeof a.token === 'string' && typeof a.exp === 'number' ? a : undefined;
	}
	setStatus(id: string, s: CachedStatus): void {
		this.data.status[id] = s;
		this.save();
	}
	setAccess(id: string, a: CachedAccess): void {
		this.data.access[id] = a;
		this.save();
	}
	dropAccess(id: string): void {
		if (!this.data.access[id]) return;
		delete this.data.access[id];
		this.save();
	}
	drop(id: string): void {
		delete this.data.status[id];
		delete this.data.access[id];
		this.save();
	}
	private save(): void {
		try {
			const tmp = `${this.file}.tmp`;
			writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
			renameSync(tmp, this.file);
		} catch {
			/* caching is best effort */
		}
	}
}
