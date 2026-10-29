import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic';

/**
 * When each account was added, for sorting. New accounts get the time they were first seen.
 * Accounts that were there before this existed get the time of their maFile (the earlier of its
 * creation and modification time), written down once so it stays the same afterwards.
 */
export class AddedDates {
	private dates = new Map<string, number>();
	private dirty = false;

	constructor(private readonly file: string) {
		try {
			if (existsSync(file)) {
				const o = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
				for (const [id, t] of Object.entries(o)) if (/^\d{17}$/.test(id) && typeof t === 'number' && Number.isFinite(t)) this.dates.set(id, t);
			}
		} catch {
			/* starts over from the file times */
		}
	}

	/** Milliseconds since 1970. `fallback` is only called for an account not seen before. */
	get(steamId: string, fallback: () => number | undefined): number {
		const known = this.dates.get(steamId);
		if (known !== undefined) return known;
		const t = fallback();
		const value = t !== undefined && t > 0 ? t : Date.now();
		this.dates.set(steamId, value);
		this.dirty = true;
		return value;
	}

	/** Forget accounts that are gone, then write if anything changed. */
	save(keep: string[]): void {
		const wanted = new Set(keep);
		for (const id of this.dates.keys()) {
			if (!wanted.has(id)) {
				this.dates.delete(id);
				this.dirty = true;
			}
		}
		if (!this.dirty) return;
		try {
			writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.dates)));
			this.dirty = false;
		} catch {
			/* only used for sorting; try again next time */
		}
	}
}
